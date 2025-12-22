/**
 * Common Type Declarations for Bevakningsverktyg
 * 
 * This file contains shared type definitions used across the project
 * for company data, scraping results, browser automation, and more.
 */

// =============================================================================
// COMPANY & BUSINESS DATA
// =============================================================================

/**
 * Basic company details from various sources
 */
export interface CompanyDetails {
  /** Company organization number (SE: organisationsnummer) */
  orgNumber?: string;
  /** Company name */
  name: string;
  /** Company registration date */
  registrationDate?: string;
  /** Company legal form (AB, HB, etc.) */
  legalForm?: string;
  /** Company status (active, bankrupt, etc.) */
  status?: string;
  /** Company address */
  address?: {
    street?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  };
  /** Contact information */
  contact?: {
    phone?: string;
    email?: string;
    website?: string;
  };
}

/**
 * Financial information for a company
 */
export interface FinancialData {
  /** Fiscal year */
  year: number;
  /** Revenue/turnover in SEK */
  revenue?: number;
  /** Operating profit in SEK */
  operatingProfit?: number;
  /** Net profit/loss in SEK */
  netProfit?: number;
  /** Total assets in SEK */
  assets?: number;
  /** Number of employees */
  employees?: number;
}

// =============================================================================
// SCRAPING & AUTOMATION
// =============================================================================

/**
 * Result from a web scraping operation
 */
export interface ScraperResult<T = unknown> {
  /** Whether the scraping was successful */
  success: boolean;
  /** Scraped data */
  data?: T;
  /** Error message if failed */
  error?: string;
  /** Timestamp of scraping */
  timestamp?: string;
  /** Source URL */
  sourceUrl?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Browser automation options
 */
export interface BrowserOptions {
  /** Run browser in headless mode */
  headless?: boolean;
  /** Browser viewport width */
  width?: number;
  /** Browser viewport height */
  height?: number;
  /** Use proxy server */
  proxy?: string;
  /** Custom user agent */
  userAgent?: string;
  /** Navigation timeout in milliseconds */
  timeout?: number;
  /** Enable stealth mode */
  stealth?: boolean;
}

/**
 * Page navigation result
 */
export interface NavigationResult {
  /** Whether navigation was successful */
  success: boolean;
  /** Final URL after navigation */
  url?: string;
  /** HTTP status code */
  statusCode?: number;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// API & EXTERNAL SERVICES
// =============================================================================

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T = unknown> {
  /** Response data */
  data?: T;
  /** Error information */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  /** Response metadata */
  meta?: {
    timestamp?: string;
    requestId?: string;
    [key: string]: unknown;
  };
}

/**
 * Supabase query result
 */
export interface SupabaseResult<T = unknown> {
  data: T | null;
  error: Error | null;
}

// =============================================================================
// DOCUMENT & CONTENT TYPES
// =============================================================================

/**
 * Press release or article data
 */
export interface PressRelease {
  /** Unique identifier */
  id?: string;
  /** Article title */
  title: string;
  /** Article content/body */
  content: string;
  /** Publication date */
  publishedAt?: string;
  /** Article URL */
  url?: string;
  /** Author information */
  author?: string;
  /** Related company */
  company?: string;
  /** Article tags/categories */
  tags?: string[];
  /** Article images */
  images?: string[];
}

/**
 * PDF document metadata
 */
export interface PdfDocument {
  /** Document filename */
  filename: string;
  /** Document URL */
  url?: string;
  /** Number of pages */
  pageCount?: number;
  /** Document text content */
  text?: string;
  /** Extraction timestamp */
  extractedAt?: string;
  /** Document metadata */
  metadata?: {
    title?: string;
    author?: string;
    creationDate?: string;
    [key: string]: unknown;
  };
}

// =============================================================================
// MONITORING & LOGGING
// =============================================================================

/**
 * Monitoring event data
 */
export interface MonitoringEvent {
  /** Event type */
  type: string;
  /** Event severity level */
  level: 'info' | 'warning' | 'error' | 'critical';
  /** Event message */
  message: string;
  /** Event timestamp */
  timestamp: string;
  /** Related company or entity */
  entity?: string;
  /** Additional event data */
  data?: Record<string, unknown>;
}

/**
 * Task execution result
 */
export interface TaskResult {
  /** Task identifier */
  taskId: string;
  /** Task status */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Task result data */
  result?: unknown;
  /** Error information if failed */
  error?: string;
  /** Task start time */
  startedAt?: string;
  /** Task completion time */
  completedAt?: string;
  /** Task duration in milliseconds */
  durationMs?: number;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Generic pagination parameters
 */
export interface PaginationParams {
  /** Page number (1-indexed) */
  page?: number;
  /** Items per page */
  perPage?: number;
  /** Total count of items */
  total?: number;
}

/**
 * Generic filter options
 */
export interface FilterOptions {
  /** Search query string */
  query?: string;
  /** Date range filter */
  dateRange?: {
    from?: string;
    to?: string;
  };
  /** Status filter */
  status?: string | string[];
  /** Additional filters */
  [key: string]: unknown;
}
