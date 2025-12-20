/**
 * Ratsit.se Income Scraper - Hämtar inkomstdeklarationer
 *
 * Använder befintlig browser-factory för:
 * - Stealth-mode mot bot-detection
 * - Cookie-hantering
 * - CAPTCHA-hantering via NopeCHA
 *
 * Features:
 * - Inloggning med företagskonto (för automatisk debitering)
 * - Sökning på personnummer eller namn
 * - Extraktion av inkomstdata (förvärvsinkomst, kapitalinkomst, skatt)
 * - Session-cache via cookies
 *
 * Usage:
 *   const { RatsitIncomeScraper, getPersonIncome } = require('./ratsit-income-scraper');
 *
 *   // Enkel användning
 *   const income = await getPersonIncome('Anna Andersson', { location: 'Stockholm' });
 *
 *   // Avancerad användning
 *   const scraper = new RatsitIncomeScraper();
 *   await scraper.init();
 *   const results = await scraper.searchPerson('Erik Eriksson');
 *   const income = await scraper.getIncomeFromProfile(results[0].profileUrl);
 *   await scraper.close();
 *
 * @module ratsit-income-scraper
 */

const {
    createBrowser,
    createPage,
    configurePage,
    navigateAndConfigure,
    saveCookies,
    loadCookies,
    handleCaptcha,
    dismissAllPopups,
    humanType,
    takeScreenshot,
    sleep
} = require('../utils/browser-factory');

const path = require('path');
const fs = require('fs');

// ============================================
// SUPABASE INTEGRATION
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

/**
 * Spara inkomstdata till Supabase via Edge Function
 * @param {Object} incomeData - Inkomstdata att spara
 * @returns {Promise<Object>} Resultat från Edge Function
 */
async function saveToSupabase(incomeData) {
    if (!SUPABASE_URL) {
        console.error('[RatsitScraper] SUPABASE_URL ej konfigurerad - data sparas inte');
        return { success: false, error: 'Supabase not configured' };
    }

    const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/ratsit-income`;

    try {
        const response = await fetch(edgeFunctionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'apikey': SUPABASE_KEY
            },
            body: JSON.stringify({
                action: 'save',
                data: {
                    name: incomeData.name,
                    personnummer: incomeData.personnummer,
                    address: incomeData.address,
                    age: incomeData.age,
                    birth_year: incomeData.birthYear,
                    taxable_income: incomeData.taxableIncome,
                    capital_income: incomeData.capitalIncome,
                    total_tax: incomeData.totalTax,
                    final_tax: incomeData.finalTax,
                    income_year: incomeData.incomeYear,
                    profile_url: incomeData.profileUrl,
                    properties: incomeData.properties,
                    vehicles: incomeData.vehicles,
                    scraped_at: incomeData.scrapedAt
                }
            })
        });

        const result = await response.json();

        if (result.success) {
            console.error('[RatsitScraper] ✅ Data sparad till Supabase');
        } else {
            console.error('[RatsitScraper] Kunde inte spara till Supabase:', result.error);
        }

        return result;
    } catch (error) {
        console.error('[RatsitScraper] Fel vid sparning till Supabase:', error.message);
        return { success: false, error: error.message };
    }
}

// ============================================
// KONFIGURATION
// ============================================

const CONFIG = {
    BASE_URL: 'https://www.ratsit.se',
    LOGIN_URL: 'https://www.ratsit.se/logga-in',
    SEARCH_URL: 'https://www.ratsit.se/sok/person',

    // Sökvägar
    COOKIE_PATH: path.join(__dirname, '../../data/ratsit-cookies.json'),
    SCREENSHOT_DIR: path.join(__dirname, '../../data/screenshots'),

    // Timeouts
    TIMEOUT: 30000,
    LOGIN_WAIT: 5000,
    PAGE_LOAD_WAIT: 3000,

    // Rate limiting
    MIN_DELAY_MS: 2000,
};

// Säkerställ att directories finns
const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};
ensureDir(path.dirname(CONFIG.COOKIE_PATH));
ensureDir(CONFIG.SCREENSHOT_DIR);

// ============================================
// RATSIT INCOME SCRAPER CLASS
// ============================================

class RatsitIncomeScraper {
    /**
     * @param {Object} options - Konfiguration
     * @param {string} options.email - Ratsit-kontots e-post (fallback: RATSIT_EMAIL env)
     * @param {string} options.password - Ratsit-kontots lösenord (fallback: RATSIT_PASSWORD env)
     * @param {boolean} options.headless - Kör headless (default: true)
     * @param {boolean} options.useCaptchaSolver - Använd NopeCHA CAPTCHA-solver (default: false)
     * @param {boolean} options.saveScreenshots - Spara skärmdumpar för debug (default: false)
     * @param {boolean} options.noProxy - Inaktivera proxy (default: false)
     */
    constructor(options = {}) {
        this.email = options.email || process.env.RATSIT_EMAIL;
        this.password = options.password || process.env.RATSIT_PASSWORD;
        this.noProxy = options.noProxy ?? (process.env.NO_PROXY_SCRAPER === 'true');
        this.headless = options.headless ?? (process.env.HEADLESS !== 'false');
        this.useCaptchaSolver = options.useCaptchaSolver ?? false;
        this.saveScreenshots = options.saveScreenshots ?? false;

        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
        this.lastRequest = 0;
    }

    /**
     * Logga meddelande med prefix
     */
    log(message, level = 'info') {
        const prefix = '[RatsitScraper]';
        const timestamp = new Date().toISOString().substring(11, 19);
        if (level === 'error') {
            console.error(`${prefix} ${timestamp} ERROR: ${message}`);
        } else {
            console.error(`${prefix} ${timestamp} ${message}`);
        }
    }

    /**
     * Rate limiting - vänta mellan requests
     */
    async rateLimit() {
        const now = Date.now();
        const elapsed = now - this.lastRequest;

        if (elapsed < CONFIG.MIN_DELAY_MS) {
            await sleep(CONFIG.MIN_DELAY_MS - elapsed);
        }

        this.lastRequest = Date.now();
    }

    /**
     * Ta skärmdump för debugging
     */
    async screenshot(name) {
        if (!this.saveScreenshots || !this.page) return null;

        try {
            return await takeScreenshot(this.page, `ratsit-${name}`, CONFIG.SCREENSHOT_DIR);
        } catch (e) {
            this.log(`Kunde inte ta skärmdump: ${e.message}`, 'error');
            return null;
        }
    }

    /**
     * Initiera browser och ladda session
     * @returns {Promise<boolean>} True om redo
     */
    async init() {
        this.log('Startar browser...');

        // Temporärt inaktivera proxy om noProxy är satt
        const savedProxy = {};
        if (this.noProxy) {
            ['https_proxy', 'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY'].forEach(key => {
                if (process.env[key]) {
                    savedProxy[key] = process.env[key];
                    delete process.env[key];
                }
            });
            this.log('Proxy inaktiverad för denna session');
        }

        try {
            // Skapa browser med browser-factory
            this.browser = await createBrowser({
                headless: this.headless,
                useCaptchaSolver: this.useCaptchaSolver
            });

            // Skapa och konfigurera page
            this.page = await createPage(this.browser, { useProxy: !this.noProxy });
        } finally {
            // Återställ proxy-variabler
            Object.entries(savedProxy).forEach(([key, value]) => {
                process.env[key] = value;
            });
        }

        // Försök ladda sparade cookies
        const cookiesLoaded = await loadCookies(this.page, CONFIG.COOKIE_PATH);

        if (cookiesLoaded) {
            this.log('Cookies laddade, verifierar session...');

            // Verifiera att session fortfarande är giltig
            if (await this.verifySession()) {
                this.log('✅ Session giltig - redan inloggad');
                this.isLoggedIn = true;
                return true;
            }

            this.log('Session ogiltig, behöver logga in igen');
        }

        // Logga in
        if (this.email && this.password) {
            this.log('🔐 Loggar in...');
            await this.login();
        } else {
            this.log('Varning: Inga inloggningsuppgifter - begränsad funktionalitet', 'error');
        }

        return true;
    }

    /**
     * Verifiera om session är aktiv
     * @returns {Promise<boolean>}
     */
    async verifySession() {
        try {
            await this.page.goto(CONFIG.BASE_URL, {
                timeout: CONFIG.TIMEOUT,
                waitUntil: 'networkidle2'
            });

            await sleep(2000);
            await dismissAllPopups(this.page);

            // Kolla efter inloggningsindikatorer
            const isLoggedIn = await this.page.evaluate(() => {
                const html = document.body.innerHTML.toLowerCase();
                const loggedInIndicators = ['logga ut', 'mitt konto', 'min sida', 'mina sökningar'];
                return loggedInIndicators.some(indicator => html.includes(indicator));
            });

            return isLoggedIn;
        } catch (e) {
            this.log(`Session-verifiering misslyckades: ${e.message}`, 'error');
            return false;
        }
    }

    /**
     * Logga in på Ratsit
     */
    async login() {
        try {
            await this.page.goto(CONFIG.LOGIN_URL, {
                timeout: CONFIG.TIMEOUT,
                waitUntil: 'networkidle2'
            });

            await sleep(2000);
            await dismissAllPopups(this.page);
            await this.screenshot('login-page');

            // Hitta email-fält
            const emailSelectors = [
                'input[type="email"]',
                'input[name="email"]',
                'input[id*="email"]',
                'input[placeholder*="post"]',
                'input[placeholder*="mail"]',
                'input[autocomplete="email"]'
            ];

            let emailInput = null;
            for (const selector of emailSelectors) {
                emailInput = await this.page.$(selector);
                if (emailInput) break;
            }

            if (!emailInput) {
                await this.screenshot('no-email-field');
                throw new Error('Kunde inte hitta email-fält på inloggningssidan');
            }

            // Fyll i email med mänsklig hastighet
            await emailInput.click();
            await sleep(300);
            await emailInput.type(this.email, { delay: 50 + Math.random() * 50 });

            // Hitta lösenordsfält
            const passwordInput = await this.page.$('input[type="password"]');
            if (!passwordInput) {
                await this.screenshot('no-password-field');
                throw new Error('Kunde inte hitta lösenords-fält');
            }

            // Fyll i lösenord
            await passwordInput.click();
            await sleep(300);
            await passwordInput.type(this.password, { delay: 50 + Math.random() * 50 });

            // Hitta och klicka på login-knapp
            const loginButtonSelectors = [
                'button[type="submit"]',
                'input[type="submit"]',
                'button:has-text("Logga in")',
                '[data-testid="login-button"]'
            ];

            let loginClicked = false;
            for (const selector of loginButtonSelectors) {
                try {
                    const btn = await this.page.$(selector);
                    if (btn) {
                        await btn.click();
                        loginClicked = true;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!loginClicked) {
                // Fallback: tryck Enter
                await this.page.keyboard.press('Enter');
            }

            // Vänta på inloggning
            await sleep(CONFIG.LOGIN_WAIT);
            await this.screenshot('after-login');

            // Hantera eventuell CAPTCHA
            const hasCaptcha = await this.page.evaluate(() => {
                const html = document.body.innerHTML.toLowerCase();
                return html.includes('captcha') ||
                       html.includes('recaptcha') ||
                       html.includes('hcaptcha') ||
                       document.querySelector('iframe[src*="captcha"]') !== null;
            });

            if (hasCaptcha) {
                this.log('CAPTCHA detekterad, väntar på lösning...');
                const captchaResolved = await handleCaptcha(this.page, 30000);

                if (!captchaResolved) {
                    throw new Error('CAPTCHA kunde inte lösas - kör med --visible och useCaptchaSolver');
                }

                await sleep(3000);
            }

            // Verifiera inloggning
            if (!await this.verifySession()) {
                await this.screenshot('login-failed');

                // Kolla efter felmeddelanden
                const errorMessage = await this.page.evaluate(() => {
                    const errorSelectors = ['.error', '.alert-danger', '[role="alert"]', '.message-error'];
                    for (const sel of errorSelectors) {
                        const el = document.querySelector(sel);
                        if (el && el.textContent.trim()) {
                            return el.textContent.trim();
                        }
                    }
                    return null;
                });

                throw new Error(`Inloggning misslyckades${errorMessage ? ': ' + errorMessage : ''}`);
            }

            // Spara cookies för framtida sessioner
            await saveCookies(this.page, CONFIG.COOKIE_PATH, 'ratsit.se');
            this.isLoggedIn = true;
            this.log('✅ Inloggning lyckades');

        } catch (e) {
            this.log(`Inloggningsfel: ${e.message}`, 'error');
            throw e;
        }
    }

    /**
     * Sök efter person
     * @param {string} name - Namn att söka efter
     * @param {string} location - Ort (optional)
     * @returns {Promise<Array>} Lista med sökresultat
     */
    async searchPerson(name, location = '') {
        await this.rateLimit();

        this.log(`Söker: ${name}${location ? ' i ' + location : ''}`);

        // Bygg sök-URL
        let searchUrl = `${CONFIG.SEARCH_URL}?vem=${encodeURIComponent(name)}`;
        if (location) {
            searchUrl += `&var=${encodeURIComponent(location)}`;
        }

        await navigateAndConfigure(this.page, searchUrl, {
            timeout: CONFIG.TIMEOUT,
            dismissPopups: true
        });

        await sleep(CONFIG.PAGE_LOAD_WAIT);
        await this.screenshot('search-results');

        // Extrahera sökresultat
        const results = await this.page.evaluate(() => {
            const items = [];

            // Olika selektorer för sökresultat
            const resultSelectors = [
                '.search-result-item',
                '.person-card',
                '[class*="PersonCard"]',
                '[class*="personCard"]',
                '[class*="result-item"]',
                'a[href*="/person/"]'
            ];

            // Hitta alla resultat-element
            let resultElements = [];
            for (const selector of resultSelectors) {
                const els = document.querySelectorAll(selector);
                if (els.length > 0) {
                    resultElements = Array.from(els);
                    break;
                }
            }

            // Om inga resultat hittades, försök med alla länkar till person-sidor
            if (resultElements.length === 0) {
                resultElements = Array.from(document.querySelectorAll('a[href*="/person/"]'));
            }

            for (const el of resultElements) {
                // Hitta profillänk
                const link = el.tagName === 'A' ? el :
                             el.querySelector('a[href*="/person/"]');

                if (!link || !link.href.includes('/person/')) continue;

                const text = el.textContent || '';

                // Extrahera ålder
                const ageMatch = text.match(/(\d+)\s*år/);
                const age = ageMatch ? parseInt(ageMatch[1]) : null;

                // Extrahera adress (efter ålder)
                const addressMatch = text.match(/\d+\s*år[,\s]+([^,\n]+)/);
                const address = addressMatch ? addressMatch[1].trim() : '';

                // Extrahera namn
                const nameEl = el.querySelector('h2, h3, .name, [class*="name"], [class*="Name"]');
                let personName = nameEl ? nameEl.textContent.trim() : '';

                if (!personName) {
                    // Fallback: ta första raden av texten
                    personName = text.split('\n')[0].trim().substring(0, 50);
                }

                // Undvik dubbletter
                if (!items.find(i => i.profileUrl === link.href)) {
                    items.push({
                        name: personName,
                        age,
                        address,
                        profileUrl: link.href
                    });
                }
            }

            return items;
        });

        this.log(`Hittade ${results.length} resultat`);
        return results;
    }

    /**
     * Hämta inkomstdata från en profil-URL
     * @param {string} profileUrl - URL till personprofil
     * @returns {Promise<Object>} Inkomstdata
     */
    async getIncomeFromProfile(profileUrl) {
        await this.rateLimit();

        this.log(`Hämtar inkomst från: ${profileUrl}`);

        // Säkerställ full URL
        if (!profileUrl.startsWith('http')) {
            profileUrl = CONFIG.BASE_URL + profileUrl;
        }

        await navigateAndConfigure(this.page, profileUrl, {
            timeout: CONFIG.TIMEOUT,
            dismissPopups: true
        });

        await sleep(CONFIG.PAGE_LOAD_WAIT);
        await this.screenshot('profile-page');

        // Extrahera inkomstdata
        const incomeData = await this.page.evaluate(() => {
            const text = document.body.innerText;
            const html = document.body.innerHTML;

            /**
             * Extrahera belopp med regex
             */
            const extractAmount = (patterns) => {
                for (const pattern of patterns) {
                    const regex = new RegExp(pattern + '[:\\s]*([\\d\\s]+)(?:\\s*kr|\\s*SEK)?', 'i');
                    const match = text.match(regex);
                    if (match) {
                        return parseInt(match[1].replace(/\s/g, ''));
                    }
                }
                return null;
            };

            /**
             * Extrahera text med regex
             */
            const extractText = (patterns) => {
                for (const pattern of patterns) {
                    const regex = new RegExp(pattern + '[:\\s]+([^\\n]+)', 'i');
                    const match = text.match(regex);
                    if (match) {
                        return match[1].trim();
                    }
                }
                return null;
            };

            // Namn
            const nameEl = document.querySelector('h1, .person-name, [class*="personName"], [class*="PersonName"]');
            const name = nameEl ? nameEl.textContent.trim() : '';

            // Adress
            const address = extractText(['Adress', 'Bostadsadress', 'Folkbokförd']);

            // Ålder och födelseår
            const ageMatch = text.match(/(\d+)\s*år/);
            const birthYearMatch = text.match(/Född[:\s]+(\d{4})/i);

            const age = ageMatch ? parseInt(ageMatch[1]) : null;
            const currentYear = new Date().getFullYear();
            const birthYear = birthYearMatch ?
                parseInt(birthYearMatch[1]) :
                (age ? currentYear - age : null);

            // Personnummer (maskerat)
            const personnummerMatch = text.match(/(\d{6}[-\s]?\d{4}|\d{8}[-\s]?\d{4})/);
            const personnummer = personnummerMatch ? personnummerMatch[1] : null;

            // Inkomster
            const taxableIncome = extractAmount([
                'Förvärvsinkomst',
                'Inkomst av tjänst',
                'Tjänsteinkomst',
                'Taxerad förvärvsinkomst',
                'Sammanräknad förvärvsinkomst'
            ]);

            const capitalIncome = extractAmount([
                'Kapitalinkomst',
                'Inkomst av kapital',
                'Kapital'
            ]);

            // Skatt
            const totalTax = extractAmount([
                'Skatt totalt',
                'Total skatt',
                'Kommunal skatt'
            ]);

            const finalTax = extractAmount([
                'Slutlig skatt',
                'Debiterad slutskatt'
            ]);

            // Inkomstår
            const yearPatterns = [
                /Inkomstår[:\s]+(\d{4})/i,
                /Taxering[:\s]+(\d{4})/i,
                /Inkomst\s+(\d{4})/i
            ];

            let incomeYear = null;
            for (const pattern of yearPatterns) {
                const match = text.match(pattern);
                if (match) {
                    incomeYear = parseInt(match[1]);
                    break;
                }
            }

            // Fastigheter
            const properties = [];
            const propertySection = text.match(/Fastigheter[\s\S]*?(?=Fordon|Inkomst|$)/i);
            if (propertySection) {
                const propertyMatches = propertySection[0].matchAll(/([A-ZÅÄÖ][a-zåäö]+\s+\d+:\d+)[,\s]+([^\n]+)/g);
                for (const match of propertyMatches) {
                    properties.push({
                        designation: match[1],
                        description: match[2].trim()
                    });
                }
            }

            // Fordon
            const vehicles = [];
            const vehicleSection = text.match(/Fordon[\s\S]*?(?=Fastigheter|Inkomst|$)/i);
            if (vehicleSection) {
                const vehicleMatches = vehicleSection[0].matchAll(/([A-Z]{3}\s*\d{2,3}[A-Z]?)[,\s]+([^\n]+)/g);
                for (const match of vehicleMatches) {
                    vehicles.push({
                        registration: match[1].replace(/\s/g, ''),
                        description: match[2].trim()
                    });
                }
            }

            return {
                name,
                address,
                age,
                birthYear,
                personnummer,
                taxableIncome,
                capitalIncome,
                totalTax,
                finalTax,
                incomeYear,
                properties: properties.length > 0 ? properties : undefined,
                vehicles: vehicles.length > 0 ? vehicles : undefined,
                profileUrl: window.location.href,
                scrapedAt: new Date().toISOString()
            };
        });

        // Logga resultat
        if (incomeData.taxableIncome) {
            this.log(`✅ Inkomst hämtad: ${incomeData.name} - ${incomeData.taxableIncome.toLocaleString('sv-SE')} kr`);
        } else {
            this.log(`Ingen inkomstdata hittades för: ${incomeData.name}`);
        }

        return incomeData;
    }

    /**
     * Hämta inkomst för en person baserat på namn
     * @param {string} name - Personens namn
     * @param {Object} options - Sökoptioner
     * @param {string} options.birthYear - Födelseår för filtrering
     * @param {string} options.location - Ort för filtrering
     * @returns {Promise<Object|null>} Inkomstdata eller null
     */
    async getPersonIncome(name, options = {}) {
        const { birthYear = null, location = '' } = options;

        // Sök efter person
        const results = await this.searchPerson(name, location);

        if (results.length === 0) {
            this.log('Inga sökresultat hittades');
            return null;
        }

        // Välj bästa träff
        let target = results[0];

        if (birthYear) {
            const year = parseInt(birthYear);
            const expectedAge = new Date().getFullYear() - year;

            // Filtrera på ungefärlig ålder (±2 år för datumskillnader)
            const filtered = results.filter(r =>
                r.age && Math.abs(r.age - expectedAge) <= 2
            );

            if (filtered.length > 0) {
                target = filtered[0];
                this.log(`Filtrerat till ${filtered.length} resultat baserat på födelseår`);
            }
        }

        if (!target.profileUrl) {
            this.log('Ingen profil-URL tillgänglig', 'error');
            return null;
        }

        // Hämta inkomst
        return await this.getIncomeFromProfile(target.profileUrl);
    }

    /**
     * Stäng browser och rensa resurser
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.isLoggedIn = false;
            this.log('Browser stängd');
        }
    }
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Hämta inkomst för en person (enkel funktion)
 *
 * @param {string} name - Personens namn
 * @param {Object} options - Alternativ
 * @param {string} options.location - Ort
 * @param {string} options.birthYear - Födelseår
 * @param {string} options.email - Ratsit-email
 * @param {string} options.password - Ratsit-lösenord
 * @param {boolean} options.headless - Kör headless
 * @returns {Promise<Object|null>} Inkomstdata
 */
async function getPersonIncome(name, options = {}) {
    const scraper = new RatsitIncomeScraper({
        email: options.email,
        password: options.password,
        headless: options.headless ?? true,
        useCaptchaSolver: options.useCaptchaSolver ?? false,
        saveScreenshots: options.saveScreenshots ?? false
    });

    try {
        await scraper.init();
        return await scraper.getPersonIncome(name, {
            birthYear: options.birthYear,
            location: options.location
        });
    } finally {
        await scraper.close();
    }
}

/**
 * Sök efter personer
 *
 * @param {string} name - Namn att söka efter
 * @param {Object} options - Alternativ
 * @returns {Promise<Array>} Sökresultat
 */
async function searchPerson(name, options = {}) {
    const scraper = new RatsitIncomeScraper({
        email: options.email,
        password: options.password,
        headless: options.headless ?? true
    });

    try {
        await scraper.init();
        return await scraper.searchPerson(name, options.location);
    } finally {
        await scraper.close();
    }
}

// ============================================
// CLI
// ============================================

if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
Ratsit Inkomst Scraper - Hämta inkomstdeklarationer

ANVÄNDNING:
  node ratsit-income-scraper.js <kommando> [argument] [flaggor]

KOMMANDON:
  search <namn>           Sök efter person
  income <namn>           Hämta inkomstuppgifter för person
  profile <url>           Hämta inkomst från specifik profil-URL

FLAGGOR:
  --location=ORT          Filtrera på ort
  --birth-year=YYYY       Filtrera på födelseår
  --save                  Spara resultat till Supabase (kräver SUPABASE_URL)
  --visible               Visa browser-fönstret (för debug/CAPTCHA)
  --screenshots           Spara skärmdumpar för debugging
  --captcha-solver        Aktivera NopeCHA CAPTCHA-solver
  --no-proxy              Inaktivera proxy (vid tunnelproblem)
  --help, -h              Visa denna hjälp

MILJÖVARIABLER:
  RATSIT_EMAIL            E-postadress för Ratsit-konto
  RATSIT_PASSWORD         Lösenord för Ratsit-konto
  SUPABASE_URL            Supabase projekt-URL (för --save)
  SUPABASE_KEY            Supabase API-nyckel (för --save)

EXEMPEL:
  node ratsit-income-scraper.js search "Anna Andersson"
  node ratsit-income-scraper.js search "Erik Eriksson" --location=Stockholm
  node ratsit-income-scraper.js income "Isak Skogstad"
  node ratsit-income-scraper.js income "Anna Andersson" --birth-year=1985
  node ratsit-income-scraper.js profile "https://www.ratsit.se/person/..."
  node ratsit-income-scraper.js income "Test" --visible --screenshots

OUTPUT:
  JSON med inkomstdata:
  {
    "name": "...",
    "address": "...",
    "age": 35,
    "birthYear": 1989,
    "taxableIncome": 450000,
    "capitalIncome": 25000,
    "totalTax": 135000,
    "incomeYear": 2023,
    "profileUrl": "...",
    "scrapedAt": "..."
  }
`);
        process.exit(0);
    }

    // Parse kommando och argument
    const [command, query] = args.filter(a => !a.startsWith('--'));

    // Parse flaggor
    const flags = {};
    args.filter(a => a.startsWith('--')).forEach(arg => {
        const [key, value] = arg.slice(2).split('=');
        flags[key] = value || true;
    });

    // Kör
    (async () => {
        const scraper = new RatsitIncomeScraper({
            headless: !flags.visible,
            useCaptchaSolver: !!flags['captcha-solver'],
            saveScreenshots: !!flags.screenshots,
            noProxy: !!flags['no-proxy']
        });

        try {
            await scraper.init();

            let result;

            switch (command) {
                case 'search':
                    if (!query) {
                        console.error('Fel: Sökterm saknas');
                        process.exit(1);
                    }
                    result = await scraper.searchPerson(query, flags.location);
                    break;

                case 'income':
                    if (!query) {
                        console.error('Fel: Namn saknas');
                        process.exit(1);
                    }
                    result = await scraper.getPersonIncome(query, {
                        birthYear: flags['birth-year'],
                        location: flags.location
                    });
                    break;

                case 'profile':
                    if (!query) {
                        console.error('Fel: URL saknas');
                        process.exit(1);
                    }
                    result = await scraper.getIncomeFromProfile(query);
                    break;

                default:
                    console.error(`Fel: Okänt kommando "${command}"`);
                    console.error('Kör med --help för användning');
                    process.exit(1);
            }

            console.log(JSON.stringify(result, null, 2));

            // Spara till Supabase om --save flaggan är satt
            if (flags.save && result && command !== 'search') {
                await saveToSupabase(result);
            }

        } catch (error) {
            console.error('Fel:', error.message);
            process.exit(1);
        } finally {
            await scraper.close();
        }
    })();
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    RatsitIncomeScraper,
    getPersonIncome,
    searchPerson,
    saveToSupabase,
    CONFIG
};
