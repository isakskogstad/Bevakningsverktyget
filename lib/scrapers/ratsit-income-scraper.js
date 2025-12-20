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
    createRealBrowser,
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
// KONFIGURATION
// ============================================

const CONFIG = {
    BASE_URL: 'https://www.ratsit.se',
    LOGIN_URL: 'https://www.ratsit.se/loggain',
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
     * @param {string} name - Namn på skärmdumpen
     * @param {boolean} force - Ta skärmdump även om saveScreenshots är false
     */
    async screenshot(name, force = false) {
        // Alltid ta screenshot under login-flödet för debugging
        if (!this.page) return null;

        // Force screenshots under login för debugging
        const shouldSave = this.saveScreenshots || force || process.env.DEBUG_RATSIT === 'true';
        if (!shouldSave) return null;

        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `ratsit-${name}-${timestamp}.png`;
            const filepath = path.join(CONFIG.SCREENSHOT_DIR, filename);

            await this.page.screenshot({ path: filepath, fullPage: true });
            this.log(`Screenshot sparad: ${filename}`);
            return filepath;
        } catch (e) {
            this.log(`Kunde inte ta skärmdump: ${e.message}`);
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
            // ANVÄND puppeteer-real-browser med Turnstile-stöd!
            // Detta löser automatiskt Cloudflare Turnstile CAPTCHA
            const result = await createRealBrowser({
                headless: this.headless,
                turnstile: true, // Auto-lösa Cloudflare Turnstile
                fingerprint: true // Unik fingerprint för att undvika detection
            });

            this.browser = result.browser;
            this.page = result.page;
            this.log('✅ Real Browser med Turnstile-stöd startad');
        } catch (e) {
            // Fallback till vanlig browser om puppeteer-real-browser misslyckas
            this.log(`Real Browser misslyckades: ${e.message}, använder standard Puppeteer...`);
            this.browser = await createBrowser({
                headless: this.headless,
                useCaptchaSolver: this.useCaptchaSolver
            });
            this.page = await createPage(this.browser, { useProxy: !this.noProxy });
        } finally {
            // Återställ proxy-variabler
            Object.entries(savedProxy).forEach(([key, value]) => {
                process.env[key] = value;
            });
        }

        // === PRIORITET 1: Ladda cookies från RATSIT_COOKIES miljövariabel (GitHub Actions) ===
        if (process.env.RATSIT_COOKIES) {
            this.log('Försöker ladda cookies från RATSIT_COOKIES miljövariabel...');
            try {
                // Cookies är base64-kodade
                const cookiesJson = Buffer.from(process.env.RATSIT_COOKIES, 'base64').toString('utf8');
                const cookies = JSON.parse(cookiesJson);

                // Konvertera till Puppeteer-format och sätt cookies
                // VIKTIGT: Använd rätt domän-format för Puppeteer
                const puppeteerCookies = cookies.map(c => ({
                    name: c.name,
                    value: c.value,
                    domain: c.domain.includes('ratsit.se') ? '.ratsit.se' : c.domain,
                    path: '/',
                    httpOnly: c.name === '.session' || c.name === '_LCC',
                    secure: true,
                    sameSite: 'Lax'
                }));

                await this.page.setCookie(...puppeteerCookies);
                this.log(`✅ ${cookies.length} cookies laddade från miljövariabel`);

                // SKIP session-verifiering för env-cookies (Cloudflare blockerar)
                // Anta att cookies är giltiga - om inte, kommer sökningen att misslyckas
                this.log('✅ Antar att session från miljövariabel är giltig (skippar Cloudflare-blockad verifiering)');
                this.isLoggedIn = true;
                return true;
            } catch (e) {
                this.log(`Kunde inte parsa RATSIT_COOKIES: ${e.message}`, 'error');
            }
        }

        // === PRIORITET 2: Ladda cookies från fil ===
        const cookiesLoaded = await loadCookies(this.page, CONFIG.COOKIE_PATH);

        if (cookiesLoaded) {
            this.log('Cookies laddade från fil, verifierar session...');

            // Verifiera att session fortfarande är giltig
            if (await this.verifySession()) {
                this.log('✅ Session giltig - redan inloggad');
                this.isLoggedIn = true;
                return true;
            }

            this.log('Session ogiltig, behöver logga in igen');
        }

        // === PRIORITET 3: Logga in via engångskod ===
        // OBS: Detta fungerar INTE i GitHub Actions pga Cloudflare blocking
        this.log('🔐 Loggar in via engångskod...');
        await this.login();

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
     * Kolla om Turnstile finns på sidan
     * @returns {Promise<boolean>}
     */
    async hasTurnstile() {
        try {
            const result = await this.page.evaluate(() => {
                const checks = [];

                // Kolla efter iframes med Cloudflare
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    const src = iframe.src || '';
                    const title = iframe.title || '';
                    if (src.includes('challenges.cloudflare.com') ||
                        src.includes('turnstile') ||
                        title.toLowerCase().includes('cloudflare') ||
                        title.toLowerCase().includes('turnstile')) {
                        checks.push({ type: 'iframe', src, title, found: true });
                        return { found: true, checks };
                    }
                }

                // Kolla efter cf-turnstile class
                const cfTurnstile = document.querySelector('.cf-turnstile');
                if (cfTurnstile) {
                    checks.push({ type: 'cf-turnstile', found: true });
                    return { found: true, checks };
                }

                // Kolla efter data-sitekey
                const sitekey = document.querySelector('[data-sitekey]');
                if (sitekey) {
                    checks.push({ type: 'data-sitekey', found: true });
                    return { found: true, checks };
                }

                // Kolla efter texten "Bekräfta att du är en människa"
                const bodyText = document.body.innerText || '';
                if (bodyText.includes('Bekräfta att du är en människa') ||
                    bodyText.includes('Verify you are human') ||
                    bodyText.includes('Verifiering')) {
                    checks.push({ type: 'text-match', found: true });
                    return { found: true, checks };
                }

                // Kolla efter Turnstile widget container
                const widget = document.querySelector('[id*="turnstile"], [class*="turnstile"]');
                if (widget) {
                    checks.push({ type: 'widget', found: true });
                    return { found: true, checks };
                }

                return { found: false, checks, iframeCount: iframes.length };
            });

            if (result.found) {
                this.log(`Turnstile hittad: ${JSON.stringify(result.checks)}`);
            }

            return result.found;
        } catch (e) {
            this.log(`hasTurnstile fel: ${e.message}`);
            return false;
        }
    }

    /**
     * Kolla om Turnstile är löst (grön bock)
     * @returns {Promise<boolean>}
     */
    async isTurnstileSolved() {
        try {
            // Kolla efter success-indikatorer
            const solved = await this.page.evaluate(() => {
                // Turnstile sätter ofta ett hidden input med token när löst
                const tokenInput = document.querySelector('input[name="cf-turnstile-response"]');
                if (tokenInput && tokenInput.value && tokenInput.value.length > 10) {
                    return true;
                }

                // Kolla efter success-klass på container
                const container = document.querySelector('.cf-turnstile');
                if (container && container.getAttribute('data-state') === 'success') {
                    return true;
                }

                return false;
            });

            return solved;
        } catch (e) {
            return false;
        }
    }

    /**
     * Hantera Cloudflare Turnstile CAPTCHA
     * Dynamisk - väntar på att den laddas, klickar, och väntar på success
     * @returns {Promise<boolean>} true om löst eller inte behövs
     */
    async handleTurnstile() {
        try {
            // Vänta upp till 10 sekunder på att Turnstile kanske dyker upp
            this.log('Kollar om Turnstile behövs...');
            let turnstileFound = false;
            const waitStart = Date.now();

            while (Date.now() - waitStart < 10000) {
                if (await this.hasTurnstile()) {
                    turnstileFound = true;
                    this.log('Turnstile detekterad!');
                    break;
                }
                await sleep(500);
            }

            if (!turnstileFound) {
                this.log('Ingen Turnstile - fortsätter utan');
                return true;
            }

            // Kolla om redan löst
            if (await this.isTurnstileSolved()) {
                this.log('Turnstile redan löst!');
                return true;
            }

            // Hitta iframe
            const turnstileSelectors = [
                'iframe[src*="challenges.cloudflare.com"]',
                'iframe[src*="turnstile"]',
                'iframe[title*="Cloudflare"]',
                '.cf-turnstile iframe'
            ];

            let turnstileFrame = null;
            for (const selector of turnstileSelectors) {
                turnstileFrame = await this.page.$(selector);
                if (turnstileFrame) {
                    this.log(`Hittade Turnstile iframe: ${selector}`);
                    break;
                }
            }

            if (!turnstileFrame) {
                // Turnstile container finns men ingen iframe - kanske auto-solved
                this.log('Turnstile container utan iframe - kanske auto-solve');
                await sleep(3000);
                return await this.isTurnstileSolved();
            }

            // Klicka på iframe (checkbox är inne i iframe)
            const iframeBox = await turnstileFrame.boundingBox();
            if (iframeBox) {
                this.log('Klickar på Turnstile checkbox...');

                // Klicka i mitten av iframe med lite randomness
                await this.page.mouse.click(
                    iframeBox.x + iframeBox.width / 2 + (Math.random() * 6 - 3),
                    iframeBox.y + iframeBox.height / 2 + (Math.random() * 6 - 3)
                );

                // Vänta på att Turnstile löses (upp till 15 sekunder)
                this.log('Väntar på Turnstile-validering...');
                const solveStart = Date.now();
                while (Date.now() - solveStart < 15000) {
                    if (await this.isTurnstileSolved()) {
                        this.log('Turnstile löst!');
                        return true;
                    }

                    // Kolla om felmeddelande dykt upp
                    const errorMsg = await this.page.$eval(
                        '[class*="error"], [class*="alert"]',
                        el => el.textContent
                    ).catch(() => null);

                    if (errorMsg && errorMsg.toLowerCase().includes('verifiering misslyckades')) {
                        this.log('Turnstile misslyckades - försöker igen');
                        await sleep(2000);
                        // Klicka igen
                        await this.page.mouse.click(
                            iframeBox.x + iframeBox.width / 2,
                            iframeBox.y + iframeBox.height / 2
                        );
                    }

                    await sleep(1000);
                }
            }

            this.log('Turnstile timeout - kunde inte verifiera');
            return false;
        } catch (e) {
            this.log(`Turnstile-fel: ${e.message}`, 'error');
            return false;
        }
    }

    /**
     * Vänta på och klicka på "Skicka inloggningskod" knappen
     * Med puppeteer-real-browser hanteras Turnstile automatiskt!
     * @returns {Promise<boolean>}
     */
    async clickSendCodeButton() {
        const maxAttempts = 5;
        const startTime = Date.now();
        const maxTime = 120000; // 2 minuter max

        for (let attempt = 1; attempt <= maxAttempts && (Date.now() - startTime) < maxTime; attempt++) {
            try {
                this.log(`Försöker skicka kod (${attempt}/${maxAttempts})...`);

                // Vänta mellan försök med ökande cooldown
                if (attempt > 1) {
                    const cooldown = 5000 + (attempt * 2000);
                    this.log(`Väntar ${cooldown/1000}s mellan försök...`);
                    await sleep(cooldown);
                }

                // Kolla aktuell URL
                let currentUrl;
                try {
                    currentUrl = this.page.url();
                } catch (e) {
                    this.log('Kunde inte läsa URL, väntar...');
                    await sleep(2000);
                    continue;
                }

                if (currentUrl.includes('/kod')) {
                    this.log('Redan på kod-sidan - koden har skickats!');
                    return true;
                }

                // puppeteer-real-browser löser Turnstile automatiskt
                // Vi behöver bara vänta på att det sker
                this.log('puppeteer-real-browser hanterar eventuell Turnstile automatiskt...');
                await sleep(3000);

                // Hitta och klicka på knappen
                const buttonInfo = await this.page.evaluate(() => {
                    const buttons = document.querySelectorAll('button');
                    const info = { found: false, disabled: false, text: '' };

                    for (const btn of buttons) {
                        const text = (btn.textContent || '').toLowerCase().trim();
                        if (text.includes('skicka') && (text.includes('kod') || text.includes('inloggning'))) {
                            info.found = true;
                            info.text = text;
                            info.disabled = btn.disabled;

                            if (!btn.disabled) {
                                btn.click();
                                info.clicked = true;
                            }
                            return info;
                        }
                    }

                    // Fallback: leta efter submit-knappar
                    const submitBtn = document.querySelector('button[type="submit"]');
                    if (submitBtn && !submitBtn.disabled) {
                        info.found = true;
                        info.text = submitBtn.textContent || 'submit';
                        submitBtn.click();
                        info.clicked = true;
                    }

                    return info;
                });

                this.log(`Knapp-status: ${JSON.stringify(buttonInfo)}`);

                if (!buttonInfo.found) {
                    this.log('Knappen hittades inte på sidan');
                    await this.screenshot(`no-button-attempt-${attempt}`, true);
                    continue;
                }

                if (buttonInfo.disabled) {
                    this.log('Knappen är disabled - väntar på Turnstile auto-solve...');
                    // puppeteer-real-browser ska lösa Turnstile automatiskt
                    await sleep(5000);
                    continue;
                }

                if (!buttonInfo.clicked) {
                    this.log('Kunde inte klicka på knappen');
                    continue;
                }

                this.log('Klickade på knappen - väntar på respons...');

                // Vänta på eventuell navigation eller Turnstile-popup
                await sleep(5000);

                // Ta screenshot för debugging
                await this.screenshot(`after-click-${attempt}`, true);

                // Kolla om sidan navigerade till /kod
                try {
                    const urlAfterClick = this.page.url();
                    this.log(`URL efter klick: ${urlAfterClick}`);

                    if (urlAfterClick.includes('/kod')) {
                        this.log('Navigerade till kod-sidan - SUCCESS!');
                        return true;
                    }
                } catch (e) {
                    // Page might have navigated
                }

                // Kolla efter success-indikatorer på sidan
                const pageState = await this.page.evaluate(() => {
                    const bodyText = document.body.innerText || '';
                    const bodyLower = bodyText.toLowerCase();

                    return {
                        hasCodeSent: bodyLower.includes('skickat') ||
                                     bodyLower.includes('kontrollera din e-post') ||
                                     bodyLower.includes('en kod har skickats'),
                        hasError: bodyLower.includes('verifiering misslyckades') ||
                                  bodyLower.includes('verification failed'),
                        hasTooManyAttempts: bodyLower.includes('för många') ||
                                            bodyLower.includes('too many'),
                        hasCodeInput: !!document.querySelector('input[placeholder*="kod"], input[name*="code"]')
                    };
                });

                this.log(`Sidans status: ${JSON.stringify(pageState)}`);

                if (pageState.hasCodeSent || pageState.hasCodeInput) {
                    this.log('Kod skickad eller kodfält finns - SUCCESS!');
                    return true;
                }

                if (pageState.hasTooManyAttempts) {
                    this.log('För många försök - rate limited. Väntar 30s...');
                    await sleep(30000);
                    continue;
                }

                if (pageState.hasError) {
                    this.log('Verifieringsfel på sidan');
                    await sleep(3000);
                    continue;
                }

                // Vänta extra och försök igen
                this.log('Ingen tydlig respons - väntar...');
                await sleep(3000);

            } catch (e) {
                if (e.message.includes('detached') || e.message.includes('Detached')) {
                    this.log('Sidan navigerade (detached frame)...');
                    await sleep(3000);

                    try {
                        const url = this.page.url();
                        if (url.includes('/kod')) {
                            this.log('Navigerade till kod-sidan - SUCCESS!');
                            return true;
                        }
                    } catch (navErr) {}
                } else {
                    this.log(`Fel: ${e.message}`);
                }
                await sleep(2000);
            }
        }

        this.log('Alla försök förbrukade utan framgång');
        await this.screenshot('all-attempts-failed', true);
        return false;
    }

    /**
     * Klicka på Cloudflare Turnstile checkbox manuellt
     * @returns {Promise<boolean>}
     */
    async clickTurnstileCheckbox() {
        try {
            // Hitta Turnstile iframe
            const iframeSelectors = [
                'iframe[src*="challenges.cloudflare.com"]',
                'iframe[src*="turnstile"]',
                'iframe[title*="Widget"]',
                'iframe[title*="cloudflare"]'
            ];

            for (const selector of iframeSelectors) {
                const iframe = await this.page.$(selector);
                if (iframe) {
                    const box = await iframe.boundingBox();
                    if (box) {
                        this.log(`Klickar på Turnstile checkbox (${selector})...`);
                        // Klicka i mitten av iframen
                        await this.page.mouse.click(
                            box.x + box.width / 2,
                            box.y + box.height / 2
                        );
                        await sleep(2000);
                        return true;
                    }
                }
            }

            // Alternativ: leta efter checkbox-element
            const checkboxClicked = await this.page.evaluate(() => {
                // Leta efter Turnstile container och klicka
                const container = document.querySelector('.cf-turnstile, [data-sitekey]');
                if (container) {
                    const checkbox = container.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        checkbox.click();
                        return true;
                    }
                }
                return false;
            });

            return checkboxClicked;
        } catch (e) {
            this.log(`clickTurnstileCheckbox fel: ${e.message}`);
            return false;
        }
    }

    /**
     * Vänta på att Cloudflare Challenge passeras och vi når inloggningssidan
     * Försöker klicka på Turnstile om det behövs
     * @returns {Promise<boolean>}
     */
    async waitForCloudflareChallenge() {
        const maxWait = 90000; // 90 sekunder max för Cloudflare
        const startTime = Date.now();
        let consecutivePassedChecks = 0;
        const requiredPassedChecks = 3; // Måste passera 3 gånger i rad
        let clickAttempts = 0;
        const maxClickAttempts = 5;

        while (Date.now() - startTime < maxWait) {
            try {
                // Kolla om vi fortfarande är på Cloudflare challenge-sidan
                const pageState = await this.page.evaluate(() => {
                    const bodyText = document.body.innerText || '';
                    const isChallenge =
                        bodyText.includes('Bekräfta att du är en människa') ||
                        bodyText.includes('Verify you are human') ||
                        bodyText.includes('kontrollera säkerheten') ||
                        bodyText.includes('checking your browser') ||
                        bodyText.includes('Just a moment') ||
                        bodyText.includes('måste kontrollera') ||
                        bodyText.includes('Verifierar');

                    // Kolla också efter Cloudflare-specifika element
                    const hasCfChallenge = !!document.querySelector('#challenge-running, #challenge-form, .cf-browser-verification');

                    // Kolla om Turnstile-widget finns
                    const hasTurnstile = !!document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], .cf-turnstile');

                    // Kolla om vi har inloggningssidans element
                    const hasLoginForm = !!document.querySelector('input[type="text"], input[type="email"]');
                    const hasRatsitContent = bodyText.includes('Logga in') || bodyText.includes('E-post') || bodyText.includes('inloggningskod');
                    const hasButton = Array.from(document.querySelectorAll('button')).some(
                        btn => btn.textContent.toLowerCase().includes('skicka')
                    );

                    return {
                        isCloudflare: isChallenge || hasCfChallenge,
                        hasTurnstile,
                        hasLoginForm,
                        hasRatsitContent,
                        hasButton,
                        url: window.location.href
                    };
                });

                const elapsed = Math.floor((Date.now() - startTime) / 1000);

                // Om vi är på Cloudflare och har Turnstile, försök klicka
                if (pageState.isCloudflare && pageState.hasTurnstile && clickAttempts < maxClickAttempts) {
                    if (elapsed > 5 && elapsed % 10 === 0) { // Vänta minst 5s, försök var 10:e sekund
                        this.log(`Försöker klicka på Turnstile (försök ${clickAttempts + 1}/${maxClickAttempts})...`);
                        await this.clickTurnstileCheckbox();
                        clickAttempts++;
                    }
                }

                if (!pageState.isCloudflare && (pageState.hasLoginForm || pageState.hasRatsitContent || pageState.hasButton)) {
                    consecutivePassedChecks++;
                    this.log(`Cloudflare verkar passerad (${consecutivePassedChecks}/${requiredPassedChecks})...`);

                    if (consecutivePassedChecks >= requiredPassedChecks) {
                        this.log('Cloudflare Challenge passerad - inloggningssida nådd!');
                        await this.screenshot('cloudflare-passed', true);
                        // Extra väntan för att sidan ska stabiliseras
                        await sleep(2000);
                        return true;
                    }
                } else {
                    // Återställ om vi fortfarande ser Cloudflare
                    if (consecutivePassedChecks > 0) {
                        this.log('Cloudflare fortfarande aktiv - återställer räknare');
                    }
                    consecutivePassedChecks = 0;
                }

                // Logga progress var 10:e sekund
                if (elapsed % 10 === 0 && elapsed > 0) {
                    this.log(`Väntar på Cloudflare... (${elapsed}s) hasTurnstile: ${pageState.hasTurnstile}`);
                    await this.screenshot(`cloudflare-waiting-${elapsed}s`, true);
                }

                await sleep(1000);
            } catch (e) {
                // Navigation pågår - vänta och fortsätt
                if (e.message.includes('context') || e.message.includes('destroyed') || e.message.includes('detached')) {
                    this.log('Navigation pågår...');
                } else {
                    this.log(`waitForCloudflareChallenge fel: ${e.message}`);
                }
                await sleep(1000);
            }
        }

        this.log('Timeout: Cloudflare Challenge passerades inte inom 90s', 'error');
        await this.screenshot('cloudflare-timeout', true);
        return false;
    }

    /**
     * Vänta på att inloggningssidan är redo
     * @returns {Promise<boolean>}
     */
    async waitForPageReady() {
        const maxWait = 30000; // Ökat till 30 sekunder
        const startTime = Date.now();
        let lastCheck = '';

        while (Date.now() - startTime < maxWait) {
            try {
                // Logga URL för debugging
                const url = this.page.url();
                if (url !== lastCheck) {
                    this.log(`Kollar sida: ${url}`);
                    lastCheck = url;
                }

                // Kolla om vi har email-fält
                const hasEmailField = await this.page.$('input[type="text"][placeholder*="post"], input[type="email"], input[placeholder*="E-post"]');

                // Kolla efter skicka-knapp med flera varianter
                const hasSendButton = await this.page.evaluate(() => {
                    const buttons = document.querySelectorAll('button');
                    for (const btn of buttons) {
                        const text = (btn.textContent || '').toLowerCase();
                        if ((text.includes('skicka') && text.includes('kod')) ||
                            text.includes('skicka inloggningskod') ||
                            text.includes('logga in')) {
                            return true;
                        }
                    }
                    return false;
                });

                if (hasEmailField && hasSendButton) {
                    this.log('Sidan är redo (email-fält + knapp hittade)');
                    return true;
                }

                // Om bara email-fält finns, fortsätt vänta
                if (hasEmailField && !hasSendButton) {
                    this.log('Email-fält hittades, väntar på knapp...');
                }

                await sleep(500);
            } catch (e) {
                this.log(`waitForPageReady fel: ${e.message}`);
                await sleep(500);
            }
        }

        // Ta screenshot vid timeout för debugging
        await this.screenshot('page-not-ready-timeout', true);
        this.log('Timeout vid väntan på att sidan ska bli redo', 'error');
        return false;
    }

    /**
     * Fyll i e-postfältet
     * @param {string} email
     * @returns {Promise<boolean>}
     */
    async fillEmailField(email) {
        const emailSelectors = [
            'input[type="text"][placeholder*="post"]',
            'input[type="email"]',
            'input[placeholder*="E-post"]',
            'input[placeholder*="mail"]',
            'input[name*="email"]'
        ];

        for (const selector of emailSelectors) {
            try {
                const emailInput = await this.page.$(selector);
                if (emailInput) {
                    this.log(`Hittade email-fält: ${selector}`);

                    // Rensa fältet först
                    await emailInput.click({ clickCount: 3 });
                    await this.page.keyboard.press('Backspace');

                    // Skriv in email med naturlig hastighet
                    await emailInput.type(email, { delay: 30 + Math.random() * 40 });

                    // Verifiera att det skrevs in
                    const value = await emailInput.evaluate(el => el.value);
                    if (value === email) {
                        this.log('E-post ifylld korrekt');
                        return true;
                    }
                }
            } catch (e) {
                continue;
            }
        }

        this.log('Kunde inte fylla i e-postfältet', 'error');
        return false;
    }

    /**
     * Logga in på Ratsit med engångskod via e-post
     * Använder Resend för att ta emot och läsa inloggningskoden automatiskt
     * DYNAMISK: Hanterar alla scenarier - med/utan Turnstile, olika ordningar
     */
    async login() {
        const { waitForVerificationCode, getAutomationEmail } = require('../utils/resend-email');

        try {
            const automationEmail = getAutomationEmail();
            this.log(`Använder automation-email: ${automationEmail}`);

            // === STEG 1: Ladda inloggningssidan ===
            this.log('Laddar inloggningssidan...');
            await this.page.goto(CONFIG.LOGIN_URL, {
                timeout: CONFIG.TIMEOUT,
                waitUntil: 'networkidle2'
            });

            await sleep(2000);

            // === STEG 1.5: Vänta på Cloudflare Challenge (puppeteer-real-browser hanterar) ===
            this.log('Kollar efter Cloudflare Challenge...');
            const cloudflareWaitResult = await this.waitForCloudflareChallenge();
            if (!cloudflareWaitResult) {
                this.log('Cloudflare Challenge misslyckades - fortsätter ändå...');
            }

            await dismissAllPopups(this.page);

            // === STEG 2: Vänta på att sidan är interaktiv ===
            this.log('Väntar på att sidan blir interaktiv...');
            const pageReady = await this.waitForPageReady();
            if (!pageReady) {
                throw new Error('Sidan laddades inte korrekt');
            }

            await this.screenshot('login-page-loaded');

            // === STEG 3: Fyll i e-postadress ===
            this.log('Fyller i e-postadress...');
            const emailFilled = await this.fillEmailField(automationEmail);
            if (!emailFilled) {
                throw new Error('Kunde inte fylla i e-postadress');
            }

            // Markera tidpunkt för e-postfiltrering
            const codeRequestTime = new Date();

            // === STEG 4: Hantera Turnstile (om den finns) ===
            // Vänta lite för att ge Turnstile tid att ladda
            await sleep(2000);

            if (await this.hasTurnstile()) {
                this.log('Cloudflare Turnstile detekterad - hanterar...');
                const turnstileSolved = await this.handleTurnstile();
                if (!turnstileSolved) {
                    this.log('Turnstile kunde inte lösas automatiskt', 'warn');
                    // Fortsätt ändå - kanske det fungerar
                }
            } else {
                this.log('Ingen Turnstile detekterad - fortsätter');
            }

            // === STEG 5: Klicka på "Skicka inloggningskod" ===
            this.log('Försöker skicka inloggningskod...');
            const codeSent = await this.clickSendCodeButton();

            if (!codeSent) {
                await this.screenshot('send-code-failed');
                throw new Error('Kunde inte skicka inloggningskod');
            }

            await this.screenshot('code-requested');

            // Vänta på e-post med inloggningskod via Resend
            this.log('Väntar på inloggningskod via e-post (max 60s)...');

            const result = await waitForVerificationCode({
                fromContains: 'ratsit',
                subjectContains: 'inloggning',
                timeoutMs: 60000
            });

            if (!result || !result.code) {
                await this.screenshot('no-code-received');
                throw new Error('Fick ingen inloggningskod via e-post inom 60 sekunder');
            }

            const verificationCode = result.code;
            this.log(`Mottog inloggningskod: ${verificationCode}`);

            // Klicka på "Jag har mottagit en kod" om det behövs
            const hasCodeLink = await this.page.$('a:has-text("Jag har mottagit en kod")');
            if (hasCodeLink) {
                await hasCodeLink.click();
                await sleep(1000);
            }

            // Navigera till kod-inmatning om vi inte redan är där
            const currentUrl = this.page.url();
            if (!currentUrl.includes('/kod')) {
                await this.page.goto('https://www.ratsit.se/loggain/kod', {
                    timeout: CONFIG.TIMEOUT,
                    waitUntil: 'networkidle2'
                });
                await sleep(1000);
            }

            await this.screenshot('code-entry-page');

            // Hitta kod-inmatningsfält
            const codeSelectors = [
                'input[type="text"]',
                'input[name*="code"]',
                'input[name*="kod"]',
                'input[placeholder*="kod"]',
                'input[placeholder*="code"]'
            ];

            let codeInput = null;
            for (const selector of codeSelectors) {
                codeInput = await this.page.$(selector);
                if (codeInput) break;
            }

            if (!codeInput) {
                await this.screenshot('no-code-input');
                throw new Error('Kunde inte hitta fält för inloggningskod');
            }

            // Fyll i koden
            await codeInput.click();
            await sleep(300);
            await codeInput.type(verificationCode, { delay: 100 });

            // Klicka på "Logga in" eller submit
            await sleep(500);
            const submitBtn = await this.page.$('button[type="submit"]') ||
                              await this.page.$('button:has-text("Logga in")');

            if (submitBtn) {
                await submitBtn.click();
            } else {
                await this.page.keyboard.press('Enter');
            }

            // Vänta på inloggning
            await sleep(CONFIG.LOGIN_WAIT);
            await this.screenshot('after-code-login');

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
                    throw new Error('CAPTCHA kunde inte lösas');
                }

                await sleep(3000);
            }

            // Verifiera inloggning
            if (!await this.verifySession()) {
                await this.screenshot('login-failed');

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
            this.log('✅ Inloggning lyckades med engångskod');

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

        // Vänta på eventuell Cloudflare Challenge
        // puppeteer-real-browser hanterar detta automatiskt
        await sleep(2000);

        // Kolla om Cloudflare blockerar
        const pageText = await this.page.evaluate(() => document.body.innerText || '');
        if (pageText.includes('Bekräfta att du är en människa') ||
            pageText.includes('Verify you are human') ||
            pageText.includes('Just a moment')) {
            this.log('Cloudflare Challenge på söksidan - väntar...');
            await this.waitForCloudflareChallenge();
        }

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
  --visible               Visa browser-fönstret (för debug/CAPTCHA)
  --screenshots           Spara skärmdumpar för debugging
  --captcha-solver        Aktivera NopeCHA CAPTCHA-solver
  --no-proxy              Inaktivera proxy (vid tunnelproblem)
  --help, -h              Visa denna hjälp

MILJÖVARIABLER:
  RATSIT_EMAIL            E-postadress för Ratsit-konto
  RATSIT_PASSWORD         Lösenord för Ratsit-konto

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
    CONFIG
};
