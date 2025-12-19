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
- **Databas:** Supabase PostgreSQL + Edge Functions (Deno)
- **Frontend:** GitHub Pages (statisk HTML/JS/CSS)

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

## Supabase Edge Functions (Journalist Dashboard Backend)

### Översikt
3 Serverless Edge Functions som fungerar som CORS-proxy och backend för journalist-dashboardet:

| Function | Syfte | Cache TTL | Rate Limit |
|----------|-------|-----------|------------|
| `rss-proxy` | Aggregera RSS-feeds med keyword matching | 30 min | 30 req/h per user |
| `mynewsdesk-proxy` | Scrapa MyNewsdesk pressreleaser + bilder | 24h | 10 req/h per pressrum |
| `send-sms` | Twilio SMS-notifikationer | N/A | 10/h, 50/dag per user |

### Databas-schema (8 nya tabeller)
- **rss_feeds** - RSS-feed konfiguration
- **rss_articles** - Cachade RSS-artiklar
- **bookmarks** - Användarens bokmärken
- **keyword_alerts** - Nyckelordsbevakning
- **keyword_alert_matches** - Alert-matchningar
- **sms_logs** - SMS audit log
- **pressroom_cache** - MyNewsdesk cache
- **rate_limits** - Rate limiting tracking

### Dokumentation
- **Full Design:** `/docs/SUPABASE-EDGE-FUNCTIONS-DESIGN.md`
- **Snabbreferens:** `/docs/EDGE-FUNCTIONS-QUICK-REFERENCE.md`
- **Implementation Checklist:** `/docs/IMPLEMENTATION-CHECKLIST.md`
- **SQL Migration:** `/supabase/migrations/001_edge_functions_schema.sql`

### Deploy Edge Functions
```bash
# Deploy alla functions
supabase functions deploy rss-proxy
supabase functions deploy mynewsdesk-proxy
supabase functions deploy send-sms

# Set Twilio secrets
supabase secrets set TWILIO_ACCOUNT_SID=xxx
supabase secrets set TWILIO_AUTH_TOKEN=xxx
supabase secrets set TWILIO_PHONE_NUMBER=+46xxx
```

### Test Endpoints
```bash
# RSS Proxy
curl -X POST https://[PROJECT].supabase.co/functions/v1/rss-proxy \
  -H "Authorization: Bearer [ANON_KEY]" \
  -d '{"forceRefresh":true}'

# MyNewsdesk Proxy
curl -X POST https://[PROJECT].supabase.co/functions/v1/mynewsdesk-proxy \
  -H "Authorization: Bearer [ANON_KEY]" \
  -d '{"pressroomUrl":"https://www.mynewsdesk.com/se/company"}'

# Send SMS (requires user token)
curl -X POST https://[PROJECT].supabase.co/functions/v1/send-sms \
  -H "Authorization: Bearer [USER_TOKEN]" \
  -d '{"to":"+46700000000","message":"Test"}'
```

## Notes
- Projekt skapat: 2025-12-19
- POIT-scraper behöver finjusteras efter faktisk HTML-struktur
- Scheduler körs var 60:e minut som default
- Chrome i Docker kräver `shm_size: '2gb'` och `SYS_ADMIN` capability
- **Backend-arkitektur designad:** 2025-12-19 (3 Edge Functions + 8 nya tabeller)
- **RLS policies:** Aktiverade på alla tabeller för säkerhet
- **Caching:** Multi-layer (30min - 24h) för optimal performance
