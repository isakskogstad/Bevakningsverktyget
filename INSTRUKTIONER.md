# BEVAKNINGSVERKTYG - INSTRUKTIONER

## ÖVERSIKT

Detta är ett verktyg för att bevaka svenska företag, köpa dokument från Bolagsverket,
och generera nyhetsartiklar baserat på företagshändelser.

---

## OBLIGATORISKA REGLER

### 1. CAPTCHA-LÖSNING (PRIORITERINGSORDNING)

När du stöter på CAPTCHA, använd ALLTID dessa verktyg i denna ordning:

1. **NopeCHA Extension** (`lib/nopecha-extension/`)
   - Automatisk CAPTCHA-lösning via browser extension
   - Gratis, snabbast
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

### 2. BROWSER AUTOMATION

**ALLTID** använd stealth-verktyg när du navigerar online:

```javascript
// JavaScript - Puppeteer Extra med Stealth
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
```

```python
# Python - nodriver (föredras)
import nodriver as uc
browser = await uc.start()

# Python - undetected-chromedriver (fallback)
import undetected_chromedriver as uc
driver = uc.Chrome()
```

### 3. FEL OCH RETRY

**VÄNTA ALDRIG PÅ MANUELL LÖSNING!**

Vid misslyckande:
1. Försök igen med samma metod (max 3 gånger)
2. Byt till nästa verktyg i prioriteringslistan
3. Prova alternativ approach (annan URL, annat sökord)
4. Spara framgångsrik metod till `data/successful-methods/`

### 4. SPARA FRAMGÅNGSRIKA METODER

När något fungerar, spara det:

```javascript
// Exempel på att spara lyckad metod
const method = {
    date: new Date().toISOString(),
    site: 'foretagsinfo.bolagsverket.se',
    action: 'bypass_captcha',
    tool: 'nodriver',
    config: { headless: false, timeout: 30000 },
    success: true
};
fs.writeFileSync('data/successful-methods/[site]-[action].json', JSON.stringify(method, null, 2));
```

---

## MAPPSTRUKTUR

```
bevakningsverktyg/
├── INSTRUKTIONER.md          # Denna fil - LÄS ALLTID FÖRST!
├── PROJECT.md                # Projektöversikt
├── .env.example              # Miljövariabler (kopiera till .env)
│
├── verktyg-dashboard/        # DASHBOARD-VERKTYG
│   ├── 01-nyhetsredaktion/   # Generera nyhetsartiklar
│   ├── 02-bolagsbevakning/   # Bevaka företagsändringar
│   ├── 03-dokumentkop/       # Köp dokument från Bolagsverket
│   ├── 04-poit-sokning/      # Sök kungörelser på POIT
│   └── 05-budget-hantering/  # Hantera daglig budget
│
├── admin-verktyg/            # ADMIN-VERKTYG
│   ├── 01-billing/           # Betalningshantering
│   ├── 02-api-nycklar/       # API-nyckelhantering
│   ├── 03-loggverktyg/       # Köploggar och aktivitet
│   ├── 04-backup/            # Backup-rutiner
│   └── 05-systemstatus/      # Hälsokontroller
│
├── lib/                      # EXTERNA BIBLIOTEK
│   ├── nopecha-extension/    # NopeCHA CAPTCHA-lösare
│   ├── captcha-solvers/      # CAPTCHA-verktyg
│   └── browser-automation/   # Browser-verktyg
│
├── src/                      # KÄLLKOD
│   ├── scrapers/             # Web scrapers
│   │   ├── bolagsverket-navigator.js
│   │   ├── poit-scraper.js
│   │   └── protokoll-scraper.js
│   ├── services/             # Tjänster
│   │   ├── auto_captcha_solver.js
│   │   ├── pdf_parser.js
│   │   ├── news_article_generator.js
│   │   ├── purchase_logger.js
│   │   └── twilio_sms_node.js
│   ├── dashboard/            # Dashboard-server
│   └── api/                  # API-routes
│
├── data/                     # DATA
│   ├── successful-methods/   # Sparade framgångsrika metoder
│   └── purchase-logs/        # Köploggar
│
├── scripts/                  # STANDALONE SCRIPTS
│   └── poit-purchase-stealth.js
│
├── dashboard/                # SEPARAT DASHBOARD
│   ├── server.js
│   └── public/
│
└── backups/                  # BACKUPS
```

---

## STEG-FÖR-STEG: VANLIGA UPPGIFTER

### A. Navigera på Bolagsverket

```javascript
// 1. Importera verktyg
const { createBrowser, navigateWithRetry } = require('./src/scrapers/bolagsverket-navigator');

// 2. Skapa browser med stealth
const { browser, page } = await createBrowser(false); // headless=false för debugging

// 3. Navigera med automatisk CAPTCHA-hantering
await navigateWithRetry(page, 'https://foretagsinfo.bolagsverket.se/sok-foretagsinformation-web/foretag', {
    maxRetries: 5,
    captchaHandler: true
});

// 4. Sök företag
await page.type('#orgnr', '5591628660');
await page.click('button[type="submit"]');
```

### B. Köpa dokument

```javascript
// 1. Använd protokoll-scraper
const { purchaseProtokoll } = require('./src/scrapers/protokoll-scraper');

// 2. Köp med budgetkontroll
const result = await purchaseProtokoll({
    orgnr: '5591628660',
    documentType: 'PROT',
    maxPrice: 50 // SEK
});

// 3. 3D Secure hanteras automatiskt via Twilio SMS
```

### C. Söka på POIT

```javascript
// 1. Använd poit-scraper
const { searchPOIT } = require('./src/scrapers/poit-scraper');

// 2. Sök kungörelser
const results = await searchPOIT({
    orgnr: '5591628660',
    dateFrom: '2024-01-01'
});
```

### D. Generera nyhetsartikel

```javascript
// 1. Använd news generator
const { generateArticle } = require('./src/services/news_article_generator');

// 2. Generera artikel från PDF
const article = await generateArticle({
    pdfPath: './output/protokoll_5591628660.pdf',
    style: 'di' // Dagens Industri stil
});
```

---

## KONFIGURATION

### Miljövariabler (.env)

```bash
# CAPTCHA-tjänster
TWOCAPTCHA_API_KEY=din-nyckel-här
ANTICAPTCHA_API_KEY=din-nyckel-här

# Twilio för 3D Secure SMS
TWILIO_ACCOUNT_SID=din-sid
TWILIO_AUTH_TOKEN=din-token
TWILIO_PHONE_NUMBER=+46xxxxxxxxx

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=din-nyckel

# Budget
DAILY_BUDGET_SEK=100
```

### Daglig budget

- Standard: 100 SEK/dag
- Spåras i `data/purchase-logs/`
- Använd `src/services/budget_manager.js` för kontroll

---

## FELSÖKNING

### CAPTCHA blockerar

1. Kontrollera att NopeCHA extension är installerad: `lib/nopecha-extension/`
2. Prova nodriver istället för puppeteer
3. Vänta 30 sekunder mellan försök
4. Byt IP (VPN) om möjligt

### Sida laddar inte

1. Öka timeout: `page.setDefaultTimeout(60000)`
2. Vänta på rätt selector: `await page.waitForSelector('#orgnr', { timeout: 30000 })`
3. Ta skärmdump för debugging: `await page.screenshot({ path: '/tmp/debug.png' })`

### 3D Secure misslyckas

1. Kontrollera Twilio-konfiguration
2. Verifiera att telefonnummer är korrekt
3. Se loggar i `data/purchase-logs/`

---

## VIKTIGA FILER

| Fil | Syfte |
|-----|-------|
| `src/services/auto_captcha_solver.js` | Automatisk CAPTCHA-lösning |
| `src/scrapers/bolagsverket-navigator.js` | Navigering på Bolagsverket |
| `src/scrapers/protokoll-scraper.js` | Köp av protokoll med betalning |
| `src/scrapers/poit-scraper.js` | Sökning på POIT |
| `src/services/pdf_parser.js` | PDF-analys med Claude |
| `src/services/news_article_generator.js` | Generera nyhetsartiklar |
| `src/services/purchase_logger.js` | Logga köp |
| `src/services/twilio_sms_node.js` | SMS för 3D Secure |

---

## CHANGELOG

- 2024-12-19: Lade till nodriver, undetected-chromedriver, NopeCHA
- 2024-12-19: Skapade mappstruktur för verktyg och admin
- 2024-12-19: Skapade denna instruktionsfil
