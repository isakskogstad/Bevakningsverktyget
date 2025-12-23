-- Sync Metadata Table
-- Lagrar information om senaste synkroniseringar för olika datakällor

CREATE TABLE IF NOT EXISTS sync_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL UNIQUE,
    last_sync_at TIMESTAMPTZ DEFAULT NOW(),
    last_sync_status TEXT DEFAULT 'success',
    records_synced INTEGER DEFAULT 0,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index för snabb sökning
CREATE INDEX IF NOT EXISTS idx_sync_metadata_source ON sync_metadata(source);

-- Trigger för att automatiskt uppdatera updated_at
CREATE OR REPLACE FUNCTION update_sync_metadata_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_metadata_updated ON sync_metadata;
CREATE TRIGGER trigger_sync_metadata_updated
    BEFORE UPDATE ON sync_metadata
    FOR EACH ROW
    EXECUTE FUNCTION update_sync_metadata_timestamp();

-- Lägg till initiala poster för varje datakälla
INSERT INTO sync_metadata (source, last_sync_at, last_sync_status, records_synced, metadata)
VALUES
    ('poit_announcements', NOW(), 'success', 80, '{"cleaned_at": "2025-12-23", "matched_companies": 7}'),
    ('rss_feeds', NOW() - INTERVAL '1 hour', 'pending', 0, '{}'),
    ('press_releases', NOW() - INTERVAL '1 hour', 'pending', 0, '{}'),
    ('company_logos', NOW() - INTERVAL '1 day', 'success', 1244, '{}')
ON CONFLICT (source) DO NOTHING;

-- RLS-policy för att tillåta läsning
ALTER TABLE sync_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access"
    ON sync_metadata FOR SELECT
    USING (true);

-- Kommentar
COMMENT ON TABLE sync_metadata IS 'Metadata för senaste synkroniseringar av olika datakällor';
