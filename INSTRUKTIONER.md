# BEVAKNINGSVERKTYG - INSTRUKTIONER

## ÖVERSIKT

Detta är ett verktyg för att bevaka svenska företag, köpa dokument från Bolagsverket,
och generera nyhetsartiklar baserat på företagshändelser.

**Frontend:** Statisk HTML i `docs/` (GitHub Pages)
**Backend:** Supabase Edge Functions
**CLI-verktyg:** Lokala scripts för CAPTCHA-skyddade sidor

---

## MAPPSTRUKTUR

```
bevakningsverktyg/
├── INSTRUKTIONER.md          # Denna fil - LÄS ALLTID FÖRST!
├── PROJECT.md                # Projektöversikt med alla verktyg
├── .env.example              # Miljövariabler (kopiera till .env)
│
├── docs/                     # FRONTEND (GitHub Pages)
│   ├── index.html           # Huvuddashboard
│   ├── assets/              # CSS, JS, bilder
│   ├── verktyg/             # Verktygsidor
│   │   ├── allabolag/       # Allabolag-sökning
│   │   ├── bolagsverket-api/# VDM API-sökning
│   │   ├── foretagsbevakning/# POIT-bevakning
│   │   ├── xbrl-parser/     # Årsredovisningsparser
│   │   ├── artikelgenerator/# AI-artikelgenerering
│   │   ├── pdf-parser/      # PDF-analys
│   │   ├── dokumentkop/     # Protokollköp
│   │   └── cli-verktyg/     # Lokala CLI-verktyg (dokumentation)
│   ├── nyhetsverktyg/       # Nyhetsredaktion
│   │   └── pressbevakning/  # Pressrumsbevakning
│   ├── admin/               # Admin-sidor
│   └── installningar/       # Inställningar
│
├── supabase/                 # SUPABASE
│   ├── functions/           # Edge Functions
│   │   ├── budget/          # Budgethantering (DEPLOYAD)
│   │   ├── poit-kungorelse/ # POIT-proxy (DEPLOYAD)
│   │   ├── rss-proxy/       # RSS-aggregering
│   │   ├── mynewsdesk-proxy/# Pressrum-scraping
│   │   └── send-sms/        # SMS-notifieringar
│   └── migrations/          # SQL-migrationer
│
├── src/                      # KÄLLKOD
│   ├── scrapers/            # Web scrapers
│   │   ├── allabolag-scraper.js
│   │   ├── poit-scraper.js
│   │   └── protokoll-scraper.js
│   ├── services/            # Tjänster
│   │   ├── auto_captcha_solver.js
│   │   ├── pdf_parser.js
│   │   └── news_article_generator_v2.js
│   ├── api/                 # FastAPI routes (legacy)
│   └── models/              # Pydantic-modeller (legacy)
│
├── lib/                      # EXTERNA BIBLIOTEK
│   ├── nopecha-extension/   # NopeCHA CAPTCHA-lösare
│   ├── captcha-solvers/     # CAPTCHA-verktyg
│   └── browser-automation/  # Browser-verktyg
│
├── scripts/                  # CLI-SCRIPTS
│   ├── poit-purchase-stealth.js  # Stealth protokollköp
│   └── discover-pressrooms.ts    # Pressrum-discovery
│
├── data/                     # LOKAL DATA
│   ├── successful-methods/  # Sparade framgångsrika metoder
│   ├── purchase-logs/       # Köploggar
│   └── purchase_log.json    # Aktuell köphistorik
│
└── backups/                  # AUTOMATISKA BACKUPS
```

---

## OBLIGATORISKA REGLER

### 1. CAPTCHA-LÖSNING (PRIORITERINGSORDNING)

När du stöter på CAPTCHA, använd ALLTID dessa verktyg i denna ordning:

1. **NopeCHA Extension** (`lib/nopecha-extension/`)
   - Automatisk CAPTCHA-lösning via browser extension
   - Gratis 100 req/dag
   - Stödjer reCAPTCHA, hCaptcha, Turnstile

2. **nodriver** (Python: `import nodriver`)
   - Undetected Chrome driver
   - Bättre stealth än puppeteer
   - Använd för svåra sidor

3. **undetected-chromedriver** (Python: `import undetected_chromedriver`)
   - Fallback om nodriver misslyckas
   - Beprövad och stabil

4. **2captcha API** (`src/services/auto_captcha_solver.js`)
   - Betalservice, använd som sista utväg
   - Kräver API-nyckel i .env: `TWOCAPTCHA_API_KEY`

### 2. FEL OCH RETRY

**VÄNTA ALDRIG PÅ MANUELL LÖSNING!**

Vid misslyckande:
1. Försök igen med samma metod (max 3 gånger)
2. Byt till nästa verktyg i prioriteringslistan
3. Prova alternativ approach (annan URL, annat sökord)
4. Spara framgångsrik metod till `data/successful-methods/`

---

## STEG-FÖR-STEG: VANLIGA UPPGIFTER

### A. Köra frontend lokalt

```bash
# Öppna direkt i webbläsare
open docs/index.html

# Eller med lokal server
cd docs && python -m http.server 8080
# Öppna http://localhost:8080
```

### B. Köpa dokument (CLI)

```bash
# Kräver lokal Chrome med NopeCHA-extension
node scripts/poit-purchase-stealth.js 5591628660
```

### C. Testa Budget API

```bash
# Hämta status
curl "https://wzkohritxdrstsmwopco.supabase.co/functions/v1/budget" \
  -H "Authorization: Bearer ANON_KEY"

# Registrera köp
curl -X POST "https://wzkohritxdrstsmwopco.supabase.co/functions/v1/budget/purchase" \
  -H "Authorization: Bearer ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"orgnr":"5591628660","amount_sek":60}'
```

### D. Söka på POIT via Edge Function

```bash
curl -X POST "https://wzkohritxdrstsmwopco.supabase.co/functions/v1/poit-kungorelse" \
  -H "Authorization: Bearer ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"searchType":"orgnr","searchTerm":"5591628660"}'
```

---

## KONFIGURATION

### Miljövariabler (.env)

```bash
# Supabase
SUPABASE_URL=https://wzkohritxdrstsmwopco.supabase.co
SUPABASE_KEY=anon-key-här
SUPABASE_SERVICE_KEY=service-key-här

# CAPTCHA-tjänster (valfritt)
TWOCAPTCHA_API_KEY=din-nyckel-här

# Twilio för SMS (valfritt)
TWILIO_ACCOUNT_SID=din-sid
TWILIO_AUTH_TOKEN=din-token
TWILIO_PHONE_NUMBER=+46xxxxxxxxx

# AI
ANTHROPIC_API_KEY=sk-ant-...
```

### Daglig budget

- Standard: 100 SEK/dag, 500 SEK/månad
- Hanteras via Budget Edge Function
- Kontrollera i dashboarden: `docs/verktyg/dokumentkop/`

---

## FELSÖKNING

### CAPTCHA blockerar

1. Kontrollera att NopeCHA extension är installerad: `lib/nopecha-extension/`
2. Kör med `headless: false` för debugging
3. Vänta 30 sekunder mellan försök
4. Prova nodriver istället för puppeteer

### Edge Function fungerar inte

1. Kontrollera att funktionen är deployad: `supabase functions list`
2. Kolla loggar: `supabase functions logs budget`
3. Verifiera Authorization-header

### Frontend visar fel

1. Öppna DevTools → Console
2. Kontrollera att SUPABASE_URL är korrekt i HTML
3. Verifiera CORS-headers på Edge Functions

---

## VIKTIGA FILER

| Fil | Syfte |
|-----|-------|
| `docs/index.html` | Huvuddashboard |
| `docs/verktyg/dokumentkop/index.html` | Protokollköp med budgetkontroll |
| `supabase/functions/budget/index.ts` | Budget Edge Function |
| `supabase/functions/poit-kungorelse/index.ts` | POIT-proxy |
| `src/scrapers/protokoll-scraper.js` | Lokal protokoll-scraper |
| `scripts/poit-purchase-stealth.js` | Stealth-köp CLI |

---

## CHANGELOG

- **2025-12-19:** Städat projekt, uppdaterat dokumentation
- **2025-12-19:** Implementerat 10 verktyg i dashboard
- **2025-12-19:** Budget Edge Function deployad och testad
- **2024-12-19:** Lade till nodriver, undetected-chromedriver, NopeCHA
- **2024-12-19:** Skapade denna instruktionsfil
