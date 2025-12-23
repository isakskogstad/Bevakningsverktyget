#!/bin/bash
# =============================================================================
# Lokal inkomsthämtare för Bevakningsverktyget
# =============================================================================
# Kör detta script lokalt för att hämta inkomstuppgifter från Ratsit.se
# GitHub Actions kan inte användas pga Cloudflare datacenter-IP blockering
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================================"
echo "  LOKAL INKOMSTHÄMTARE FÖR BEVAKNINGSVERKTYGET"
echo "============================================================"
echo ""

# Kolla om .env finns
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "❌ .env-fil saknas!"
    echo ""
    echo "Skapa $PROJECT_DIR/.env med:"
    echo "  SUPABASE_URL=https://ditt-projekt.supabase.co"
    echo "  SUPABASE_SERVICE_KEY=din-service-key"
    echo "  RATSIT_EMAIL=din-email@example.com"
    echo "  RESEND_API_KEY=din-resend-key (för engångskod)"
    echo ""
    exit 1
fi

# Ladda miljövariabler
source "$PROJECT_DIR/.env"

# Kolla nödvändiga variabler
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
    echo "❌ SUPABASE_URL och SUPABASE_SERVICE_KEY måste vara satta i .env"
    exit 1
fi

echo "📋 Hämtar väntande jobb från Supabase..."
echo ""

# Hämta pending jobs
PENDING_JOBS=$(curl -s \
    -H "apikey: $SUPABASE_SERVICE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
    "$SUPABASE_URL/rest/v1/income_fetch_jobs?status=eq.pending&select=*&order=created_at.asc&limit=10")

JOB_COUNT=$(echo "$PENDING_JOBS" | jq 'length')

if [ "$JOB_COUNT" == "0" ] || [ "$JOB_COUNT" == "null" ]; then
    echo "✅ Inga väntande jobb att bearbeta!"
    echo ""
    echo "Skapa nya jobb via dashboarden på:"
    echo "  https://isakskogstad.github.io/Bevakningsverktyget/verktyg/foretagsbevakning/"
    echo ""
    exit 0
fi

echo "Hittade $JOB_COUNT väntande jobb:"
echo ""

# Lista jobben
echo "$PENDING_JOBS" | jq -r '.[] | "  • \(.id[0:8])... | \(.person_name) | \(.location // "N/A") | \(.company_name // "N/A")"'
echo ""

read -p "Vill du bearbeta dessa jobb? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Avbrutet."
    exit 0
fi

echo ""
echo "============================================================"
echo "  STARTAR BEARBETNING"
echo "============================================================"
echo ""

# Bearbeta varje jobb
echo "$PENDING_JOBS" | jq -c '.[]' | while read -r job; do
    JOB_ID=$(echo "$job" | jq -r '.id')
    PERSON_NAME=$(echo "$job" | jq -r '.person_name')
    LOCATION=$(echo "$job" | jq -r '.location // ""')
    BIRTH_YEAR=$(echo "$job" | jq -r '.birth_year // ""')
    COMPANY_ORGNR=$(echo "$job" | jq -r '.company_orgnr // ""')
    COMPANY_NAME=$(echo "$job" | jq -r '.company_name // ""')
    ROLE_TYPE=$(echo "$job" | jq -r '.role_type // ""')

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📝 Job: ${JOB_ID:0:8}..."
    echo "   Person: $PERSON_NAME"
    echo "   Ort: ${LOCATION:-N/A}"
    echo "   Företag: ${COMPANY_NAME:-N/A} (${COMPANY_ORGNR:-N/A})"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Uppdatera status till running
    curl -s -X PATCH \
        "$SUPABASE_URL/rest/v1/income_fetch_jobs?id=eq.$JOB_ID" \
        -H "apikey: $SUPABASE_SERVICE_KEY" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"status\": \"running\", \"started_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"progress\": 10, \"current_step\": \"Startar browser...\"}" > /dev/null

    # Kör scrapern
    echo "  🚀 Kör ratsit-scraper..."

    cd "$PROJECT_DIR"

    # Bygg argument
    ARGS="--job-id=\"$JOB_ID\" --person-name=\"$PERSON_NAME\""
    [ -n "$LOCATION" ] && ARGS="$ARGS --location=\"$LOCATION\""
    [ -n "$BIRTH_YEAR" ] && ARGS="$ARGS --birth-year=\"$BIRTH_YEAR\""
    [ -n "$COMPANY_ORGNR" ] && ARGS="$ARGS --company-orgnr=\"$COMPANY_ORGNR\""
    [ -n "$COMPANY_NAME" ] && ARGS="$ARGS --company-name=\"$COMPANY_NAME\""
    [ -n "$ROLE_TYPE" ] && ARGS="$ARGS --role-type=\"$ROLE_TYPE\""

    # Kör scriptet
    if eval "node scripts/fetch-income-action.js $ARGS"; then
        echo "  ✅ Jobb slutfört!"
    else
        echo "  ❌ Jobb misslyckades"
        # Markera som failed
        curl -s -X PATCH \
            "$SUPABASE_URL/rest/v1/income_fetch_jobs?id=eq.$JOB_ID" \
            -H "apikey: $SUPABASE_SERVICE_KEY" \
            -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"status\": \"failed\", \"completed_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"error_message\": \"Lokal körning misslyckades\"}" > /dev/null
    fi

    echo ""
done

echo "============================================================"
echo "  KLART!"
echo "============================================================"
echo ""
echo "Alla jobb har bearbetats. Kolla resultaten på dashboarden."
echo ""
