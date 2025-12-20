# SESSION LOG (2025-12-19)

## MCP
- Added Supabase MCP server to `~/.mcp.json`:
  - url: `https://mcp.supabase.com/mcp?project_ref=wzkohritxdrstsmwopco`
- MCP connect failed in-session because server not loaded; requires client restart.

## Dashboard UI (integrated)
- Dashboard redesigned to be single-page with tabs and integrated panels.
- Unified realtime feed groups events per company/day with timestamps and links.
- Companies list added as a tab with search + sector filter.
- Settings moved into a right-side drawer (close on overlay/ESC).
- SMS + budget settings embedded in drawer; SMS log + cost summary shown.
- Company modal includes inline documents section + “Uppdatera data” action.

Files:
- `docs/index.html` (major UI + logic changes)

## Redirects to keep single-page UX
- Added JS redirect to dashboard for:
  - `docs/verktyg/allabolag/index.html`
  - `docs/verktyg/bolagsverket-api/index.html`
  - `docs/verktyg/foretagsbevakning/index.html`
  - `docs/nyhetsverktyg/nyhetsflode/index.html`
  - `docs/installningar/index.html`
  - `docs/sms-notiser/index.html`
  - `docs/admin/budget/index.html`

## Supabase schema/migrations
- New migration: `supabase/migrations/003_allabolag_sms_schema.sql` includes
  - `company_details`, `company_roles`, `company_financials`, `company_documents`
  - `sms_preferences` (user preferences + important orgnrs)
  - `sync_jobs` (job lock)
  - RLS for company_* tables (authenticated read) + sms_preferences
  - Added `from_phone` column to `sms_logs`

## Edge Functions
- Updated `supabase/functions/allabolag-proxy/index.ts`
  - Supports POST with `{ orgnr, save: true }`
  - Saves to Supabase tables
  - Cache guard: skip if synced within 12h
  - Saves financials + roles

- Added `supabase/functions/send-sms/index.ts`
  - Sends SMS via Twilio
  - Logs to `sms_logs` and `budget_logs`

- Added `supabase/functions/twilio-webhook/index.ts`
  - Inbound SMS webhook from Twilio
  - Matches sender phone to `sms_preferences.phone_number`
  - Logs incoming message to `sms_logs`

## Scripts
- Added `scripts/allabolag-batch-update.py`
  - Updates ~200 companies/day
  - Uses `sync_jobs` lock to avoid double runs
  - Uses `company_details.last_synced_at` cache

## Pending/Next
1) Restart client so MCP Supabase server loads.
2) Run migrations + deploy edge functions:
   - `supabase db push`
   - `supabase functions deploy allabolag-proxy send-sms twilio-webhook`
3) Set env vars in Supabase:
   - `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
4) Configure Twilio webhook to `/functions/v1/twilio-webhook`
5) Schedule `scripts/allabolag-batch-update.py` daily (cron) with `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`

## Notes
- Some frontend still uses RSS client-side; consider moving to server-side cache later.
- Company data refresh button calls allabolag-proxy with save=true.

## Git status snapshot
```
## main...origin/main
 M docs/admin/budget/index.html
 M docs/index.html
 M docs/installningar/index.html
 M docs/nyhetsverktyg/nyhetsflode/index.html
 M docs/sms-notiser/index.html
 M docs/verktyg/allabolag/index.html
 M docs/verktyg/bolagsverket-api/index.html
 M docs/verktyg/foretagsbevakning/index.html
 M supabase/functions/allabolag-proxy/index.ts
?? SESSION_LOG.md
?? scripts/allabolag-batch-update.py
?? supabase/functions/send-sms/
?? supabase/functions/twilio-webhook/
?? supabase/migrations/003_allabolag_sms_schema.sql
```
