-- Migration: Create document_purchases table
-- Date: 2025-12-20
-- Description: Loggar dokumentköp från Bolagsverket med verifiering och status

-- Skapa tabell för dokumentköp
CREATE TABLE IF NOT EXISTS document_purchases (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    orgnr VARCHAR(20) NOT NULL,
    documents JSONB NOT NULL,
    amount_sek INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    user_id UUID REFERENCES auth.users(id),
    otp_code VARCHAR(10),
    otp_sent_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    downloaded_files JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index för snabbare sökning
CREATE INDEX IF NOT EXISTS idx_document_purchases_orgnr ON document_purchases(orgnr);
CREATE INDEX IF NOT EXISTS idx_document_purchases_status ON document_purchases(status);
CREATE INDEX IF NOT EXISTS idx_document_purchases_created_at ON document_purchases(created_at);

-- RLS (Row Level Security)
ALTER TABLE document_purchases ENABLE ROW LEVEL SECURITY;

-- Policy: Användare kan se sina egna köp
DROP POLICY IF EXISTS "Users can view own purchases" ON document_purchases;
CREATE POLICY "Users can view own purchases"
    ON document_purchases FOR SELECT
    USING (auth.uid() = user_id OR user_id IS NULL);

-- Policy: Service role kan allt
DROP POLICY IF EXISTS "Service role full access" ON document_purchases;
CREATE POLICY "Service role full access"
    ON document_purchases FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Kommentar
COMMENT ON TABLE document_purchases IS 'Loggar dokumentköp från Bolagsverket med verifiering och status';
