/**
 * Browser Factory - Centraliserad browser-hantering för alla scrapers
 *
 * Denna modul tillhandahåller en enhetlig strategi för:
 * - Browser-instansiering med puppeteer-extra
 * - Stealth-mode för att undvika bot-detection
 * - Adblocker för att blockera annonser och trackers
 * - Cookie consent-blockering
 * - CAPTCHA-hantering (NopeCHA integration)
 *
 * ALLA scrapers i projektet ska använda denna modul för att:
 * 1. Skapa browser-instanser
 * 2. Konfigurera sidor med popup-blockering
 * 3. Hantera cookies och CAPTCHA
 *
 * Usage:
 *   const { createBrowser, createPage, configurePage } = require('./utils/browser-factory');
 *
 *   const browser = await createBrowser();
 *   const page = await createPage(browser);
 *   await configurePage(page);
 *
 * @module browser-factory
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
const fs = require('fs');
const path = require('path');

// Importera popup-blocker
const {
    injectCookieBlocker,
    dismissAllPopups,
    startPopupWatcher,
    waitForCaptchaResolution,
    sleep
} = require('./popup-blocker');

// Projektrot
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ============================================
// KONFIGURATION
// ============================================

const CONFIG = {
    // Browser-inställningar
    DEFAULT_VIEWPORT: { width: 1920, height: 1080 },
    DEFAULT_TIMEOUT: 30000,
    LAUNCH_TIMEOUT: 60000,

    // NopeCHA extension
    NOPECHA_EXTENSION_PATH: path.join(PROJECT_ROOT, 'lib/nopecha-extension'),

    // User-Agent
    DEFAULT_USER_AGENT: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

    // Språk
    DEFAULT_LANGUAGE: 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7'
};

// ============================================
// PLUGIN CONFIGURATION
// ============================================

// Konfigurera puppeteer med plugins (görs en gång vid modul-laddning)
let isConfigured = false;

function configurePuppeteer() {
    if (isConfigured) return;

    // Stealth plugin
    puppeteer.use(StealthPlugin());

    // Adblocker plugin med cookie notice blocking
    puppeteer.use(AdblockerPlugin({
        blockTrackers: true,
        blockTrackersAndAnnoyances: true, // Blockerar cookie notices
        useCache: true
    }));

    isConfigured = true;
    console.error('[BrowserFactory] Puppeteer konfigurerad med Stealth + Adblocker');
}

// ============================================
// BROWSER CREATION
// ============================================

/**
 * Skapar en browser-instans med alla optimeringar
 *
 * @param {Object} options - Browser-alternativ
 * @param {boolean} options.headless - Kör headless (default: true för serverless/produktion)
 * @param {boolean} options.useCaptchaSolver - Ladda NopeCHA extension (default: false i headless)
 * @param {string[]} options.extraArgs - Extra Chrome-args
 * @param {string} options.userDataDir - Custom user data directory
 * @returns {Promise<Browser>} Puppeteer browser-instans
 */
async function createBrowser(options = {}) {
    configurePuppeteer();

    // Kolla environment för att tvinga headless i produktion
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
    const envHeadless = process.env.HEADLESS !== 'false';

    const {
        headless = isProduction || envHeadless, // Default: true (headless för serverless)
        useCaptchaSolver = false, // Default: false (extensions kräver GUI)
        extraArgs = [],
        userDataDir = null
    } = options;

    // Standard browser-args (optimerade för headless/serverless)
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--safebrowsing-disable-auto-update',
        `--lang=${CONFIG.DEFAULT_LANGUAGE.split(',')[0]}`,
        `--window-size=${CONFIG.DEFAULT_VIEWPORT.width},${CONFIG.DEFAULT_VIEWPORT.height}`,
        '--disable-blink-features=AutomationControlled',
        ...extraArgs
    ];

    // Kolla om NopeCHA extension finns (endast i GUI-mode)
    const extensionPath = CONFIG.NOPECHA_EXTENSION_PATH;
    const manifestPath = path.join(extensionPath, 'manifest.json');
    const hasExtension = useCaptchaSolver && !headless && fs.existsSync(manifestPath);

    if (hasExtension) {
        // Ta bort --disable-extensions för att ladda NopeCHA
        const extIdx = args.indexOf('--disable-extensions');
        if (extIdx > -1) args.splice(extIdx, 1);
        args.push(`--disable-extensions-except=${extensionPath}`);
        args.push(`--load-extension=${extensionPath}`);
        console.error('[BrowserFactory] NopeCHA CAPTCHA-solver laddad');
    }

    // Extensions kräver GUI-mode
    const useHeadless = headless && !hasExtension;

    const launchOptions = {
        headless: useHeadless ? 'new' : false,
        args,
        defaultViewport: null,
        timeout: CONFIG.LAUNCH_TIMEOUT,
        // För Docker: använd system Chromium om CHROMIUM_PATH är satt
        ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH })
    };

    if (userDataDir) {
        launchOptions.userDataDir = userDataDir;
    }

    const browser = await puppeteer.launch(launchOptions);
    console.error(`[BrowserFactory] Browser startad (headless: ${useHeadless})`);

    return browser;
}

// ============================================
// PAGE CREATION & CONFIGURATION
// ============================================

/**
 * Skapar och konfigurerar en ny sida
 *
 * @param {Browser} browser - Puppeteer browser
 * @param {Object} options - Page-alternativ
 * @param {Object} options.viewport - Custom viewport
 * @param {string} options.userAgent - Custom user-agent
 * @param {Object} options.extraHeaders - Extra HTTP headers
 * @returns {Promise<Page>} Konfigurerad page
 */
async function createPage(browser, options = {}) {
    const {
        viewport = CONFIG.DEFAULT_VIEWPORT,
        userAgent = CONFIG.DEFAULT_USER_AGENT,
        extraHeaders = {}
    } = options;

    const page = await browser.newPage();

    // Viewport
    await page.setViewport(viewport);

    // User-Agent
    await page.setUserAgent(userAgent);

    // Headers
    await page.setExtraHTTPHeaders({
        'Accept-Language': CONFIG.DEFAULT_LANGUAGE,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        ...extraHeaders
    });

    // Dölj webdriver-egenskaper
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['sv-SE', 'sv', 'en-US', 'en'] });
    });

    return page;
}

/**
 * Konfigurerar en sida efter navigation
 * Ska köras efter page.goto()
 *
 * @param {Page} page - Puppeteer page
 * @param {Object} options - Alternativ
 * @param {boolean} options.waitForPopups - Vänta på popups (default: true)
 * @param {number} options.waitTime - Väntetid i ms (default: 1500)
 */
async function configurePage(page, options = {}) {
    const {
        waitForPopups = true,
        waitTime = 1500
    } = options;

    // Injicera "I Don't Care About Cookies" script
    await injectCookieBlocker(page);

    // Vänta på att eventuella popups dyker upp
    if (waitForPopups) {
        await sleep(waitTime);
        await dismissAllPopups(page);
    }
}

/**
 * Navigerar till en URL med full konfiguration
 *
 * @param {Page} page - Puppeteer page
 * @param {string} url - URL att navigera till
 * @param {Object} options - Alternativ
 * @param {string} options.waitUntil - Navigation wait condition (default: 'networkidle2')
 * @param {number} options.timeout - Timeout i ms (default: 30000)
 * @param {boolean} options.dismissPopups - Stäng popups efter navigation (default: true)
 * @returns {Promise<Response>} Puppeteer response
 */
async function navigateAndConfigure(page, url, options = {}) {
    const {
        waitUntil = 'networkidle2',
        timeout = CONFIG.DEFAULT_TIMEOUT,
        dismissPopups = true
    } = options;

    const response = await page.goto(url, { waitUntil, timeout });

    if (dismissPopups) {
        await configurePage(page);
    }

    return response;
}

// ============================================
// COOKIE HANDLING
// ============================================

/**
 * Sparar cookies till fil
 *
 * @param {Page} page - Puppeteer page
 * @param {string} filePath - Sökväg till cookie-fil
 * @param {string} domain - Begränsa till specifik domän (optional)
 */
async function saveCookies(page, filePath, domain = null) {
    const cookies = domain
        ? await page.cookies(`https://${domain}`)
        : await page.cookies();

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify({
        cookies,
        savedAt: Date.now()
    }, null, 2));

    console.error(`[BrowserFactory] ${cookies.length} cookies sparade till ${filePath}`);
}

/**
 * Laddar cookies från fil
 *
 * @param {Page} page - Puppeteer page
 * @param {string} filePath - Sökväg till cookie-fil
 * @param {number} maxAgeMs - Max ålder för cookies i ms (default: 7 dagar)
 * @returns {boolean} True om cookies laddades
 */
async function loadCookies(page, filePath, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    try {
        if (!fs.existsSync(filePath)) {
            return false;
        }

        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // Kolla ålder
        if (Date.now() - data.savedAt > maxAgeMs) {
            console.error('[BrowserFactory] Cookies för gamla, ignorerar');
            return false;
        }

        await page.setCookie(...data.cookies);
        console.error(`[BrowserFactory] ${data.cookies.length} cookies laddade`);
        return true;
    } catch (e) {
        console.error(`[BrowserFactory] Fel vid laddning av cookies: ${e.message}`);
        return false;
    }
}

/**
 * Exporterar cookies som sträng
 *
 * @param {Page} page - Puppeteer page
 * @param {string} domain - Domän att hämta cookies för
 * @returns {string} Cookie-sträng i format "name=value; name2=value2"
 */
async function exportCookieString(page, domain) {
    const cookies = await page.cookies(`https://${domain}`);
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

// ============================================
// CAPTCHA HANDLING
// ============================================

/**
 * Väntar på och hanterar CAPTCHA
 *
 * @param {Page} page - Puppeteer page
 * @param {number} maxWaitMs - Max väntetid i ms (default: 15000)
 * @returns {boolean} True om ingen CAPTCHA eller löst
 */
async function handleCaptcha(page, maxWaitMs = 15000) {
    return await waitForCaptchaResolution(page, maxWaitMs);
}

// ============================================
// POPUP WATCHER
// ============================================

/**
 * Startar bakgrunds-övervakning av popups
 *
 * @param {Page} page - Puppeteer page
 * @param {number} intervalMs - Intervall mellan kontroller (default: 2000)
 * @returns {Function} Funktion för att stoppa övervakningen
 */
function watchPopups(page, intervalMs = 2000) {
    return startPopupWatcher(page, intervalMs);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Skriver text med mänsklig hastighet
 *
 * @param {Page} page - Puppeteer page
 * @param {string} selector - CSS selector för input
 * @param {string} text - Text att skriva
 * @param {Object} options - Alternativ
 * @param {number} options.minDelay - Min delay per tecken (default: 50)
 * @param {number} options.maxDelay - Max delay per tecken (default: 150)
 */
async function humanType(page, selector, text, options = {}) {
    const { minDelay = 50, maxDelay = 150 } = options;

    await page.click(selector);
    await sleep(200);

    for (const char of text) {
        const delay = Math.random() * (maxDelay - minDelay) + minDelay;
        await page.keyboard.type(char, { delay });
    }
}

/**
 * Tar skärmdump för debugging
 *
 * @param {Page} page - Puppeteer page
 * @param {string} name - Namn på skärmdumpen
 * @param {string} dir - Mapp att spara i (default: /tmp)
 * @returns {string} Sökväg till skärmdumpen
 */
async function takeScreenshot(page, name, dir = '/tmp') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}-${timestamp}.png`;
    const filepath = path.join(dir, filename);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    await page.screenshot({ path: filepath, fullPage: true });
    console.error(`[BrowserFactory] Skärmdump: ${filepath}`);
    return filepath;
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    // Browser & Page
    createBrowser,
    createPage,
    configurePage,
    navigateAndConfigure,

    // Cookies
    saveCookies,
    loadCookies,
    exportCookieString,

    // CAPTCHA
    handleCaptcha,

    // Popups
    watchPopups,
    dismissAllPopups,

    // Utilities
    humanType,
    takeScreenshot,
    sleep,

    // Konfiguration
    CONFIG,

    // Re-export från popup-blocker för enkelhet
    injectCookieBlocker,
    waitForCaptchaResolution,
    startPopupWatcher
};
