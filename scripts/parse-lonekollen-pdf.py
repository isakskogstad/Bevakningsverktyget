# -*- coding: utf-8 -*-
"""
Lönekollen PDF Parser - Text-baserad extraktion (INTE OCR)

Extraherar inkomstdata för en specifik person från Lönekollen PDF.
Scriptet vet redan namnet på personen (från sökningen på Ratsit).

Sida 1 = Sammanfattning (bild-baserad, ignoreras)
Sida 2 = Inkomstår 2024 (text)
Sida 3 = Inkomstår 2023 (text)
Sida 4 = Inkomstår 2022 (text)
"""

import re
import json
from pathlib import Path
from typing import Optional, List

import fitz  # PyMuPDF - bättre textextraktion än pdfplumber


def extract_person_data_from_lines(lines: List[str], start_idx: int, year: int) -> Optional[dict]:
    """
    Extrahera persondata från PyMuPDF-format där varje fält är på egen rad.

    Format:
      [i]   Namn, Adress
      [i+1] ÅÅ IÅ (t.ex. "33 24")
      [i+2] Löneranking (t.ex. "287")
      [i+3] BA (N/J)
      [i+4] Lön (t.ex. "199 300")
      [i+5] Kapital (t.ex. "-30 832")
    """
    try:
        namn_adress = lines[start_idx].strip()
        age_year = lines[start_idx + 1].strip()
        ranking = lines[start_idx + 2].strip()
        ba = lines[start_idx + 3].strip()
        lon = lines[start_idx + 4].strip()
        kapital = lines[start_idx + 5].strip()

        # Parsa namn och adress
        if ',' in namn_adress:
            namn, adress = namn_adress.split(',', 1)
            namn = namn.strip()
            adress = adress.strip()
        else:
            namn = namn_adress
            adress = None

        # Parsa ålder och inkomstår (format: "33 24" eller "3324")
        age_year_match = re.match(r'(\d{1,2})\s*(\d{2})', age_year)
        if not age_year_match:
            return None
        alder = int(age_year_match.group(1))
        inkomstar_suffix = int(age_year_match.group(2))
        inkomstar = 2000 + inkomstar_suffix

        # Parsa löneranking
        loneranking = int(ranking) if ranking.isdigit() else None

        # Parsa BA
        betalningsanmarkning = ba.upper() == 'J'

        # Parsa lön och kapital (ta bort mellanslag)
        lon_val = int(lon.replace(' ', '').replace('\xa0', '')) if lon.replace(' ', '').replace('\xa0', '').lstrip('-').isdigit() else 0
        kapital_val = int(kapital.replace(' ', '').replace('\xa0', '')) if kapital.replace(' ', '').replace('\xa0', '').lstrip('-').isdigit() else 0

        return {
            "namn": namn,
            "adress": adress,
            "alder": alder,
            "inkomstar": inkomstar,
            "loneranking": loneranking,
            "betalningsanmarkning": betalningsanmarkning,
            "lon_forvarvsinkomst": lon_val,
            "kapitalinkomst": kapital_val
        }
    except (IndexError, ValueError) as e:
        return None


def parse_income_line(line: str, search_name: str) -> Optional[dict]:
    """
    Parsa en rad med inkomstdata.

    OBS: Varje rad kan innehålla FLERA personer (3 per rad i PDF:en).
    Vi extraherar alla och returnerar endast den som matchar search_name.

    Format per person: "Efternamn Förnamn, Adress ÅÅ IÅ LR BA Lön Kapital"
    Exempel: "Skogstad Isak, Skottgränd 6 lgh 1201 3223 127 N 539 200 -109 976"
    """

    if search_name.lower() not in line.lower():
        return None

    # Regex för att matcha ALLA personer på raden
    # Mönster: Namn, Adress ÅÅ(ålder)IÅ(år) LR(rank) BA(N/J) Lön Kapital
    # Lookahead för att hitta nästa person eller radslut
    person_pattern = r"([A-ZÅÄÖ][a-zåäöé']+(?:\s+[A-ZÅÄÖ][a-zåäöé']+)*),\s*([^,]+?)\s+(\d{2})(\d{2})\s+(\d{1,4})\s+([NJ])\s+([\d\s]+?)\s+(-?[\d\s]+?)(?=\s+[A-ZÅÄÖ]|$)"

    matches = re.findall(person_pattern, line)

    if not matches:
        return None

    # Sök efter den person som matchar search_name
    search_parts = search_name.lower().split()

    for match in matches:
        namn = match[0]
        namn_lower = namn.lower()

        # Kolla om alla delar av söknamnet finns i namnet
        if all(part in namn_lower for part in search_parts):
            adress = match[1].strip()
            alder = int(match[2])
            inkomstar_suffix = int(match[3])
            loneranking = int(match[4])
            ba = match[5]
            lon_str = match[6].replace(' ', '')
            kapital_str = match[7].replace(' ', '')

            # Beräkna fullständigt inkomstår (20XX)
            inkomstar = 2000 + inkomstar_suffix

            # Parsa lön och kapital
            lon = int(lon_str) if lon_str else 0
            kapital = int(kapital_str) if kapital_str else 0

            return {
                "namn": namn,
                "adress": adress,
                "alder": alder,
                "inkomstar": inkomstar,
                "loneranking": loneranking,
                "betalningsanmarkning": ba == 'J',
                "lon_forvarvsinkomst": lon,
                "kapitalinkomst": kapital,
                "raw_line": line.strip()
            }

    return None


def extract_income_data(pdf_path: str, search_name: str) -> dict:
    """
    Extrahera inkomstdata för en specifik person från Lönekollen PDF.

    Använder PyMuPDF för bättre textextraktion. Datan är formaterad så att
    varje fält (namn, ålder, lön, etc.) är på separata rader.

    Args:
        pdf_path: Sökväg till PDF-filen
        search_name: Namnet på personen att söka efter (t.ex. "Skogstad Isak")

    Returns:
        Dict med personinfo och inkomster för alla år
    """

    result = {
        "namn": None,
        "adress": None,
        "inkomster": [],
        "pdf_path": str(pdf_path),
        "search_name": search_name
    }

    # Sidmappning till inkomstår
    page_to_year = {
        1: 2024,  # Sida 2 (index 1)
        2: 2023,  # Sida 3 (index 2)
        3: 2022,  # Sida 4 (index 3)
    }

    doc = fitz.open(pdf_path)

    try:
        # Sida 2-4 innehåller inkomstdata (sida 1 är sammanfattning med bilder)
        for page_num in [1, 2, 3]:  # Index 1, 2, 3 = sida 2, 3, 4
            if page_num >= len(doc):
                continue

            page = doc[page_num]
            text = page.get_text()
            lines = text.split('\n')

            # Sök efter personnamnet
            search_lower = search_name.lower()

            for i, line in enumerate(lines):
                if search_lower in line.lower():
                    # Hitta vilken del av namnet som matchar
                    # Extrahera data från de följande raderna
                    year = page_to_year.get(page_num, 2024)
                    income_data = extract_person_data_from_lines(lines, i, year)

                    if income_data:
                        # Uppdatera personinfo om det är första träffen
                        if not result["namn"]:
                            result["namn"] = income_data["namn"]
                            result["adress"] = income_data["adress"]

                        # Lägg till inkomstdata (undvik dubletter)
                        existing_years = [inc["inkomstar"] for inc in result["inkomster"]]
                        if income_data["inkomstar"] not in existing_years:
                            result["inkomster"].append({
                                "inkomstar": income_data["inkomstar"],
                                "alder": income_data["alder"],
                                "loneranking": income_data["loneranking"],
                                "betalningsanmarkning": income_data["betalningsanmarkning"],
                                "lon_forvarvsinkomst": income_data["lon_forvarvsinkomst"],
                                "kapitalinkomst": income_data["kapitalinkomst"]
                            })
                        break  # Gå vidare till nästa sida
    finally:
        doc.close()

    # Sortera inkomster efter år (nyast först)
    result["inkomster"].sort(key=lambda x: x["inkomstar"], reverse=True)

    return result


# ---------------- MAIN ----------------

if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser(description="Extrahera inkomstdata från Lönekollen PDF")
    parser.add_argument("pdf", help="PDF-fil att processa")
    parser.add_argument("--name", "-n", required=True, help="Namn på personen att söka efter")
    parser.add_argument("--json", "-j", action="store_true", help="Output som JSON")
    args = parser.parse_args()

    result = extract_income_data(args.pdf, args.name)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Person: {result['namn']}")
        print(f"Adress: {result['adress']}")
        print(f"Sökterm: {result['search_name']}")
        print()
        print("Inkomster:")
        print("-" * 60)
        for inc in result["inkomster"]:
            ba_str = "JA" if inc["betalningsanmarkning"] else "Nej"
            print(f"  {inc['inkomstar']}: Ålder {inc['alder']}, "
                  f"Rank {inc['loneranking']}, BA: {ba_str}, "
                  f"Lön: {inc['lon_forvarvsinkomst']:,} kr, "
                  f"Kapital: {inc['kapitalinkomst']:,} kr")
