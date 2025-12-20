#!/usr/bin/env python3
"""
Comprehensive Annual Report Analysis
=====================================
Downloads ALL available annual reports for 10 companies and performs deep analysis:
- Structure variations between documents
- Common vs unique XBRL fields
- Data over time for same company
- Comparison with existing database values
"""

import os
import sys
import json
import time
import re
import zipfile
import io
from datetime import datetime
from pathlib import Path
from collections import defaultdict
from decimal import Decimal, InvalidOperation

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import requests

# Import existing VDM client
from src.scrapers.bolagsverket_vdm import get_bolagsverket_vdm_client
from src.supabase_client import get_db

# Configuration
API_BASE = "https://gw.api.bolagsverket.se/vardefulla-datamangder/v1"
OUTPUT_DIR = Path("/Users/isak/Desktop/CLAUDE_CODE /projects/loop-auto/test_annual_reports/comprehensive")
OUTPUT_DIR.mkdir(exist_ok=True)

# Test companies (randomly selected from database)
TEST_COMPANIES = [
    ("5591707582", "Sanctify Financial Technologies AB"),
    ("5569398349", "GeoGuessr AB"),
    ("5590249263", "Noberu Stockholm AB"),
    ("5590179924", "SecTrade Konsult AB"),
    ("5567153696", "Smartify Sverige AB"),
    ("5562776434", "Peak Performance Production AB"),
    ("5591532113", "Braive AB"),
    ("5567796544", "Arrowhead Game Studios AB"),
    ("5594517749", "Talentium AB"),
    ("5592151756", "ABIOSÈ AB"),
]

# Global clients
vdm_client = None
db = None


def get_vdm_client():
    global vdm_client
    if vdm_client is None:
        vdm_client = get_bolagsverket_vdm_client()
    return vdm_client


def get_database():
    global db
    if db is None:
        db = get_db()
    return db


def download_document(dokument_id: str) -> bytes | None:
    """Download a document and return raw bytes."""
    client = get_vdm_client()
    token = client._get_token_sync()
    if not token:
        return None

    response = requests.get(
        f"{API_BASE}/dokument/{dokument_id}",
        headers={"Authorization": f"Bearer {token}", "Accept": "*/*"},
        timeout=120
    )

    if response.status_code != 200:
        print(f"    Download error: {response.status_code}")
        return None

    return response.content


def parse_xbrl_value(value_str: str, scale: int = 0, decimals: str = "0") -> float | None:
    """Parse XBRL numeric value with scale and decimals."""
    try:
        # Remove spaces and convert Swedish decimal format
        clean = value_str.replace(" ", "").replace("\xa0", "").replace(",", ".")
        if not clean or clean == "-":
            return None

        value = float(clean)

        # Apply scale (e.g., scale="3" means multiply by 1000)
        if scale:
            value = value * (10 ** scale)

        return value
    except (ValueError, InvalidOperation):
        return None


def extract_xbrl_facts(xhtml_content: str) -> dict:
    """Extract all XBRL facts from XHTML content."""
    facts = {
        "numeric": [],      # ix:nonFraction
        "text": [],         # ix:nonNumeric
        "contexts": {},     # Context definitions
        "units": {},        # Unit definitions
        "namespaces": set() # All namespaces used
    }

    # Extract numeric facts (ix:nonFraction)
    numeric_pattern = r'<ix:nonFraction\s+([^>]+)>([^<]*)</ix:nonFraction>'
    for match in re.finditer(numeric_pattern, xhtml_content, re.DOTALL):
        attrs_str = match.group(1)
        value = match.group(2).strip()

        # Parse attributes
        attrs = {}
        for attr_match in re.finditer(r'(\w+)=["\']([^"\']*)["\']', attrs_str):
            attrs[attr_match.group(1)] = attr_match.group(2)

        fact_name = attrs.get("name", "")
        if ":" in fact_name:
            namespace = fact_name.split(":")[0]
            facts["namespaces"].add(namespace)

        scale = int(attrs.get("scale", 0))
        parsed_value = parse_xbrl_value(value, scale)

        facts["numeric"].append({
            "name": fact_name,
            "value_raw": value,
            "value_parsed": parsed_value,
            "context": attrs.get("contextRef", ""),
            "unit": attrs.get("unitRef", ""),
            "decimals": attrs.get("decimals", ""),
            "scale": scale,
        })

    # Extract text facts (ix:nonNumeric)
    text_pattern = r'<ix:nonNumeric\s+([^>]+)>([^<]*)</ix:nonNumeric>'
    for match in re.finditer(text_pattern, xhtml_content, re.DOTALL):
        attrs_str = match.group(1)
        value = match.group(2).strip()

        attrs = {}
        for attr_match in re.finditer(r'(\w+)=["\']([^"\']*)["\']', attrs_str):
            attrs[attr_match.group(1)] = attr_match.group(2)

        fact_name = attrs.get("name", "")
        if ":" in fact_name:
            namespace = fact_name.split(":")[0]
            facts["namespaces"].add(namespace)

        facts["text"].append({
            "name": fact_name,
            "value": value,
            "context": attrs.get("contextRef", ""),
        })

    # Extract context definitions
    context_pattern = r'<xbrli:context\s+id=["\']([^"\']+)["\']>(.*?)</xbrli:context>'
    for match in re.finditer(context_pattern, xhtml_content, re.DOTALL):
        context_id = match.group(1)
        context_content = match.group(2)

        # Extract period
        period_match = re.search(r'<xbrli:instant>([^<]+)</xbrli:instant>', context_content)
        if period_match:
            facts["contexts"][context_id] = {"type": "instant", "date": period_match.group(1)}
        else:
            start_match = re.search(r'<xbrli:startDate>([^<]+)</xbrli:startDate>', context_content)
            end_match = re.search(r'<xbrli:endDate>([^<]+)</xbrli:endDate>', context_content)
            if start_match and end_match:
                facts["contexts"][context_id] = {
                    "type": "duration",
                    "start": start_match.group(1),
                    "end": end_match.group(1)
                }

    return facts


def analyze_ixbrl_archive(content: bytes, orgnr: str, doc_info: dict) -> dict:
    """Analyze an iXBRL ZIP archive."""
    analysis = {
        "orgnr": orgnr,
        "document_id": doc_info.get("dokumentId", ""),
        "period_end": doc_info.get("rapporteringsperiodTom", ""),
        "registration_date": doc_info.get("registreringstidpunkt", ""),
        "file_format": doc_info.get("filformat", ""),
        "file_size_kb": len(content) / 1024,
        "is_zip": False,
        "xhtml_files": [],
        "all_facts": [],
        "fact_names": set(),
        "namespaces": set(),
        "contexts": {},
        "error": None,
    }

    # Check if ZIP
    if content[:4] == b'PK\x03\x04':
        analysis["is_zip"] = True
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                for fname in zf.namelist():
                    if fname.endswith('.xhtml') or fname.endswith('.html'):
                        analysis["xhtml_files"].append(fname)
                        xhtml_content = zf.read(fname).decode('utf-8', errors='ignore')

                        # Extract XBRL facts
                        facts = extract_xbrl_facts(xhtml_content)
                        analysis["all_facts"].extend(facts["numeric"])
                        analysis["all_facts"].extend([{**f, "type": "text"} for f in facts["text"]])
                        analysis["namespaces"].update(facts["namespaces"])
                        analysis["contexts"].update(facts["contexts"])

                        for f in facts["numeric"]:
                            analysis["fact_names"].add(f["name"])
                        for f in facts["text"]:
                            analysis["fact_names"].add(f["name"])
        except Exception as e:
            analysis["error"] = str(e)

    # Convert sets to lists for JSON serialization
    analysis["fact_names"] = list(analysis["fact_names"])
    analysis["namespaces"] = list(analysis["namespaces"])

    return analysis


def get_existing_db_data(orgnr: str) -> dict:
    """Get existing data from database for comparison."""
    db = get_database()

    data = {
        "company": None,
        "financials": [],
        "roles": [],
    }

    try:
        # Company data
        company = db.get_company(orgnr)
        if company:
            data["company"] = {
                "name": company.get("name"),
                "status": company.get("status"),
                "employees": company.get("employees"),
                "revenue": company.get("revenue"),
                "profit": company.get("profit"),
            }

        # Financials
        response = db.client.table("financials").select("*").eq("orgnr", orgnr).execute()
        data["financials"] = response.data or []

        # Roles
        response = db.client.table("roles").select("*").eq("orgnr", orgnr).execute()
        data["roles"] = response.data or []

    except Exception as e:
        data["error"] = str(e)

    return data


def main():
    print("=" * 80)
    print("COMPREHENSIVE ANNUAL REPORT ANALYSIS")
    print(f"Time: {datetime.now().isoformat()}")
    print("=" * 80)

    # Initialize clients
    try:
        get_vdm_client()
        get_database()
        print("✓ VDM Client and Database initialized")
    except Exception as e:
        print(f"✗ Initialization error: {e}")
        sys.exit(1)

    # Results storage
    all_results = {
        "companies_analyzed": 0,
        "total_documents": 0,
        "total_facts_extracted": 0,
        "companies": [],
        "all_fact_names": defaultdict(int),  # fact_name -> count
        "all_namespaces": set(),
        "fact_name_by_company": defaultdict(set),  # orgnr -> set of fact_names
    }

    print(f"\nAnalyzing {len(TEST_COMPANIES)} companies...")
    print("-" * 80)

    for orgnr, name in TEST_COMPANIES:
        print(f"\n{'='*60}")
        print(f"COMPANY: {orgnr} - {name}")
        print("=" * 60)

        company_result = {
            "orgnr": orgnr,
            "name": name,
            "documents": [],
            "total_facts": 0,
            "unique_fact_names": set(),
            "years_available": [],
            "db_comparison": None,
        }

        # Get document list
        client = get_vdm_client()
        docs = client.get_document_list(orgnr) or []
        print(f"  Found {len(docs)} documents in API")

        if not docs:
            all_results["companies"].append(company_result)
            continue

        # Download and analyze ALL documents
        for i, doc in enumerate(docs):
            doc_id = doc.get("dokumentId")
            period_end = doc.get("rapporteringsperiodTom", "")
            year = period_end[:4] if period_end else "unknown"

            print(f"\n  [{i+1}/{len(docs)}] Year {year}: Downloading...")

            content = download_document(doc_id)
            if not content:
                print(f"    ✗ Download failed")
                continue

            print(f"    ✓ Downloaded {len(content)/1024:.1f} KB")

            # Analyze
            analysis = analyze_ixbrl_archive(content, orgnr, doc)

            if analysis["error"]:
                print(f"    ✗ Analysis error: {analysis['error']}")
            else:
                print(f"    ✓ Extracted {len(analysis['all_facts'])} facts")
                print(f"    ✓ Unique fact names: {len(analysis['fact_names'])}")
                print(f"    ✓ Namespaces: {analysis['namespaces']}")

            # Store analysis (without heavy data)
            doc_summary = {
                "document_id": doc_id,
                "year": year,
                "period_end": period_end,
                "file_size_kb": analysis["file_size_kb"],
                "xhtml_files": analysis["xhtml_files"],
                "fact_count": len(analysis["all_facts"]),
                "fact_names": analysis["fact_names"],
                "namespaces": analysis["namespaces"],
                "contexts": analysis["contexts"],
            }
            company_result["documents"].append(doc_summary)
            company_result["years_available"].append(year)
            company_result["total_facts"] += len(analysis["all_facts"])
            company_result["unique_fact_names"].update(analysis["fact_names"])

            # Track global statistics
            all_results["total_documents"] += 1
            all_results["total_facts_extracted"] += len(analysis["all_facts"])
            all_results["all_namespaces"].update(analysis["namespaces"])

            for fact_name in analysis["fact_names"]:
                all_results["all_fact_names"][fact_name] += 1
                all_results["fact_name_by_company"][orgnr].add(fact_name)

            # Save raw facts for this document
            facts_file = OUTPUT_DIR / f"{orgnr}_{year}_facts.json"
            with open(facts_file, 'w', encoding='utf-8') as f:
                # Filter to numeric facts with values
                numeric_facts = [
                    {
                        "name": fact["name"],
                        "value": fact.get("value_parsed"),
                        "value_raw": fact.get("value_raw", fact.get("value", "")),
                        "context": fact.get("context", ""),
                        "unit": fact.get("unit", ""),
                    }
                    for fact in analysis["all_facts"]
                    if fact.get("value_parsed") is not None or fact.get("value")
                ]
                json.dump(numeric_facts, f, indent=2, ensure_ascii=False)

            time.sleep(1)  # Rate limiting

        # Get existing DB data for comparison
        print(f"\n  Fetching existing database data...")
        db_data = get_existing_db_data(orgnr)
        company_result["db_comparison"] = {
            "has_company": db_data["company"] is not None,
            "financials_count": len(db_data["financials"]),
            "roles_count": len(db_data["roles"]),
            "db_years": [f.get("year") for f in db_data["financials"]],
        }
        print(f"    DB financials: {len(db_data['financials'])} years")
        print(f"    API reports: {len(company_result['years_available'])} years")

        # Convert set to list for JSON
        company_result["unique_fact_names"] = list(company_result["unique_fact_names"])

        all_results["companies"].append(company_result)
        all_results["companies_analyzed"] += 1

        time.sleep(2)  # Rate limiting between companies

    # Convert sets to lists
    all_results["all_namespaces"] = list(all_results["all_namespaces"])
    all_results["fact_name_by_company"] = {k: list(v) for k, v in all_results["fact_name_by_company"].items()}

    # Analyze common vs unique facts
    print("\n" + "=" * 80)
    print("ANALYSIS RESULTS")
    print("=" * 80)

    # Find facts present in ALL companies
    companies_with_docs = [c for c in all_results["companies"] if c["documents"]]
    if companies_with_docs:
        common_facts = set(companies_with_docs[0]["unique_fact_names"])
        for company in companies_with_docs[1:]:
            common_facts &= set(company["unique_fact_names"])

        all_results["common_facts_all_companies"] = list(common_facts)
        print(f"\nFacts present in ALL {len(companies_with_docs)} companies with documents:")
        for fact in sorted(common_facts)[:30]:  # Show first 30
            print(f"  - {fact}")
        if len(common_facts) > 30:
            print(f"  ... and {len(common_facts) - 30} more")

    # Most common facts overall
    print(f"\nTop 50 most common XBRL facts across all documents:")
    sorted_facts = sorted(all_results["all_fact_names"].items(), key=lambda x: -x[1])
    for fact_name, count in sorted_facts[:50]:
        print(f"  {count:3d}x  {fact_name}")

    # Categorize facts by namespace
    print(f"\nFacts by namespace:")
    namespace_facts = defaultdict(list)
    for fact_name in all_results["all_fact_names"]:
        if ":" in fact_name:
            ns = fact_name.split(":")[0]
            namespace_facts[ns].append(fact_name)

    for ns, facts in sorted(namespace_facts.items()):
        print(f"\n  {ns}: {len(facts)} unique facts")
        # Show sample facts
        for f in sorted(facts)[:5]:
            print(f"    - {f}")
        if len(facts) > 5:
            print(f"    ... and {len(facts) - 5} more")

    # Summary statistics
    print(f"\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Companies analyzed: {all_results['companies_analyzed']}")
    print(f"Companies with documents: {len(companies_with_docs)}")
    print(f"Total documents downloaded: {all_results['total_documents']}")
    print(f"Total XBRL facts extracted: {all_results['total_facts_extracted']}")
    print(f"Unique fact names found: {len(all_results['all_fact_names'])}")
    print(f"Namespaces used: {all_results['all_namespaces']}")

    # Data availability comparison
    print(f"\n" + "-" * 40)
    print("DATA AVAILABILITY (API vs Database)")
    print("-" * 40)
    for company in all_results["companies"]:
        api_years = len(company["years_available"])
        db_years = company["db_comparison"]["financials_count"] if company["db_comparison"] else 0
        status = "✓" if api_years > 0 else "✗"
        print(f"  {status} {company['orgnr']}: API={api_years} years, DB={db_years} years")

    # Save full results
    results_file = OUTPUT_DIR / "comprehensive_analysis.json"
    with open(results_file, 'w', encoding='utf-8') as f:
        # Convert defaultdict to dict
        all_results["all_fact_names"] = dict(all_results["all_fact_names"])
        json.dump(all_results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nFull results saved to: {results_file}")

    # Save fact catalog
    catalog_file = OUTPUT_DIR / "xbrl_fact_catalog.json"
    fact_catalog = {
        "generated": datetime.now().isoformat(),
        "total_unique_facts": len(all_results["all_fact_names"]),
        "facts_by_frequency": sorted_facts,
        "facts_by_namespace": {ns: sorted(facts) for ns, facts in namespace_facts.items()},
        "common_to_all": list(common_facts) if companies_with_docs else [],
    }
    with open(catalog_file, 'w', encoding='utf-8') as f:
        json.dump(fact_catalog, f, indent=2, ensure_ascii=False)
    print(f"XBRL fact catalog saved to: {catalog_file}")

    print("\n" + "=" * 80)
    print("ANALYSIS COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    main()
