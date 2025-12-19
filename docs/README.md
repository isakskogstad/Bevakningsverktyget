# Bevakningsverktyg - Frontend Dashboard

Statisk HTML-frontend för bevakningsverktyget. Hostas via GitHub Pages.

## Struktur

```
docs/
├── index.html                # Huvuddashboard
├── assets/                   # CSS, JS, bilder
│   ├── css/
│   │   ├── style.css        # Huvudstil
│   │   └── variables.css    # CSS-variabler
│   └── js/
│       └── main.js          # Gemensam JS
│
├── verktyg/                  # IMPLEMENTERADE VERKTYG (10 st)
│   ├── allabolag/           # #1 Allabolag-sökning
│   ├── bolagsverket-api/    # #2 VDM API-sökning
│   ├── foretagsbevakning/   # #3 POIT-bevakning
│   ├── xbrl-parser/         # #4 Årsredovisningsparser
│   ├── artikelgenerator/    # #5 AI-artikelgenerering
│   ├── pdf-parser/          # #6 PDF-analys
│   ├── dokumentkop/         # #9 Protokollköp med budgetkontroll
│   └── cli-verktyg/         # #10 CLI-verktyg (dokumentation)
│
├── nyhetsverktyg/           # Nyhetsredaktion
│   └── pressbevakning/      # Pressrumsbevakning
│
├── admin/                   # Admin-sidor
│   └── api-nycklar/         # API-nyckelhantering
│
├── installningar/           # Inställningar
│   └── budget/              # Budgetinställningar
│
├── bevakning/              # Bevakningslistor
└── sms-notiser/            # SMS-notifikationer
```

## Implementerade verktyg

| # | Verktyg | Sida | Status |
|---|---------|------|--------|
| 1 | Allabolag Scraper | `/verktyg/allabolag/` | ✅ Klar |
| 2 | Bolagsverket VDM | `/verktyg/bolagsverket-api/` | ✅ Klar |
| 3 | POIT Monitor | `/verktyg/foretagsbevakning/` | ✅ Klar |
| 4 | XBRL Parser | `/verktyg/xbrl-parser/` | ✅ Klar |
| 5 | Artikelgenerator | `/verktyg/artikelgenerator/` | ✅ Klar |
| 6 | PDF Parser | `/verktyg/pdf-parser/` | ✅ Klar |
| 7 | Pressbilder | Integrerad i #5 | ✅ Klar |
| 8 | Budget Manager | Backend (Edge Function) | ✅ Klar |
| 9 | Dokumentköp | `/verktyg/dokumentkop/` | ✅ Klar |
| 10 | CLI-verktyg | `/verktyg/cli-verktyg/` | ✅ Klar |

## Supabase Edge Functions

Dashboard kommunicerar med följande Edge Functions:

| Function | Endpoint | Användning |
|----------|----------|------------|
| `budget` | `/functions/v1/budget` | Budgethantering |
| `poit-kungorelse` | `/functions/v1/poit-kungorelse` | POIT-proxy |
| `rss-proxy` | `/functions/v1/rss-proxy` | RSS-aggregering (designad) |
| `mynewsdesk-proxy` | `/functions/v1/mynewsdesk-proxy` | Pressrum-scraping (designad) |
| `send-sms` | `/functions/v1/send-sms` | SMS-notifieringar (designad) |

## Köra lokalt

```bash
# Enklast - öppna direkt i webbläsare
open docs/index.html

# Eller med lokal HTTP-server
cd docs && python -m http.server 8080
# Öppna http://localhost:8080
```

## Design

- **Färger:** Definierade i `assets/css/variables.css`
- **Layout:** Sidebar + huvudinnehåll
- **Responsivt:** Fungerar på desktop och mobil
- **Dark mode:** Stöds via CSS-variabler

## Supabase-konfiguration

Alla sidor använder Supabase JS SDK. URL och anon key:

```javascript
const SUPABASE_URL = 'https://wzkohritxdrstsmwopco.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIs...'; // Anon key (säker att exponera)
```

## API-dokumentation

### Budget API

```bash
# Hämta status
GET /functions/v1/budget

# Kontrollera köp
POST /functions/v1/budget/check
{"amount": 60}

# Registrera köp
POST /functions/v1/budget/purchase
{"orgnr": "5591628660", "amount_sek": 60, "document_type": "Protokoll"}

# Hämta historik
GET /functions/v1/budget/history
```

### POIT API

```bash
# Sök kungörelser
POST /functions/v1/poit-kungorelse
{"searchType": "orgnr", "searchTerm": "5591628660"}
```

## Deployment

Frontenden hostas via GitHub Pages:

1. Pusha ändringar till `main`
2. GitHub Actions bygger och deployar automatiskt
3. Tillgänglig på: `https://[username].github.io/bevakningsverktyg/`

## Teknisk dokumentation

Ytterligare dokumentation finns i docs-mappen:

| Dokument | Beskrivning |
|----------|-------------|
| `SUPABASE-EDGE-FUNCTIONS-DESIGN.md` | Full teknisk specifikation |
| `EDGE-FUNCTIONS-QUICK-REFERENCE.md` | Snabbreferens |
| `EDGE-FUNCTIONS-BATCH-2-3-DESIGN.md` | BATCH 2-3 design |
| `BACKEND-ARCHITECTURE-SUMMARY.md` | Arkitekturöversikt |
| `IMPLEMENTATION-CHECKLIST.md` | Implementationschecklista |

## Senast uppdaterad

2025-12-19 - 10 verktyg implementerade, projekt städat
