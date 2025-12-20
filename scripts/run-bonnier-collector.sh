#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. .venv/bin/activate
TWILIO_TEST_TO="${TWILIO_TEST_TO:-}"
SUPABASE_URL="${SUPABASE_URL:-https://wzkohritxdrstsmwopco.supabase.co}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:?}"
DI_EMAIL="${DI_EMAIL:-isak.skogstad@me.com}"
DI_PASSWORD="${DI_PASSWORD:-Wdef3579!}"
BONNIER_ARTICLE_URLS="${BONNIER_ARTICLE_URLS:-https://www.di.se/live/arise-koper-vindkraftsverk/}"
node scripts/bonnier-collector.js
