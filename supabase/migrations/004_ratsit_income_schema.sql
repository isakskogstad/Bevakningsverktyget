-- =============================================
-- Ratsit Income Schema
-- Lagrar inkomstdeklarationer hämtade från Ratsit.se
-- =============================================

-- Skapa tabell för inkomstdata
CREATE TABLE IF NOT EXISTS ratsit_income (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Personuppgifter
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL, -- För sökning (lowercase, utan diakritiska tecken)
    personnummer TEXT, -- Kan vara maskerat
    address TEXT,
    age INTEGER,
    birth_year INTEGER,

    -- Inkomstuppgifter
    taxable_income BIGINT, -- Förvärvsinkomst i SEK
    capital_income BIGINT, -- Kapitalinkomst i SEK (kan vara negativ)
    total_tax BIGINT, -- Total skatt
    final_tax BIGINT, -- Slutlig skatt
    income_year INTEGER, -- Vilket år inkomsten avser

    -- Tillgångar
    properties JSONB, -- Array med fastigheter
    vehicles JSONB, -- Array med fordon

    -- Metadata
    profile_url TEXT, -- URL till Ratsit-profil
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unik kombination av namn + födelseår
    CONSTRAINT ratsit_income_unique_person UNIQUE (name_normalized, birth_year)
);

-- Index för snabbare sökningar
CREATE INDEX IF NOT EXISTS idx_ratsit_income_name ON ratsit_income (name);
CREATE INDEX IF NOT EXISTS idx_ratsit_income_name_normalized ON ratsit_income (name_normalized);
CREATE INDEX IF NOT EXISTS idx_ratsit_income_birth_year ON ratsit_income (birth_year);
CREATE INDEX IF NOT EXISTS idx_ratsit_income_scraped_at ON ratsit_income (scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_ratsit_income_income_year ON ratsit_income (income_year);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_ratsit_income_search ON ratsit_income
    USING gin(to_tsvector('swedish', coalesce(name, '') || ' ' || coalesce(address, '')));

-- Trigger för att uppdatera updated_at
CREATE OR REPLACE FUNCTION update_ratsit_income_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ratsit_income_updated ON ratsit_income;
CREATE TRIGGER trigger_ratsit_income_updated
    BEFORE UPDATE ON ratsit_income
    FOR EACH ROW
    EXECUTE FUNCTION update_ratsit_income_timestamp();

-- Kommentar på tabellen
COMMENT ON TABLE ratsit_income IS 'Inkomstdeklarationer hämtade från Ratsit.se';
COMMENT ON COLUMN ratsit_income.taxable_income IS 'Förvärvsinkomst i SEK';
COMMENT ON COLUMN ratsit_income.capital_income IS 'Kapitalinkomst i SEK (kan vara negativ)';
COMMENT ON COLUMN ratsit_income.income_year IS 'Inkomståret (t.ex. 2023)';

-- RLS (Row Level Security) - optional, aktivera vid behov
-- ALTER TABLE ratsit_income ENABLE ROW LEVEL SECURITY;

-- Policy för att läsa (alla kan läsa)
-- CREATE POLICY "Allow public read" ON ratsit_income FOR SELECT USING (true);

-- Policy för att skriva (endast service role)
-- CREATE POLICY "Allow service write" ON ratsit_income FOR ALL USING (auth.role() = 'service_role');
