#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# Source local env (if present)
if [[ -f "$REPO_ROOT/.env.local" ]]; then
  set -o allexport
  source "$REPO_ROOT/.env.local"
  set +o allexport
fi
SUPABASE_URL="${SUPABASE_URL:-https://wzkohritxdrstsmwopco.supabase.co}"
: "${SUPABASE_SERVICE_KEY:?SUPABASE_SERVICE_KEY must be set in the environment or .env.local}"
# Activate the virtualenv if it exists
if [[ -f "$REPO_ROOT/.venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.venv/bin/activate"
fi
python scripts/allabolag-batch-update.py
