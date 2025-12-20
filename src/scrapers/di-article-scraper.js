/**
 * DI.se Article Scraper - Hämtar hela artikelinnehållet från DI.se
 *
 * Använder centraliserade moduler:
 * - browser-factory: Browser-skapande med stealth, adblocker, CAPTCHA-hantering
 * - popup-blocker: Cookie consent, popup-hantering
 * - NopeCHA extension för automatisk CAPTCHA-lösning
 * - Session-cookies för att undvika upprepade inloggningar
 *
 * Usage:
 *   const { DIArticleScraper } = require('./di-article-scraper');
 *   const scraper = new DIArticleScraper();
 *   await scraper.init();
 *   const article = await scraper.scrapeArticle('https://www.di.se/...');
 *   await scraper.close();
 */

const {
    createBrowser,
    createPage,
    configurePage,
    dismissAllPopups: dismissAllPopupsBase,
    handleCaptcha,
    humanType: humanTypeBase,
    saveCookies: saveCookiesBase,
    loadCookies: loadCookiesBase,
    startPopupWatcher,
    sleep
} = require('../utils/browser-factory');
const fs = require('fs');
const path = require('path');

// Projektrot
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Konfiguration
const CONFIG = {
    // Inloggningsuppgifter (kan överskrivas via options eller ENV)
    DEFAULT_EMAIL: process.env.DI_EMAIL || 'isak.skogstad@me.com',
    DEFAULT_PASSWORD: process.env.DI_PASSWORD || 'Wdef3579!',

    // Sökvägar
    COOKIE_PATH: path.join(PROJECT_ROOT, 'data/di-session/cookies.json'),
    SESSION_INFO_PATH: path.join(PROJECT_ROOT, 'data/di-session/session-info.json'),
    NOPECHA_EXTENSION_PATH: path.join(PROJECT_ROOT, 'lib/nopecha-extension'),

    // Timeouts
    LOGIN_TIMEOUT: 60000,
    PAGE_TIMEOUT: 30000,
    TYPING_DELAY_MIN: 50,
    TYPING_DELAY_MAX: 150,

    // Session
    MAX_COOKIE_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 dagar
    VERIFY_INTERVAL_MS: 60 * 60 * 1000, // 1 timme

    // URLs
    LOGIN_URL: 'https://www.di.se/konto/logga-in/',
    BASE_URL: 'https://www.di.se'
};

/**
 * DI.se Article Scraper - Huvudklass
 */
class DIArticleScraper {
    constructor(options = {}) {
        this.credentials = {
            email: options.email || CONFIG.DEFAULT_EMAIL,
            password: options.password || CONFIG.DEFAULT_PASSWORD
        };
        this.cookiePath = options.cookiePath || CONFIG.COOKIE_PATH;
        this.sessionInfoPath = options.sessionInfoPath || CONFIG.SESSION_INFO_PATH;
        this.headless = options.headless ?? true; // Default headless för serverless
        this.browser = null;
        this.page = null;
        this.isInitialized = false;
    }

    /**
     * Initialiserar scrapern - laddar cookies eller loggar in
     */
    async init() {
        console.error('[DI] Initialiserar scraper...');

        // Starta browser med stealth och NopeCHA
        await this.launchBrowser();

        // Försök ladda sparade cookies
        const cookiesLoaded = await this.loadCookies();

        if (cookiesLoaded) {
            console.error('[DI] Cookies laddade, verifierar session...');
            const valid = await this.verifyCookies();

            if (valid) {
                console.error('[DI] ✅ Använder cachad session');
                this.isInitialized = true;
                return true;
            }
            console.error('[DI] Session ogiltig, behöver ny inloggning');
        }

        // Behöver ny inloggning
        console.error('[DI] 🔐 Utför ny inloggning...');
        await this.login();
        this.isInitialized = true;
        return true;
    }

    /**
     * Startar browser med stealth-inställningar via browser-factory
     * NopeCHA extension hanteras av browser-factory om useCaptchaSolver=true
     */
    async launchBrowser() {
        // Använd centraliserad browser-factory
        // useCaptchaSolver=true laddar NopeCHA om tillgänglig (kräver GUI)
        this.browser = await createBrowser({
            headless: this.headless,
            useCaptchaSolver: !this.headless // Endast i GUI-mode
        });

        // Skapa page med browser-factory (hanterar viewport, user-agent, headers)
        this.page = await createPage(this.browser, {
            viewport: { width: 1920, height: 1080 }
        });

        console.error(`[DI] Browser startad (headless: ${this.headless})`);
    }

    /**
     * Loggar in på DI.se
     */
    async login() {
        console.error('[DI] Navigerar till login-sidan...');
        await this.page.goto(CONFIG.LOGIN_URL, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.PAGE_TIMEOUT
        });

        // Starta popup-watcher i bakgrunden
        this.startPopupWatcherInternal();

        // Vänta och hantera eventuella popups som dyker upp
        console.error('[DI] Väntar på att sidan stabiliseras...');
        await this.sleep(2000);
        await this.dismissAllPopups();

        // Vänta på login-formulär
        console.error('[DI] Väntar på login-formulär...');
        await this.page.waitForSelector('input[type="email"], input[name="email"], input[id*="email"]', {
            timeout: CONFIG.LOGIN_TIMEOUT
        });

        // Kolla och stäng popups igen (kan dyka upp sent)
        await this.dismissAllPopups();

        console.error('[DI] Fyller i inloggningsuppgifter...');

        // Hitta och fyll i email-fältet
        const emailSelector = await this.findEmailInput();
        await this.humanType(emailSelector, this.credentials.email);

        // Kort paus - kolla popups
        await this.sleep(500);
        await this.dismissAllPopups();

        // Hitta och fyll i lösenords-fältet
        const passwordSelector = await this.findPasswordInput();
        await this.humanType(passwordSelector, this.credentials.password);

        // Försök kryssa i "Håll mig inloggad" om det finns
        await this.checkRememberMe();

        // Vänta och övervaka CAPTCHA
        console.error('[DI] Övervakar för CAPTCHA (10 sek)...');
        await this.waitForCaptchaResolution(10000);

        // Stäng eventuella popups innan klick
        await this.dismissAllPopups();

        // Klicka login-knappen
        console.error('[DI] Klickar login-knappen...');
        const loginButtonSelector = await this.findLoginButton();
        await this.page.click(loginButtonSelector);

        // Vänta på navigation (lyckad inloggning)
        try {
            await this.page.waitForNavigation({
                waitUntil: 'networkidle2',
                timeout: CONFIG.LOGIN_TIMEOUT
            });
        } catch (e) {
            // Ibland sker ingen navigation, kolla manuellt
            console.error('[DI] Navigation timeout, kontrollerar status...');
        }

        // Vänta och hantera eventuella post-login popups
        await this.sleep(2000);
        await this.dismissAllPopups();

        // Verifiera att inloggning lyckades
        const loggedIn = await this.verifyCookies();

        if (!loggedIn) {
            // Ta skärmdump för debugging
            const screenshotPath = path.join(PROJECT_ROOT, 'data/di-session/login-failed.png');
            await this.page.screenshot({ path: screenshotPath, fullPage: true });
            console.error(`[DI] ❌ Skärmdump sparad: ${screenshotPath}`);
            throw new Error('Inloggning misslyckades - kontrollera skärmdump');
        }

        // Spara cookies
        await this.saveCookies();
        console.error('[DI] ✅ Inloggning lyckades, cookies sparade');

        // Stoppa popup-watcher
        this.stopPopupWatcherInternal();
    }

    /**
     * Startar en bakgrundsloop som övervakar och stänger popups
     * Använder browser-factory's startPopupWatcher
     */
    startPopupWatcherInternal() {
        // Använd browser-factory's popup watcher
        this.popupWatcherStop = startPopupWatcher(this.page, 2000);
    }

    /**
     * Stoppar popup-watcher
     */
    stopPopupWatcherInternal() {
        if (this.popupWatcherStop) {
            this.popupWatcherStop();
            this.popupWatcherStop = null;
        }
    }

    /**
     * Stänger alla kända popup-typer
     * Använder browser-factory's dismissAllPopups
     */
    async dismissAllPopups() {
        await dismissAllPopupsBase(this.page);
    }

    /**
     * Väntar och övervakar CAPTCHA-lösning
     * Använder browser-factory's handleCaptcha
     */
    async waitForCaptchaResolution(maxWaitMs = 10000) {
        return await handleCaptcha(this.page, maxWaitMs);
    }

    /**
     * Hittar email-input med fallback-selectors
     */
    async findEmailInput() {
        const selectors = [
            'input[name="email"]',
            'input[type="email"]',
            'input[id*="email"]',
            'input[placeholder*="e-post"]',
            'input[placeholder*="email"]'
        ];

        for (const selector of selectors) {
            const element = await this.page.$(selector);
            if (element) return selector;
        }

        throw new Error('Kunde inte hitta email-fält');
    }

    /**
     * Hittar lösenords-input med fallback-selectors
     */
    async findPasswordInput() {
        const selectors = [
            'input[name="password"]',
            'input[type="password"]',
            'input[id*="password"]',
            'input[placeholder*="lösenord"]',
            'input[placeholder*="password"]'
        ];

        for (const selector of selectors) {
            const element = await this.page.$(selector);
            if (element) return selector;
        }

        throw new Error('Kunde inte hitta lösenords-fält');
    }

    /**
     * Hittar login-knappen med fallback-selectors
     */
    async findLoginButton() {
        const selectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Logga in")',
            'button.login-button',
            'button[class*="login"]',
            'button[class*="submit"]'
        ];

        for (const selector of selectors) {
            try {
                const element = await this.page.$(selector);
                if (element) return selector;
            } catch (e) {
                // Vissa selectors (som :has-text) fungerar inte alltid
            }
        }

        // Fallback: hitta knapp med "Logga in" text
        const buttons = await this.page.$$('button, input[type="submit"]');
        for (const button of buttons) {
            const text = await button.evaluate(el => el.textContent || el.value || '');
            if (text.toLowerCase().includes('logga in') || text.toLowerCase().includes('login')) {
                return `button:nth-of-type(${buttons.indexOf(button) + 1})`;
            }
        }

        throw new Error('Kunde inte hitta login-knapp');
    }

    /**
     * Försöker kryssa i "Håll mig inloggad"
     */
    async checkRememberMe() {
        const selectors = [
            'input[name="remember-me"]',
            'input[name="rememberMe"]',
            'input[type="checkbox"][id*="remember"]',
            'input[type="checkbox"][class*="remember"]'
        ];

        for (const selector of selectors) {
            try {
                const checkbox = await this.page.$(selector);
                if (checkbox) {
                    const isChecked = await checkbox.evaluate(el => el.checked);
                    if (!isChecked) {
                        await checkbox.click();
                        console.error('[DI] ✓ "Håll mig inloggad" ikryssad');
                    }
                    return;
                }
            } catch (e) {
                // Fortsätt med nästa selector
            }
        }

        console.error('[DI] "Håll mig inloggad"-checkbox hittades inte');
    }

    /**
     * Väntar en given tid
     * Använder browser-factory's sleep
     */
    async sleep(ms) {
        return sleep(ms);
    }

    /**
     * Skriver text med mänsklig hastighet
     * Använder browser-factory's humanType
     */
    async humanType(selector, text) {
        await humanTypeBase(this.page, selector, text, {
            minDelay: CONFIG.TYPING_DELAY_MIN,
            maxDelay: CONFIG.TYPING_DELAY_MAX
        });
    }

    /**
     * Sparar session-cookies till fil
     */
    async saveCookies() {
        const cookies = await this.page.cookies();

        const sessionData = {
            cookies,
            savedAt: Date.now(),
            verifiedAt: Date.now(),
            email: this.credentials.email
        };

        // Säkerställ att mappen finns
        const dir = path.dirname(this.cookiePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(this.cookiePath, JSON.stringify(sessionData, null, 2));

        // Spara session-info separat (utan cookies för säkerhet)
        const sessionInfo = {
            savedAt: sessionData.savedAt,
            verifiedAt: sessionData.verifiedAt,
            email: sessionData.email,
            cookieCount: cookies.length
        };
        fs.writeFileSync(this.sessionInfoPath, JSON.stringify(sessionInfo, null, 2));

        console.error(`[DI] ${cookies.length} cookies sparade`);
    }

    /**
     * Laddar sparade cookies från fil
     */
    async loadCookies() {
        try {
            if (!fs.existsSync(this.cookiePath)) {
                console.error('[DI] Ingen sparad session hittades');
                return false;
            }

            const data = JSON.parse(fs.readFileSync(this.cookiePath, 'utf8'));

            // Kontrollera ålder
            const age = Date.now() - data.savedAt;
            if (age > CONFIG.MAX_COOKIE_AGE_MS) {
                console.error('[DI] Session för gammal, behöver ny inloggning');
                return false;
            }

            // Ladda cookies till sidan
            await this.page.setCookie(...data.cookies);
            console.error(`[DI] ${data.cookies.length} cookies laddade`);

            return true;
        } catch (e) {
            console.error('[DI] Fel vid laddning av cookies:', e.message);
            return false;
        }
    }

    /**
     * Verifierar att sessionen fortfarande är giltig
     */
    async verifyCookies() {
        try {
            // Navigera till DI.se startsida
            await this.page.goto(CONFIG.BASE_URL, {
                waitUntil: 'networkidle2',
                timeout: CONFIG.PAGE_TIMEOUT
            });

            // Kolla om inloggningsknapp finns (= ej inloggad)
            const isLoggedIn = await this.page.evaluate(() => {
                // Om "Logga in"-länk finns är vi ej inloggade
                const loginLink = document.querySelector('a[href*="logga-in"], a[href*="login"]');
                const userMenu = document.querySelector('[class*="user"], [class*="account"], [class*="profile"]');

                // Om user menu finns eller ingen login-länk = inloggad
                if (userMenu) return true;
                if (loginLink) return false;

                // Fallback: kolla cookies
                return document.cookie.includes('di_session') ||
                       document.cookie.includes('auth') ||
                       document.cookie.includes('user');
            });

            if (isLoggedIn) {
                // Uppdatera verifierad-tid
                this.updateSessionVerified();
            }

            return isLoggedIn;
        } catch (e) {
            console.error('[DI] Fel vid verifiering:', e.message);
            return false;
        }
    }

    /**
     * Uppdaterar session-info med ny verifierad-tid
     */
    updateSessionVerified() {
        try {
            if (fs.existsSync(this.sessionInfoPath)) {
                const info = JSON.parse(fs.readFileSync(this.sessionInfoPath, 'utf8'));
                info.verifiedAt = Date.now();
                fs.writeFileSync(this.sessionInfoPath, JSON.stringify(info, null, 2));
            }
        } catch (e) {
            // Ignorera fel
        }
    }

    /**
     * Hämtar och extraherar artikel från URL
     */
    async scrapeArticle(url) {
        if (!this.isInitialized) {
            throw new Error('Scraper ej initialiserad. Kör init() först.');
        }

        console.error(`[DI] Hämtar artikel: ${url}`);

        await this.page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.PAGE_TIMEOUT
        });

        // Kolla om artikeln är låst
        const isLocked = await this.page.evaluate(() => {
            const article = document.querySelector('article');
            if (article && article.dataset.accessRestriction === 'Locked') {
                return true;
            }
            // Kolla efter paywall-element
            const paywall = document.querySelector('[class*="paywall"], [class*="locked"]');
            return !!paywall;
        });

        if (isLocked) {
            console.error('[DI] ⚠️  Artikel låst, försöker logga in igen...');
            await this.login();
            await this.page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: CONFIG.PAGE_TIMEOUT
            });
        }

        // Extrahera innehåll
        return await this.extractContent(url);
    }

    /**
     * Extraherar artikelinnehåll från sidan
     */
    async extractContent(url) {
        const article = await this.page.evaluate(() => {
            const getText = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.textContent.trim() : null;
            };

            const getHtml = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.innerHTML : null;
            };

            const getAttr = (selector, attr) => {
                const el = document.querySelector(selector);
                return el ? el.getAttribute(attr) : null;
            };

            // Titel - flera möjliga selectors
            const title = getText('h1.article__headline') ||
                         getText('h1[class*="headline"]') ||
                         getText('article h1') ||
                         getText('h1');

            // Lead/ingress
            const lead = getText('.article__lead') ||
                        getText('[class*="lead"]') ||
                        getText('.preamble') ||
                        getText('article p:first-of-type');

            // Brödtext - full artikel
            const bodyElement = document.querySelector('.article__body') ||
                               document.querySelector('[class*="article-body"]') ||
                               document.querySelector('article .content') ||
                               document.querySelector('article');

            let body = null;
            let bodyText = null;

            if (bodyElement) {
                body = bodyElement.innerHTML;
                bodyText = bodyElement.textContent.replace(/\s+/g, ' ').trim();
            }

            // Författare
            const author = getText('.byline__author') ||
                          getText('[class*="author"]') ||
                          getText('.byline');

            // Publiceringstid
            const publishedAt = getAttr('time.publication__time', 'datetime') ||
                               getAttr('time[datetime]', 'datetime') ||
                               getAttr('[class*="publish"]', 'datetime');

            // Uppdateringstid
            const updatedAt = getAttr('time.update__time', 'datetime') ||
                             getAttr('[class*="update"] time', 'datetime');

            // Bilder
            const images = Array.from(document.querySelectorAll('article img'))
                .map(img => ({
                    src: img.src,
                    alt: img.alt || '',
                    width: img.naturalWidth,
                    height: img.naturalHeight
                }))
                .filter(img => img.src && !img.src.includes('data:'));

            // Taggar
            const tags = Array.from(document.querySelectorAll('[class*="tag"] a, [data-tags] a'))
                .map(a => a.textContent.trim())
                .filter(Boolean);

            return {
                title,
                lead,
                body,
                bodyText,
                author,
                publishedAt,
                updatedAt,
                images,
                tags,
                url: window.location.href,
                scrapedAt: new Date().toISOString()
            };
        });

        // Validera att vi fick innehåll
        if (!article.title && !article.bodyText) {
            console.error('[DI] ⚠️  Kunde inte extrahera artikelinnehåll');

            // Ta skärmdump för debugging
            const screenshotPath = path.join(PROJECT_ROOT, 'data/di-session/extract-failed.png');
            await this.page.screenshot({ path: screenshotPath, fullPage: true });
            console.error(`[DI] Skärmdump sparad: ${screenshotPath}`);
        }

        article.url = url;
        console.error(`[DI] ✅ Artikel extraherad: "${article.title?.substring(0, 50)}..."`);

        return article;
    }

    /**
     * Stänger browser och rensar resurser
     */
    async close() {
        // Stoppa popup-watcher först
        this.stopPopupWatcherInternal();

        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.isInitialized = false;
            console.error('[DI] Browser stängd');
        }
    }

    /**
     * Exporterar cookies som sträng för Edge Function
     */
    async exportCookieString() {
        const cookies = await this.page.cookies('https://www.di.se');

        const cookieString = cookies
            .map(c => `${c.name}=${c.value}`)
            .join('; ');

        return cookieString;
    }
}

/**
 * Convenience-funktion för att hämta en artikel
 */
async function scrapeArticle(url, options = {}) {
    const scraper = new DIArticleScraper(options);

    try {
        await scraper.init();
        const article = await scraper.scrapeArticle(url);
        return article;
    } finally {
        await scraper.close();
    }
}

module.exports = {
    DIArticleScraper,
    scrapeArticle,
    CONFIG
};
