-- Migration 004: Budget views fix
-- Created: 2025-12-20

CREATE OR REPLACE VIEW public.user_spending_overview AS
SELECT
  bl.user_id,
  date_trunc('day', bl.created_at)::DATE as spending_date,
  bl.service,
  COUNT(*) as request_count,
  SUM(bl.tokens_input) as total_tokens_input,
  SUM(bl.tokens_output) as total_tokens_output,
  SUM(bl.cost_sek) as total_cost_sek
FROM public.budget_logs bl
GROUP BY bl.user_id, date_trunc('day', bl.created_at), bl.service
ORDER BY spending_date DESC, total_cost_sek DESC;

CREATE OR REPLACE VIEW public.daily_user_spending AS
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
  FROM public.budget_logs
  GROUP BY user_id, created_at, service
) as service_summary
GROUP BY user_id, date_trunc('day', created_at)
ORDER BY date DESC;

GRANT SELECT ON public.user_spending_overview TO authenticated;
GRANT SELECT ON public.daily_user_spending TO authenticated;
