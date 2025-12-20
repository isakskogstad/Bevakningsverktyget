-- =====================================================
-- Person Income Table - Stores income data from Ratsit
-- =====================================================

CREATE TABLE IF NOT EXISTS person_income (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Person identifiers
    person_name TEXT NOT NULL,
    birth_year INTEGER,
    address TEXT,
    city TEXT,
    personnummer TEXT,
    profile_url TEXT,

    -- Income data
    income_year INTEGER NOT NULL,
    taxable_income INTEGER,          -- Förvärvsinkomst
    capital_income INTEGER,          -- Kapitalinkomst (kan vara negativ)
    final_tax INTEGER,               -- Slutlig skatt
    preliminary_tax INTEGER,         -- Preliminär skatt
    tax_surplus_deficit INTEGER,     -- Överskott/underskott

    -- Lönekollen-specifika fält
    age_at_income_year INTEGER,      -- Ålder vid inkomståret
    salary_ranking INTEGER,          -- Löneranking (1 = högst)
    has_payment_remarks BOOLEAN DEFAULT false,  -- Betalningsanmärkning (J/N)

    -- PDF storage reference
    pdf_storage_path TEXT,           -- Path i Supabase Storage bucket

    -- Properties and vehicles (JSON arrays)
    properties JSONB DEFAULT '[]'::jsonb,
    vehicles JSONB DEFAULT '[]'::jsonb,

    -- Company association (optional)
    company_orgnr TEXT,
    company_name TEXT,
    role_type TEXT,                  -- VD, Ordförande, Styrelseledamot etc

    -- Metadata
    source TEXT DEFAULT 'ratsit',
    scraped_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- User who requested this
    requested_by UUID REFERENCES auth.users(id),

    -- Constraints
    CONSTRAINT valid_income_year CHECK (income_year >= 1900 AND income_year <= 2100)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_person_income_name ON person_income(person_name);
CREATE INDEX IF NOT EXISTS idx_person_income_company ON person_income(company_orgnr);
CREATE INDEX IF NOT EXISTS idx_person_income_year ON person_income(income_year DESC);
CREATE INDEX IF NOT EXISTS idx_person_income_scraped ON person_income(scraped_at DESC);

-- Composite index for checking if we already have data
CREATE INDEX IF NOT EXISTS idx_person_income_lookup
ON person_income(person_name, birth_year, income_year);

-- Enable RLS
ALTER TABLE person_income ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read all income data
CREATE POLICY "Authenticated users can read income data" ON person_income
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Authenticated users can insert income data
CREATE POLICY "Authenticated users can insert income data" ON person_income
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_person_income_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_person_income_timestamp
    BEFORE UPDATE ON person_income
    FOR EACH ROW
    EXECUTE FUNCTION update_person_income_timestamp();

-- =====================================================
-- Income Fetch Jobs - Track ongoing/completed fetches
-- =====================================================

CREATE TABLE IF NOT EXISTS income_fetch_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Job details
    person_name TEXT NOT NULL,
    birth_year INTEGER,
    location TEXT,
    company_orgnr TEXT,
    role_type TEXT,

    -- Status: pending, running, completed, failed
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,       -- 0-100
    current_step TEXT,                -- Human readable current step
    error_message TEXT,

    -- Result
    result_id UUID REFERENCES person_income(id),

    -- Timing
    created_at TIMESTAMPTZ DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- User who requested
    requested_by UUID REFERENCES auth.users(id)
);

-- Index for checking job status
CREATE INDEX IF NOT EXISTS idx_income_jobs_status ON income_fetch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_income_jobs_user ON income_fetch_jobs(requested_by, created_at DESC);

-- Enable RLS
ALTER TABLE income_fetch_jobs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see their own jobs
CREATE POLICY "Users can see their own jobs" ON income_fetch_jobs
    FOR SELECT
    TO authenticated
    USING (requested_by = auth.uid());

-- Policy: Users can create jobs
CREATE POLICY "Users can create jobs" ON income_fetch_jobs
    FOR INSERT
    TO authenticated
    WITH CHECK (requested_by = auth.uid());

-- Policy: System can update any job (for worker updates)
CREATE POLICY "Service role can update jobs" ON income_fetch_jobs
    FOR UPDATE
    TO service_role
    USING (true);

-- =====================================================
-- View: Latest income per person per company
-- =====================================================

CREATE OR REPLACE VIEW latest_person_income AS
SELECT DISTINCT ON (person_name, company_orgnr)
    id,
    person_name,
    birth_year,
    address,
    city,
    income_year,
    taxable_income,
    capital_income,
    final_tax,
    company_orgnr,
    company_name,
    role_type,
    scraped_at
FROM person_income
ORDER BY person_name, company_orgnr, income_year DESC, scraped_at DESC;

COMMENT ON TABLE person_income IS 'Stores income declaration data fetched from Ratsit for company executives';
COMMENT ON TABLE income_fetch_jobs IS 'Tracks income fetch jobs for real-time progress updates';

-- =====================================================
-- Storage Bucket for Lönekollen PDFs
-- =====================================================

-- Note: Storage bucket creation via SQL requires service_role.
-- This creates the bucket if it doesn't exist.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'lonekollen-pdfs',
    'lonekollen-pdfs',
    false,  -- Private bucket
    10485760,  -- 10MB max file size
    ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for authenticated access
CREATE POLICY "Authenticated users can read PDFs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'lonekollen-pdfs');

CREATE POLICY "Authenticated users can upload PDFs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'lonekollen-pdfs');

CREATE POLICY "Service role full access to PDFs"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'lonekollen-pdfs');

-- =====================================================
-- Upsert function for income data (avoid duplicates)
-- =====================================================

CREATE OR REPLACE FUNCTION upsert_person_income(
    p_person_name TEXT,
    p_income_year INTEGER,
    p_taxable_income INTEGER,
    p_capital_income INTEGER,
    p_age INTEGER DEFAULT NULL,
    p_salary_ranking INTEGER DEFAULT NULL,
    p_has_payment_remarks BOOLEAN DEFAULT false,
    p_address TEXT DEFAULT NULL,
    p_pdf_path TEXT DEFAULT NULL,
    p_company_orgnr TEXT DEFAULT NULL,
    p_company_name TEXT DEFAULT NULL,
    p_role_type TEXT DEFAULT NULL,
    p_requested_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Check if record already exists
    SELECT id INTO v_id
    FROM person_income
    WHERE person_name = p_person_name
      AND income_year = p_income_year
      AND (company_orgnr = p_company_orgnr OR (company_orgnr IS NULL AND p_company_orgnr IS NULL));

    IF v_id IS NOT NULL THEN
        -- Update existing record
        UPDATE person_income
        SET taxable_income = COALESCE(p_taxable_income, taxable_income),
            capital_income = COALESCE(p_capital_income, capital_income),
            age_at_income_year = COALESCE(p_age, age_at_income_year),
            salary_ranking = COALESCE(p_salary_ranking, salary_ranking),
            has_payment_remarks = COALESCE(p_has_payment_remarks, has_payment_remarks),
            address = COALESCE(p_address, address),
            pdf_storage_path = COALESCE(p_pdf_path, pdf_storage_path),
            scraped_at = now(),
            updated_at = now()
        WHERE id = v_id;
    ELSE
        -- Insert new record
        INSERT INTO person_income (
            person_name, income_year, taxable_income, capital_income,
            age_at_income_year, salary_ranking, has_payment_remarks,
            address, pdf_storage_path, company_orgnr, company_name,
            role_type, requested_by
        ) VALUES (
            p_person_name, p_income_year, p_taxable_income, p_capital_income,
            p_age, p_salary_ranking, p_has_payment_remarks,
            p_address, p_pdf_path, p_company_orgnr, p_company_name,
            p_role_type, p_requested_by
        )
        RETURNING id INTO v_id;
    END IF;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
