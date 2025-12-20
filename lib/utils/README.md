# Bevakningsverktyget - Web Scraping Utilities

Standardiserade verktyg för all webbskrapning i projektet.

## Installation

Alla beroenden finns redan i `package.json`. Kör:

```bash
npm install
```

## Snabbstart

### Enkel sidinhämtning

```javascript
const { fetchPage } = require('./lib/utils');

const { html, cookies } = await fetchPage('https://example.com');
console.log(html);
```

### Custom scraper

```javascript
const { scrape } = require('./lib/utils');

const data = await scrape('https://breakit.se', async (page) => {
    // Popups är redan hanterade
    return await page.evaluate(() => {
        const articles = [];
        document.querySelectorAll('article').forEach(el => {
            articles.push({
                title: el.querySelector('h2')?.textContent,
                link: el.querySelector('a')?.href
            });
        });
        return articles;
    });
});
```

### Full kontroll

```javascript
const { createBrowser, createPage, navigateAndConfigure, handleCaptcha } = require('./lib/utils');

async function scrapeWithFullControl() {
    const browser = await createBrowser({ headless: true });
    const page = await createPage(browser);

    try {
        // Navigera med automatisk popup-hantering
        await navigateAndConfigure(page, 'https://example.com');

        // Vänta på eventuell CAPTCHA
        await handleCaptcha(page);

        // Gör något
        const title = await page.title();
        console.log('Titel:', title);

        return title;
    } finally {
        await browser.close();
    }
}
```

## Funktioner

### Browser Factory

| Funktion | Beskrivning |
|----------|-------------|
| `createBrowser(options)` | Skapar browser med Stealth + Adblocker |
| `createPage(browser, options)` | Skapar konfigurerad page |
| `navigateAndConfigure(page, url)` | Navigerar och stänger popups |
| `fetchPage(url)` | Hämtar HTML och cookies |
| `scrape(url, scraperFn)` | Kör custom scraper |

### Cookies

| Funktion | Beskrivning |
|----------|-------------|
| `saveCookies(page, filepath)` | Sparar cookies till fil |
| `loadCookies(page, filepath)` | Laddar cookies från fil |
| `exportCookieString(page, domain)` | Exporterar som cookie-sträng |

### CAPTCHA & Popups

| Funktion | Beskrivning |
|----------|-------------|
| `handleCaptcha(page)` | Väntar på CAPTCHA-lösning |
| `dismissAllPopups(page)` | Stänger alla kända popups |
| `injectCookieBlocker(page)` | Injicerar IDCAC-script |
| `watchPopups(page)` | Startar popup-övervakning i bakgrunden |

### Utilities

| Funktion | Beskrivning |
|----------|-------------|
| `humanType(page, selector, text)` | Skriver med mänsklig hastighet |
| `takeScreenshot(page, name)` | Tar skärmdump för debugging |
| `sleep(ms)` | Väntar angivet antal millisekunder |

## Konfiguration

### Browser-alternativ

```javascript
const browser = await createBrowser({
    headless: true,              // Default: true i produktion
    useCaptchaSolver: false,     // Ladda NopeCHA extension (kräver GUI)
    extraArgs: [],               // Extra Chrome-argument
    userDataDir: null            // Custom user data directory
});
```

### Page-alternativ

```javascript
const page = await createPage(browser, {
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 ...',
    extraHeaders: { 'X-Custom': 'value' }
});
```

## Stödda CMP:er (Cookie Consent)

- OneTrust
- Didomi
- Cookiebot
- Quantcast
- Generiska svenska/engelska ("Acceptera", "Godkänn", "Accept", etc.)

## Exempel: Breakit-scraper

```javascript
const { scrape } = require('./lib/utils');

async function scrapeBreakitNews() {
    return await scrape('https://breakit.se', async (page) => {
        return await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.article-card')).map(el => ({
                title: el.querySelector('.title')?.textContent?.trim(),
                summary: el.querySelector('.excerpt')?.textContent?.trim(),
                url: el.querySelector('a')?.href,
                date: el.querySelector('time')?.getAttribute('datetime')
            }));
        });
    });
}
```

## Exempel: Allabolag-scraper med inloggning

```javascript
const { createBrowser, createPage, navigateAndConfigure, saveCookies, loadCookies, humanType } = require('./lib/utils');

async function scrapeAllabolag(orgnr) {
    const browser = await createBrowser({ headless: false }); // GUI för inloggning
    const page = await createPage(browser);

    try {
        // Försök ladda sparade cookies
        const cookiesLoaded = await loadCookies(page, './cookies/allabolag.json');

        await navigateAndConfigure(page, 'https://www.allabolag.se');

        if (!cookiesLoaded) {
            // Logga in
            await humanType(page, '#email', 'user@example.com');
            await humanType(page, '#password', 'password123');
            await page.click('button[type="submit"]');
            await page.waitForNavigation();

            // Spara cookies för nästa gång
            await saveCookies(page, './cookies/allabolag.json');
        }

        // Sök efter företag
        await navigateAndConfigure(page, `https://www.allabolag.se/${orgnr}`);

        return await page.evaluate(() => {
            return {
                name: document.querySelector('h1')?.textContent,
                revenue: document.querySelector('.revenue')?.textContent
            };
        });
    } finally {
        await browser.close();
    }
}
```

## Felsökning

### CAPTCHA blockerar

1. Kör med `headless: false` för att se vad som händer
2. Använd `useCaptchaSolver: true` och NopeCHA-extension
3. Lägg till fördröjningar mellan requests

### Popups stängs inte

1. Kör `dismissAllPopups(page, { verbose: true })` för logging
2. Lägg till custom selectors i `popup-blocker.js`
3. Använd `watchPopups(page)` för kontinuerlig övervakning

### Bot-detection

1. Stealth-plugin är aktiverad som standard
2. Använd `humanType()` istället för `page.type()`
3. Lägg till slumpmässiga pauser mellan actions
