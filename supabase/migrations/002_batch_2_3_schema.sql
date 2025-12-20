-- Migration 002: BATCH 2 & 3 Schema
-- Nyhets- & Innehållsgenerering + Automatisering & Säkerhet
-- Created: 2025-12-19

-- ============================================================================
-- BATCH 2: NYHETS- & INNEHÅLLSGENERERING
-- ============================================================================

-- Table: generated_articles
-- Used by: generate-article function
CREATE TABLE IF NOT EXISTS public.generated_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relations
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES loop_table(id) ON DELETE SET NULL,

  -- Article content
  title TEXT NOT NULL,
  lead TEXT NOT NULL,
  body TEXT NOT NULL,
  summary TEXT,
  keywords TEXT[],
  word_count INTEGER,

  -- Metadata
  article_type TEXT CHECK (article_type IN ('news', 'profile', 'analysis')),
  tone TEXT CHECK (tone IN ('neutral', 'positive', 'critical')),

  -- AI metadata
  model TEXT NOT NULL,
  tokens_used INTEGER,
  cost_sek DECIMAL(10,2),

  -- Status
  published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  published_url TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for generated_articles
CREATE INDEX IF NOT EXISTS idx_generated_articles_user_id ON generated_articles(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_articles_company_id ON generated_articles(company_id);
CREATE INDEX IF NOT EXISTS idx_generated_articles_created_at ON generated_articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_articles_keywords ON generated_articles USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_generated_articles_published ON generated_articles(published) WHERE published = true;

-- RLS for generated_articles
ALTER TABLE generated_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own articles" ON generated_articles;
CREATE POLICY "Users can view own articles"
  ON generated_articles
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own articles" ON generated_articles;
CREATE POLICY "Users can create own articles"
  ON generated_articles
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own articles" ON generated_articles;
CREATE POLICY "Users can update own articles"
  ON generated_articles
  FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own articles" ON generated_articles;
CREATE POLICY "Users can delete own articles"
  ON generated_articles
  FOR DELETE
  USING (user_id = auth.uid());

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_generated_articles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_generated_articles_updated_at ON generated_articles;
CREATE TRIGGER trigger_update_generated_articles_updated_at
  BEFORE UPDATE ON generated_articles
  FOR EACH ROW
  EXECUTE FUNCTION update_generated_articles_updated_at();

-- ============================================================================
-- BATCH 3: AUTOMATISERING & SÄKERHET
-- ============================================================================

-- Table: budget_logs
-- Shared by ALL services that cost money
CREATE TABLE IF NOT EXISTS public.budget_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Service info
  service TEXT NOT NULL, -- 'anthropic', 'nopecha', 'twilio', 'bolagsverket'
  operation TEXT NOT NULL, -- 'generate-article', 'parse-pdf', 'solve-captcha', etc.

  -- Cost tracking
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_sek DECIMAL(10,2) NOT NULL,

  -- Metadata (flexible JSONB for service-specific data)
  metadata JSONB,

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure expected columns exist if budget_logs was created earlier
ALTER TABLE IF EXISTS public.budget_logs
  ADD COLUMN IF NOT EXISTS tokens_input INTEGER;
ALTER TABLE IF EXISTS public.budget_logs
  ADD COLUMN IF NOT EXISTS tokens_output INTEGER;
ALTER TABLE IF EXISTS public.budget_logs
  ADD COLUMN IF NOT EXISTS cost_sek DECIMAL(10,2);

-- Indexes for budget_logs
CREATE INDEX IF NOT EXISTS idx_budget_logs_user_id ON budget_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_logs_service ON budget_logs(service);
CREATE INDEX IF NOT EXISTS idx_budget_logs_operation ON budget_logs(operation);
CREATE INDEX IF NOT EXISTS idx_budget_logs_created_at ON budget_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_budget_logs_user_service ON budget_logs(user_id, service);

-- RLS for budget_logs
ALTER TABLE budget_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own logs" ON budget_logs;
CREATE POLICY "Users can view own logs"
  ON budget_logs
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "System can insert logs" ON budget_logs;
CREATE POLICY "System can insert logs"
  ON budget_logs
  FOR INSERT
  WITH CHECK (false); -- Only via service role key

-- Table: user_budget_limits
CREATE TABLE IF NOT EXISTS public.user_budget_limits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Budget limits (SEK)
  daily_limit DECIMAL(10,2) DEFAULT 100,
  monthly_limit DECIMAL(10,2) DEFAULT 1000,

  -- Alert thresholds (percentage)
  alert_threshold_daily INTEGER DEFAULT 80, -- Alert at 80% of daily limit
  alert_threshold_monthly INTEGER DEFAULT 80, -- Alert at 80% of monthly limit

  -- Alert settings
  alert_email BOOLEAN DEFAULT true,
  alert_dashboard BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for user_budget_limits
ALTER TABLE user_budget_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own limits" ON user_budget_limits;
CREATE POLICY "Users can view own limits"
  ON user_budget_limits
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage own limits" ON user_budget_limits;
CREATE POLICY "Users can manage own limits"
  ON user_budget_limits
  FOR ALL
  USING (user_id = auth.uid());

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_update_user_budget_limits_updated_at ON user_budget_limits;
CREATE TRIGGER trigger_update_user_budget_limits_updated_at
  BEFORE UPDATE ON user_budget_limits
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Table: bolagsverket_protocols
CREATE TABLE IF NOT EXISTS public.bolagsverket_protocols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Company info
  orgnr TEXT NOT NULL,
  company_name TEXT,

  -- Protocol info
  year INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'bolagsstämma', 'extra bolagsstämma'
  date TEXT,
  description TEXT,

  -- Purchase info
  cost DECIMAL(10,2),
  purchased BOOLEAN DEFAULT false,
  purchased_by UUID REFERENCES auth.users(id),
  purchased_at TIMESTAMPTZ,

  -- Document storage
  pdf_url TEXT, -- External URL (if available)
  pdf_stored_at TEXT, -- Supabase Storage path
  document_id TEXT, -- Bolagsverket document ID

  -- Metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint
  UNIQUE(orgnr, year, type)
);

-- Indexes for bolagsverket_protocols
CREATE INDEX IF NOT EXISTS idx_bolagsverket_protocols_orgnr ON bolagsverket_protocols(orgnr);
CREATE INDEX IF NOT EXISTS idx_bolagsverket_protocols_year ON bolagsverket_protocols(year DESC);
CREATE INDEX IF NOT EXISTS idx_bolagsverket_protocols_purchased ON bolagsverket_protocols(purchased);
CREATE INDEX IF NOT EXISTS idx_bolagsverket_protocols_purchased_by ON bolagsverket_protocols(purchased_by);

-- RLS for bolagsverket_protocols
ALTER TABLE bolagsverket_protocols ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view all protocols" ON bolagsverket_protocols;
CREATE POLICY "Users can view all protocols"
  ON bolagsverket_protocols
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "System can manage protocols" ON bolagsverket_protocols;
CREATE POLICY "System can manage protocols"
  ON bolagsverket_protocols
  FOR ALL
  USING (false); -- Only via service role

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_update_bolagsverket_protocols_updated_at ON bolagsverket_protocols;
CREATE TRIGGER trigger_update_bolagsverket_protocols_updated_at
  BEFORE UPDATE ON bolagsverket_protocols
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function: Get user spending summary
CREATE OR REPLACE FUNCTION get_user_spending_summary(
  p_user_id UUID,
  p_period TEXT DEFAULT 'day' -- 'day', 'week', 'month'
)
RETURNS TABLE(
  total_cost DECIMAL(10,2),
  by_service JSONB,
  transaction_count BIGINT
) AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
BEGIN
  -- Calculate start date based on period
  CASE p_period
    WHEN 'day' THEN
      v_start_date := date_trunc('day', NOW());
    WHEN 'week' THEN
      v_start_date := date_trunc('week', NOW());
    WHEN 'month' THEN
      v_start_date := date_trunc('month', NOW());
    ELSE
      v_start_date := date_trunc('day', NOW());
  END CASE;

  RETURN QUERY
  SELECT
    COALESCE(SUM(cost_sek), 0)::DECIMAL(10,2) as total_cost,
    jsonb_object_agg(service, service_cost) as by_service,
    COUNT(*)::BIGINT as transaction_count
  FROM (
    SELECT
      service,
      SUM(cost_sek) as service_cost
    FROM budget_logs
    WHERE user_id = p_user_id
      AND created_at >= v_start_date
    GROUP BY service
  ) as service_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check if user has exceeded budget
CREATE OR REPLACE FUNCTION check_budget_limit(
  p_user_id UUID,
  p_cost DECIMAL(10,2),
  p_period TEXT DEFAULT 'day' -- 'day' or 'month'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_current_spending DECIMAL(10,2);
  v_limit DECIMAL(10,2);
  v_start_date TIMESTAMPTZ;
BEGIN
  -- Get budget limit
  IF p_period = 'day' THEN
    SELECT daily_limit INTO v_limit
    FROM user_budget_limits
    WHERE user_id = p_user_id;

    v_start_date := date_trunc('day', NOW());
  ELSE
    SELECT monthly_limit INTO v_limit
    FROM user_budget_limits
    WHERE user_id = p_user_id;

    v_start_date := date_trunc('month', NOW());
  END IF;

  -- Default limit if not set
  IF v_limit IS NULL THEN
    v_limit := CASE WHEN p_period = 'day' THEN 100 ELSE 1000 END;
  END IF;

  -- Get current spending
  SELECT COALESCE(SUM(cost_sek), 0) INTO v_current_spending
  FROM budget_logs
  WHERE user_id = p_user_id
    AND created_at >= v_start_date;

  -- Check if adding new cost would exceed limit
  RETURN (v_current_spending + p_cost) <= v_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Views: Budget analytics (guarded to avoid hard-fail on legacy schemas)
DO $$
BEGIN
  EXECUTE $view$
    CREATE OR REPLACE VIEW user_spending_overview AS
    SELECT
      bl.user_id,
      date_trunc('day', bl.created_at)::DATE as spending_date,
      bl.service,
      COUNT(*) as request_count,
      SUM(bl.tokens_input) as total_tokens_input,
      SUM(bl.tokens_output) as total_tokens_output,
      SUM(bl.cost_sek) as total_cost_sek
    FROM budget_logs bl
    GROUP BY bl.user_id, date_trunc('day', bl.created_at), bl.service
    ORDER BY spending_date DESC, total_cost_sek DESC
  $view$;

  EXECUTE $view$
    CREATE OR REPLACE VIEW daily_user_spending AS
    SELECT
      user_id,
      date_trunc('day', created_at)::DATE as date,
      COUNT(*) as transactions,
      SUM(service_cost) as total_cost,
      jsonb_object_agg(service, service_cost) as by_service
    FROM (
      SELECT
        user_id,
        created_at,
        service,
        SUM(cost_sek) as service_cost
      FROM budget_logs
      GROUP BY user_id, created_at, service
    ) as service_summary
    GROUP BY user_id, date_trunc('day', created_at)
    ORDER BY date DESC
  $view$;
EXCEPTION
  WHEN undefined_table OR undefined_column THEN
    RAISE NOTICE 'Skipping budget views: %', SQLERRM;
END;
$$;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Grant usage on helper functions to authenticated users
GRANT EXECUTE ON FUNCTION get_user_spending_summary(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_budget_limit(UUID, DECIMAL, TEXT) TO authenticated;

-- Grant select on views to authenticated users
DO $$
BEGIN
  EXECUTE 'GRANT SELECT ON user_spending_overview TO authenticated';
  EXECUTE 'GRANT SELECT ON daily_user_spending TO authenticated';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Skipping view grants: %', SQLERRM;
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE generated_articles IS 'AI-generated news articles using Claude API';
COMMENT ON TABLE budget_logs IS 'Audit log for ALL API costs (Anthropic, NopeCHA, Twilio, etc.)';
COMMENT ON TABLE user_budget_limits IS 'User-defined budget limits and alert thresholds';
COMMENT ON TABLE bolagsverket_protocols IS 'Bolagsstämmoprotokoll from Bolagsverket';

COMMENT ON FUNCTION get_user_spending_summary IS 'Get user spending summary for a given period (day/week/month)';
COMMENT ON FUNCTION check_budget_limit IS 'Check if user would exceed budget limit with a new cost';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
