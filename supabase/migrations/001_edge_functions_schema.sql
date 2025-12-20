-- ============================================================================
-- Supabase Edge Functions Schema
-- För bevakningsverktyg journalist dashboard
-- ============================================================================
-- Skapad: 2025-12-19
-- Version: 1.0.0
-- ============================================================================

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate relevance score based on keyword matches
CREATE OR REPLACE FUNCTION calculate_relevance_score(
  content TEXT,
  keywords TEXT[]
)
RETURNS DECIMAL(3,2) AS $$
DECLARE
  match_count INTEGER := 0;
  keyword TEXT;
  total_keywords INTEGER := array_length(keywords, 1);
BEGIN
  IF total_keywords IS NULL OR total_keywords = 0 THEN
    RETURN 0.0;
  END IF;

  FOREACH keyword IN ARRAY keywords
  LOOP
    IF content ILIKE '%' || keyword || '%' THEN
      match_count := match_count + 1;
    END IF;
  END LOOP;

  RETURN ROUND(match_count::DECIMAL / total_keywords::DECIMAL, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- TABLE: rss_feeds
-- Konfigurerade RSS-feeds
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rss_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Metadata
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  description TEXT,

  -- Konfiguration
  enabled BOOLEAN DEFAULT true,
  check_interval_minutes INTEGER DEFAULT 60,

  -- Filtering
  keywords TEXT[], -- Nyckelord att matcha mot
  exclude_keywords TEXT[], -- Nyckelord att exkludera

  -- Cache
  last_fetched_at TIMESTAMPTZ,
  last_error TEXT,
  error_count INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Index för performance
CREATE INDEX IF NOT EXISTS idx_rss_feeds_enabled ON rss_feeds(enabled);
CREATE INDEX IF NOT EXISTS idx_rss_feeds_last_fetched ON rss_feeds(last_fetched_at);
CREATE INDEX IF NOT EXISTS idx_rss_feeds_keywords ON rss_feeds USING GIN(keywords);

-- Trigger för updated_at
DROP TRIGGER IF EXISTS update_rss_feeds_updated_at ON rss_feeds;
CREATE TRIGGER update_rss_feeds_updated_at
  BEFORE UPDATE ON rss_feeds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE rss_feeds IS 'Konfigurerade RSS-feeds för bevakning';

-- ============================================================================
-- TABLE: rss_articles
-- Cachade RSS-artiklar
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rss_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relation
  feed_id UUID NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,

  -- Artikel-data
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  description TEXT,
  content TEXT,
  pub_date TIMESTAMPTZ,
  author TEXT,

  -- Metadata
  guid TEXT UNIQUE, -- RSS item GUID
  raw_xml JSONB, -- Full XML item för referens

  -- Matching
  matched_keywords TEXT[],
  relevance_score DECIMAL(3,2) DEFAULT 0.0, -- 0.00-1.00

  -- Status
  read BOOLEAN DEFAULT false,
  bookmarked BOOLEAN DEFAULT false,

  -- Timestamps
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_rss_articles_feed_id ON rss_articles(feed_id);
CREATE INDEX IF NOT EXISTS idx_rss_articles_pub_date ON rss_articles(pub_date DESC);
CREATE INDEX IF NOT EXISTS idx_rss_articles_matched_keywords ON rss_articles USING GIN(matched_keywords);
CREATE INDEX IF NOT EXISTS idx_rss_articles_bookmarked ON rss_articles(bookmarked) WHERE bookmarked = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_articles_guid ON rss_articles(guid);

COMMENT ON TABLE rss_articles IS 'Cachade RSS-artiklar med keyword matching';

-- ============================================================================
-- TABLE: bookmarks
-- Användarnas bokmärken
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Användare
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Bokmärke-data
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,

  -- Typ
  type TEXT NOT NULL CHECK (type IN ('rss_article', 'poit_announcement', 'company', 'other')),
  reference_id UUID, -- ID till relaterad entitet

  -- Organisering
  tags TEXT[],
  folder TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_type ON bookmarks(type);
CREATE INDEX IF NOT EXISTS idx_bookmarks_tags ON bookmarks USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks(created_at DESC);

-- Trigger
DROP TRIGGER IF EXISTS update_bookmarks_updated_at ON bookmarks;
CREATE TRIGGER update_bookmarks_updated_at
  BEFORE UPDATE ON bookmarks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE bookmarks IS 'Användarnas bokmärken';

-- ============================================================================
-- TABLE: keyword_alerts
-- Nyckelordsbevakning
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.keyword_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Användare
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Alert-konfiguration
  name TEXT NOT NULL,
  keywords TEXT[] NOT NULL,
  exclude_keywords TEXT[],

  -- Notifikations-inställningar
  notify_email BOOLEAN DEFAULT false,
  notify_sms BOOLEAN DEFAULT false,
  notify_dashboard BOOLEAN DEFAULT true,

  -- Filtrering
  sources TEXT[] DEFAULT ARRAY['rss', 'poit', 'mynewsdesk'],
  company_ids UUID[], -- Specifika företag att bevaka

  -- Status
  enabled BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_keyword_alerts_user_id ON keyword_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_keyword_alerts_enabled ON keyword_alerts(enabled);
CREATE INDEX IF NOT EXISTS idx_keyword_alerts_keywords ON keyword_alerts USING GIN(keywords);

-- Trigger
DROP TRIGGER IF EXISTS update_keyword_alerts_updated_at ON keyword_alerts;
CREATE TRIGGER update_keyword_alerts_updated_at
  BEFORE UPDATE ON keyword_alerts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE keyword_alerts IS 'Nyckelordsbevakning med notifikationer';

-- ============================================================================
-- TABLE: keyword_alert_matches
-- Alert-matchningar
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.keyword_alert_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relation
  alert_id UUID NOT NULL REFERENCES keyword_alerts(id) ON DELETE CASCADE,

  -- Match-data
  source TEXT NOT NULL CHECK (source IN ('rss', 'poit', 'mynewsdesk')),
  source_id UUID, -- ID i source-tabell
  title TEXT NOT NULL,
  url TEXT,
  matched_keywords TEXT[],

  -- Status
  read BOOLEAN DEFAULT false,
  dismissed BOOLEAN DEFAULT false,

  -- Metadata
  matched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_alert_matches_alert_id ON keyword_alert_matches(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_matches_read ON keyword_alert_matches(read);
CREATE INDEX IF NOT EXISTS idx_alert_matches_matched_at ON keyword_alert_matches(matched_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_matches_source ON keyword_alert_matches(source);

COMMENT ON TABLE keyword_alert_matches IS 'Matchningar för nyckelordsalerts';

-- ============================================================================
-- TABLE: sms_logs
-- SMS-loggning
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Användare
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- SMS-data
  to_phone TEXT NOT NULL,
  message TEXT NOT NULL,

  -- Twilio response
  twilio_sid TEXT UNIQUE,
  status TEXT, -- 'queued', 'sent', 'delivered', 'failed'
  error_code TEXT,
  error_message TEXT,

  -- Rate limiting
  rate_limit_key TEXT, -- För rate limiting per användare

  -- Metadata
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,

  -- Kostnad (för budgetuppföljning)
  cost_sek DECIMAL(10,2) DEFAULT 0.50
);

-- Index
CREATE INDEX IF NOT EXISTS idx_sms_logs_user_id ON sms_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_sent_at ON sms_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(status);
CREATE INDEX IF NOT EXISTS idx_sms_logs_rate_limit_key ON sms_logs(rate_limit_key, sent_at);
CREATE INDEX IF NOT EXISTS idx_sms_logs_twilio_sid ON sms_logs(twilio_sid);

COMMENT ON TABLE sms_logs IS 'Audit log för SMS-notifikationer';

-- ============================================================================
-- TABLE: pressroom_cache
-- MyNewsdesk cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pressroom_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Company info
  company_id UUID REFERENCES loop_table(id),
  company_name TEXT,
  pressroom_url TEXT NOT NULL,

  -- Cached data
  press_releases JSONB[] DEFAULT ARRAY[]::JSONB[], -- Array av pressreleaser
  images JSONB[] DEFAULT ARRAY[]::JSONB[], -- Array av bilder

  -- Cache metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,

  -- Error tracking
  fetch_error TEXT,
  fetch_attempts INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_pressroom_cache_company_id ON pressroom_cache(company_id);
CREATE INDEX IF NOT EXISTS idx_pressroom_cache_expires_at ON pressroom_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_pressroom_cache_pressroom_url ON pressroom_cache(pressroom_url);

-- Unique constraint på pressroom_url (en cache-post per pressrum)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pressroom_cache_url_unique ON pressroom_cache(pressroom_url);

-- Trigger
DROP TRIGGER IF EXISTS update_pressroom_cache_updated_at ON pressroom_cache;
CREATE TRIGGER update_pressroom_cache_updated_at
  BEFORE UPDATE ON pressroom_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE pressroom_cache IS 'Cache för MyNewsdesk pressrum';

-- ============================================================================
-- TABLE: rate_limits
-- Rate limiting tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifikation
  key TEXT NOT NULL, -- user_id:endpoint eller ip:endpoint
  endpoint TEXT NOT NULL,

  -- Tracking
  request_count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  window_end TIMESTAMPTZ,

  -- Metadata
  last_request_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_key_endpoint ON rate_limits(key, endpoint, window_start);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_end ON rate_limits(window_end);

COMMENT ON TABLE rate_limits IS 'Rate limiting tracking';

-- ============================================================================
-- FUNCTION: increment_rate_limit
-- Öka rate limit counter
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_key TEXT,
  p_endpoint TEXT,
  p_window_minutes INTEGER
)
RETURNS void AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
BEGIN
  v_window_start := NOW();
  v_window_end := NOW() + (p_window_minutes || ' minutes')::INTERVAL;

  INSERT INTO rate_limits (key, endpoint, request_count, window_start, window_end, last_request_at)
  VALUES (p_key, p_endpoint, 1, v_window_start, v_window_end, NOW())
  ON CONFLICT (key, endpoint, window_start)
  DO UPDATE SET
    request_count = rate_limits.request_count + 1,
    last_request_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: cleanup_old_rate_limits
-- Rensa gamla rate limit poster
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM rate_limits
  WHERE window_end < NOW() - INTERVAL '1 hour';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger för auto-cleanup
DROP TRIGGER IF EXISTS trigger_cleanup_rate_limits ON rate_limits;
CREATE TRIGGER trigger_cleanup_rate_limits
  AFTER INSERT ON rate_limits
  EXECUTE FUNCTION cleanup_old_rate_limits();

-- ============================================================================
-- FUNCTION: cleanup_old_cache
-- Rensa gammal cache (kan köras manuellt eller via cron)
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_old_cache(older_than_hours INTEGER DEFAULT 72)
RETURNS INTEGER AS $$
DECLARE
  rss_deleted INTEGER := 0;
  press_deleted INTEGER := 0;
BEGIN
  -- Rensa gamla RSS-artiklar
  WITH deleted AS (
    DELETE FROM rss_articles
    WHERE fetched_at < NOW() - (older_than_hours || ' hours')::INTERVAL
    RETURNING 1
  )
  SELECT COUNT(*) INTO rss_deleted FROM deleted;

  -- Rensa gammal pressroom cache
  WITH deleted AS (
    DELETE FROM pressroom_cache
    WHERE expires_at < NOW() - (older_than_hours || ' hours')::INTERVAL
    RETURNING 1
  )
  SELECT COUNT(*) INTO press_deleted FROM deleted;

  RETURN COALESCE(rss_deleted, 0) + COALESCE(press_deleted, 0);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- rss_feeds
ALTER TABLE rss_feeds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view enabled feeds" ON rss_feeds;
CREATE POLICY "Users can view enabled feeds"
  ON rss_feeds
  FOR SELECT
  USING (enabled = true);

DROP POLICY IF EXISTS "Admins can manage feeds" ON rss_feeds;
CREATE POLICY "Admins can manage feeds"
  ON rss_feeds
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- rss_articles
ALTER TABLE rss_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view articles" ON rss_articles;
CREATE POLICY "Users can view articles"
  ON rss_articles
  FOR SELECT
  USING (true);

-- bookmarks
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own bookmarks" ON bookmarks;
CREATE POLICY "Users can view own bookmarks"
  ON bookmarks
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own bookmarks" ON bookmarks;
CREATE POLICY "Users can create own bookmarks"
  ON bookmarks
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own bookmarks" ON bookmarks;
CREATE POLICY "Users can update own bookmarks"
  ON bookmarks
  FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own bookmarks" ON bookmarks;
CREATE POLICY "Users can delete own bookmarks"
  ON bookmarks
  FOR DELETE
  USING (user_id = auth.uid());

-- keyword_alerts
ALTER TABLE keyword_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own alerts" ON keyword_alerts;
CREATE POLICY "Users can view own alerts"
  ON keyword_alerts
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own alerts" ON keyword_alerts;
CREATE POLICY "Users can create own alerts"
  ON keyword_alerts
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own alerts" ON keyword_alerts;
CREATE POLICY "Users can update own alerts"
  ON keyword_alerts
  FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own alerts" ON keyword_alerts;
CREATE POLICY "Users can delete own alerts"
  ON keyword_alerts
  FOR DELETE
  USING (user_id = auth.uid());

-- keyword_alert_matches
ALTER TABLE keyword_alert_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own alert matches" ON keyword_alert_matches;
CREATE POLICY "Users can view own alert matches"
  ON keyword_alert_matches
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM keyword_alerts
      WHERE keyword_alerts.id = keyword_alert_matches.alert_id
      AND keyword_alerts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own alert matches" ON keyword_alert_matches;
CREATE POLICY "Users can update own alert matches"
  ON keyword_alert_matches
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM keyword_alerts
      WHERE keyword_alerts.id = keyword_alert_matches.alert_id
      AND keyword_alerts.user_id = auth.uid()
    )
  );

-- sms_logs
ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own SMS logs" ON sms_logs;
CREATE POLICY "Users can view own SMS logs"
  ON sms_logs
  FOR SELECT
  USING (user_id = auth.uid());

-- pressroom_cache
ALTER TABLE pressroom_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view pressroom cache" ON pressroom_cache;
CREATE POLICY "Users can view pressroom cache"
  ON pressroom_cache
  FOR SELECT
  USING (true);

-- rate_limits (ingen RLS - hanteras av Edge Functions)

-- ============================================================================
-- SEED DATA (EXAMPLE RSS FEEDS)
-- ============================================================================

INSERT INTO rss_feeds (name, url, keywords, enabled, description) VALUES
  (
    'Dagens Industri - Börsnoterade',
    'https://www.di.se/rss',
    ARRAY['börs', 'emission', 'kvartalsrapport', 'styrelse', 'vd'],
    true,
    'Dagens Industri RSS-feed med fokus på börsnoterade bolag'
  ),
  (
    'Breakit',
    'https://www.breakit.se/feed',
    ARRAY['startup', 'tech', 'investering', 'exit', 'bolag'],
    true,
    'Breakit tech-nyheter om svenska startups'
  ),
  (
    'Affärsvärlden',
    'https://www.affarsvarlden.se/rss/nyheter',
    ARRAY['börsen', 'analys', 'börsnotering', 'aktie'],
    true,
    'Affärsvärlden börs och marknadsnyheter'
  )
ON CONFLICT (url) DO NOTHING;

-- ============================================================================
-- GRANTS (för Edge Functions med service role)
-- ============================================================================

-- Grant för Edge Functions att läsa/skriva i tabeller
GRANT ALL ON TABLE rss_feeds TO service_role;
GRANT ALL ON TABLE rss_articles TO service_role;
GRANT ALL ON TABLE bookmarks TO service_role;
GRANT ALL ON TABLE keyword_alerts TO service_role;
GRANT ALL ON TABLE keyword_alert_matches TO service_role;
GRANT ALL ON TABLE sms_logs TO service_role;
GRANT ALL ON TABLE pressroom_cache TO service_role;
GRANT ALL ON TABLE rate_limits TO service_role;

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Edge Functions schema migration completed successfully!';
  RAISE NOTICE 'Created tables: rss_feeds, rss_articles, bookmarks, keyword_alerts, keyword_alert_matches, sms_logs, pressroom_cache, rate_limits';
  RAISE NOTICE 'RLS policies enabled on all tables';
  RAISE NOTICE 'Seeded % example RSS feeds', (SELECT COUNT(*) FROM rss_feeds);
END $$;
