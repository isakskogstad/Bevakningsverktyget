-- Migration 003: Allabolag data + SMS preferences
-- Created: 2025-12-19

-- ============================================================================
-- TABLE: company_details
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.company_details (
  orgnr TEXT PRIMARY KEY,
  name TEXT,
  company_type TEXT,
  status TEXT,
  purpose TEXT,
  registered_date TEXT,
  foundation_year INTEGER,
  source_basic TEXT,
  last_synced_at TIMESTAMPTZ,

  postal_street TEXT,
  postal_code TEXT,
  postal_city TEXT,
  visiting_street TEXT,
  visiting_code TEXT,
  visiting_city TEXT,

  phone TEXT,
  email TEXT,
  website TEXT,

  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  municipality TEXT,
  municipality_code TEXT,
  county TEXT,
  county_code TEXT,
  lei_code TEXT,

  moms_registered SMALLINT,
  employer_registered SMALLINT,
  f_skatt SMALLINT,

  is_group SMALLINT,
  companies_in_group INTEGER,
  parent_orgnr TEXT,
  parent_name TEXT,

  share_capital BIGINT,
  revenue BIGINT,
  net_profit BIGINT,
  total_assets BIGINT,
  equity BIGINT,
  num_employees INTEGER,
  equity_ratio NUMERIC,
  return_on_equity NUMERIC,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_details_name ON company_details(name);
CREATE INDEX IF NOT EXISTS idx_company_details_updated_at ON company_details(updated_at DESC);

ALTER TABLE company_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can view company details" ON company_details;
CREATE POLICY "Authenticated can view company details"
  ON company_details
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- TABLE: company_roles
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.company_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orgnr TEXT NOT NULL,
  name TEXT,
  birth_year INTEGER,
  role_type TEXT,
  role_category TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_roles_orgnr ON company_roles(orgnr);
CREATE INDEX IF NOT EXISTS idx_company_roles_category ON company_roles(role_category);

ALTER TABLE company_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can view company roles" ON company_roles;
CREATE POLICY "Authenticated can view company roles"
  ON company_roles
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- TABLE: company_financials
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.company_financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orgnr TEXT NOT NULL,
  period_year INTEGER,
  period_months INTEGER,
  is_consolidated SMALLINT,
  source TEXT,

  revenue BIGINT,
  other_income BIGINT,
  operating_costs BIGINT,
  raw_materials BIGINT,
  goods BIGINT,
  depreciation_intangible BIGINT,
  depreciation_tangible BIGINT,
  other_external_costs BIGINT,
  inventory_change BIGINT,
  operating_profit BIGINT,
  financial_income BIGINT,
  financial_costs BIGINT,
  profit_after_financial BIGINT,
  net_profit BIGINT,

  intangible_assets BIGINT,
  tangible_assets BIGINT,
  financial_assets BIGINT,
  inventory BIGINT,
  receivables BIGINT,
  cash BIGINT,
  total_assets BIGINT,

  share_capital BIGINT,
  equity BIGINT,
  untaxed_reserves BIGINT,
  provisions BIGINT,
  long_term_liabilities BIGINT,
  short_term_liabilities BIGINT,

  return_on_equity NUMERIC,
  return_on_assets NUMERIC,
  equity_ratio NUMERIC,
  profit_margin NUMERIC,
  quick_ratio NUMERIC,

  num_employees INTEGER,
  salaries_board_ceo BIGINT,
  salaries_other BIGINT,
  social_costs BIGINT,
  revenue_per_employee BIGINT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_financials_orgnr ON company_financials(orgnr);
CREATE INDEX IF NOT EXISTS idx_company_financials_year ON company_financials(period_year DESC);

ALTER TABLE company_financials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can view company financials" ON company_financials;
CREATE POLICY "Authenticated can view company financials"
  ON company_financials
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- TABLE: company_documents
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.company_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_nr TEXT NOT NULL,
  document_type TEXT,
  document_subtype TEXT,
  external_id TEXT,
  title TEXT,
  summary TEXT,
  source_url TEXT,
  file_url TEXT,
  file_type TEXT,
  document_date DATE,
  source TEXT,
  status TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_documents_orgnr ON company_documents(org_nr);
CREATE INDEX IF NOT EXISTS idx_company_documents_type ON company_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_company_documents_created_at ON company_documents(created_at DESC);

ALTER TABLE company_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can view company documents" ON company_documents;
CREATE POLICY "Authenticated can view company documents"
  ON company_documents
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- TABLE: sms_preferences
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.sms_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number TEXT,
  important_events TEXT[] DEFAULT ARRAY[]::TEXT[],
  important_orgnrs TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- TABLE: sync_jobs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.sync_jobs (
  job_name TEXT PRIMARY KEY,
  status TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  metadata JSONB
);

GRANT ALL ON TABLE sync_jobs TO service_role;

ALTER TABLE sms_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own SMS preferences" ON sms_preferences;
CREATE POLICY "Users can view own SMS preferences"
  ON sms_preferences
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage own SMS preferences" ON sms_preferences;
CREATE POLICY "Users can manage own SMS preferences"
  ON sms_preferences
  FOR ALL
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_sms_preferences_updated_at ON sms_preferences;
CREATE TRIGGER update_sms_preferences_updated_at
  BEFORE UPDATE ON sms_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

GRANT ALL ON TABLE company_details TO service_role;
GRANT ALL ON TABLE company_roles TO service_role;
GRANT ALL ON TABLE company_financials TO service_role;
GRANT ALL ON TABLE company_documents TO service_role;
GRANT ALL ON TABLE sms_preferences TO service_role;
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS from_phone TEXT;
