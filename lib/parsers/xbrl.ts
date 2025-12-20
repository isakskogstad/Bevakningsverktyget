/**
 * XBRL Financial Data Types for Loop-Auto API
 * ============================================
 *
 * TypeScript types for Swedish annual report (arsredovisning) XBRL data
 * extracted from Bolagsverket VDM API.
 *
 * Based on SE-GEN-BASE taxonomy with 60+ financial fields organized by:
 * - Availability: CORE (100%), COMMON (>80%), EXTENDED (50-80%), OPTIONAL (<50%)
 * - Category: Income Statement, Balance Sheet, Key Ratios, Audit, Board
 *
 * @author Claude Code (typescript-pro agent)
 * @date 2024-12-09
 */

import { z } from 'zod';

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Field availability levels in XBRL documents.
 * Based on analysis of 28 annual reports from 9 companies (2018-2024).
 */
export enum FieldAvailability {
  /** 100% - Always present in all documents */
  CORE = 'core',
  /** >80% - Usually present */
  COMMON = 'common',
  /** 50-80% - Often present */
  EXTENDED = 'extended',
  /** <50% - Sometimes present */
  OPTIONAL = 'optional',
}

/**
 * Type of reporting period in annual reports.
 */
export enum PeriodType {
  /** Current fiscal year (period0, balans0) */
  CURRENT_YEAR = 'current',
  /** Previous fiscal year (period1, balans1) */
  PREVIOUS_YEAR = 'previous',
  /** Two years ago (period2, balans2) */
  TWO_YEARS_AGO = 'two_years',
  /** Three years ago (period3, balans3) */
  THREE_YEARS_AGO = 'three_years',
}

/**
 * Data source for financial information.
 */
export enum DataSource {
  /** Official Bolagsverket VDM API (XBRL) */
  BOLAGSVERKET_VDM = 'bolagsverket_vdm',
  /** Allabolag.se scraper */
  ALLABOLAG = 'allabolag',
  /** Combined/merged sources */
  COMBINED = 'combined',
}

// =============================================================================
// CORE FINANCIAL TYPES
// =============================================================================

/**
 * Income statement (Resultatrakning) fields.
 * All amounts in SEK (Swedish Kronor).
 */
export interface IncomeStatement {
  /** Net revenue - Nettoomsattning */
  revenue: number | null;
  /** Operating income - Rorelseintakter */
  operatingIncome: number | null;
  /** Operating costs - Rorelsekostnader */
  operatingCosts: number | null;
  /** Operating profit - Rorelseresultat */
  operatingProfit: number | null;
  /** Profit after financial items - Resultat efter finansiella poster */
  profitAfterFinancial: number | null;
  /** Profit before tax - Resultat fore skatt */
  profitBeforeTax: number | null;
  /** Net profit/loss - Arets resultat */
  netProfit: number | null;

  // Cost breakdown (COMMON/EXTENDED availability)
  /** Other external costs - Ovriga externa kostnader */
  otherExternalCosts: number | null;
  /** Personnel costs - Personalkostnader */
  personnelCosts: number | null;
  /** Raw materials and consumables - Ravaror och fornodenheter */
  rawMaterialsCosts: number | null;
  /** Goods for resale - Handelsvaror */
  goodsCosts: number | null;
  /** Depreciation and amortization - Avskrivningar */
  depreciation: number | null;

  // Financial items (COMMON availability)
  /** Net financial items - Finansiella poster */
  financialItemsNet: number | null;
  /** Interest costs - Rantekostnader */
  interestCosts: number | null;
  /** Other operating income - Ovriga rorelseintakter */
  otherIncome: number | null;

  // Tax (EXTENDED availability)
  /** Income tax - Skatt pa arets resultat */
  incomeTax: number | null;
}

/**
 * Balance sheet assets (Balansrakning - Tillgangar).
 * All amounts in SEK.
 */
export interface BalanceSheetAssets {
  /** Total assets - Tillgangar */
  totalAssets: number | null;

  // Fixed assets (Anlaggningstillgangar)
  /** Total fixed assets - Anlaggningstillgangar */
  fixedAssets: number | null;
  /** Intangible assets - Immateriella anlaggningstillgangar */
  intangibleAssets: number | null;
  /** Tangible assets - Materiella anlaggningstillgangar */
  tangibleAssets: number | null;
  /** Financial assets - Finansiella anlaggningstillgangar */
  financialAssets: number | null;
  /** Equipment - Inventarier, verktyg och installationer */
  equipment: number | null;
  /** Capitalized R&D - Balanserade utgifter for utvecklingsarbete */
  capitalizedRD: number | null;

  // Current assets (Omsattningstillgangar)
  /** Total current assets - Omsattningstillgangar */
  currentAssets: number | null;
  /** Short-term receivables - Kortfristiga fordringar */
  receivables: number | null;
  /** Accounts receivable - Kundfordringar */
  accountsReceivable: number | null;
  /** Cash and bank - Kassa och bank */
  cash: number | null;
  /** Prepaid expenses - Forutbetalda kostnader */
  prepaidExpenses: number | null;

  // Group company assets (EXTENDED availability)
  /** Receivables from group companies - Fordringar koncernforetag */
  receivablesGroupShort: number | null;
  /** Shares in group companies - Andelar i koncernforetag */
  sharesGroupCompanies: number | null;
}

/**
 * Balance sheet equity and liabilities (Balansrakning - Eget kapital och skulder).
 * All amounts in SEK.
 */
export interface BalanceSheetEquityLiabilities {
  // Equity (Eget kapital)
  /** Total equity - Eget kapital */
  equity: number | null;
  /** Share capital - Aktiekapital */
  shareCapital: number | null;
  /** Restricted equity - Bundet eget kapital */
  restrictedEquity: number | null;
  /** Unrestricted equity - Fritt eget kapital */
  unrestrictedEquity: number | null;
  /** Retained earnings - Balanserat resultat */
  retainedEarnings: number | null;
  /** Share premium - Overkursfond */
  sharePremium: number | null;

  // Liabilities (Skulder)
  /** Current liabilities - Kortfristiga skulder */
  currentLiabilities: number | null;
  /** Long-term liabilities - Langfristiga skulder */
  longTermLiabilities: number | null;
  /** Accounts payable - Leverantorsskulder */
  accountsPayable: number | null;
  /** Accrued expenses - Upplupna kostnader */
  accruedExpenses: number | null;
  /** Tax liabilities - Skatteskulder */
  taxLiabilities: number | null;

  // Reserves (EXTENDED availability)
  /** Untaxed reserves - Obeskattade reserver */
  untaxedReserves: number | null;
  /** Tax allocation reserves - Periodiseringsfonder */
  taxAllocationReserves: number | null;

  // Group company liabilities (EXTENDED availability)
  /** Liabilities to group companies - Skulder till koncernforetag */
  liabilitiesGroupShort: number | null;
}

/**
 * Key financial ratios (Nyckeltal).
 */
export interface KeyRatios {
  /** Equity ratio (%) - Soliditet */
  equityRatio: number | null;
  /** Quick ratio (%) - Kassalikviditet */
  quickRatio: number | null;
  /** Return on equity (%) - Avkastning pa eget kapital */
  returnOnEquity: number | null;
}

/**
 * Employee information.
 */
export interface EmployeeInfo {
  /** Average number of employees - Medelantal anstallda */
  numEmployees: number | null;
  /** Average male employees - Medelantal man */
  employeesMale: number | null;
  /** Average female employees - Medelantal kvinnor */
  employeesFemale: number | null;

  // Salary details (EXTENDED availability)
  /** Total salaries - Loner och andra ersattningar */
  totalSalaries: number | null;
  /** Salaries to board and CEO - Loner till styrelse och VD */
  salariesBoardCeo: number | null;
  /** Salaries to other employees - Loner till ovriga anstallda */
  salariesOther: number | null;
  /** Social costs including pension - Sociala kostnader inkl pension */
  socialCosts: number | null;
}

/**
 * Complete financial data for a single period.
 */
export interface XBRLFinancialPeriod {
  /** Fiscal year (e.g., 2023) */
  fiscalYear: number;
  /** Period type (current, previous, etc.) */
  periodType: PeriodType;
  /** Period start date (ISO 8601) */
  periodStart: string | null;
  /** Period end date (ISO 8601) */
  periodEnd: string | null;
  /** Whether this is consolidated (group) data */
  isConsolidated: boolean;

  /** Income statement data */
  incomeStatement: IncomeStatement;
  /** Balance sheet assets */
  assets: BalanceSheetAssets;
  /** Balance sheet equity and liabilities */
  equityLiabilities: BalanceSheetEquityLiabilities;
  /** Key financial ratios */
  keyRatios: KeyRatios;
  /** Employee information */
  employees: EmployeeInfo;

  /** Additional unmapped fields */
  extra: Record<string, number | string | null>;
}

/**
 * Flattened financial data for simpler use cases.
 * Contains all fields at top level instead of nested.
 */
export interface XBRLFinancialsFlat {
  // Period info
  fiscalYear: number;
  periodType: PeriodType;
  isConsolidated: boolean;

  // Income Statement (CORE)
  revenue: number | null;
  operatingProfit: number | null;
  profitAfterFinancial: number | null;
  profitBeforeTax: number | null;
  netProfit: number | null;
  operatingCosts: number | null;
  otherExternalCosts: number | null;
  personnelCosts: number | null;

  // Balance Sheet - Assets (CORE)
  totalAssets: number | null;
  currentAssets: number | null;
  receivables: number | null;
  cash: number | null;

  // Balance Sheet - Equity (CORE)
  equity: number | null;
  restrictedEquity: number | null;
  unrestrictedEquity: number | null;
  shareCapital: number | null;

  // Balance Sheet - Liabilities (CORE)
  currentLiabilities: number | null;

  // Key Ratios (CORE)
  equityRatio: number | null;
  numEmployees: number | null;

  // COMMON fields
  fixedAssets: number | null;
  tangibleAssets: number | null;
  financialAssets: number | null;
  accountsReceivable: number | null;
  prepaidExpenses: number | null;
  longTermLiabilities: number | null;
  accountsPayable: number | null;
  accruedExpenses: number | null;
  financialItemsNet: number | null;
  interestCosts: number | null;
  otherIncome: number | null;
  depreciation: number | null;
  retainedEarnings: number | null;

  // EXTENDED fields
  intangibleAssets: number | null;
  capitalizedRD: number | null;
  rawMaterialsCosts: number | null;
  goodsCosts: number | null;
  incomeTax: number | null;
  taxLiabilities: number | null;
  untaxedReserves: number | null;
  taxAllocationReserves: number | null;
  quickRatio: number | null;
  returnOnEquity: number | null;
  employeesMale: number | null;
  employeesFemale: number | null;
  totalSalaries: number | null;
  salariesBoardCeo: number | null;
  salariesOther: number | null;
  socialCosts: number | null;
  sharePremium: number | null;
  receivablesGroupShort: number | null;
  liabilitiesGroupShort: number | null;
  sharesGroupCompanies: number | null;
  equipment: number | null;
}

// =============================================================================
// AUDIT & BOARD TYPES
// =============================================================================

/**
 * Audit report information (OPTIONAL availability).
 */
export interface AuditInfo {
  /** Auditor first name */
  auditorFirstName: string | null;
  /** Auditor last name */
  auditorLastName: string | null;
  /** Audit firm name - Revisionsbolagets namn */
  auditFirm: string | null;
  /** Date audit was completed (ISO 8601) */
  auditDate: string | null;
  /** Audit opinion/statement text */
  auditOpinion: string | null;
}

/**
 * Board composition information (OPTIONAL availability).
 */
export interface BoardInfo {
  /** Percentage of women on board */
  percentWomen: number | null;
  /** Percentage of men on board */
  percentMen: number | null;
  /** List of board members (if available) */
  members: BoardMember[];
}

/**
 * Individual board member.
 */
export interface BoardMember {
  name: string;
  role: string;
  birthYear: number | null;
}

// =============================================================================
// COMPANY & ANNUAL REPORT TYPES
// =============================================================================

/**
 * Company identification from XBRL.
 */
export interface XBRLCompanyInfo {
  /** Company name - Foretagets namn */
  name: string;
  /** Organization number (10 digits, no dash) */
  orgnr: string;
  /** Fiscal year start date (ISO 8601) */
  fiscalYearStart: string | null;
  /** Fiscal year end date (ISO 8601) */
  fiscalYearEnd: string | null;
}

/**
 * Complete parsed annual report.
 */
export interface AnnualReport {
  /** Company identification */
  company: XBRLCompanyInfo;
  /** Financial data by period */
  financials: XBRLFinancialPeriod[];
  /** Audit information (if available) */
  audit: AuditInfo | null;
  /** Board composition (if available) */
  board: BoardInfo | null;
  /** Source information */
  meta: {
    /** Data source */
    source: DataSource;
    /** Parse timestamp (ISO 8601) */
    parsedAt: string;
    /** Source file name */
    sourceFile: string | null;
    /** Number of XBRL facts extracted */
    totalFacts: number;
    /** XBRL namespaces found */
    namespaces: string[];
  };
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

/**
 * Standard API error response.
 */
export interface ApiError {
  error: true;
  message: string;
  requestId: string;
  statusCode: number;
  details?: {
    errors?: Array<{
      field: string;
      message: string;
      type: string;
    }>;
    hint?: string;
  };
}

/**
 * Pagination metadata.
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasMore: boolean;
}

/**
 * Response for GET /api/v1/companies/{orgnr}/xbrl
 */
export interface XBRLResponse {
  orgnr: string;
  name: string;
  reports: AnnualReport[];
  /** Total number of available reports */
  totalReports: number;
}

/**
 * Response for GET /api/v1/companies/{orgnr}/xbrl/financials
 */
export interface XBRLFinancialsResponse {
  orgnr: string;
  name: string;
  fiscalYears: number[];
  /** Flat financial data for easy consumption */
  financials: XBRLFinancialsFlat[];
}

/**
 * Response for GET /api/v1/companies/{orgnr}/xbrl/latest
 */
export interface XBRLLatestResponse {
  orgnr: string;
  name: string;
  fiscalYear: number;
  /** Current year financials */
  current: XBRLFinancialsFlat;
  /** Previous year financials (for comparison) */
  previous: XBRLFinancialsFlat | null;
  /** Year-over-year changes */
  yoyChanges: {
    revenueChange: number | null;
    profitChange: number | null;
    assetsChange: number | null;
    employeesChange: number | null;
  };
}

/**
 * Response for POST /api/v1/xbrl/parse
 */
export interface XBRLParseResponse {
  success: boolean;
  report: AnnualReport;
  warnings: string[];
  errors: string[];
}

/**
 * Search filters for XBRL data.
 */
export interface XBRLSearchFilters {
  /** Minimum fiscal year */
  minYear?: number;
  /** Maximum fiscal year */
  maxYear?: number;
  /** Minimum revenue */
  minRevenue?: number;
  /** Maximum revenue */
  maxRevenue?: number;
  /** Minimum employees */
  minEmployees?: number;
  /** Has audit report */
  hasAudit?: boolean;
  /** Is profitable */
  isProfitable?: boolean;
  /** Page number (1-indexed) */
  page?: number;
  /** Page size (max 100) */
  pageSize?: number;
}

/**
 * Response for GET /api/v1/xbrl/search
 */
export interface XBRLSearchResponse {
  results: Array<{
    orgnr: string;
    name: string;
    fiscalYear: number;
    revenue: number | null;
    netProfit: number | null;
    numEmployees: number | null;
  }>;
  pagination: PaginationMeta;
  filters: XBRLSearchFilters;
}

// =============================================================================
// ZOD SCHEMAS FOR RUNTIME VALIDATION
// =============================================================================

/**
 * Zod schema for nullable number (financial amounts).
 */
const nullableNumber = z.number().nullable();

/**
 * Zod schema for nullable string.
 */
const nullableString = z.string().nullable();

/**
 * Zod schema for PeriodType enum.
 */
export const PeriodTypeSchema = z.nativeEnum(PeriodType);

/**
 * Zod schema for DataSource enum.
 */
export const DataSourceSchema = z.nativeEnum(DataSource);

/**
 * Zod schema for Income Statement.
 */
export const IncomeStatementSchema = z.object({
  revenue: nullableNumber,
  operatingIncome: nullableNumber,
  operatingCosts: nullableNumber,
  operatingProfit: nullableNumber,
  profitAfterFinancial: nullableNumber,
  profitBeforeTax: nullableNumber,
  netProfit: nullableNumber,
  otherExternalCosts: nullableNumber,
  personnelCosts: nullableNumber,
  rawMaterialsCosts: nullableNumber,
  goodsCosts: nullableNumber,
  depreciation: nullableNumber,
  financialItemsNet: nullableNumber,
  interestCosts: nullableNumber,
  otherIncome: nullableNumber,
  incomeTax: nullableNumber,
});

/**
 * Zod schema for Balance Sheet Assets.
 */
export const BalanceSheetAssetsSchema = z.object({
  totalAssets: nullableNumber,
  fixedAssets: nullableNumber,
  intangibleAssets: nullableNumber,
  tangibleAssets: nullableNumber,
  financialAssets: nullableNumber,
  equipment: nullableNumber,
  capitalizedRD: nullableNumber,
  currentAssets: nullableNumber,
  receivables: nullableNumber,
  accountsReceivable: nullableNumber,
  cash: nullableNumber,
  prepaidExpenses: nullableNumber,
  receivablesGroupShort: nullableNumber,
  sharesGroupCompanies: nullableNumber,
});

/**
 * Zod schema for Balance Sheet Equity & Liabilities.
 */
export const BalanceSheetEquityLiabilitiesSchema = z.object({
  equity: nullableNumber,
  shareCapital: nullableNumber,
  restrictedEquity: nullableNumber,
  unrestrictedEquity: nullableNumber,
  retainedEarnings: nullableNumber,
  sharePremium: nullableNumber,
  currentLiabilities: nullableNumber,
  longTermLiabilities: nullableNumber,
  accountsPayable: nullableNumber,
  accruedExpenses: nullableNumber,
  taxLiabilities: nullableNumber,
  untaxedReserves: nullableNumber,
  taxAllocationReserves: nullableNumber,
  liabilitiesGroupShort: nullableNumber,
});

/**
 * Zod schema for Key Ratios.
 */
export const KeyRatiosSchema = z.object({
  equityRatio: nullableNumber,
  quickRatio: nullableNumber,
  returnOnEquity: nullableNumber,
});

/**
 * Zod schema for Employee Info.
 */
export const EmployeeInfoSchema = z.object({
  numEmployees: nullableNumber,
  employeesMale: nullableNumber,
  employeesFemale: nullableNumber,
  totalSalaries: nullableNumber,
  salariesBoardCeo: nullableNumber,
  salariesOther: nullableNumber,
  socialCosts: nullableNumber,
});

/**
 * Zod schema for XBRL Financial Period (structured).
 */
export const XBRLFinancialPeriodSchema = z.object({
  fiscalYear: z.number(),
  periodType: PeriodTypeSchema,
  periodStart: nullableString,
  periodEnd: nullableString,
  isConsolidated: z.boolean(),
  incomeStatement: IncomeStatementSchema,
  assets: BalanceSheetAssetsSchema,
  equityLiabilities: BalanceSheetEquityLiabilitiesSchema,
  keyRatios: KeyRatiosSchema,
  employees: EmployeeInfoSchema,
  extra: z.record(z.union([z.number(), z.string(), z.null()])),
});

/**
 * Zod schema for XBRL Financials Flat.
 */
export const XBRLFinancialsFlatSchema = z.object({
  fiscalYear: z.number(),
  periodType: PeriodTypeSchema,
  isConsolidated: z.boolean(),

  // CORE Income Statement
  revenue: nullableNumber,
  operatingProfit: nullableNumber,
  profitAfterFinancial: nullableNumber,
  profitBeforeTax: nullableNumber,
  netProfit: nullableNumber,
  operatingCosts: nullableNumber,
  otherExternalCosts: nullableNumber,
  personnelCosts: nullableNumber,

  // CORE Balance Sheet - Assets
  totalAssets: nullableNumber,
  currentAssets: nullableNumber,
  receivables: nullableNumber,
  cash: nullableNumber,

  // CORE Balance Sheet - Equity
  equity: nullableNumber,
  restrictedEquity: nullableNumber,
  unrestrictedEquity: nullableNumber,
  shareCapital: nullableNumber,

  // CORE Balance Sheet - Liabilities
  currentLiabilities: nullableNumber,

  // CORE Key Ratios
  equityRatio: nullableNumber,
  numEmployees: nullableNumber,

  // COMMON fields
  fixedAssets: nullableNumber,
  tangibleAssets: nullableNumber,
  financialAssets: nullableNumber,
  accountsReceivable: nullableNumber,
  prepaidExpenses: nullableNumber,
  longTermLiabilities: nullableNumber,
  accountsPayable: nullableNumber,
  accruedExpenses: nullableNumber,
  financialItemsNet: nullableNumber,
  interestCosts: nullableNumber,
  otherIncome: nullableNumber,
  depreciation: nullableNumber,
  retainedEarnings: nullableNumber,

  // EXTENDED fields
  intangibleAssets: nullableNumber,
  capitalizedRD: nullableNumber,
  rawMaterialsCosts: nullableNumber,
  goodsCosts: nullableNumber,
  incomeTax: nullableNumber,
  taxLiabilities: nullableNumber,
  untaxedReserves: nullableNumber,
  taxAllocationReserves: nullableNumber,
  quickRatio: nullableNumber,
  returnOnEquity: nullableNumber,
  employeesMale: nullableNumber,
  employeesFemale: nullableNumber,
  totalSalaries: nullableNumber,
  salariesBoardCeo: nullableNumber,
  salariesOther: nullableNumber,
  socialCosts: nullableNumber,
  sharePremium: nullableNumber,
  receivablesGroupShort: nullableNumber,
  liabilitiesGroupShort: nullableNumber,
  sharesGroupCompanies: nullableNumber,
  equipment: nullableNumber,
});

/**
 * Zod schema for Audit Info.
 */
export const AuditInfoSchema = z.object({
  auditorFirstName: nullableString,
  auditorLastName: nullableString,
  auditFirm: nullableString,
  auditDate: nullableString,
  auditOpinion: nullableString,
});

/**
 * Zod schema for Board Member.
 */
export const BoardMemberSchema = z.object({
  name: z.string(),
  role: z.string(),
  birthYear: z.number().nullable(),
});

/**
 * Zod schema for Board Info.
 */
export const BoardInfoSchema = z.object({
  percentWomen: nullableNumber,
  percentMen: nullableNumber,
  members: z.array(BoardMemberSchema),
});

/**
 * Zod schema for XBRL Company Info.
 */
export const XBRLCompanyInfoSchema = z.object({
  name: z.string(),
  orgnr: z.string().length(10),
  fiscalYearStart: nullableString,
  fiscalYearEnd: nullableString,
});

/**
 * Zod schema for Annual Report Meta.
 */
export const AnnualReportMetaSchema = z.object({
  source: DataSourceSchema,
  parsedAt: z.string(),
  sourceFile: nullableString,
  totalFacts: z.number(),
  namespaces: z.array(z.string()),
});

/**
 * Zod schema for complete Annual Report.
 */
export const AnnualReportSchema = z.object({
  company: XBRLCompanyInfoSchema,
  financials: z.array(XBRLFinancialPeriodSchema),
  audit: AuditInfoSchema.nullable(),
  board: BoardInfoSchema.nullable(),
  meta: AnnualReportMetaSchema,
});

/**
 * Zod schema for API Error.
 */
export const ApiErrorSchema = z.object({
  error: z.literal(true),
  message: z.string(),
  requestId: z.string(),
  statusCode: z.number(),
  details: z
    .object({
      errors: z
        .array(
          z.object({
            field: z.string(),
            message: z.string(),
            type: z.string(),
          })
        )
        .optional(),
      hint: z.string().optional(),
    })
    .optional(),
});

/**
 * Zod schema for Pagination Meta.
 */
export const PaginationMetaSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  totalItems: z.number(),
  totalPages: z.number(),
  hasMore: z.boolean(),
});

/**
 * Zod schema for XBRL Response.
 */
export const XBRLResponseSchema = z.object({
  orgnr: z.string(),
  name: z.string(),
  reports: z.array(AnnualReportSchema),
  totalReports: z.number(),
});

/**
 * Zod schema for XBRL Financials Response.
 */
export const XBRLFinancialsResponseSchema = z.object({
  orgnr: z.string(),
  name: z.string(),
  fiscalYears: z.array(z.number()),
  financials: z.array(XBRLFinancialsFlatSchema),
});

/**
 * Zod schema for XBRL Latest Response.
 */
export const XBRLLatestResponseSchema = z.object({
  orgnr: z.string(),
  name: z.string(),
  fiscalYear: z.number(),
  current: XBRLFinancialsFlatSchema,
  previous: XBRLFinancialsFlatSchema.nullable(),
  yoyChanges: z.object({
    revenueChange: nullableNumber,
    profitChange: nullableNumber,
    assetsChange: nullableNumber,
    employeesChange: nullableNumber,
  }),
});

/**
 * Zod schema for XBRL Search Filters.
 */
export const XBRLSearchFiltersSchema = z.object({
  minYear: z.number().optional(),
  maxYear: z.number().optional(),
  minRevenue: z.number().optional(),
  maxRevenue: z.number().optional(),
  minEmployees: z.number().optional(),
  hasAudit: z.boolean().optional(),
  isProfitable: z.boolean().optional(),
  page: z.number().min(1).optional(),
  pageSize: z.number().min(1).max(100).optional(),
});

/**
 * Zod schema for XBRL Search Response.
 */
export const XBRLSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      orgnr: z.string(),
      name: z.string(),
      fiscalYear: z.number(),
      revenue: nullableNumber,
      netProfit: nullableNumber,
      numEmployees: nullableNumber,
    })
  ),
  pagination: PaginationMetaSchema,
  filters: XBRLSearchFiltersSchema,
});

// =============================================================================
// TYPE INFERENCE FROM ZOD SCHEMAS
// =============================================================================

/** Inferred type from IncomeStatementSchema */
export type IncomeStatementInferred = z.infer<typeof IncomeStatementSchema>;

/** Inferred type from BalanceSheetAssetsSchema */
export type BalanceSheetAssetsInferred = z.infer<typeof BalanceSheetAssetsSchema>;

/** Inferred type from XBRLFinancialPeriodSchema */
export type XBRLFinancialPeriodInferred = z.infer<typeof XBRLFinancialPeriodSchema>;

/** Inferred type from AnnualReportSchema */
export type AnnualReportInferred = z.infer<typeof AnnualReportSchema>;
