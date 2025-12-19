# Bevakningsverktyg

## Overview
Automatiskt bevakningsverktyg som övervakar **1217 specifika svenska företag** och upptäcker händelser som:
- Styrelseändringar (VD, ordförande, ledamöter)
- Ägarförändringar
- Ekonomiska varningar (likvidation, konkurs)
- Fusioner och delningar
- Bolagsordningsändringar
- Kallelser på okända borgenärer

## Tech Stack
- **Backend:** Python 3.11 + FastAPI
- **Scraping:** undetected-chromedriver + NopeCHA (CAPTCHA-lösning)
- **Scheduler:** APScheduler (inbyggd)
- **Container:** Docker med Chrome
- **Databas:** Supabase (optional, för persistent lagring)

## Datakällor
| Källa | Status | Beskrivning |
|-------|--------|-------------|
| **POIT** (Post- och Inrikes Tidningar) | ✅ Implementerad | Kungörelser om konkurser, likvidationer, styrelseändringar |
| Bolagsverket API | 🔜 Planerad | Direkta registerändringar |
| Allabolag.se | 🔜 Planerad | Aggregerad bolagsinfo |

## Projektstruktur
```
bevakningsverktyg/
├── src/
│   ├── api/
│   │   ├── __init__.py
│   │   └── routes.py          # FastAPI endpoints
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py         # Pydantic-modeller
│   ├── scrapers/
│   │   ├── __init__.py
│   │   └── poit_scraper.py    # POIT-scraper med CAPTCHA-hantering
│   ├── services/
│   │   ├── __init__.py
│   │   └── bevakning_service.py  # Huvudlogik
│   ├── config.py              # Konfiguration
│   └── main.py                # FastAPI app + scheduler
├── companies.json             # Bevakade företag (1217 st)
├── companies.csv              # Samma i CSV
├── requirements.txt           # Python dependencies
├── Dockerfile                 # Container med Chrome
├── docker-compose.yml         # Docker Compose config
├── .env.example               # Environment-mall
└── PROJECT.md
```

## API Endpoints

| Metod | Endpoint | Beskrivning |
|-------|----------|-------------|
| GET | `/` | Välkomstsida |
| GET | `/health` | Health check |
| GET | `/api/v1/status` | Bevakningsstatus |
| GET | `/api/v1/foretag` | Lista bevakade företag |
| GET | `/api/v1/foretag/{orgnr}` | Hämta ett företag |
| GET | `/api/v1/foretag/{orgnr}/haendelser` | Händelser för företag |
| GET | `/api/v1/haendelser` | Alla upptäckta händelser |
| POST | `/api/v1/kontrollera` | Trigga kontroll (async) |
| POST | `/api/v1/kontrollera/sync` | Trigga kontroll (sync) |

## Händelsetyper
- `styrelse_andring` - Byte av styrelseledamöter
- `vd_byte` - Ny VD
- `konkurs` - Konkursbeslut
- `likvidation` - Likvidation påbörjad
- `fusion` - Fusion med annat bolag
- `bolagsordning_andring` - Ändrad bolagsordning
- `nyemission` - Nyemission/ändrat aktiekapital
- `kallelse_okand_borgenar` - Kallelse på okända borgenärer
- `annan` - Övriga händelser

## Köra lokalt

```bash
# Installera dependencies
pip install -r requirements.txt

# Kopiera env-fil
cp .env.example .env

# Starta servern
python -m src.main

# Eller med uvicorn direkt
uvicorn src.main:app --reload --port 8000
```

API-dokumentation: http://localhost:8000/docs

## Köra med Docker

```bash
# Bygg och starta
docker-compose up --build

# Eller bara starta (om redan byggd)
docker-compose up -d
```

## Miljövariabler

| Variabel | Beskrivning | Default |
|----------|-------------|---------|
| `HEADLESS` | Kör Chrome i headless mode | `true` |
| `CHECK_INTERVAL_MINUTES` | Intervall mellan kontroller | `60` |
| `NOPECHA_EXTENSION_PATH` | Sökväg till NopeCHA .crx | - |
| `SUPABASE_URL` | Supabase projekt-URL | - |
| `SUPABASE_KEY` | Supabase anon key | - |

## CAPTCHA-hantering

Verktyget använder två strategier för att hantera CAPTCHA:

1. **undetected-chromedriver** - Modifierad ChromeDriver som inte triggar bot-detection
2. **NopeCHA** (optional) - AI-baserad CAPTCHA-lösare, gratis 100 requests/dag

## Företagslista
- **Källa:** `Bevakaren.Företagslista.xlsx`
- **Antal:** 1217 företag
- **Format:** Organisationsnummer (10 siffror) + företagsnamn
- **Typ:** Svenska techbolag/scaleups

## Notes
- Projekt skapat: 2025-12-19
- POIT-scraper behöver finjusteras efter faktisk HTML-struktur
- Scheduler körs var 60:e minut som default
- Chrome i Docker kräver `shm_size: '2gb'` och `SYS_ADMIN` capability
