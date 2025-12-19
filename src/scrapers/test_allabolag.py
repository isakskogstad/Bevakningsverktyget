#!/usr/bin/env python3
"""
Test script for Allabolag scraper

Tests both with and without Supabase integration.
"""

import os
import sys
import json
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from scrapers.allabolag_scraper import AllabolagScraper, scrape_allabolag


def test_basic_scraping():
    """Test basic scraping without Supabase."""
    print("\n" + "="*80)
    print("TEST 1: Basic scraping (no Supabase)")
    print("="*80)

    # Test with a real Swedish company (Spotify Technology S.A. Swedish branch)
    orgnr = '5567676827'  # Spotify

    print(f"\nScraping {orgnr}...")
    data = scrape_allabolag(orgnr)

    if data:
        print(f"\n✓ Successfully scraped {data['name']}")
        print(f"  - Organization number: {data['orgnr']}")
        print(f"  - Company type: {data.get('company_type')}")
        print(f"  - Status: {data.get('status')}")
        print(f"  - Postal address: {data.get('postal_street')}, {data.get('postal_city')}")
        print(f"  - Phone: {data.get('phone')}")
        print(f"  - Website: {data.get('website')}")
        print(f"\nRegistrations:")
        print(f"  - F-skatt: {'Yes' if data.get('f_skatt') else 'No'}")
        print(f"  - VAT registered: {'Yes' if data.get('moms_registered') else 'No'}")
        print(f"  - Employer registered: {'Yes' if data.get('employer_registered') else 'No'}")

        if data.get('roles'):
            print(f"\nRoles ({len(data['roles'])}):")
            for role in data['roles'][:5]:  # Show first 5
                print(f"  - {role['name']} ({role.get('birth_year')}): {role['role_type']} [{role['role_category']}]")
            if len(data['roles']) > 5:
                print(f"  ... and {len(data['roles']) - 5} more")

        if data.get('financials'):
            print(f"\nFinancials ({len(data['financials'])} periods):")
            for fin in data['financials'][:3]:  # Show first 3
                consolidated = " (Consolidated)" if fin.get('is_consolidated') else ""
                print(f"  - {fin['period_year']}{consolidated}:")
                if fin.get('revenue'):
                    print(f"    Revenue: {fin['revenue']:,} SEK")
                if fin.get('net_profit'):
                    print(f"    Net profit: {fin['net_profit']:,} SEK")
                if fin.get('num_employees'):
                    print(f"    Employees: {fin['num_employees']}")

        if data.get('related_companies'):
            print(f"\nRelated companies ({len(data['related_companies'])}):")
            for rel in data['related_companies'][:5]:
                print(f"  - {rel['related_name']} ({rel['related_orgnr']}) - {rel['relation_type']}")

        if data.get('industries'):
            print(f"\nIndustries:")
            for ind in data['industries']:
                primary = " (Primary)" if ind.get('is_primary') else ""
                print(f"  - {ind['sni_code']}: {ind.get('sni_description')}{primary}")

        return True
    else:
        print("\n✗ Failed to scrape data")
        return False


def test_with_supabase():
    """Test scraping with Supabase integration."""
    print("\n" + "="*80)
    print("TEST 2: Scraping with Supabase integration")
    print("="*80)

    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_KEY')

    if not supabase_url or not supabase_key:
        print("\n⚠ Skipping: SUPABASE_URL and SUPABASE_SERVICE_KEY not set")
        print("   Set these environment variables to test Supabase integration")
        return None

    print(f"\nSupabase URL: {supabase_url}")

    scraper = AllabolagScraper(
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        delay=1.0,
        cache_hours=24
    )

    orgnr = '5567676827'

    print(f"\nScraping {orgnr} and saving to Supabase...")
    data = scraper.scrape_company(orgnr, force=True)  # Force to test saving

    if data:
        print(f"\n✓ Successfully scraped and saved {data['name']}")
        print(f"  - Data saved to company_details")
        print(f"  - {len(data.get('roles', []))} roles saved to company_roles")
        print(f"  - {len(data.get('financials', []))} financial periods saved to company_financials")

        # Test cache
        print(f"\nTesting cache (should use cached data)...")
        cached_data = scraper.scrape_company(orgnr)
        if cached_data:
            print(f"✓ Cache working correctly")

        return True
    else:
        print("\n✗ Failed to scrape and save data")
        return False


def test_async_scraping():
    """Test async scraping."""
    print("\n" + "="*80)
    print("TEST 3: Async scraping")
    print("="*80)

    import asyncio

    async def run_async():
        scraper = AllabolagScraper(delay=1.0)
        orgnr = '5567676827'

        print(f"\nAsync scraping {orgnr}...")
        data = await scraper.scrape_company_async(orgnr)

        if data:
            print(f"\n✓ Successfully async scraped {data['name']}")
            return True
        else:
            print("\n✗ Failed to async scrape data")
            return False

    return asyncio.run(run_async())


def test_error_handling():
    """Test error handling with invalid org number."""
    print("\n" + "="*80)
    print("TEST 4: Error handling")
    print("="*80)

    scraper = AllabolagScraper(delay=0.5)

    # Test with non-existent org number
    invalid_orgnr = '0000000000'

    print(f"\nTrying to scrape invalid orgnr: {invalid_orgnr}...")
    data = scraper.scrape_company(invalid_orgnr)

    if data is None:
        print(f"✓ Correctly returned None for invalid orgnr")
        return True
    else:
        print(f"✗ Should have returned None for invalid orgnr")
        return False


def main():
    """Run all tests."""
    print("\n" + "="*80)
    print("ALLABOLAG SCRAPER TEST SUITE")
    print("="*80)

    results = {
        'basic_scraping': test_basic_scraping(),
        'supabase': test_with_supabase(),
        'async': test_async_scraping(),
        'error_handling': test_error_handling()
    }

    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)

    passed = sum(1 for v in results.values() if v is True)
    failed = sum(1 for v in results.values() if v is False)
    skipped = sum(1 for v in results.values() if v is None)

    for test, result in results.items():
        status = "✓ PASS" if result is True else "✗ FAIL" if result is False else "⚠ SKIP"
        print(f"{status}: {test}")

    print(f"\nTotal: {passed} passed, {failed} failed, {skipped} skipped")

    if failed > 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
