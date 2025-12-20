"""
POIT Monitoring Service

Comprehensive service for monitoring Bolagsverket POIT announcements and
notifying users when watched companies appear.

Features:
- Playwright-based scraping (GitHub Actions compatible)
- Automatic org.nr extraction and matching
- User watchlist support with category filtering
- Email notifications via Resend
- Sync statistics and error tracking

Usage:
    # Run full sync
    python -m src.poit_monitor
    
    # Or as module
    from src.poit_monitor import POITMonitorService
    service = POITMonitorService()
    await service.run_sync()

Environment:
    SUPABASE_URL - Supabase project URL
    SUPABASE_KEY - Supabase service role key
    RESEND_API_KEY - Resend API key for emails
"""

import os
import asyncio
from datetime import datetime, date
from typing import Dict, Any, Optional, List, Set, Tuple
from dataclasses import dataclass, asdict, field
import hashlib
import logging

try:
    from .scrapers.poit_playwright import (
        POITPlaywrightScraper,
        POITAnnouncement,
        POITDailyStats,
        ScrapeResult,
        extract_orgnrs,
        normalize_orgnr
    )
    from .supabase_client import get_database
    from .logging_config import get_source_logger
except ImportError:
    # Running as script
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from src.scrapers.poit_playwright import (
        POITPlaywrightScraper,
        POITAnnouncement,
        POITDailyStats,
        ScrapeResult,
        extract_orgnrs,
        normalize_orgnr
    )
    from src.supabase_client import get_database
    
    def get_source_logger(name):
        return logging.getLogger(name)

logger = get_source_logger("poit_monitor")


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class SyncStats:
    """Statistics for a sync run"""
    sync_id: Optional[str] = None
    sync_date: str = ""
    sync_started_at: str = ""
    sync_completed_at: Optional[str] = None
    announcements_found: int = 0
    announcements_new: int = 0
    notifications_created: int = 0
    notifications_sent: int = 0
    status: str = "running"
    errors: List[str] = field(default_factory=list)
    categories_scraped: List[str] = field(default_factory=list)


@dataclass
class WatchlistMatch:
    """A match between an announcement and a watchlist entry"""
    user_id: str
    orgnr: str
    company_name: Optional[str]
    announcement_id: str
    category: str
    email: Optional[str] = None
    email_notifications: bool = True


# =============================================================================
# POIT Monitor Service
# =============================================================================

class POITMonitorService:
    """
    Main service for POIT monitoring and notifications.
    
    Workflow:
    1. Scrape POIT categories using Playwright
    2. Store new announcements in database (deduplicated)
    3. Match announcements against user watchlists
    4. Create notification records for matches
    5. Send email notifications (via Resend)
    6. Update sync statistics
    
    Example:
        service = POITMonitorService()
        result = await service.run_sync()
        print(f"New announcements: {result['announcements_new']}")
    """
    
    # Categories to monitor
    DEFAULT_CATEGORIES = [
        "konkurser",
        "bolagsverkets_registreringar", 
        "kallelser",
        "skuldsaneringar",
        "familjeratt"
    ]
    
    def __init__(
        self,
        categories: Optional[List[str]] = None,
        limit_per_category: int = 100,
        send_emails: bool = True,
        dry_run: bool = False
    ):
        """
        Initialize POIT monitor service.
        
        Args:
            categories: Categories to monitor (None = all default)
            limit_per_category: Max announcements per category
            send_emails: Whether to send email notifications
            dry_run: If True, don't write to database or send emails
        """
        self.categories = categories or self.DEFAULT_CATEGORIES
        self.limit_per_category = limit_per_category
        self.send_emails = send_emails
        self.dry_run = dry_run
        
        self.db = get_database()
        self.stats = SyncStats(
            sync_date=date.today().isoformat(),
            sync_started_at=datetime.now().isoformat()
        )
    
    async def run_sync(self) -> Dict[str, Any]:
        """
        Run the complete sync workflow.
        
        Returns:
            Dict with sync results and statistics
        """
        logger.info(f"Starting POIT sync for {self.stats.sync_date}")
        
        if not self.dry_run:
            # Create sync stats record
            self._create_sync_record()
        
        try:
            # Step 1: Scrape POIT
            all_announcements = await self._scrape_poit()
            self.stats.announcements_found = len(all_announcements)
            
            if not all_announcements:
                logger.warning("No announcements found")
                self.stats.status = "completed_empty"
                return self._finalize_sync()
            
            # Step 2: Store new announcements (deduplicated)
            new_announcement_ids = await self._store_announcements(all_announcements)
            self.stats.announcements_new = len(new_announcement_ids)
            
            if not new_announcement_ids:
                logger.info("No new announcements to process")
                self.stats.status = "completed_no_new"
                return self._finalize_sync()
            
            # Step 3: Match against watchlists
            matches = await self._match_watchlists(new_announcement_ids)
            
            if not matches:
                logger.info("No watchlist matches found")
                self.stats.status = "completed_no_matches"
                return self._finalize_sync()
            
            # Step 4: Create notifications
            notifications_created = await self._create_notifications(matches)
            self.stats.notifications_created = notifications_created
            
            # Step 5: Send emails (if enabled)
            if self.send_emails and notifications_created > 0:
                sent = await self._send_notifications()
                self.stats.notifications_sent = sent
            
            self.stats.status = "completed"
            return self._finalize_sync()
            
        except Exception as e:
            logger.error(f"Sync failed: {e}")
            self.stats.status = "failed"
            self.stats.errors.append(str(e))
            return self._finalize_sync()
    
    async def _scrape_poit(self) -> List[POITAnnouncement]:
        """Scrape POIT categories using Playwright."""
        all_announcements = []
        
        async with POITPlaywrightScraper(headless=True, debug=False) as scraper:
            # Get daily stats first
            stats = await scraper.get_daily_stats()
            
            if not stats:
                logger.error("Failed to get daily stats from POIT")
                self.stats.errors.append("Failed to get daily stats")
                return []
            
            logger.info(f"POIT has {stats.total_announcements} announcements in {len(stats.categories)} categories")
            
            # Scrape each category
            for cat_key in self.categories:
                if cat_key not in stats.categories:
                    logger.warning(f"Category not found: {cat_key}")
                    continue
                
                logger.info(f"Scraping {cat_key}...")
                result = await scraper.scrape_category(
                    cat_key,
                    limit=self.limit_per_category
                )
                
                if result.success:
                    all_announcements.extend(result.announcements)
                    self.stats.categories_scraped.append(cat_key)
                    logger.info(f"  Found {result.total_found} announcements")
                else:
                    logger.warning(f"  Failed: {result.error}")
                    self.stats.errors.append(f"{cat_key}: {result.error}")
                
                # Small delay between categories
                await asyncio.sleep(1)
        
        return all_announcements
    
    async def _store_announcements(
        self, 
        announcements: List[POITAnnouncement]
    ) -> List[str]:
        """
        Store announcements in database, returning IDs of new ones.
        
        Deduplication is based on content hash to avoid storing duplicates.
        """
        if self.dry_run:
            logger.info(f"[DRY RUN] Would store {len(announcements)} announcements")
            return [f"dry_run_{i}" for i in range(len(announcements))]
        
        new_ids = []
        
        for ann in announcements:
            try:
                # Generate content hash for deduplication
                content_hash = self._generate_content_hash(ann)
                
                # Check if already exists
                existing = self.db.client.table('poit_announcements') \
                    .select('id') \
                    .eq('poit_id', content_hash) \
                    .limit(1) \
                    .execute()
                
                if existing.data:
                    continue  # Already exists
                
                # Prepare data
                data = {
                    "poit_id": content_hash,
                    "orgnr": ann.orgnr,
                    "category": ann.category,
                    "subcategory": ann.subcategory,
                    "title": ann.title,
                    "content": ann.content,
                    "announcement_date": ann.announcement_date or date.today().isoformat(),
                    "source_url": ann.source_url,
                    "extracted_orgnrs": ann.extracted_orgnrs or []
                }
                
                # Insert
                result = self.db.client.table('poit_announcements') \
                    .insert(data) \
                    .execute()
                
                if result.data:
                    new_ids.append(result.data[0]['id'])
                    
            except Exception as e:
                logger.warning(f"Error storing announcement: {e}")
                continue
        
        logger.info(f"Stored {len(new_ids)} new announcements")
        return new_ids
    
    async def _match_watchlists(
        self,
        announcement_ids: List[str]
    ) -> List[WatchlistMatch]:
        """
        Match new announcements against user watchlists.
        
        Returns list of matches with user and announcement details.
        """
        if self.dry_run:
            logger.info(f"[DRY RUN] Would check {len(announcement_ids)} announcements against watchlists")
            return []
        
        matches = []
        
        try:
            # Get all watchlist entries
            watchlist_result = self.db.client.table('user_watchlists') \
                .select('user_id, orgnr, company_name, alert_categories, email_notifications') \
                .execute()
            
            if not watchlist_result.data:
                logger.info("No watchlist entries found")
                return []
            
            # Build orgnr -> users mapping
            orgnr_to_users: Dict[str, List[Dict]] = {}
            for entry in watchlist_result.data:
                orgnr = normalize_orgnr(entry['orgnr'])
                if orgnr:
                    if orgnr not in orgnr_to_users:
                        orgnr_to_users[orgnr] = []
                    orgnr_to_users[orgnr].append(entry)
            
            logger.info(f"Checking against {len(orgnr_to_users)} watched org.nrs")
            
            # Get the new announcements with their extracted orgnrs
            for ann_id in announcement_ids:
                ann_result = self.db.client.table('poit_announcements') \
                    .select('id, category, extracted_orgnrs, orgnr') \
                    .eq('id', ann_id) \
                    .single() \
                    .execute()
                
                if not ann_result.data:
                    continue
                
                ann = ann_result.data
                
                # Get all orgnrs from this announcement
                ann_orgnrs = set()
                if ann.get('orgnr'):
                    normalized = normalize_orgnr(ann['orgnr'])
                    if normalized:
                        ann_orgnrs.add(normalized)
                
                for orgnr in ann.get('extracted_orgnrs') or []:
                    normalized = normalize_orgnr(orgnr)
                    if normalized:
                        ann_orgnrs.add(normalized)
                
                # Check for matches
                for orgnr in ann_orgnrs:
                    if orgnr in orgnr_to_users:
                        for user_entry in orgnr_to_users[orgnr]:
                            # Check category filter
                            alert_cats = user_entry.get('alert_categories') or []
                            category_key = self._normalize_category(ann['category'])
                            
                            if alert_cats and category_key not in alert_cats:
                                continue  # User doesn't want this category
                            
                            matches.append(WatchlistMatch(
                                user_id=user_entry['user_id'],
                                orgnr=orgnr,
                                company_name=user_entry.get('company_name'),
                                announcement_id=ann_id,
                                category=ann['category'],
                                email_notifications=user_entry.get('email_notifications', True)
                            ))
            
            logger.info(f"Found {len(matches)} watchlist matches")
            
        except Exception as e:
            logger.error(f"Error matching watchlists: {e}")
            self.stats.errors.append(f"Watchlist matching: {str(e)}")
        
        return matches
    
    async def _create_notifications(
        self,
        matches: List[WatchlistMatch]
    ) -> int:
        """Create notification records for matches."""
        if self.dry_run:
            logger.info(f"[DRY RUN] Would create {len(matches)} notifications")
            return 0
        
        created = 0
        
        for match in matches:
            try:
                # Check if notification already exists (dedup)
                existing = self.db.client.table('poit_notifications') \
                    .select('id') \
                    .eq('user_id', match.user_id) \
                    .eq('announcement_id', match.announcement_id) \
                    .eq('orgnr', match.orgnr) \
                    .limit(1) \
                    .execute()
                
                if existing.data:
                    continue  # Already exists
                
                # Create notification
                data = {
                    "user_id": match.user_id,
                    "announcement_id": match.announcement_id,
                    "orgnr": match.orgnr,
                    "status": "pending" if match.email_notifications else "skipped"
                }
                
                self.db.client.table('poit_notifications') \
                    .insert(data) \
                    .execute()
                
                created += 1
                
            except Exception as e:
                logger.warning(f"Error creating notification: {e}")
                continue
        
        logger.info(f"Created {created} notifications")
        return created
    
    async def _send_notifications(self) -> int:
        """
        Send pending email notifications.
        
        Returns number of emails sent.
        """
        if self.dry_run:
            logger.info("[DRY RUN] Would send email notifications")
            return 0
        
        # Import notification sender (created in Fas 4)
        try:
            from .poit_notifications import send_pending_notifications
            return await send_pending_notifications()
        except ImportError:
            logger.warning("poit_notifications module not available, skipping email sending")
            return 0
        except Exception as e:
            logger.error(f"Error sending notifications: {e}")
            self.stats.errors.append(f"Email sending: {str(e)}")
            return 0
    
    def _create_sync_record(self):
        """Create initial sync stats record in database."""
        try:
            data = {
                "sync_date": self.stats.sync_date,
                "sync_started_at": self.stats.sync_started_at,
                "status": "running"
            }
            
            result = self.db.client.table('poit_sync_stats') \
                .insert(data) \
                .execute()
            
            if result.data:
                self.stats.sync_id = result.data[0]['id']
                
        except Exception as e:
            logger.warning(f"Error creating sync record: {e}")
    
    def _finalize_sync(self) -> Dict[str, Any]:
        """Finalize sync and update database record."""
        self.stats.sync_completed_at = datetime.now().isoformat()
        
        # Update sync record in database
        if not self.dry_run and self.stats.sync_id:
            try:
                data = {
                    "sync_completed_at": self.stats.sync_completed_at,
                    "announcements_found": self.stats.announcements_found,
                    "announcements_new": self.stats.announcements_new,
                    "notifications_sent": self.stats.notifications_sent,
                    "status": self.stats.status,
                    "errors": self.stats.errors if self.stats.errors else None
                }
                
                self.db.client.table('poit_sync_stats') \
                    .update(data) \
                    .eq('id', self.stats.sync_id) \
                    .execute()
                    
            except Exception as e:
                logger.warning(f"Error updating sync record: {e}")
        
        # Return results
        result = asdict(self.stats)
        logger.info(f"Sync completed: {self.stats.status}, {self.stats.announcements_new} new, {self.stats.notifications_created} notifications")
        
        return result
    
    def _generate_content_hash(self, ann: POITAnnouncement) -> str:
        """Generate a unique hash for announcement content."""
        content = f"{ann.category}|{ann.title}|{ann.content or ''}|{ann.announcement_date}"
        return hashlib.sha256(content.encode()).hexdigest()[:32]
    
    def _normalize_category(self, category: str) -> str:
        """Normalize category name to key format."""
        key = category.lower()
        replacements = {'å': 'a', 'ä': 'a', 'ö': 'o'}
        for old, new in replacements.items():
            key = key.replace(old, new)
        import re
        key = re.sub(r'[^a-z0-9]', '_', key)
        key = re.sub(r'_+', '_', key)
        return key.strip('_')


# =============================================================================
# Convenience Functions
# =============================================================================

async def run_poit_sync(
    categories: Optional[List[str]] = None,
    send_emails: bool = True,
    dry_run: bool = False
) -> Dict[str, Any]:
    """
    Run a complete POIT sync.
    
    Args:
        categories: Categories to monitor (None = all)
        send_emails: Whether to send notifications
        dry_run: Don't write to database
        
    Returns:
        Dict with sync results
    """
    service = POITMonitorService(
        categories=categories,
        send_emails=send_emails,
        dry_run=dry_run
    )
    return await service.run_sync()


async def check_company_announcements(orgnr: str, days: int = 7) -> List[Dict]:
    """
    Check recent announcements for a specific company.
    
    Args:
        orgnr: Organization number
        days: Number of days to look back
        
    Returns:
        List of announcement dicts
    """
    db = get_database()
    normalized = normalize_orgnr(orgnr)
    
    if not normalized:
        return []
    
    try:
        # Query using GIN index on extracted_orgnrs
        result = db.client.table('poit_announcements') \
            .select('*') \
            .or_(f"orgnr.eq.{normalized},extracted_orgnrs.cs.{{{normalized}}}") \
            .order('announcement_date', desc=True) \
            .limit(50) \
            .execute()
        
        return result.data or []
        
    except Exception as e:
        logger.error(f"Error checking announcements: {e}")
        return []


async def get_sync_history(limit: int = 10) -> List[Dict]:
    """Get recent sync run history."""
    db = get_database()
    
    try:
        result = db.client.table('poit_sync_stats') \
            .select('*') \
            .order('sync_started_at', desc=True) \
            .limit(limit) \
            .execute()
        
        return result.data or []
        
    except Exception as e:
        logger.error(f"Error getting sync history: {e}")
        return []


# =============================================================================
# CLI Entry Point
# =============================================================================

async def main():
    """CLI entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="POIT Monitoring Service")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to database")
    parser.add_argument("--no-email", action="store_true", help="Don't send emails")
    parser.add_argument("--categories", nargs="+", help="Categories to monitor")
    parser.add_argument("--limit", type=int, default=100, help="Max per category")
    parser.add_argument("--check", type=str, help="Check announcements for specific orgnr")
    parser.add_argument("--history", action="store_true", help="Show sync history")
    
    args = parser.parse_args()
    
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    if args.check:
        print(f"\nChecking announcements for {args.check}...")
        announcements = await check_company_announcements(args.check)
        if announcements:
            for ann in announcements[:10]:
                print(f"\n  {ann['announcement_date']} - {ann['category']}")
                print(f"  {ann['title'][:80]}")
        else:
            print("  No announcements found")
        return
    
    if args.history:
        print("\nRecent sync history:")
        history = await get_sync_history()
        for h in history:
            print(f"\n  {h['sync_date']} - {h['status']}")
            print(f"    Found: {h['announcements_found']}, New: {h['announcements_new']}")
            print(f"    Notifications: {h['notifications_sent']}")
        return
    
    # Run sync
    print("\n" + "=" * 60)
    print("POIT Monitor - Sync Run")
    print("=" * 60)
    
    if args.dry_run:
        print("\n⚠️  DRY RUN MODE - No changes will be made")
    
    service = POITMonitorService(
        categories=args.categories,
        limit_per_category=args.limit,
        send_emails=not args.no_email,
        dry_run=args.dry_run
    )
    
    result = await service.run_sync()
    
    print("\n" + "-" * 60)
    print("Sync Results:")
    print(f"  Status: {result['status']}")
    print(f"  Categories scraped: {', '.join(result['categories_scraped'])}")
    print(f"  Announcements found: {result['announcements_found']}")
    print(f"  New announcements: {result['announcements_new']}")
    print(f"  Notifications created: {result['notifications_created']}")
    print(f"  Emails sent: {result['notifications_sent']}")
    
    if result['errors']:
        print(f"\n  ⚠️ Errors: {len(result['errors'])}")
        for err in result['errors'][:5]:
            print(f"    - {err}")
    
    print("=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
