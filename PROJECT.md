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
- **Frontend:** Statisk HTML/JS/CSS (GitHub Pages) i `docs/`
- **Backend:** Supabase Edge Functions (Deno/TypeScript)
- **Databas:** Supabase PostgreSQL
- **Scraping:** Puppeteer + NopeCHA (lokal CLI för CAPTCHA)
- **API:** Bolagsverket VDM (gratis), POIT (kungörelser)

## Projektstruktur
```
bevakningsverktyg/
├── docs/                     # Frontend (GitHub Pages)
│   ├── index.html           # Huvuddashboard
│   ├── assets/              # CSS, JS, images
│   ├── verktyg/             # Verktygsidor
│   │   ├── allabolag/       # Allabolag-sökning
│   │   ├── bolagsverket-api/# VDM API-sökning
│   │   ├── foretagsbevakning/# POIT-bevakning
│   │   ├── xbrl-parser/     # Årsredovisningsparser
│   │   ├── artikelgenerator/# AI-artikelgenerering
│   │   ├── pdf-parser/      # PDF-analys
│   │   ├── dokumentkop/     # Protokollköp
│   │   └── cli-verktyg/     # Lokala CLI-verktyg (docs)
│   ├── nyhetsverktyg/       # Nyhetsredaktion
│   ├── admin/               # Admin-sidor
│   └── installningar/       # Inställningar
├── src/                      # Python backend (legacy)
│   ├── api/                 # FastAPI routes
│   ├── models/              # Pydantic-modeller
│   ├── scrapers/            # Scraper-moduler
│   │   ├── allabolag-scraper.js
│   │   ├── poit-scraper.js
│   │   ├── protokoll-scraper.js
│   │   └── xbrl_parser.py
│   └── services/            # Tjänster
│       ├── news_article_generator_v2.js
│       ├── pdf_parser.js
│       └── auto_captcha_solver.js
├── supabase/                 # Supabase-konfiguration
│   ├── functions/           # Edge Functions
│   │   ├── budget/          # Budgethantering
│   │   ├── poit-kungorelse/ # POIT-proxy
│   │   ├── rss-proxy/       # RSS-aggregering
│   │   ├── mynewsdesk-proxy/# Pressrum-scraping
│   │   └── send-sms/        # SMS-notifieringar
│   └── migrations/          # SQL-migrationer
├── lib/                      # Externa bibliotek
│   ├── nopecha-extension/   # NopeCHA Chrome extension
│   ├── browser-automation/  # Puppeteer helpers
│   └── captcha-solvers/     # CAPTCHA-verktyg
├── scripts/                  # CLI-scripts
│   ├── poit-purchase-stealth.js  # Stealth protokollköp
│   └── discover-pressrooms.ts    # Pressrum-discovery
├── data/                     # Lokal data
│   ├── purchase_log.json    # Köphistorik
│   └── successful-methods/  # Cachade metoder
├── backups/                  # Automatiska backups
├── .env.example              # Miljövariabler
├── package.json              # Node.js dependencies
├── requirements.txt          # Python dependencies
├── Dockerfile                # Docker-konfiguration
└── docker-compose.yml        # Docker Compose
```

## Implementerade verktyg (10 st)

### BATCH 1: Företagsdata & Scraping
| # | Verktyg | Status | Beskrivning |
|---|---------|--------|-------------|
| 1 | Allabolag Scraper | ✅ Klar | Hämta styrelse, ledning, finansiell data |
| 2 | Bolagsverket VDM API | ✅ Klar | Officiellt gratis API för företagsinfo |
| 3 | POIT Monitor | ✅ Klar | Kungörelser med watchlist-matching |
| 4 | XBRL Parser | ✅ Klar | Parsea svenska årsredovisningar |

### BATCH 2: Nyhets- & Innehållsgenerering
| # | Verktyg | Status | Beskrivning |
|---|---------|--------|-------------|
| 5 | Artikelgenerator | ✅ Klar | AI-driven artikelgenerering med Claude |
| 6 | PDF Parser | ✅ Klar | PDF-analys med AI-sammanfattning |
| 7 | Pressbildsscraper | ✅ Klar | Integrerad i artikelgeneratorn |

### BATCH 3: Automatisering & Ekonomi
| # | Verktyg | Status | Beskrivning |
|---|---------|--------|-------------|
| 8 | Budget Manager | ✅ Klar | Budget API (Edge Function) |
| 9 | Dokumentköp | ✅ Klar | Protokollköp med budgetkontroll |
| 10 | CLI-verktyg | ✅ Klar | Lokala CAPTCHA-verktyg (dokumentation) |

## Supabase Edge Functions

| Function | Status | Beskrivning |
|----------|--------|-------------|
| `budget` | ✅ Deployad | Budgethantering och köphistorik |
| `poit-kungorelse` | ✅ Deployad | POIT-proxy för kungörelser |
| `rss-proxy` | ✅ Designad | RSS-aggregering med keyword matching |
| `mynewsdesk-proxy` | ✅ Designad | Pressrum-scraping |
| `send-sms` | ✅ Designad | Twilio SMS-notifieringar |

## API Endpoints

### Budget API (Edge Function)
| Metod | Endpoint | Beskrivning |
|-------|----------|-------------|
| GET | `/budget` | Hämta budgetstatus och statistik |
| POST | `/budget/check` | Kontrollera om köp är tillåtet |
| POST | `/budget/purchase` | Registrera ett köp |
| PUT | `/budget/settings` | Uppdatera budgetinställningar |
| GET | `/budget/history` | Hämta köphistorik |

### POIT API (Edge Function)
| Metod | Endpoint | Beskrivning |
|-------|----------|-------------|
| POST | `/poit-kungorelse` | Sök kungörelser för företag |

## Databas-schema (Supabase)

### Huvudtabeller
- **companies** (1358 st) - Företagsdata, logotyper
- **roles** (8528 st) - Styrelse, VD, revisorer
- **financials** (6381 st) - Omsättning, resultat
- **poit_announcements** (3805 st) - Kungörelser
- **loop_table** (1214 st) - Funding, värdering
- **xbrl_facts** (17444 st) - XBRL-data

### Budget & Köp
- **budget_settings** - Budgetinställningar
- **purchases** - Köphistorik

### Nyheter
- **company_pressrooms** (82 st) - Pressrums-URL
- **news_articles** - Genererade artiklar

## Köra lokalt

### Frontend (GitHub Pages)
```bash
# Öppna docs/index.html i webbläsare
open docs/index.html

# Eller starta lokal server
cd docs && python -m http.server 8080
```

### CLI-verktyg (kräver lokal Chrome)
```bash
# Installera dependencies
npm install

# Kör protokollköp
node scripts/poit-purchase-stealth.js 5560125790

# Kör POIT-scraping
node src/scrapers/poit-scraper.js
```

### Edge Functions (test lokalt)
```bash
# Starta Supabase lokalt
supabase start

# Testa budget-funktion
curl -X GET "http://localhost:54321/functions/v1/budget" \
  -H "Authorization: Bearer ANON_KEY"
```

## Miljövariabler

| Variabel | Beskrivning |
|----------|-------------|
| `SUPABASE_URL` | Supabase projekt-URL |
| `SUPABASE_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `ANTHROPIC_API_KEY` | Claude API-nyckel |
| `TWILIO_ACCOUNT_SID` | Twilio konto |
| `TWILIO_AUTH_TOKEN` | Twilio token |
| `TWILIO_PHONE_NUMBER` | Twilio telefonnummer |

## NopeCHA Extension

**Path:** `lib/nopecha-extension/`

Automatisk CAPTCHA-lösning för:
- reCAPTCHA v2/v3
- hCaptcha
- Cloudflare Turnstile

**Gratis:** 100 requests/dag utan API-nyckel

## Notes

- **Projekt skapat:** 2024
- **Senast uppdaterad:** 2025-12-19
- **Frontend:** GitHub Pages (statisk HTML i `docs/`)
- **Backend:** Supabase Edge Functions
- **CLI-verktyg:** Kräver lokal Chrome med NopeCHA

### Borttagna mappar (städat 2025-12-19)
- `dashboard/` - Oanvänd Express-server
- `verktyg-dashboard/` - Placeholder utan kod
- `admin-verktyg/` - Oanvänd API-nyckelhantering
