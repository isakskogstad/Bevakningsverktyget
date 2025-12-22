# Bevakningsverktyget - Lib

Centraliserad biblioteksstruktur för alla moduler, scrapers och verktyg.

## 🎯 Kodkonsolidering (December 2024)

**Alla implementationer finns nu i `lib/`-mappen.** Tidigare duplicerad kod i `src/` har ersatts med re-exports för bakåtkompatibilitet.

- ✅ **Utils**: `lib/utils/browser-factory.js`, `lib/utils/popup-blocker.js`
- ✅ **Scrapers**: `lib/scrapers/allabolag-scraper.js`, `lib/scrapers/poit-scraper.js`, `lib/scrapers/bonnier-news-scraper.js`
- 🔁 **Re-exports**: `src/utils/*` och `src/scrapers/index.js` pekar till `lib/` för bakåtkompatibilitet

**Ny kod bör alltid importera från `lib/` direkt.**

## Mappstruktur

```
lib/
├── api/                    # API-endpoints (FastAPI)
│   └── api.py              # Loop Company Data API (40+ endpoints)
│
├── scrapers/               # Webbskrapare
│   ├── bolagsverket_vdm.py     # ⭐ Bolagsverket VDM API (officiell)
│   ├── bolagsverket-navigator.js # Dokumentnavigator
│   ├── protokoll-scraper.js    # ⭐ Protokollhämtare med köp
│   ├── poit-scraper.js         # POIT-kungörelser
│   ├── allabolag-scraper.js    # Allabolag.se (JS)
│   ├── allabolag.py            # Allabolag.se (Python)
│   └── bonnier-news-scraper.js # Nyhetsskrapare
│
├── parsers/                # Dokumentparsers
│   ├── xbrl.ts                 # ⭐ XBRL TypeScript-typer (Zod)
│   ├── pdf_parser.js           # ⭐ PDF-extraktion
│   └── comprehensive_analysis.py # XBRL-analysverktyg
│
├── monitors/               # Övervakare
│   └── poit_monitor.py         # ⭐ POIT-kungörelseövervakning
│
├── generators/             # Innehållsgeneratorer
│   └── news_article_generator_v2.js # ⭐ AI-nyhetsgenerator (Claude)
│
├── captcha/                # CAPTCHA-lösare
│   └── auto_captcha_solver.js  # Automatisk CAPTCHA-hantering
│
├── services/               # Tjänster
│   ├── twilio/
│   │   └── twilio_sms_node.js  # SMS via Twilio
│   ├── budget/
│   │   └── budget_manager.js   # Budgethantering för köp
│   └── purchase_logger.js      # Köploggning
│
├── utils/                  # Verktyg
│   ├── browser-factory.js      # ⭐ Browser-hantering (Puppeteer)
│   ├── popup-blocker.js        # ⭐ Cookie/popup-blockering
│   └── index.js                # Export av alla utils
│
├── agents/                 # AI-agenter
├── charts/                 # Diagramgenerering
├── formatting/             # Textformatering
├── images/                 # Bildanalys
└── references/             # Citathantering
```

## Prioriterade moduler (⭐)

| Modul | Beskrivning | Status |
|-------|-------------|--------|
| `scrapers/bolagsverket_vdm.py` | Officiell VDM API-klient | ✅ Redo |
| `scrapers/protokoll-scraper.js` | Protokollköp med autentisering | ✅ Redo |
| `parsers/xbrl.ts` | XBRL-typer för årsredovisningar | ✅ Redo |
| `parsers/pdf_parser.js` | PDF-textextraktion | ✅ Redo |
| `monitors/poit_monitor.py` | Kungörelseövervakning | ✅ Redo |
| `generators/news_article_generator_v2.js` | AI-artikelgenerering | ✅ Redo |
| `utils/browser-factory.js` | Standardiserad webbskrapning | ✅ Redo |

## Användning

### Webbskrapning (Standard)

```javascript
const { fetchPage, scrape } = require('./utils');

// Enkel sidinhämtning
const { html } = await fetchPage('https://example.com');

// Custom scraper
const data = await scrape('https://allabolag.se/5566443322', async (page) => {
    return await page.evaluate(() => ({
        name: document.querySelector('h1')?.textContent,
        revenue: document.querySelector('.revenue')?.textContent
    }));
});
```

### Bolagsverket VDM

```python
from lib.scrapers.bolagsverket_vdm import BolagsverketVDMClient

client = BolagsverketVDMClient()
xbrl_data = await client.get_annual_report('5566443322')
```

### POIT-övervakning

```python
from lib.monitors.poit_monitor import POITMonitor

monitor = POITMonitor(watchlist=['5566443322', '5599887766'])
new_announcements = await monitor.check_today()
```

### Nyhetsartikelgenerering

```javascript
const NewsGenerator = require('./generators/news_article_generator_v2');

const generator = new NewsGenerator();
const article = await generator.generate({
    orgnr: '5566443322',
    articleType: 'vd_byte',
    tone: 'neutral'
});
```

## Beroenden

### JavaScript/Node.js
- puppeteer-extra (webbskrapning)
- puppeteer-extra-plugin-stealth (bot-undvikande)
- puppeteer-extra-plugin-adblocker (popup-blockering)
- @supabase/supabase-js (databas)
- @anthropic-ai/sdk (Claude API)
- pdf-parse (PDF-extraktion)
- resend (email)

### Python
- httpx (async HTTP)
- requests (sync HTTP)
- playwright (webbskrapning)
- supabase (databas)
- fastapi (API)
- beautifulsoup4 (HTML-parsing)

### TypeScript
- zod (schema-validering)

## Filnamnskonventioner

- **Python**: `snake_case.py` (t.ex. `poit_monitor.py`)
- **JavaScript**: `kebab-case.js` (t.ex. `browser-factory.js`)
- **TypeScript**: `camelCase.ts` (t.ex. `chartGenerator.ts`)

## Utveckling

### Lägga till ny scraper

1. Skapa fil i `lib/scrapers/`
2. Importera `browser-factory` för standard-browser
3. Använd `popup-blocker` för cookie-hantering
4. Exportera funktioner via `module.exports` / `export`
5. Lägg till i denna README

### Testa

```bash
# JavaScript
npm test

# Python
pytest tests/
```
