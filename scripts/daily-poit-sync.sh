#!/bin/bash
# =============================================================================
# DAGLIG POIT-SYNKRONISERING
# =============================================================================
#
# Detta script:
# 1. Hämtar nya POIT-händelser från Bolagsverket
# 2. Matchar mot bevakade företag (loop_table)
# 3. Rensar händelser som inte matchar bevakade företag
# 4. Uppdaterar sync-metadata
#
# Användning:
#   ./scripts/daily-poit-sync.sh           # Normal körning
#   ./scripts/daily-poit-sync.sh --dry-run # Testläge utan ändringar
#
# Kräver:
#   - Node.js installerat
#   - SUPABASE_SERVICE_KEY environment variable
#
# Schemalägg med cron:
#   0 7 * * * cd /path/to/Bevakningsverktyget && ./scripts/daily-poit-sync.sh >> logs/poit-sync.log 2>&1
#
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/poit-sync-$(date +%Y-%m-%d).log"

# Skapa log-mapp om den inte finns
mkdir -p "$LOG_DIR"

# Funktion för loggning
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "============================================================"
log "STARTAR DAGLIG POIT-SYNKRONISERING"
log "============================================================"

# Kontrollera att SUPABASE_SERVICE_KEY finns
if [ -z "$SUPABASE_SERVICE_KEY" ]; then
    # Försök läsa från .env om den finns
    if [ -f "$PROJECT_DIR/.env" ]; then
        export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
    fi

    if [ -z "$SUPABASE_SERVICE_KEY" ]; then
        log "FEL: SUPABASE_SERVICE_KEY är inte satt"
        exit 1
    fi
fi

log "Kör cleanup och matchning..."

# Kör cleanup-scriptet
cd "$PROJECT_DIR"
if node scripts/poit-cleanup-and-match.js $@ >> "$LOG_FILE" 2>&1; then
    log "✅ Cleanup och matchning klar"
else
    log "❌ Fel vid cleanup"
    exit 1
fi

log "============================================================"
log "SYNKRONISERING KLAR"
log "============================================================"

# Visa sammanfattning
tail -20 "$LOG_FILE"
