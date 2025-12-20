/**
 * Bonnier News Article Scraper - Hämtar artiklar från alla Bonnier News-tidningar
 *
 * Stödda tidningar:
 * - DI.se (Dagens Industri)
 * - DN.se (Dagens Nyheter)
 * - Expressen.se
 * - Sydsvenskan.se
 * - Privataaffarer.se
 * - HD.se (Helsingborgs Dagblad)
 * - Kvallsposten.se
 * - GT.se (Göteborgs-Tidningen)
 *
 * Alla dessa tidningar använder samma Bonnier News SSO-system,
 * vilket innebär att en enda inloggning ger tillgång till alla.
 *
 * Usage:
 *   const { BonnierNewsScraper } = require('./bonnier-news-scraper');
 *   const scraper = new BonnierNewsScraper({ email, password });
 *   await scraper.init();
 *   const article = await scraper.scrapeArticle('https://www.dn.se/...');
 *   await scraper.close();
 *
 * @module bonnier-news-scraper
 */

const fs = require('fs');
const path = require('path');

// Importera centraliserad browser-factory
const {
    createBrowser,
    createPage,
    configurePage,
    injectCookieBlocker,
    dismissAllPopups,
    startPopupWatcher,
    handleCaptcha,
    humanType: humanTypeBase,
    sleep
} = require('../utils/browser-factory');

// Projektrot
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ============================================
// KONFIGURATION
// ============================================

/**
 * Tidnings-konfigurationer
 * Alla använder samma login-system men har olika domäner och CSS-strukturer
 */
const SITES = {
    'di.se': {
        name: 'Dagens Industri',
        shortName: 'DI',
        domain: 'di.se',
        loginUrl: 'https://www.di.se/konto/logga-in/',
        baseUrl: 'https://www.di.se',
        selectors: {
            article: {
                title: ['h1.article__headline', 'h1[class*="headline"]', 'article h1', 'h1'],
                lead: ['.article__lead', '[class*="lead"]', '.preamble'],
                body: ['.article__body', '[class*="article-body"]', 'article .content', 'article'],
                author: ['.byline__author', '[class*="author"]', '.byline'],
                publishedAt: ['time.publication__time[datetime]', 'time[datetime]'],
                updatedAt: ['time.update__time[datetime]', '[class*="update"] time[datetime]']
            }
        }
    },
    'dn.se': {
        name: 'Dagens Nyheter',
        shortName: 'DN',
        domain: 'dn.se',
        loginUrl: 'https://www.dn.se/konto/logga-in/',
        baseUrl: 'https://www.dn.se',
        selectors: {
            article: {
                title: ['h1.article__headline', 'h1[class*="headline"]', 'article h1', 'h1'],
                lead: ['.article__lead', '[class*="lead"]', '.preamble', '.ingress'],
                body: ['.article__body', '[class*="article-body"]', 'article .content', 'article'],
                author: ['.byline__author', '[class*="author"]', '.byline'],
                publishedAt: ['time[datetime]'],
                updatedAt: ['[class*="update"] time[datetime]']
            }
        }
    },
    'expressen.se': {
        name: 'Expressen',
        shortName: 'EXP',
        domain: 'expressen.se',
        loginUrl: 'https://www.expressen.se/konto/logga-in/',
        baseUrl: 'https://www.expressen.se',
        selectors: {
            article: {
                title: ['h1.article-header__heading', 'h1[class*="heading"]', 'article h1', 'h1'],
                lead: ['.article-header__lead', '[class*="lead"]', '.preamble'],
                body: ['.article__body', '.article-body', '[class*="article-body"]', 'article'],
                author: ['.byline__name', '[class*="author"]', '.byline'],
                publishedAt: ['time[datetime]'],
                updatedAt: ['[class*="update"] time[datetime]']
            }
        }
    },
    'sydsvenskan.se': {
        name: 'Sydsvenskan',
        shortName: 'SDS',
        domain: 'sydsvenskan.se',
        loginUrl: 'https://www.sydsvenskan.se/konto/logga-in/',
        baseUrl: 'https://www.sydsvenskan.se',
        selectors: {
            article: {
                title: ['h1.article__headline', 'h1[class*="headline"]', 'article h1', 'h1'],
                lead: ['.article__lead', '[class*="lead"]', '.preamble'],
                body: ['.article__body', '[class*="article-body"]', 'article .content', 'article'],
                author: ['.byline__author', '[class*="author"]', '.byline'],
                publishedAt: ['time[datetime]'],
                updatedAt: ['[class*="update"] time[datetime]']
            }
        }
    },
    'privataaffarer.se': {
        name: 'Privata Affärer',
        shortName: 'PA',
        domain: 'privataaffarer.se',
        loginUrl: 'https://www.privataaffarer.se/konto/logga-in/',
        baseUrl: 'https://www.privataaffarer.se',
        selectors: {
            article: {
                title: ['h1.article__headline', 'h1[class*="headline"]', 'article h1', 'h1'],
                lead: ['.article__lead', '[class*="lead"]', '.preamble'],
                body: ['.article__body', '[class*="article-body"]', 'article .content', 'article'],
                author: ['.byline__author', '[class*="author"]', '.byline'],
                publishedAt: ['time[datetime]'],
                updatedAt: ['[class*="update"] time[datetime]']
            }
        }
    },
    'hd.se': {
        name: 'Helsingborgs Dagblad',
        shortName: 'HD',
        domain: 'hd.se',
        loginUrl: 'https://www.hd.se/konto/logga-in/',
        baseUrl: 'https://www.hd.se',
        selectors: {
            article: {
                title: ['h1.article__headline', 'h1[class*="headline"]', 'article h1', 'h1'],
                lead: ['.article__lead', '[class*="lead"]', '.preamble'],
                body: ['.article__body', '[class*="article-body"]', 'article'],
                author: ['.byline__author', '[class*="author"]', '.byline'],
                publishedAt: ['time[datetime]'],
                updatedAt: ['[class*="update"] time[datetime]']
            }
        }
    }
};

// Standard-konfiguration
const CONFIG = {
    // Inloggningsuppgifter
    DEFAULT_EMAIL: process.env.BONNIER_EMAIL || process.env.DI_EMAIL || '',
    DEFAULT_PASSWORD: process.env.BONNIER_PASSWORD || process.env.DI_PASSWORD || '',

    // Sökvägar
    COOKIE_PATH: path.join(PROJECT_ROOT, 'data/bonnier-session/cookies.json'),
    SESSION_INFO_PATH: path.join(PROJECT_ROOT, 'data/bonnier-session/session-info.json'),
    NOPECHA_EXTENSION_PATH: path.join(PROJECT_ROOT, 'lib/nopecha-extension'),

    // Timeouts
    LOGIN_TIMEOUT: 60000,
    PAGE_TIMEOUT: 30000,
    TYPING_DELAY_MIN: 50,
    TYPING_DELAY_MAX: 150,

    // Session
    MAX_COOKIE_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 dagar
};

// ============================================
// HUVUDKLASS
// ============================================

/**
 * Bonnier News Article Scraper
 *
 * Hanterar inloggning och artikel-hämtning för alla Bonnier News-tidningar
 */
class BonnierNewsScraper {
    constructor(options = {}) {
        this.credentials = {
            email: options.email || CONFIG.DEFAULT_EMAIL,
            password: options.password || CONFIG.DEFAULT_PASSWORD
        };
        this.cookiePath = options.cookiePath || CONFIG.COOKIE_PATH;
        this.sessionInfoPath = options.sessionInfoPath || CONFIG.SESSION_INFO_PATH;
        this.headless = options.headless ?? true; // Default headless för serverless
        this.verbose = options.verbose ?? true;

        this.browser = null;
        this.page = null;
        this.isInitialized = false;
        this.stopPopupWatcher = null;
    }

    /**
     * Identifierar vilken tidning en URL tillhör
     */
    static getSiteConfig(url) {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.replace('www.', '');

        for (const [domain, config] of Object.entries(SITES)) {
            if (hostname === domain || hostname.endsWith('.' + domain)) {
                return config;
            }
        }

        return null;
    }

    /**
     * Lista över stödda domäner
     */
    static getSupportedDomains() {
        return Object.keys(SITES);
    }

    /**
     * Loggar meddelande (om verbose är aktiverat)
     */
    log(message, force = false) {
        if (this.verbose || force) {
            console.error(`[BonnierNews] ${message}`);
        }
    }

    /**
     * Initialiserar scrapern - laddar cookies eller loggar in
     */
    async init() {
        this.log('Initialiserar scraper...');

        // Validera credentials
        if (!this.credentials.email || !this.credentials.password) {
            throw new Error('Email och lösenord krävs. Sätt BONNIER_EMAIL/DI_EMAIL och BONNIER_PASSWORD/DI_PASSWORD i miljövariabler.');
        }

        // Starta browser med stealth och plugins
        await this.launchBrowser();

        // Försök ladda sparade cookies
        const cookiesLoaded = await this.loadCookies();

        if (cookiesLoaded) {
            this.log('Cookies laddade, verifierar session...');
            const valid = await this.verifyCookies();

            if (valid) {
                this.log('✅ Använder cachad session');
                this.isInitialized = true;
                return true;
            }
            this.log('Session ogiltig, behöver ny inloggning');
        }

        // Behöver ny inloggning
        this.log('🔐 Utför ny inloggning...');
        await this.login();
        this.isInitialized = true;
        return true;
    }

    /**
     * Startar browser med alla optimeringar
     * Använder centraliserad browser-factory
     */
    async launchBrowser() {
        // Använd centraliserad browser-factory
        // useCaptchaSolver=true laddar NopeCHA om tillgänglig (kräver GUI)
        this.browser = await createBrowser({
            headless: this.headless,
            useCaptchaSolver: !this.headless // Endast i GUI-mode
        });

        // Skapa page med browser-factory (hanterar viewport, user-agent, headers, webdriver-hiding)
        this.page = await createPage(this.browser, {
            viewport: { width: 1920, height: 1080 }
        });

        this.log(`Browser startad (headless: ${this.headless})`);
    }

    /**
     * Loggar in på Bonnier News (använder DI.se som standard)
     */
    async login(site = 'di.se') {
        const siteConfig = SITES[site] || SITES['di.se'];
        this.log(`Navigerar till ${siteConfig.name} login...`);

        await this.page.goto(siteConfig.loginUrl, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.PAGE_TIMEOUT
        });

        // Injicera cookie-blocker
        await injectCookieBlocker(this.page);

        // Starta popup-watcher i bakgrunden
        this.stopPopupWatcher = startPopupWatcher(this.page, 2000);

        // Vänta och hantera popups
        this.log('Väntar på att sidan stabiliseras...');
        await sleep(2000);
        await dismissAllPopups(this.page);

        // Vänta på login-formulär
        this.log('Väntar på login-formulär...');
        await this.page.waitForSelector('input[type="email"], input[name="email"], input[id*="email"]', {
            timeout: CONFIG.LOGIN_TIMEOUT
        });

        // Stäng eventuella popups igen
        await dismissAllPopups(this.page);

        this.log('Fyller i inloggningsuppgifter...');

        // Hitta och fyll i email-fältet
        const emailSelector = await this.findInput(['input[name="email"]', 'input[type="email"]', 'input[id*="email"]']);
        await this.humanType(emailSelector, this.credentials.email);

        await sleep(500);
        await dismissAllPopups(this.page);

        // Hitta och fyll i lösenords-fältet
        const passwordSelector = await this.findInput(['input[name="password"]', 'input[type="password"]']);
        await this.humanType(passwordSelector, this.credentials.password);

        // Försök kryssa i "Håll mig inloggad"
        await this.checkRememberMe();

        // Övervaka CAPTCHA (använder browser-factory's handleCaptcha)
        this.log('Övervakar för CAPTCHA (10 sek)...');
        await handleCaptcha(this.page, 10000);

        // Stäng popups före klick
        await dismissAllPopups(this.page);

        // Klicka login-knappen
        this.log('Klickar login-knappen...');
        const loginButton = await this.findInput(['button[type="submit"]', 'input[type="submit"]']);
        await this.page.click(loginButton);

        // Vänta på navigation
        try {
            await this.page.waitForNavigation({
                waitUntil: 'networkidle2',
                timeout: CONFIG.LOGIN_TIMEOUT
            });
        } catch (e) {
            this.log('Navigation timeout, kontrollerar status...');
        }

        // Hantera post-login popups
        await sleep(2000);
        await dismissAllPopups(this.page);

        // Verifiera inloggning
        const loggedIn = await this.verifyCookies();

        if (!loggedIn) {
            // Ta skärmdump för debugging
            const screenshotPath = path.join(PROJECT_ROOT, 'data/bonnier-session/login-failed.png');
            fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
            await this.page.screenshot({ path: screenshotPath, fullPage: true });
            this.log(`❌ Skärmdump sparad: ${screenshotPath}`, true);
            throw new Error('Inloggning misslyckades - kontrollera skärmdump');
        }

        // Spara cookies
        await this.saveCookies();
        this.log('✅ Inloggning lyckades, cookies sparade');

        // Stoppa popup-watcher
        if (this.stopPopupWatcher) {
            this.stopPopupWatcher();
            this.stopPopupWatcher = null;
        }
    }

    /**
     * Hittar första matchande input-element
     */
    async findInput(selectors) {
        for (const selector of selectors) {
            const element = await this.page.$(selector);
            if (element) return selector;
        }
        throw new Error(`Kunde inte hitta element: ${selectors.join(', ')}`);
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
                        this.log('✓ "Håll mig inloggad" ikryssad');
                    }
                    return;
                }
            } catch (e) {
                // Fortsätt
            }
        }
    }

    /**
     * Sparar session-cookies
     */
    async saveCookies() {
        // Hämta cookies från alla Bonnier News-domäner
        const allCookies = [];

        for (const domain of Object.keys(SITES)) {
            try {
                const cookies = await this.page.cookies(`https://www.${domain}`);
                allCookies.push(...cookies);
            } catch (e) {
                // Ignorera
            }
        }

        // Deduplisera
        const uniqueCookies = [];
        const seen = new Set();
        for (const cookie of allCookies) {
            const key = `${cookie.domain}-${cookie.name}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueCookies.push(cookie);
            }
        }

        const sessionData = {
            cookies: uniqueCookies,
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

        // Spara session-info
        const sessionInfo = {
            savedAt: sessionData.savedAt,
            verifiedAt: sessionData.verifiedAt,
            email: sessionData.email,
            cookieCount: uniqueCookies.length,
            domains: [...new Set(uniqueCookies.map(c => c.domain))]
        };
        fs.writeFileSync(this.sessionInfoPath, JSON.stringify(sessionInfo, null, 2));

        this.log(`${uniqueCookies.length} cookies sparade`);
    }

    /**
     * Laddar sparade cookies
     */
    async loadCookies() {
        try {
            if (!fs.existsSync(this.cookiePath)) {
                this.log('Ingen sparad session hittades');
                return false;
            }

            const data = JSON.parse(fs.readFileSync(this.cookiePath, 'utf8'));

            // Kontrollera ålder
            const age = Date.now() - data.savedAt;
            if (age > CONFIG.MAX_COOKIE_AGE_MS) {
                this.log('Session för gammal, behöver ny inloggning');
                return false;
            }

            // Ladda cookies
            await this.page.setCookie(...data.cookies);
            this.log(`${data.cookies.length} cookies laddade`);

            return true;
        } catch (e) {
            this.log(`Fel vid laddning av cookies: ${e.message}`);
            return false;
        }
    }

    /**
     * Verifierar att sessionen är giltig
     */
    async verifyCookies() {
        try {
            // Kolla DI.se som referens
            await this.page.goto('https://www.di.se', {
                waitUntil: 'networkidle2',
                timeout: CONFIG.PAGE_TIMEOUT
            });

            await injectCookieBlocker(this.page);
            await sleep(1000);
            await dismissAllPopups(this.page);

            const isLoggedIn = await this.page.evaluate(() => {
                // Om "Logga in"-länk finns är vi ej inloggade
                const loginLink = document.querySelector('a[href*="logga-in"], a[href*="login"]');
                const userMenu = document.querySelector('[class*="user"], [class*="account"], [class*="profile"]');

                if (userMenu) return true;
                if (loginLink && !userMenu) return false;

                return document.cookie.includes('session') ||
                       document.cookie.includes('auth') ||
                       document.cookie.includes('user');
            });

            return isLoggedIn;
        } catch (e) {
            this.log(`Fel vid verifiering: ${e.message}`);
            return false;
        }
    }

    /**
     * Hämtar och extraherar artikel från URL
     *
     * @param {string} url - Artikel-URL
     * @returns {Object} Artikeldata
     */
    async scrapeArticle(url) {
        if (!this.isInitialized) {
            throw new Error('Scraper ej initialiserad. Kör init() först.');
        }

        const siteConfig = BonnierNewsScraper.getSiteConfig(url);
        if (!siteConfig) {
            throw new Error(`URL stöds ej: ${url}. Stödda domäner: ${Object.keys(SITES).join(', ')}`);
        }

        this.log(`[${siteConfig.shortName}] Hämtar artikel: ${url}`);

        await this.page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.PAGE_TIMEOUT
        });

        // Hantera popups
        await injectCookieBlocker(this.page);
        await sleep(1000);
        await dismissAllPopups(this.page);

        // Vänta på att content laddas ordentligt
        await sleep(2000);

        // Kolla om artikeln är låst
        const isLocked = await this.page.evaluate(() => {
            const article = document.querySelector('article');
            if (article && article.dataset.accessRestriction === 'Locked') return true;

            const paywall = document.querySelector('[class*="paywall"], [class*="locked"], iframe[src*="wall"]');
            return !!paywall;
        });

        if (isLocked) {
            this.log(`[${siteConfig.shortName}] ⚠️  Artikel låst, försöker logga in igen...`);
            await this.login(siteConfig.domain);
            await this.page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: CONFIG.PAGE_TIMEOUT
            });
            await sleep(2000);
        }

        // Extrahera innehåll
        return await this.extractContent(url, siteConfig);
    }

    /**
     * Extraherar artikelinnehåll
     */
    async extractContent(url, siteConfig) {
        const selectors = siteConfig.selectors.article;

        const article = await this.page.evaluate((sel) => {
            const getText = (selectors) => {
                for (const selector of selectors) {
                    const el = document.querySelector(selector);
                    if (el) return el.textContent.trim();
                }
                return null;
            };

            const getHtml = (selectors) => {
                for (const selector of selectors) {
                    const el = document.querySelector(selector);
                    if (el) return el.innerHTML;
                }
                return null;
            };

            const getAttr = (selectors, attr) => {
                for (const selector of selectors) {
                    const el = document.querySelector(selector);
                    if (el) {
                        const value = el.getAttribute(attr);
                        if (value) return value;
                    }
                }
                return null;
            };

            // Extrahera med fallbacks
            const title = getText(sel.title);
            const lead = getText(sel.lead);

            // Body
            let body = null;
            let bodyText = null;
            for (const selector of sel.body) {
                const el = document.querySelector(selector);
                if (el) {
                    body = el.innerHTML;
                    bodyText = el.textContent.replace(/\s+/g, ' ').trim();
                    break;
                }
            }

            const author = getText(sel.author);
            const publishedAt = getAttr(sel.publishedAt, 'datetime');
            const updatedAt = sel.updatedAt ? getAttr(sel.updatedAt, 'datetime') : null;

            // Bilder
            const images = Array.from(document.querySelectorAll('article img'))
                .map(img => ({
                    src: img.src,
                    alt: img.alt || ''
                }))
                .filter(img => img.src && !img.src.includes('data:') && !img.src.includes('1x1'));

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
                images: images.slice(0, 5),
                tags
            };
        }, selectors);

        // Lägg till metadata
        article.url = url;
        article.source = siteConfig.name;
        article.sourceShort = siteConfig.shortName;
        article.scrapedAt = new Date().toISOString();

        // Kolla om vi fick body content
        article.isPaywalled = !article.bodyText || article.bodyText.length < 200;

        if (article.isPaywalled) {
            this.log(`[${siteConfig.shortName}] ⚠️  Artikeln verkar vara bakom paywall`);
        } else {
            this.log(`[${siteConfig.shortName}] ✅ Artikel extraherad: "${article.title?.substring(0, 50)}..."`);
        }

        return article;
    }

    /**
     * Exporterar cookies som sträng för Edge Function
     */
    async exportCookieString(domain = null) {
        const targetDomain = domain || 'di.se';
        const cookies = await this.page.cookies(`https://www.${targetDomain}`);

        return cookies
            .map(c => `${c.name}=${c.value}`)
            .join('; ');
    }

    async scrapePressReleaseList(url) {
        if (!this.browser) throw new Error('Browser not initialized');

        const page = await createPage(this.browser, { viewport: CONFIG.DEFAULT_VIEWPORT });
        await configurePage(page);
        await injectCookieBlocker(page);
        await dismissAllPopups(page);

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.PAGE_TIMEOUT
        });
        await sleep(2000);
        await autoScroll(page, 8);

        const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href*="/live/"]'))
                .map(a => a.href)
                .filter(Boolean);
        });

        const normalized = links
            .map(href => {
                try {
                    return new URL(href, 'https://www.di.se').href;
                } catch (err) {
                    return null;
                }
            })
            .filter(href => href && href.includes('/live/'));

        await page.close();
        return normalized;
    }

    /**
     * Stänger browser
     */
    async close() {
        if (this.stopPopupWatcher) {
            this.stopPopupWatcher();
            this.stopPopupWatcher = null;
        }

        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.isInitialized = false;
            this.log('Browser stängd');
        }
    }
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

async function autoScroll(page, steps = 5) {
    await page.evaluate(async (steps) => {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        for (let i = 0; i < steps; i++) {
            window.scrollBy(0, document.body.scrollHeight);
            await delay(800);
        }
    }, steps);
}

/**
 * Hämtar en artikel (convenience-funktion)
 */
async function scrapeArticle(url, options = {}) {
    const scraper = new BonnierNewsScraper(options);

    try {
        await scraper.init();
        const article = await scraper.scrapeArticle(url);
        return article;
    } finally {
        await scraper.close();
    }
}

/**
 * Kontrollerar om en URL stöds
 */
function isSupported(url) {
    return BonnierNewsScraper.getSiteConfig(url) !== null;
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    BonnierNewsScraper,
    scrapeArticle,
    isSupported,
    SITES,
    CONFIG
};
