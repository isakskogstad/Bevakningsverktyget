-- Add missing columns to income_fetch_jobs table
-- These are used by the Render-deployed ratsit-income-service

-- company_name - Name of the company (for display purposes)
ALTER TABLE income_fetch_jobs
ADD COLUMN IF NOT EXISTS company_name TEXT;

-- result - JSONB column for storing the scraped income data
ALTER TABLE income_fetch_jobs
ADD COLUMN IF NOT EXISTS result JSONB;

-- updated_at - Timestamp for last update
ALTER TABLE income_fetch_jobs
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
