# -*- coding: utf-8 -*-
"""
Lönekollen – OCR-extraktion (ENDAST sida 1, 1 PDF = 1 person)

Baserat på analys av PDF-layouten:
- 3 sektioner med lila rubriker "Inkomstår YYYY (Taxeringsår ZZZZ)"
- Varje sektion har en tabell med kolumner: Namn/adress, Å, IÅ, LR, BA, Lön, Kapital

Använder ROI-baserad OCR för att extrahera data från specifika områden.
"""

import re
import json
import hashlib
import unicodedata
from pathlib import Path

import pytesseract
from pdf2image import convert_from_path
import cv2
import numpy as np
import os

# Sätt Tesseract-sökvägen explicit för macOS/Homebrew
pytesseract.pytesseract.tesseract_cmd = '/opt/homebrew/bin/tesseract'
os.environ['TESSDATA_PREFIX'] = '/opt/homebrew/share/tessdata'

# ---------------- KONFIG ----------------

CACHE_DIR = Path("/Users/isak/Desktop/CLAUDE_CODE /Bevakningsverktyget/data/.ocr_cache")
CACHE_DIR.mkdir(exist_ok=True)

# ROI-koordinater (x, y, width, height) som andel av bildens storlek
# Baserat på PDF-layout analys (bild 2480x3509 px)
# Exakta positioner för datarader hittas vid y=940, 1815, 2690 (pixlar)
# Sektionshöjd är ca 875 px
ROI_YEAR_TABLES = {
    # För varje år, var tabellraden med namn och inkomstdata finns
    # Format: (x_start, y_start, width, height) relativt till sidan
    # Beräknat från: y_px / 3509 (sidans höjd)
    2024: (0.015, 0.268, 0.60, 0.018),   # y=940/3509 = 0.268
    2023: (0.015, 0.517, 0.60, 0.018),   # y=1815/3509 = 0.517
    2022: (0.015, 0.767, 0.60, 0.018),   # y=2690/3509 = 0.767
}


# ---------------- HJÄLPFUNKTIONER ----------------

def pdf_hash(path: str) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def crop_roi(img, roi):
    """Beskär bild baserat på relativa koordinater (x, y, w, h)"""
    h, w = img.shape[:2]
    x, y, rw, rh = roi
    x1 = int(x * w)
    y1 = int(y * h)
    x2 = int((x + rw) * w)
    y2 = int((y + rh) * h)
    return img[y1:y2, x1:x2]


def preprocess_for_ocr(img):
    """Förbered bild för OCR - konvertera till svartvit och förbättra kontrast"""
    # Konvertera till gråskala
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img

    # Öka kontrast
    gray = cv2.convertScaleAbs(gray, alpha=1.5, beta=0)

    # Binär threshold
    _, binary = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)

    return binary


def ocr_line(img, config='--psm 7 -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖabcdefghijklmnopqrstuvwxyzåäö,.- '):
    """OCR på en enskild rad"""
    processed = preprocess_for_ocr(img)
    text = pytesseract.image_to_string(processed, lang="swe", config=config)
    return text.strip()


def normalize_swedish(text: str) -> str:
    if not text:
        return text
    return unicodedata.normalize("NFC", text)


# ---------------- PARSNING ----------------

def parse_table_row(text: str, year: int) -> dict:
    """
    Parsa en tabellrad med inkomstdata.

    OCR ger ofta ihopklistrad text som:
    "SkogstadIsak,Skottgränd6Igh1201 3324-287oN199300-30832"

    Vi måste hantera:
    - Ihopklistrade ord (SkogstadIsak -> Skogstad Isak)
    - OCR-fel som 'o' istället för '0', '-' som separator
    - Negativa kapitalinkomster (-30832)
    """

    result = {
        "namn": None,
        "fornamn": None,
        "efternamn": None,
        "adress": None,
        "inkomstar": year,
        "alder": None,
        "loneranking": None,
        "betalningsanmarkning": None,
        "lon_forvarvsinkomst": None,
        "kapitalinkomst": None
    }

    if not text:
        return result

    text = normalize_swedish(text)
    original_text = text
    print(f"[DEBUG] År {year} rad: {text[:100]}...")

    # Fixa vanliga OCR-fel
    text = text.replace('o', '0').replace('O', '0')  # o -> 0
    text = re.sub(r'(?<=[a-zåäö])(?=[A-ZÅÄÖ])', ' ', text)  # Lägg till mellanslag mellan ord

    # Extrahera namn - sök efter mönstret "Efternamn Förnamn,"
    # OCR: "Skogstad Isak," eller "SkogstadIsak,"
    name_match = re.search(r'([A-ZÅÄÖ][a-zåäö]+)\s*([A-ZÅÄÖ][a-zåäö]+)\s*,', text)
    if name_match:
        result["efternamn"] = name_match.group(1)
        result["fornamn"] = name_match.group(2)
        result["namn"] = f"{result['efternamn']} {result['fornamn']}"

    # Extrahera adress (efter komma, före siffrorna)
    addr_match = re.search(r',\s*([A-ZÅÄÖa-zåäö]+\d*[A-ZÅÄÖa-zåäö]*\s*\d*)', text)
    if addr_match:
        result["adress"] = addr_match.group(1).strip()

    # Hitta siffersekvensen med inkomstdata
    # Mönster: Ålder(2) År(2) LR(1-3) BA(N/J/0N) Lön(5-6) Kapital(kan vara negativ)
    # OCR-exempel: "3324-287oN199300-30832" eller "3324 287 N 199300 -30832"

    # Rensa och normalisera sifferdelen
    # Ta bort allt före första siffran som verkar vara del av inkomstdata
    number_section = re.search(r'(\d{4,}[-\s]*\d+[-\s]*[0N]?[-\s]*\d+[-\s]*-?\d+)', text)

    if number_section:
        nums = number_section.group(1)
        print(f"[DEBUG] Siffersektion: {nums}")

        # Ta bort mellanslag och separatorer för att få rena siffror
        clean = re.sub(r'[^0-9N-]', '', nums)
        print(f"[DEBUG] Rensat: {clean}")

        # Försök parsa mönstret
        # Format: ÅÅYYRRR[N]LLLLLL[-]KKKKKK
        # Där ÅÅ=ålder, YY=år, RRR=rank, N=BA, LLLLLL=lön, KKKKKK=kapital

        # Hitta N (betalningsanmärkning)
        n_pos = clean.find('N')
        if n_pos > 0:
            before_n = clean[:n_pos]
            after_n = clean[n_pos+1:]

            # Före N: ålder(2) + år(2) + rank(2-3) = 6-7 siffror
            if len(before_n) >= 6:
                result["alder"] = int(before_n[:2])
                # year suffix (verifiering)
                ocr_year = int(before_n[2:4])
                result["loneranking"] = int(before_n[4:])

            result["betalningsanmarkning"] = None  # N = nej

            # Efter N: lön och kapital
            # Kapital kan vara negativt (börjar med -)
            if '-' in after_n:
                # Hitta sista minustecknet (kapital är negativt)
                parts = after_n.rsplit('-', 1)
                if len(parts) == 2:
                    result["lon_forvarvsinkomst"] = int(parts[0]) if parts[0] else 0
                    result["kapitalinkomst"] = -int(parts[1]) if parts[1] else 0
            else:
                # Dela i mitten (lön är vanligtvis 5-6 siffror)
                if len(after_n) >= 10:
                    result["lon_forvarvsinkomst"] = int(after_n[:6])
                    result["kapitalinkomst"] = int(after_n[6:])
                elif len(after_n) >= 5:
                    result["lon_forvarvsinkomst"] = int(after_n)
                    result["kapitalinkomst"] = 0

        print(f"[DEBUG] År {year}: Ålder {result['alder']}, LR {result['loneranking']}, "
              f"Lön {result['lon_forvarvsinkomst']}, Kapital {result['kapitalinkomst']}")

    return result


# ---------------- PIPELINE ----------------

def process_pdf(pdf_path: str, use_cache: bool = True, debug: bool = False) -> dict:
    """Processa en Lönekollen-PDF och extrahera inkomstdata"""

    h = pdf_hash(pdf_path)
    cache_file = CACHE_DIR / f"{h}.json"

    if use_cache and cache_file.exists():
        print(f"[Cache hit] {pdf_path}")
        return json.loads(cache_file.read_text(encoding="utf-8"))

    print(f"[Processing] {pdf_path}")

    # Konvertera PDF sida 1 till bild (hög DPI för bättre OCR)
    img = convert_from_path(
        pdf_path,
        dpi=300,
        first_page=1,
        last_page=1
    )[0]
    img = np.array(img)

    if debug:
        # Spara hela sidan för debugging
        from PIL import Image
        Image.fromarray(img).save('/tmp/lonekollen_debug.png')
        print("[DEBUG] Hela sidan sparad till /tmp/lonekollen_debug.png")

    result = {
        "namn": None,
        "fornamn": None,
        "efternamn": None,
        "adress": None,
        "inkomster": [],
        "pdf_path": str(pdf_path)
    }

    # OCR på hela sidan först för att hitta namn
    full_ocr_config = '--psm 3'  # Fully automatic page segmentation
    processed_full = preprocess_for_ocr(img)
    full_text = pytesseract.image_to_string(processed_full, lang="swe", config=full_ocr_config)

    if debug:
        print(f"[DEBUG Full OCR]:\n{full_text[:500]}...")

    # Extrahera data för varje år från specifika ROI
    for year, roi in ROI_YEAR_TABLES.items():
        print(f"[DEBUG] Processar år {year}, ROI: {roi}")

        # Beskär tabellraden
        row_img = crop_roi(img, roi)

        if debug:
            from PIL import Image
            Image.fromarray(row_img).save(f'/tmp/lonekollen_row_{year}.png')
            print(f"[DEBUG] Rad {year} sparad till /tmp/lonekollen_row_{year}.png")

        # OCR på raden (single line mode)
        row_text = ocr_line(row_img)

        # Om vi inte fick bra OCR, prova med större ROI
        if not row_text or len(row_text) < 20:
            # Utöka ROI lite
            expanded_roi = (roi[0], roi[1] - 0.01, roi[2], roi[3] + 0.02)
            row_img = crop_roi(img, expanded_roi)
            row_text = ocr_line(row_img)

        # Parsa raden
        income_data = parse_table_row(row_text, year)

        # Uppdatera personinfo om vi hittat det
        if income_data["namn"] and not result["namn"]:
            result["namn"] = income_data["namn"]
            result["fornamn"] = income_data["fornamn"]
            result["efternamn"] = income_data["efternamn"]
            result["adress"] = income_data["adress"]

        # Lägg till inkomstdata
        result["inkomster"].append({
            "inkomstar": income_data["inkomstar"],
            "alder": income_data["alder"],
            "loneranking": income_data["loneranking"],
            "betalningsanmarkning": income_data["betalningsanmarkning"],
            "lon_forvarvsinkomst": income_data["lon_forvarvsinkomst"],
            "kapitalinkomst": income_data["kapitalinkomst"]
        })

    # Sortera efter inkomstår (nyast först)
    result["inkomster"].sort(key=lambda x: x["inkomstar"], reverse=True)

    # Spara i cache
    cache_file.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    return result


def run_batch(pdf_paths, use_cache: bool = True, debug: bool = False):
    """Kör OCR på flera PDF-filer"""
    results = []
    for pdf in pdf_paths:
        try:
            result = process_pdf(pdf, use_cache=use_cache, debug=debug)
            results.append(result)
        except Exception as e:
            print(f"[ERROR] {pdf}: {e}")
            import traceback
            traceback.print_exc()
            results.append({"error": str(e), "pdf_path": str(pdf)})
    return results


# ---------------- MAIN ----------------

if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser(description="OCR-extraktion av Lönekollen-PDF:er")
    parser.add_argument("pdfs", nargs="*", help="PDF-filer att processa")
    parser.add_argument("--no-cache", action="store_true", help="Ignorera cache")
    parser.add_argument("--debug", action="store_true", help="Visa debug-info och spara bilder")
    args = parser.parse_args()

    # Använd argument eller default till alla PDF:er i downloads
    downloads_dir = Path("/Users/isak/Desktop/CLAUDE_CODE /Bevakningsverktyget/data/downloads")

    if args.pdfs:
        pdfs = args.pdfs
    else:
        pdfs = list(downloads_dir.glob("*.pdf"))

    if not pdfs:
        print("Inga PDF-filer hittade!")
        sys.exit(1)

    print(f"Processar {len(pdfs)} PDF-filer...")
    print("=" * 60)

    results = run_batch(
        [str(p) for p in pdfs],
        use_cache=not args.no_cache,
        debug=args.debug
    )

    print("\n" + "=" * 60)
    print("RESULTAT:")
    print("=" * 60)
    print(json.dumps(results, ensure_ascii=False, indent=2))
