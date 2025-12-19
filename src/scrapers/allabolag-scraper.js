/**
 * Allabolag.se Scraper - Node.js Version
 * Primary source for: board, management, financials, corporate structure
 *
 * Features:
 * - Rate limiting (minimum 1 second between requests)
 * - Next.js data extraction
 * - Structured output matching company_details schema
 * - Error handling with graceful fallbacks
 *
 * Usage:
 *   const { scrapeCompany } = require('./allabolag-scraper');
 *   const data = await scrapeCompany('5567676827');
 */

const axios = require('axios');
const cheerio = require('cheerio');

// Account code mapping for financial data
const ACCOUNT_CODE_MAP = {
  // Income statement
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

  // Balance sheet - Assets
  'SIA': 'intangible_assets',
  'SMA': 'tangible_assets',
  'SFA': 'financial_assets',
  'SVL': 'inventory',
  'SKG': 'receivables',
  'SKO': 'cash',
  'SGE': 'total_assets',

  // Balance sheet - Liabilities & Equity
  'AKT': 'share_capital',
  'SEK': 'equity',
  'SOB': 'untaxed_reserves',
  'SAS': 'provisions',
  'SLS': 'long_term_liabilities',
  'SKS': 'short_term_liabilities',

  // Key ratios
  'avk_eget_kapital': 'return_on_equity',
  'avk_totalt_kapital': 'return_on_assets',
  'EKA': 'equity_ratio',
  'RG': 'profit_margin',
  'kassalikviditet': 'quick_ratio',

  // Personnel
  'ANT': 'num_employees',
  'loner_styrelse_vd': 'salaries_board_ceo',
  'loner_ovriga': 'salaries_other',
  'sociala_avgifter': 'social_costs',
  'RPE': 'revenue_per_employee',
};

// Role category mapping
const ROLE_CATEGORY_MAP = {
  // Board roles
  'Styrelseledamot': 'BOARD',
  'Styrelsesuppleant': 'BOARD',
  'Styrelseordförande': 'BOARD',
  'Ledamot': 'BOARD',
  'Suppleant': 'BOARD',
  'Ordförande': 'BOARD',
  // Management roles
  'Vice verkställande direktör': 'MANAGEMENT',
  'Verkställande direktör': 'MANAGEMENT',
  'Extern verkställande direktör': 'MANAGEMENT',
  'VD': 'MANAGEMENT',
  // Auditor roles
  'Revisor': 'AUDITOR',
  'Revisorssuppleant': 'AUDITOR',
  'Huvudansvarig revisor': 'AUDITOR',
  'Lekmannarevisor': 'AUDITOR',
  // Other roles
  'Extern firmatecknare': 'OTHER',
  'Bolagsman': 'OTHER',
  'Komplementär': 'OTHER',
  'Likvidator': 'OTHER',
};

// Codes that should NOT be multiplied by 1000 (counts and percentages)
const NO_MULTIPLY_CODES = new Set([
  'ANT', 'EKA', 'RG', 'RPE',
  'avk_eget_kapital', 'avk_totalt_kapital', 'kassalikviditet'
]);

class AllabolagScraper {
  constructor(options = {}) {
    this.baseUrl = 'https://www.allabolag.se';
    this.delay = options.delay || 1000; // 1 second default
    this.lastRequest = 0;
  }

  /**
   * Rate limiting - ensure minimum delay between requests
   */
  async rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequest;

    if (elapsed < this.delay) {
      await new Promise(resolve => setTimeout(resolve, this.delay - elapsed));
    }

    this.lastRequest = Date.now();
  }

  /**
   * Fetch page with rate limiting
   */
  async fetchPage(url) {
    await this.rateLimit();

    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Extract JSON data from Next.js __NEXT_DATA__ script tag
   */
  extractJsonData(html) {
    const $ = cheerio.load(html);
    const nextDataScript = $('#__NEXT_DATA__');

    if (nextDataScript.length > 0) {
      try {
        const data = JSON.parse(nextDataScript.html());
        const pageProps = data?.props?.pageProps;

        if (pageProps?.company) {
          return pageProps;
        }
      } catch (error) {
        console.error('Error parsing __NEXT_DATA__:', error.message);
      }
    }

    return null;
  }

  /**
   * Parse birth year from date string like '01.02.1989'
   */
  parseBirthYear(birthDate) {
    if (!birthDate) return null;

    const parts = birthDate.split('.');
    if (parts.length >= 3) {
      const year = parseInt(parts[2], 10);
      return isNaN(year) ? null : year;
    }

    return null;
  }

  /**
   * Map role category based on group name and role type
   */
  mapRoleCategory(groupName, roleType) {
    // Check role type first
    if (ROLE_CATEGORY_MAP[roleType]) {
      return ROLE_CATEGORY_MAP[roleType];
    }

    // Fallback to group-based mapping
    const groupMapping = {
      'Management': 'MANAGEMENT',
      'Board': 'BOARD',
      'Revision': 'AUDITOR',
      'Other': 'OTHER'
    };

    return groupMapping[groupName] || 'OTHER';
  }

  /**
   * Parse financial period from Next.js format
   */
  parseFinancialPeriod(period, isConsolidated) {
    if (!period) return null;

    const year = period.year ? parseInt(period.year, 10) : null;
    const periodMonths = period.length ? parseInt(period.length, 10) : 12;

    const result = {
      period_year: year,
      period_months: periodMonths,
      is_consolidated: isConsolidated ? 1 : 0,
      source: 'allabolag'
    };

    // Parse accounts
    const accounts = period.accounts || [];
    accounts.forEach(acc => {
      const code = acc.code;
      const amount = acc.amount;

      if (code && ACCOUNT_CODE_MAP[code] && amount !== null && amount !== undefined) {
        const field = ACCOUNT_CODE_MAP[code];
        const numValue = parseFloat(amount);

        if (!isNaN(numValue)) {
          if (NO_MULTIPLY_CODES.has(code)) {
            result[field] = Math.round(numValue);
          } else {
            // Amount is in thousands (TSEK) - convert to SEK
            result[field] = Math.round(numValue * 1000);
          }
        }
      }
    });

    return result;
  }

  /**
   * Structure data from Next.js format
   */
  structureNextJsData(mainData, orgData, orgnr) {
    const company = mainData.company || {};
    const trademarksData = mainData.trademarks || {};

    const result = {
      orgnr,
      name: company.name || company.legalName,
      company_type: company.companyType?.code,
      status: company.status?.status || 'UNKNOWN',
      purpose: company.purpose,
      registered_date: company.registrationDate,
      foundation_year: company.foundationYear,
      source_basic: 'allabolag',
      last_synced_at: new Date().toISOString()
    };

    // Postal address
    const postal = company.postalAddress || {};
    result.postal_street = postal.addressLine;
    result.postal_code = postal.zipCode;
    result.postal_city = postal.postPlace;

    // Visitor address
    const visitor = company.visitorAddress || {};
    result.visiting_street = visitor.addressLine;
    result.visiting_code = visitor.zipCode;
    result.visiting_city = visitor.postPlace;

    // Contact info
    result.phone = company.phone || company.legalPhone;
    result.email = company.email;
    result.website = company.homePage;

    // Location / GPS
    const location = company.location || {};
    const coords = location.coordinates || [{}];
    if (coords.length > 0) {
      result.latitude = coords[0].ycoordinate;
      result.longitude = coords[0].xcoordinate;
    }

    result.municipality = location.municipality;
    result.municipality_code = location.municipalityCode;
    result.county = location.county;
    result.county_code = location.countyCode;

    // LEI code
    result.lei_code = company.leiCode || company.lei;

    // Registrations
    result.moms_registered = company.registeredForVat ? 1 : 0;
    result.employer_registered = company.registeredForPayrollTax ? 1 : 0;

    // F-skatt
    const vatDesc = (company.registeredForVatDescription || '').toLowerCase();
    let hasFskatt = vatDesc.includes('f-skatt');

    const registryEntries = company.registryStatusEntries || [];
    registryEntries.forEach(entry => {
      if (entry.label === 'registeredForPrepayment' && entry.value) {
        hasFskatt = true;
      }
    });

    result.f_skatt = hasFskatt ? 1 : 0;

    // Corporate structure
    const corpStructure = company.corporateStructure || {};
    const numSubsidiaries = corpStructure.numberOfSubsidiaries || 0;
    const numCompanies = corpStructure.numberOfCompanies || 0;

    result.is_group = numSubsidiaries > 0 ? 1 : 0;
    result.companies_in_group = numCompanies || null;

    if (corpStructure.parentCompanyOrganisationNumber) {
      result.parent_orgnr = corpStructure.parentCompanyOrganisationNumber;
      result.parent_name = corpStructure.parentCompanyName;
    }

    // Share capital
    if (company.shareCapital) {
      const shareCapital = parseFloat(company.shareCapital);
      if (!isNaN(shareCapital)) {
        result.share_capital = Math.round(shareCapital);
      }
    }

    // Financial summary
    if (company.revenue) {
      const revenue = parseFloat(company.revenue);
      if (!isNaN(revenue)) {
        result.revenue = Math.round(revenue * 1000);
      }
    }

    if (company.profit) {
      const profit = parseFloat(company.profit);
      if (!isNaN(profit)) {
        result.net_profit = Math.round(profit * 1000);
      }
    }

    // Employee count
    const employees = company.numberOfEmployees;
    if (employees) {
      if (typeof employees === 'string' && employees.includes('-')) {
        const firstNum = parseInt(employees.split('-')[0], 10);
        result.num_employees = isNaN(firstNum) ? null : firstNum;
      } else {
        const numEmp = parseInt(employees, 10);
        result.num_employees = isNaN(numEmp) ? null : numEmp;
      }
    }

    // Industries / SNI codes
    result.industries = [];
    const naceIndustries = company.naceIndustries || [];
    naceIndustries.forEach((nace, index) => {
      if (nace.includes(' ')) {
        const parts = nace.split(' ');
        result.industries.push({
          sni_code: parts[0],
          sni_description: parts.slice(1).join(' '),
          is_primary: index === 0 ? 1 : 0
        });
      }
    });

    // Financials
    result.financials = [];

    // Company accounts (non-consolidated)
    const companyAccounts = company.companyAccounts || [];
    companyAccounts.forEach(period => {
      const fin = this.parseFinancialPeriod(period, false);
      if (fin) {
        result.financials.push(fin);
      }
    });

    // Corporate accounts (consolidated)
    const corporateAccounts = company.corporateAccounts || [];
    corporateAccounts.forEach(period => {
      const fin = this.parseFinancialPeriod(period, true);
      if (fin) {
        result.financials.push(fin);
      }
    });

    // Update summary from latest financials
    if (result.financials.length > 0) {
      const companyFinancials = result.financials.filter(f => f.is_consolidated === 0);
      if (companyFinancials.length > 0) {
        const latest = companyFinancials[0];

        if (result.revenue === undefined) result.revenue = latest.revenue;
        if (result.net_profit === undefined) result.net_profit = latest.net_profit;
        if (result.num_employees === undefined) result.num_employees = latest.num_employees;

        result.total_assets = latest.total_assets;
        result.equity = latest.equity;
        result.equity_ratio = latest.equity_ratio;
        result.return_on_equity = latest.return_on_equity;
      }
    }

    // Roles (board, management, auditors)
    result.roles = [];
    const rolesData = company.roles || {};
    const roleGroups = rolesData.roleGroups || [];

    roleGroups.forEach(group => {
      const groupName = group.name || '';
      const roles = group.roles || [];

      roles.forEach(roleEntry => {
        // Skip company entries
        if (roleEntry.type === 'Company') return;

        const roleType = roleEntry.role || '';
        result.roles.push({
          name: roleEntry.name,
          birth_year: this.parseBirthYear(roleEntry.birthDate),
          role_type: roleType,
          role_category: this.mapRoleCategory(groupName, roleType),
          source: 'allabolag'
        });
      });
    });

    // Related companies (from org page)
    result.related_companies = [];
    if (orgData) {
      const overview = orgData.companyOverview || {};
      let subsidiaries = overview.dotterbolag ||
                        orgData.relatedCompanies ||
                        orgData.company?.relatedCompanies ||
                        [];

      subsidiaries.forEach(rel => {
        result.related_companies.push({
          related_orgnr: rel.orgnr || rel.orgNumber,
          related_name: rel.namn || rel.name,
          relation_type: rel.relation_type || 'subsidiary',
          source: 'allabolag'
        });
      });
    }

    // Announcements (kungörelser)
    result.announcements = [];
    const announcements = company.announcements || company.kungorelser || mainData.announcements || [];
    announcements.slice(0, 10).forEach(ann => {
      result.announcements.push({
        announcement_type: ann.type || ann.typ,
        announcement_date: ann.date || ann.datum,
        description: ann.text || ann.description,
        source: 'allabolag'
      });
    });

    return result;
  }

  /**
   * Scrape complete company data from Allabolag
   *
   * @param {string} orgnr - Organization number
   * @returns {Promise<Object|null>} Company data or null if not found
   */
  async scrapeCompany(orgnr) {
    orgnr = orgnr.replace('-', '');

    const startTime = Date.now();

    // Fetch main page
    const mainUrl = `${this.baseUrl}/${orgnr}`;
    const mainHtml = await this.fetchPage(mainUrl);

    if (!mainHtml) {
      console.error(`Failed to fetch main page for ${orgnr}`);
      return null;
    }

    const mainData = this.extractJsonData(mainHtml);
    if (!mainData) {
      console.error(`Failed to extract data for ${orgnr}`);
      return null;
    }

    // Fetch organization page
    const orgUrl = `${this.baseUrl}/${orgnr}/organisation`;
    const orgHtml = await this.fetchPage(orgUrl);
    const orgData = orgHtml ? this.extractJsonData(orgHtml) : null;

    // Structure data
    const result = this.structureNextJsData(mainData, orgData, orgnr);

    const duration = Date.now() - startTime;
    console.log(`Scraped ${orgnr} from allabolag in ${duration}ms`);

    return result;
  }
}

/**
 * Convenience function to scrape a company
 *
 * @param {string} orgnr - Organization number
 * @param {Object} options - Scraper options
 * @returns {Promise<Object|null>} Company data
 */
async function scrapeCompany(orgnr, options = {}) {
  const scraper = new AllabolagScraper(options);
  return scraper.scrapeCompany(orgnr);
}

module.exports = {
  AllabolagScraper,
  scrapeCompany
};
