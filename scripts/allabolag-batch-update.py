#!/usr/bin/env python3
"""
Batch-uppdatering av Allabolag-data.

- Uppdaterar ca 200 bolag per dygn
- Respekterar cache (last_synced_at)
- Lagrar till company_details/company_roles/company_financials
"""

import os
import sys
import time
from datetime import datetime, timezone

from supabase import create_client

# Local import
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "src"))
from scrapers.allabolag_scraper import AllabolagScraper

BATCH_SIZE = int(os.environ.get("ALLABOLAG_BATCH_SIZE", "200"))
CACHE_HOURS = int(os.environ.get("ALLABOLAG_CACHE_HOURS", "168"))
JOB_NAME = "allabolag_daily"

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)


def acquire_job_lock():
    now = datetime.now(timezone.utc).isoformat()
    job = sb.table("sync_jobs").select("status, started_at").eq("job_name", JOB_NAME).execute()

    if job.data:
        row = job.data[0]
        if row.get("status") == "running":
            print("Job already running, exiting")
            return False

    sb.table("sync_jobs").upsert({
        "job_name": JOB_NAME,
        "status": "running",
        "started_at": now,
        "finished_at": None,
        "metadata": {"batch_size": BATCH_SIZE}
    }).execute()
    return True


def release_job_lock(status="done"):
    sb.table("sync_jobs").upsert({
        "job_name": JOB_NAME,
        "status": status,
        "finished_at": datetime.now(timezone.utc).isoformat()
    }).execute()


def fetch_company_orgnrs():
    result = sb.table("loop_table").select("orgnr").execute()
    return [row.get("orgnr") for row in (result.data or []) if row.get("orgnr")]


def fetch_last_synced():
    result = sb.table("company_details").select("orgnr, last_synced_at").execute()
    return {row["orgnr"]: row.get("last_synced_at") for row in (result.data or []) if row.get("orgnr")}


def sort_candidates(orgnrs, last_synced_map):
    def key(orgnr):
        ts = last_synced_map.get(orgnr)
        if not ts:
            return (0, datetime.min)
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            dt = datetime.min
        return (1, dt)

    return sorted(orgnrs, key=key)


def main():
    if not acquire_job_lock():
        return

    try:
        orgnrs = fetch_company_orgnrs()
        last_synced = fetch_last_synced()
        candidates = sort_candidates(orgnrs, last_synced)[:BATCH_SIZE]

        scraper = AllabolagScraper(
            supabase_url=SUPABASE_URL,
            supabase_key=SUPABASE_KEY,
            cache_hours=CACHE_HOURS
        )

        for idx, orgnr in enumerate(candidates, start=1):
            print(f"[{idx}/{len(candidates)}] Scraping {orgnr}")
            try:
                scraper.scrape_company(orgnr)
            except Exception as exc:
                print(f"Failed {orgnr}: {exc}")
            time.sleep(1.2)

        release_job_lock("done")
    except Exception as exc:
        print(f"Batch failed: {exc}")
        release_job_lock("failed")


if __name__ == "__main__":
    main()
