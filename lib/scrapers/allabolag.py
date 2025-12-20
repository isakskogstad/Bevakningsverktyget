"""
Allabolag.se Scraper
Primary source for: board, management, financials, corporate structure

Features:
- Both sync and async HTTP support
- Structured logging
- Rate limiting
"""

import re
import json
import time
import asyncio
from typing import Dict, Any, Optional, List
from bs4 import BeautifulSoup

from .base import BaseScraper


class AllabolagScraper(BaseScraper):
    """
    Scraper for allabolag.se

    Provides:
    - Board and management data
    - Financial statements
    - Corporate structure (parent/subsidiaries)
    - SNI codes and industries
    - Company announcements
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
        'Ledamot': 'BOARD',           # New format
        'Suppleant': 'BOARD',          # New format
        'Ordförande': 'BOARD',         # New format
        # Management roles
        'Vice verkställande direktör': 'MANAGEMENT',
        'Verkställande direktör': 'MANAGEMENT',
        'Extern verkställande direktör': 'MANAGEMENT',
        'Extern firmatecknare': 'OTHER',  # Changed to OTHER - not really management
        'VD': 'MANAGEMENT',            # Short form
        # Auditor roles
        'Revisor': 'AUDITOR',
        'Revisorssuppleant': 'AUDITOR',
        'Huvudansvarig revisor': 'AUDITOR',
        'Lekmannarevisor': 'AUDITOR',
        # Other roles
        'Bolagsman': 'OTHER',
        'Komplementär': 'OTHER',
        'Likvidator': 'OTHER',
    }

    def __init__(self, delay: float = 1.0):
        """
        Initialize Allabolag scraper.

        Args:
            delay: Minimum delay between requests (default 1.0s)
        """
        super().__init__(
            source_name='allabolag',
            delay=delay,
            base_url=self.BASE_URL
        )

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

        # Fallback to old window.__INITIAL_DATA__ format
        for script in soup.find_all('script'):
            if script.string and 'window.__INITIAL_DATA__' in script.string:
                match = re.search(
                    r'window\.__INITIAL_DATA__\s*=\s*({.*?});',
                    script.string,
                    re.DOTALL
                )
                if match:
                    try:
                        return json.loads(match.group(1))
                    except json.JSONDecodeError:
                        pass
        return None

    # =========================================================================
    # SYNC API
    # =========================================================================

    def scrape_company(self, orgnr: str) -> Optional[Dict[str, Any]]:
        """
        Scrape complete company data from Allabolag (sync).

        Args:
            orgnr: Organization number

        Returns:
            Company data dict or None if not found
        """
        orgnr = orgnr.replace('-', '')
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
        result = self._structure_data(main_data, org_data, orgnr)

        duration_ms = (time.perf_counter() - start_time) * 1000
        self.logger.info(
            f"Scraped {orgnr} from allabolag",
            orgnr=orgnr,
            action="scrape_complete",
            duration_ms=duration_ms
        )

        return result

    # =========================================================================
    # ASYNC API
    # =========================================================================

    async def scrape_company_async(self, orgnr: str) -> Optional[Dict[str, Any]]:
        """
        Scrape complete company data from Allabolag (async).

        Uses native async HTTP for better performance.

        Args:
            orgnr: Organization number

        Returns:
            Company data dict or None if not found
        """
        orgnr = orgnr.replace('-', '')
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
        result = self._structure_data(main_data, org_data, orgnr)

        duration_ms = (time.perf_counter() - start_time) * 1000
        self.logger.info(
            f"Async scraped {orgnr} from allabolag",
            orgnr=orgnr,
            action="async_scrape_complete",
            duration_ms=duration_ms
        )

        return result

    # =========================================================================
    # DATA PARSING
    # =========================================================================

    def _structure_data(self, main_data: Dict, org_data: Dict, orgnr: str) -> Dict[str, Any]:
        """Structure extracted data into our format."""
        # Handle new Next.js format (props.pageProps.company)
        if 'company' in main_data:
            return self._structure_nextjs_data(main_data, org_data, orgnr)

        # Old format (companyOverview)
        company_data = main_data.get('companyOverview', {})

        result = {
            'orgnr': orgnr,
            'name': company_data.get('namn'),
            'company_type': company_data.get('foretagsform'),
            'status': 'ACTIVE' if company_data.get('status') == 'Aktivt' else company_data.get('status'),
            'purpose': company_data.get('ataInfo'),
            'registered_date': company_data.get('regDatum'),
            'foundation_year': company_data.get('grundat'),
            'source': 'allabolag'
        }

        # Address
        if company_data.get('adress'):
            addr = company_data['adress']
            result['postal_street'] = addr.get('gata')
            result['postal_code'] = addr.get('postnummer')
            result['postal_city'] = addr.get('ort')

        if company_data.get('besoksadress'):
            addr = company_data['besoksadress']
            result['visiting_street'] = addr.get('gata')
            result['visiting_code'] = addr.get('postnummer')
            result['visiting_city'] = addr.get('ort')

        # Contact
        result['phone'] = company_data.get('telefon')
        result['email'] = company_data.get('email')
        result['website'] = company_data.get('hemsida')

        # GPS
        if company_data.get('koordinater'):
            coords = company_data['koordinater']
            result['latitude'] = coords.get('lat')
            result['longitude'] = coords.get('lng')

        # Registrations
        result['f_skatt'] = 1 if company_data.get('fskatt') else 0
        result['moms_registered'] = 1 if company_data.get('momsregistrerad') else 0
        result['employer_registered'] = 1 if company_data.get('arbetsgivarregistrerad') else 0

        # Board & Management
        result['roles'] = []
        for person in company_data.get('befattningar', []):
            role = {
                'name': person.get('namn'),
                'birth_year': person.get('fodelsear'),
                'role_type': person.get('typ'),
                'role_category': self.ROLE_CATEGORY_MAP.get(person.get('typ'), 'OTHER'),
                'source': 'allabolag'
            }
            result['roles'].append(role)

        # Signatories
        result['signatories'] = []
        for sig in company_data.get('firmatecknare', []):
            result['signatories'].append(sig)

        # Financials
        result['financials'] = []

        # Company accounts
        for period in company_data.get('companyAccounts', []):
            fin = self._parse_financial_period(period, is_consolidated=False)
            if fin:
                result['financials'].append(fin)

        # Consolidated accounts
        for period in company_data.get('corporateAccounts', []):
            fin = self._parse_financial_period(period, is_consolidated=True)
            if fin:
                result['financials'].append(fin)

        # Corporate structure
        result['is_group'] = company_data.get('koncern', False)
        result['companies_in_group'] = company_data.get('antalKoncernbolag')

        if company_data.get('moderbolag'):
            parent = company_data['moderbolag']
            result['parent_orgnr'] = parent.get('orgnr')
            result['parent_name'] = parent.get('namn')

        # Related companies from org page
        result['related_companies'] = []
        if org_data:
            overview = org_data.get('companyOverview', {})
            for rel in overview.get('dotterbolag', []):
                result['related_companies'].append({
                    'related_orgnr': rel.get('orgnr'),
                    'related_name': rel.get('namn'),
                    'relation_type': 'subsidiary',
                    'source': 'allabolag'
                })

        # Announcements
        result['announcements'] = []
        for ann in company_data.get('kungorelser', [])[:10]:
            result['announcements'].append({
                'date': ann.get('datum'),
                'type': ann.get('typ'),
                'text': ann.get('text')
            })

        # Industries
        result['industries'] = []
        for i, sni in enumerate(company_data.get('snikoder', [])):
            result['industries'].append({
                'sni_code': sni.get('kod'),
                'sni_description': sni.get('namn'),
                'is_primary': 1 if i == 0 else 0,
                'source': 'allabolag'
            })

        # Quick summary from latest year
        if result['financials']:
            latest = result['financials'][0]
            result['revenue'] = latest.get('revenue')
            result['net_profit'] = latest.get('net_profit')
            result['total_assets'] = latest.get('total_assets')
            result['equity'] = latest.get('equity')
            result['num_employees'] = latest.get('num_employees')
            result['equity_ratio'] = latest.get('equity_ratio')
            result['return_on_equity'] = latest.get('return_on_equity')

        return result

    def _structure_nextjs_data(self, main_data: Dict, org_data: Dict, orgnr: str) -> Dict[str, Any]:
        """Structure data from new Next.js format (props.pageProps.company)."""
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
            'source_basic': 'allabolag'
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

        # Location / GPS + Municipality/County
        location = company.get('location', {})
        coords = location.get('coordinates', [{}])
        if coords:
            result['latitude'] = coords[0].get('ycoordinate')
            result['longitude'] = coords[0].get('xcoordinate')

        # Municipality and county (Priority 4)
        result['municipality'] = location.get('municipality')
        result['municipality_code'] = location.get('municipalityCode')
        result['county'] = location.get('county')
        result['county_code'] = location.get('countyCode')

        # LEI code (Legal Entity Identifier)
        result['lei_code'] = company.get('leiCode') or company.get('lei')

        # ===== PRIORITY 1: Registrations (F-skatt, Moms, Arbetsgivare) =====
        # Allabolag uses direct boolean fields and registryStatusEntries

        # Direct fields (most reliable)
        result['moms_registered'] = 1 if company.get('registeredForVat') else 0
        result['employer_registered'] = 1 if company.get('registeredForPayrollTax') else 0

        # F-skatt: Check registeredForVatDescription for "F-skatt" mention
        # or check registryStatusEntries for 'registeredForPrepayment'
        vat_desc = company.get('registeredForVatDescription', '') or ''
        has_fskatt = 'f-skatt' in vat_desc.lower()

        # Also check registryStatusEntries
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

        # Fallback: old registrations dict/list format (for backwards compatibility)
        if not any([result.get('f_skatt'), result.get('moms_registered'), result.get('employer_registered')]):
            registrations = company.get('registrations', {})
            if isinstance(registrations, dict):
                result['f_skatt'] = 1 if registrations.get('fTax') or registrations.get('fSkatt') else 0
                result['moms_registered'] = 1 if registrations.get('vat') or registrations.get('moms') else 0
                result['employer_registered'] = 1 if registrations.get('employer') or registrations.get('arbetsgivare') else 0
            elif isinstance(registrations, list):
                reg_types = [r.get('type', '').lower() for r in registrations if isinstance(r, dict)]
                result['f_skatt'] = 1 if any('f-skatt' in t or 'fskatt' in t for t in reg_types) else 0
                result['moms_registered'] = 1 if any('moms' in t or 'vat' in t for t in reg_types) else 0
                result['employer_registered'] = 1 if any('arbetsgivar' in t or 'employer' in t for t in reg_types) else 0

        # ===== PRIORITY 1: Parent company / Group structure =====
        # Try 'corporateStructure' first (new Allabolag format)
        corp_structure = company.get('corporateStructure', {})
        if corp_structure:
            # Has subsidiaries = is a group
            num_subsidiaries = corp_structure.get('numberOfSubsidiaries', 0)
            num_companies = corp_structure.get('numberOfCompanies', 0)
            result['is_group'] = 1 if (num_subsidiaries and num_subsidiaries > 0) else 0
            result['companies_in_group'] = num_companies if num_companies else None

            # Parent company info from corporateStructure
            parent_orgnr = corp_structure.get('parentCompanyOrganisationNumber')
            parent_name = corp_structure.get('parentCompanyName')
            if parent_orgnr:
                result['parent_orgnr'] = parent_orgnr
                result['parent_name'] = parent_name

        # Fallback: Try old 'group' format
        if not result.get('is_group'):
            group = company.get('group', {})
            if group:
                result['is_group'] = 1 if group.get('isGroup') or group.get('koncern') else 0
                result['companies_in_group'] = group.get('numberOfCompanies') or group.get('antalBolag')

                # Parent company info from group
                parent = group.get('parent', {})
                if parent:
                    result['parent_orgnr'] = parent.get('orgnr') or parent.get('organizationNumber')
                    result['parent_name'] = parent.get('name') or parent.get('namn')

        # Alternative parent structure (direct on company)
        if not result.get('parent_orgnr'):
            parent = company.get('parent', {})
            if parent:
                result['parent_orgnr'] = parent.get('orgnr') or parent.get('organizationNumber')
                result['parent_name'] = parent.get('name') or parent.get('namn')

        # ===== PRIORITY 2: Share capital =====
        share_capital = company.get('shareCapital')
        if share_capital:
            try:
                # Can be string "500000" or int
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

        # Handle employee count - can be a range like "1-4" or an int
        employees = company.get('numberOfEmployees')
        if employees:
            if isinstance(employees, str):
                if '-' in employees:
                    # Range like "1-4" - take the first number
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
        # Note: share_capital not in DB schema

        # Industries / SNI codes
        result['industries'] = []
        for nace in company.get('naceIndustries', []):
            # Parse "71110 Arkitektverksamhet" format
            if ' ' in nace:
                parts = nace.split(' ', 1)
                result['industries'].append({
                    'sni_code': parts[0],
                    'sni_description': parts[1] if len(parts) > 1 else None,
                    'is_primary': 1 if not result['industries'] else 0
                })

        # Financials - parse from companyAccounts and corporateAccounts
        result['financials'] = []

        # Company accounts (non-consolidated)
        for period in company.get('companyAccounts', []):
            fin = self._parse_financial_period_nextjs(period, is_consolidated=False)
            if fin:
                result['financials'].append(fin)

        # Corporate accounts (consolidated)
        for period in company.get('corporateAccounts', []):
            fin = self._parse_financial_period_nextjs(period, is_consolidated=True)
            if fin:
                result['financials'].append(fin)

        # Update summary fields from latest financials
        if result['financials']:
            # Find the latest non-consolidated period
            company_financials = [f for f in result['financials'] if not f.get('is_consolidated')]
            if company_financials:
                latest = company_financials[0]
                # Only update if not already set from summary
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

        # Extract all roles from roleGroups
        role_groups = roles_data.get('roleGroups', [])
        for group in role_groups:
            group_name = group.get('name', '')  # Management, Board, Revision, Other
            for role_entry in group.get('roles', []):
                # Skip company entries (like "Ernst & Young Aktiebolag")
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

        # Fallback: if no roles found, try contactPerson
        if not result['roles']:
            contact = company.get('contactPerson', {})
            if contact and contact.get('name'):
                result['roles'].append({
                    'name': contact.get('name'),
                    'birth_year': self._parse_birth_year(contact.get('birthDate')),
                    'role_type': contact.get('role'),
                    'role_category': self.ROLE_CATEGORY_MAP.get(contact.get('role'), 'BOARD'),
                    'source': 'allabolag'
                })

        # Note: domicile fields not in DB schema

        # Related companies - from organization page data (not main_data)
        result['related_companies'] = []
        if org_data:
            # Try Next.js format first
            overview = org_data.get('companyOverview', {})
            subsidiaries = overview.get('dotterbolag', [])

            # Also try alternative key names
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

        # Trademarks (Priority 3) - from pageProps.trademarks
        result['trademarks'] = []
        trademark_list = trademarks_data.get('trademarks', [])
        for tm in trademark_list:
            registration = tm.get('registration', {})
            result['trademarks'].append({
                'name': tm.get('title'),
                'registration_number': registration.get('id'),
                'status': 'registered' if registration.get('id') else 'pending',
                'class_codes': None,  # Not provided by Allabolag
                'registration_date': registration.get('date'),
                'expiry_date': registration.get('expiry'),
                'source': 'allabolag'
            })

        # Announcements (kungörelser) - try multiple key names
        result['announcements'] = []
        announcements_data = (
            company.get('announcements', []) or
            company.get('kungorelser', []) or
            main_data.get('announcements', []) or
            []
        )
        for ann in announcements_data[:10]:  # Limit to 10 most recent
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
        """
        Map Allabolag role group and type to our category.

        Args:
            group_name: One of 'Management', 'Board', 'Revision', 'Other'
            role_type: The specific role like 'Verkställande direktör', 'Ledamot', etc.

        Returns:
            Category string: 'MANAGEMENT', 'BOARD', 'AUDITOR', or 'OTHER'
        """
        # First check role_type against ROLE_CATEGORY_MAP
        if role_type in self.ROLE_CATEGORY_MAP:
            return self.ROLE_CATEGORY_MAP[role_type]

        # Fallback to group-based mapping
        group_mapping = {
            'Management': 'MANAGEMENT',
            'Board': 'BOARD',
            'Revision': 'AUDITOR',
            'Other': 'OTHER'
        }
        return group_mapping.get(group_name, 'OTHER')

    def _parse_financial_period(self, period: Dict, is_consolidated: bool) -> Optional[Dict]:
        """Parse a financial period into our format (old format)."""
        if not period:
            return None

        result = {
            'period_year': period.get('ar'),
            'period_months': period.get('manader', 12),
            'is_consolidated': 1 if is_consolidated else 0,
            'source': 'allabolag'
        }

        # Map account codes to our fields
        accounts = period.get('konton', {})
        for code, value in accounts.items():
            if code in self.ACCOUNT_CODE_MAP:
                field = self.ACCOUNT_CODE_MAP[code]
                result[field] = value

        return result

    def _parse_financial_period_nextjs(self, period: Dict, is_consolidated: bool) -> Optional[Dict]:
        """Parse a financial period from Next.js format into our format."""
        if not period:
            return None

        # Parse year from "2024" string or extract from period "2024-12"
        year = period.get('year')
        if year:
            try:
                year = int(year)
            except (ValueError, TypeError):
                year = None

        # Parse period length
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

        # Map account codes to our fields
        # New format: accounts = [{"code": "ADI", "amount": "36258"}, ...]
        # Note: Some codes should NOT be multiplied by 1000 (e.g. employee count, percentages)
        NO_MULTIPLY_CODES = {'ANT', 'EKA', 'RG', 'RPE', 'avk_eget_kapital', 'avk_totalt_kapital', 'kassalikviditet'}

        accounts = period.get('accounts', [])
        for acc in accounts:
            code = acc.get('code')
            amount = acc.get('amount')
            if code and code in self.ACCOUNT_CODE_MAP and amount is not None:
                field = self.ACCOUNT_CODE_MAP[code]
                try:
                    if code in NO_MULTIPLY_CODES:
                        # Keep as-is (count or percentage)
                        result[field] = int(float(amount))
                    else:
                        # Amount is in thousands (TSEK) - convert to SEK
                        result[field] = int(float(amount) * 1000)
                except (ValueError, TypeError):
                    pass

        return result

    # =========================================================================
    # SEARCH
    # =========================================================================

    def search(self, query: str, limit: int = 10) -> List[Dict]:
        """Search for companies (sync)."""
        url = f"{self.BASE_URL}/sok?q={query}"
        html = self._fetch_page(url)
        if not html:
            return []

        data = self._extract_json_data(html)
        if not data:
            return []

        results = []
        for item in data.get('searchResults', {}).get('companies', [])[:limit]:
            results.append({
                'orgnr': item.get('orgnr'),
                'name': item.get('namn'),
                'city': item.get('ort'),
                'status': item.get('status'),
                'source': 'allabolag'
            })

        return results

    async def search_async(self, query: str, limit: int = 10) -> List[Dict]:
        """Search for companies (async)."""
        url = f"{self.BASE_URL}/sok?q={query}"
        html = await self._fetch_page_async(url)
        if not html:
            return []

        data = self._extract_json_data(html)
        if not data:
            return []

        results = []
        for item in data.get('searchResults', {}).get('companies', [])[:limit]:
            results.append({
                'orgnr': item.get('orgnr'),
                'name': item.get('namn'),
                'city': item.get('ort'),
                'status': item.get('status'),
                'source': 'allabolag'
            })

        return results


# Convenience function
def scrape_allabolag(orgnr: str) -> Optional[Dict]:
    """Quick scrape function."""
    scraper = AllabolagScraper()
    return scraper.scrape_company(orgnr)
