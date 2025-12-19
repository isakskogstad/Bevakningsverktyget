"""
Allabolag.se Scraper with Supabase Integration
Primary source for: board, management, financials, corporate structure

Features:
- Both sync and async HTTP support
- Structured logging
- Rate limiting (minimum 1 second between requests)
- Supabase integration for company_details, company_roles, company_financials
- Caching based on last_synced_at
"""

import re
import json
import time
import asyncio
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from bs4 import BeautifulSoup
import httpx
from supabase import create_client, Client

# Import base scraper if it exists
try:
    from .base import BaseScraper
    HAS_BASE = True
except ImportError:
    HAS_BASE = False


class AllabolagScraper:
    """
    Scraper for allabolag.se with Supabase integration

    Provides:
    - Board and management data
    - Financial statements
    - Corporate structure (parent/subsidiaries)
    - SNI codes and industries
    - Company announcements

    Saves to:
    - company_details (main company info)
    - company_roles (board, management, auditors)
    - company_financials (financial periods)
    """

    BASE_URL = "https://www.allabolag.se"

    # Map Allabolag account codes to our database fields
    ACCOUNT_CODE_MAP = {
        # Resultaträkning
        'SDI': 'revenue',
        'AVI': 'other_income',
        'RRK': 'operating_costs',
        'RVK': 'raw_materials',
        'HVK': 'goods',
        'ADI': 'depreciation_intangible',
        'ADK': 'depreciation_tangible',
        'AEK': 'other_external_costs',
        'LFL': 'inventory_change',
        'RR': 'operating_profit',
        'FI': 'financial_income',
        'FK': 'financial_costs',
        'RFFN': 'profit_after_financial',
        'DR': 'net_profit',

        # Balansräkning - Tillgångar
        'SIA': 'intangible_assets',
        'SMA': 'tangible_assets',
        'SFA': 'financial_assets',
        'SVL': 'inventory',
        'SKG': 'receivables',
        'SKO': 'cash',
        'SGE': 'total_assets',

        # Balansräkning - Skulder & EK
        'AKT': 'share_capital',
        'SEK': 'equity',
        'SOB': 'untaxed_reserves',
        'SAS': 'provisions',
        'SLS': 'long_term_liabilities',
        'SKS': 'short_term_liabilities',

        # Nyckeltal
        'avk_eget_kapital': 'return_on_equity',
        'avk_totalt_kapital': 'return_on_assets',
        'EKA': 'equity_ratio',
        'RG': 'profit_margin',
        'kassalikviditet': 'quick_ratio',

        # Personal
        'ANT': 'num_employees',
        'loner_styrelse_vd': 'salaries_board_ceo',
        'loner_ovriga': 'salaries_other',
        'sociala_avgifter': 'social_costs',
        'RPE': 'revenue_per_employee',
    }

    ROLE_CATEGORY_MAP = {
        # Board roles
        'Styrelseledamot': 'BOARD',
        'Styrelsesuppleant': 'BOARD',
        'Styrelseordförande': 'BOARD',
        'Ledamot': 'BOARD',
        'Suppleant': 'BOARD',
        'Ordförande': 'BOARD',
        # Management roles
        'Vice verkställande direktör': 'MANAGEMENT',
        'Verkställande direktör': 'MANAGEMENT',
        'Extern verkställande direktör': 'MANAGEMENT',
        'VD': 'MANAGEMENT',
        # Auditor roles
        'Revisor': 'AUDITOR',
        'Revisorssuppleant': 'AUDITOR',
        'Huvudansvarig revisor': 'AUDITOR',
        'Lekmannarevisor': 'AUDITOR',
        # Other roles
        'Extern firmatecknare': 'OTHER',
        'Bolagsman': 'OTHER',
        'Komplementär': 'OTHER',
        'Likvidator': 'OTHER',
    }

    def __init__(self,
                 supabase_url: Optional[str] = None,
                 supabase_key: Optional[str] = None,
                 delay: float = 1.0,
                 cache_hours: int = 24):
        """
        Initialize Allabolag scraper.

        Args:
            supabase_url: Supabase project URL (if None, no DB integration)
            supabase_key: Supabase service role key
            delay: Minimum delay between requests (default 1.0s)
            cache_hours: Hours before re-scraping (default 24)
        """
        self.delay = delay
        self.cache_hours = cache_hours
        self.last_request = 0

        # Initialize Supabase client if credentials provided
        self.supabase: Optional[Client] = None
        if supabase_url and supabase_key:
            self.supabase = create_client(supabase_url, supabase_key)

    def _rate_limit(self):
        """Ensure minimum delay between requests."""
        elapsed = time.time() - self.last_request
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self.last_request = time.time()

    async def _rate_limit_async(self):
        """Async rate limiting."""
        elapsed = time.time() - self.last_request
        if elapsed < self.delay:
            await asyncio.sleep(self.delay - elapsed)
        self.last_request = time.time()

    def _fetch_page(self, url: str) -> Optional[str]:
        """Fetch page with rate limiting (sync)."""
        self._rate_limit()

        try:
            response = httpx.get(url, timeout=30, follow_redirects=True)
            response.raise_for_status()
            return response.text
        except httpx.HTTPError as e:
            print(f"HTTP error fetching {url}: {e}")
            return None

    async def _fetch_page_async(self, url: str) -> Optional[str]:
        """Fetch page with rate limiting (async)."""
        await self._rate_limit_async()

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, timeout=30, follow_redirects=True)
                response.raise_for_status()
                return response.text
        except httpx.HTTPError as e:
            print(f"HTTP error fetching {url}: {e}")
            return None

    def _extract_json_data(self, html: str) -> Optional[Dict]:
        """Extract JSON data from script tags (Next.js format)."""
        soup = BeautifulSoup(html, 'html.parser')

        # Try Next.js __NEXT_DATA__ format first (current format)
        next_data_script = soup.find('script', {'id': '__NEXT_DATA__'})
        if next_data_script and next_data_script.string:
            try:
                data = json.loads(next_data_script.string)
                page_props = data.get('props', {}).get('pageProps', {})
                if page_props.get('company'):
                    return page_props
            except json.JSONDecodeError:
                pass

        return None

    def _should_scrape(self, orgnr: str) -> bool:
        """Check if we should scrape (based on cache)."""
        if not self.supabase:
            return True

        try:
            result = self.supabase.table('company_details')\
                .select('last_synced_at')\
                .eq('orgnr', orgnr)\
                .execute()

            if not result.data:
                return True

            last_synced = result.data[0].get('last_synced_at')
            if not last_synced:
                return True

            # Parse timestamp and check if older than cache_hours
            synced_time = datetime.fromisoformat(last_synced.replace('Z', '+00:00'))
            return datetime.now(synced_time.tzinfo) - synced_time > timedelta(hours=self.cache_hours)

        except Exception as e:
            print(f"Error checking cache: {e}")
            return True

    # =========================================================================
    # SYNC API
    # =========================================================================

    def scrape_company(self, orgnr: str, force: bool = False) -> Optional[Dict[str, Any]]:
        """
        Scrape complete company data from Allabolag (sync).

        Args:
            orgnr: Organization number
            force: Force scraping even if cached data exists

        Returns:
            Company data dict or None if not found
        """
        orgnr = orgnr.replace('-', '')

        # Check cache unless force
        if not force and not self._should_scrape(orgnr):
            print(f"Using cached data for {orgnr} (last synced within {self.cache_hours}h)")
            return self._get_cached_data(orgnr)

        start_time = time.perf_counter()

        # Fetch main page
        main_url = f"{self.BASE_URL}/{orgnr}"
        main_html = self._fetch_page(main_url)
        if not main_html:
            return None

        main_data = self._extract_json_data(main_html)
        if not main_data:
            return None

        # Fetch organization page for related companies
        org_url = f"{self.BASE_URL}/{orgnr}/organisation"
        org_html = self._fetch_page(org_url)
        org_data = self._extract_json_data(org_html) if org_html else None

        # Parse and structure data
        result = self._structure_nextjs_data(main_data, org_data, orgnr)

        # Save to Supabase if client configured
        if self.supabase:
            self._save_to_supabase(result)

        duration_ms = (time.perf_counter() - start_time) * 1000
        print(f"Scraped {orgnr} from allabolag in {duration_ms:.0f}ms")

        return result

    # =========================================================================
    # ASYNC API
    # =========================================================================

    async def scrape_company_async(self, orgnr: str, force: bool = False) -> Optional[Dict[str, Any]]:
        """
        Scrape complete company data from Allabolag (async).

        Args:
            orgnr: Organization number
            force: Force scraping even if cached data exists

        Returns:
            Company data dict or None if not found
        """
        orgnr = orgnr.replace('-', '')

        # Check cache unless force
        if not force and not self._should_scrape(orgnr):
            print(f"Using cached data for {orgnr}")
            return self._get_cached_data(orgnr)

        start_time = time.perf_counter()

        # Fetch main and org pages in parallel
        main_url = f"{self.BASE_URL}/{orgnr}"
        org_url = f"{self.BASE_URL}/{orgnr}/organisation"

        main_task = self._fetch_page_async(main_url)
        org_task = self._fetch_page_async(org_url)

        main_html, org_html = await asyncio.gather(main_task, org_task)

        if not main_html:
            return None

        main_data = self._extract_json_data(main_html)
        if not main_data:
            return None

        org_data = self._extract_json_data(org_html) if org_html else None

        # Parse and structure data
        result = self._structure_nextjs_data(main_data, org_data, orgnr)

        # Save to Supabase if client configured
        if self.supabase:
            self._save_to_supabase(result)

        duration_ms = (time.perf_counter() - start_time) * 1000
        print(f"Async scraped {orgnr} from allabolag in {duration_ms:.0f}ms")

        return result

    # =========================================================================
    # DATA PARSING
    # =========================================================================

    def _structure_nextjs_data(self, main_data: Dict, org_data: Optional[Dict], orgnr: str) -> Dict[str, Any]:
        """Structure data from Next.js format (props.pageProps.company)."""
        company = main_data.get('company', {})
        trademarks_data = main_data.get('trademarks', {})

        result = {
            'orgnr': orgnr,
            'name': company.get('name') or company.get('legalName'),
            'company_type': company.get('companyType', {}).get('code'),
            'status': company.get('status', {}).get('status', 'UNKNOWN'),
            'purpose': company.get('purpose'),
            'registered_date': company.get('registrationDate'),
            'foundation_year': company.get('foundationYear'),
            'source_basic': 'allabolag',
            'last_synced_at': datetime.now().isoformat()
        }

        # Postal address
        postal = company.get('postalAddress', {})
        if postal:
            result['postal_street'] = postal.get('addressLine')
            result['postal_code'] = postal.get('zipCode')
            result['postal_city'] = postal.get('postPlace')

        # Visitor address
        visitor = company.get('visitorAddress', {})
        if visitor:
            result['visiting_street'] = visitor.get('addressLine')
            result['visiting_code'] = visitor.get('zipCode')
            result['visiting_city'] = visitor.get('postPlace')

        # Contact info
        result['phone'] = company.get('phone') or company.get('legalPhone')
        result['email'] = company.get('email')
        result['website'] = company.get('homePage')

        # Location / GPS
        location = company.get('location', {})
        coords = location.get('coordinates', [{}])
        if coords:
            result['latitude'] = coords[0].get('ycoordinate')
            result['longitude'] = coords[0].get('xcoordinate')

        result['municipality'] = location.get('municipality')
        result['municipality_code'] = location.get('municipalityCode')
        result['county'] = location.get('county')
        result['county_code'] = location.get('countyCode')

        # LEI code
        result['lei_code'] = company.get('leiCode') or company.get('lei')

        # Registrations
        result['moms_registered'] = 1 if company.get('registeredForVat') else 0
        result['employer_registered'] = 1 if company.get('registeredForPayrollTax') else 0

        vat_desc = company.get('registeredForVatDescription', '') or ''
        has_fskatt = 'f-skatt' in vat_desc.lower()

        registry_entries = company.get('registryStatusEntries', [])
        if isinstance(registry_entries, list):
            for entry in registry_entries:
                if isinstance(entry, dict):
                    label = entry.get('label', '')
                    value = entry.get('value', False)
                    if label == 'registeredForPrepayment' and value:
                        has_fskatt = True
                        break

        result['f_skatt'] = 1 if has_fskatt else 0

        # Corporate structure
        corp_structure = company.get('corporateStructure', {})
        if corp_structure:
            num_subsidiaries = corp_structure.get('numberOfSubsidiaries', 0)
            num_companies = corp_structure.get('numberOfCompanies', 0)
            result['is_group'] = 1 if (num_subsidiaries and num_subsidiaries > 0) else 0
            result['companies_in_group'] = num_companies if num_companies else None

            parent_orgnr = corp_structure.get('parentCompanyOrganisationNumber')
            parent_name = corp_structure.get('parentCompanyName')
            if parent_orgnr:
                result['parent_orgnr'] = parent_orgnr
                result['parent_name'] = parent_name

        # Share capital
        share_capital = company.get('shareCapital')
        if share_capital:
            try:
                result['share_capital'] = int(float(share_capital))
            except (ValueError, TypeError):
                pass

        # Financial summary
        try:
            result['revenue'] = int(float(company.get('revenue', 0)) * 1000) if company.get('revenue') else None
            result['net_profit'] = int(float(company.get('profit', 0)) * 1000) if company.get('profit') else None
        except (ValueError, TypeError):
            result['revenue'] = None
            result['net_profit'] = None

        # Employee count
        employees = company.get('numberOfEmployees')
        if employees:
            if isinstance(employees, str):
                if '-' in employees:
                    try:
                        result['num_employees'] = int(employees.split('-')[0])
                    except ValueError:
                        result['num_employees'] = None
                else:
                    try:
                        result['num_employees'] = int(employees)
                    except ValueError:
                        result['num_employees'] = None
            else:
                result['num_employees'] = int(employees)
        else:
            result['num_employees'] = None

        # Industries / SNI codes
        result['industries'] = []
        for nace in company.get('naceIndustries', []):
            if ' ' in nace:
                parts = nace.split(' ', 1)
                result['industries'].append({
                    'sni_code': parts[0],
                    'sni_description': parts[1] if len(parts) > 1 else None,
                    'is_primary': 1 if not result['industries'] else 0
                })

        # Financials - parse from companyAccounts and corporateAccounts
        result['financials'] = []

        for period in company.get('companyAccounts', []):
            fin = self._parse_financial_period_nextjs(period, is_consolidated=False)
            if fin:
                result['financials'].append(fin)

        for period in company.get('corporateAccounts', []):
            fin = self._parse_financial_period_nextjs(period, is_consolidated=True)
            if fin:
                result['financials'].append(fin)

        # Update summary fields from latest financials
        if result['financials']:
            company_financials = [f for f in result['financials'] if not f.get('is_consolidated')]
            if company_financials:
                latest = company_financials[0]
                if result.get('revenue') is None:
                    result['revenue'] = latest.get('revenue')
                if result.get('net_profit') is None:
                    result['net_profit'] = latest.get('net_profit')
                if result.get('num_employees') is None:
                    result['num_employees'] = latest.get('num_employees')
                result['total_assets'] = latest.get('total_assets')
                result['equity'] = latest.get('equity')
                result['equity_ratio'] = latest.get('equity_ratio')
                result['return_on_equity'] = latest.get('return_on_equity')

        # Board, Management, Revision and Other roles
        result['roles'] = []
        roles_data = company.get('roles', {})

        role_groups = roles_data.get('roleGroups', [])
        for group in role_groups:
            group_name = group.get('name', '')
            for role_entry in group.get('roles', []):
                # Skip company entries
                if role_entry.get('type') == 'Company':
                    continue

                role_type = role_entry.get('role', '')
                result['roles'].append({
                    'name': role_entry.get('name'),
                    'birth_year': self._parse_birth_year(role_entry.get('birthDate')),
                    'role_type': role_type,
                    'role_category': self._map_role_category(group_name, role_type),
                    'source': 'allabolag'
                })

        # Related companies from org page
        result['related_companies'] = []
        if org_data:
            overview = org_data.get('companyOverview', {})
            subsidiaries = overview.get('dotterbolag', [])

            if not subsidiaries:
                subsidiaries = org_data.get('relatedCompanies', [])
            if not subsidiaries:
                subsidiaries = org_data.get('company', {}).get('relatedCompanies', [])

            for rel in subsidiaries:
                if isinstance(rel, dict):
                    result['related_companies'].append({
                        'related_orgnr': rel.get('orgnr') or rel.get('orgNumber'),
                        'related_name': rel.get('namn') or rel.get('name'),
                        'relation_type': rel.get('relation_type', 'subsidiary'),
                        'source': 'allabolag'
                    })

        # Announcements
        result['announcements'] = []
        announcements_data = (
            company.get('announcements', []) or
            company.get('kungorelser', []) or
            main_data.get('announcements', []) or
            []
        )
        for ann in announcements_data[:10]:
            result['announcements'].append({
                'announcement_type': ann.get('type') or ann.get('typ'),
                'announcement_date': ann.get('date') or ann.get('datum'),
                'description': ann.get('text') or ann.get('description'),
                'source': 'allabolag'
            })

        return result

    def _parse_birth_year(self, birth_date: str) -> Optional[int]:
        """Parse birth year from date string like '01.02.1989'."""
        if not birth_date:
            return None
        try:
            parts = birth_date.split('.')
            if len(parts) >= 3:
                return int(parts[2])
        except (ValueError, IndexError):
            pass
        return None

    def _map_role_category(self, group_name: str, role_type: str) -> str:
        """Map Allabolag role group and type to our category."""
        if role_type in self.ROLE_CATEGORY_MAP:
            return self.ROLE_CATEGORY_MAP[role_type]

        group_mapping = {
            'Management': 'MANAGEMENT',
            'Board': 'BOARD',
            'Revision': 'AUDITOR',
            'Other': 'OTHER'
        }
        return group_mapping.get(group_name, 'OTHER')

    def _parse_financial_period_nextjs(self, period: Dict, is_consolidated: bool) -> Optional[Dict]:
        """Parse a financial period from Next.js format."""
        if not period:
            return None

        year = period.get('year')
        if year:
            try:
                year = int(year)
            except (ValueError, TypeError):
                year = None

        length = period.get('length', '12')
        try:
            period_months = int(length)
        except (ValueError, TypeError):
            period_months = 12

        result = {
            'period_year': year,
            'period_months': period_months,
            'is_consolidated': 1 if is_consolidated else 0,
            'source': 'allabolag'
        }

        # Codes that should NOT be multiplied by 1000
        NO_MULTIPLY_CODES = {'ANT', 'EKA', 'RG', 'RPE', 'avk_eget_kapital', 'avk_totalt_kapital', 'kassalikviditet'}

        accounts = period.get('accounts', [])
        for acc in accounts:
            code = acc.get('code')
            amount = acc.get('amount')
            if code and code in self.ACCOUNT_CODE_MAP and amount is not None:
                field = self.ACCOUNT_CODE_MAP[code]
                try:
                    if code in NO_MULTIPLY_CODES:
                        result[field] = int(float(amount))
                    else:
                        # Amount is in thousands (TSEK) - convert to SEK
                        result[field] = int(float(amount) * 1000)
                except (ValueError, TypeError):
                    pass

        return result

    # =========================================================================
    # SUPABASE INTEGRATION
    # =========================================================================

    def _get_cached_data(self, orgnr: str) -> Optional[Dict]:
        """Get cached company data from Supabase."""
        if not self.supabase:
            return None

        try:
            result = self.supabase.table('company_details')\
                .select('*')\
                .eq('orgnr', orgnr)\
                .execute()

            if result.data:
                return result.data[0]
            return None
        except Exception as e:
            print(f"Error fetching cached data: {e}")
            return None

    def _save_to_supabase(self, data: Dict[str, Any]) -> bool:
        """Save scraped data to Supabase tables."""
        if not self.supabase:
            return False

        try:
            # Prepare company_details data
            details = {k: v for k, v in data.items()
                      if k not in ['roles', 'financials', 'related_companies',
                                   'announcements', 'industries']}

            # Upsert company_details
            self.supabase.table('company_details')\
                .upsert(details, on_conflict='orgnr')\
                .execute()

            # Save roles to company_roles
            if data.get('roles'):
                # Delete existing roles for this company
                self.supabase.table('company_roles')\
                    .delete()\
                    .eq('orgnr', data['orgnr'])\
                    .execute()

                # Insert new roles
                roles = [{'orgnr': data['orgnr'], **role} for role in data['roles']]
                self.supabase.table('company_roles')\
                    .insert(roles)\
                    .execute()

            # Save financials to company_financials
            if data.get('financials'):
                # Delete existing financials
                self.supabase.table('company_financials')\
                    .delete()\
                    .eq('orgnr', data['orgnr'])\
                    .execute()

                # Insert new financials
                financials = [{'orgnr': data['orgnr'], **fin} for fin in data['financials']]
                self.supabase.table('company_financials')\
                    .insert(financials)\
                    .execute()

            print(f"Saved {data['orgnr']} to Supabase")
            return True

        except Exception as e:
            print(f"Error saving to Supabase: {e}")
            return False


# Convenience function
def scrape_allabolag(orgnr: str,
                    supabase_url: Optional[str] = None,
                    supabase_key: Optional[str] = None) -> Optional[Dict]:
    """Quick scrape function with optional Supabase integration."""
    scraper = AllabolagScraper(supabase_url=supabase_url, supabase_key=supabase_key)
    return scraper.scrape_company(orgnr)
