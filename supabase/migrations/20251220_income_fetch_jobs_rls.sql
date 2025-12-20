-- Enable RLS on income_fetch_jobs
ALTER TABLE income_fetch_jobs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow authenticated insert" ON income_fetch_jobs;
DROP POLICY IF EXISTS "Allow authenticated select" ON income_fetch_jobs;
DROP POLICY IF EXISTS "Allow authenticated update" ON income_fetch_jobs;
DROP POLICY IF EXISTS "Allow service role all" ON income_fetch_jobs;

-- Allow authenticated users to insert their own jobs
CREATE POLICY "Allow authenticated insert" ON income_fetch_jobs
FOR INSERT TO authenticated WITH CHECK (true);

-- Allow authenticated users to read all jobs
CREATE POLICY "Allow authenticated select" ON income_fetch_jobs
FOR SELECT TO authenticated USING (true);

-- Allow authenticated users to update jobs
CREATE POLICY "Allow authenticated update" ON income_fetch_jobs
FOR UPDATE TO authenticated USING (true);

-- Allow service role full access (for GitHub Actions)
CREATE POLICY "Allow service role all" ON income_fetch_jobs
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Also ensure person_income has proper RLS
ALTER TABLE person_income ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read person_income" ON person_income;
DROP POLICY IF EXISTS "Allow service role all person_income" ON person_income;

CREATE POLICY "Allow authenticated read person_income" ON person_income
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow service role all person_income" ON person_income
FOR ALL TO service_role USING (true) WITH CHECK (true);
