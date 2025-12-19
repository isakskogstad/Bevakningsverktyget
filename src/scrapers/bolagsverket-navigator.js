/**
 * Bolagsverket Navigator - Automatisk navigation och dokumenthämtning
 * 
 * Använder:
 * - puppeteer-extra med stealth plugin
 * - Automatisk CAPTCHA-lösning
 * - Retry-logik med flera metoder
 * 
 * Dokumenterar alla tillgängliga dokumenttyper på foretagsinfo.bolagsverket.se
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const captchaSolver = require('../services/auto_captcha_solver');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Konfiguration
const CONFIG = {
    BASE_URL: 'https://foretagsinfo.bolagsverket.se',
    SEARCH_URL: 'https://foretagsinfo.bolagsverket.se/sok-foretagsinformation-web/foretag',
    MAX_RETRIES: 5,
    RETRY_DELAY: 3000,
    PAGE_TIMEOUT: 60000,
    SCREENSHOT_DIR: '/tmp/bolagsverket'
};

// Säkerställ screenshot-mapp finns
if (!fs.existsSync(CONFIG.SCREENSHOT_DIR)) {
    fs.mkdirSync(CONFIG.SCREENSHOT_DIR, { recursive: true });
}

/**
 * Loggar med timestamp
 */
function log(message, level = 'info') {
    const timestamp = new Date().toISOString().substring(11, 19);
    const prefix = level === 'error' ? '❌' : level === 'success' ? '✅' : '📍';
    console.error(`[${timestamp}] ${prefix} ${message}`);
}

/**
 * Skapar en stealth browser
 */
async function createBrowser(headless = false) {
    const browser = await puppeteer.launch({
        headless: headless ? 'new' : false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--lang=sv-SE,sv',
            '--window-size=1400,900',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process'
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: null
    });
    
    const page = await browser.newPage();
    
    // Realistiska headers
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1'
    });
    
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1400, height: 900 });
    
    // Simulera mänskligt beteende
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['sv-SE', 'sv', 'en-US', 'en'] });
    });
    
    return { browser, page };
}

/**
 * Accepterar cookies om dialog visas
 */
async function acceptCookies(page) {
    try {
        const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            for (const btn of buttons) {
                const text = btn.textContent.toLowerCase();
                if (text.includes('ok') || text.includes('acceptera') || text.includes('godkänn')) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });
        if (clicked) log('Accepterade cookies');
        return clicked;
    } catch (e) {
        return false;
    }
}

/**
 * Navigerar till en URL med retry och CAPTCHA-hantering
 */
async function navigateWithRetry(page, url, options = {}) {
    const { retries = CONFIG.MAX_RETRIES, solveCaptcha = true } = options;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            log(`Navigerar till ${url} (försök ${attempt}/${retries})`);
            
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: CONFIG.PAGE_TIMEOUT
            });
            
            await sleep(2000);
            
            // Ta screenshot
            const screenshotPath = path.join(CONFIG.SCREENSHOT_DIR, `nav_${Date.now()}.png`);
            await page.screenshot({ path: screenshotPath });
            
            // Kolla efter CAPTCHA
            const captchaType = await captchaSolver.detectCaptchaType(page);
            
            if (captchaType && solveCaptcha) {
                log(`CAPTCHA detekterad: ${captchaType}`);
                
                const result = await captchaSolver.solveCaptcha(page);
                
                if (result.success) {
                    log(`CAPTCHA löst med metod: ${result.method}`, 'success');
                    await sleep(2000);
                    
                    // Verifiera att vi kom förbi
                    const stillHasCaptcha = await captchaSolver.detectCaptchaType(page);
                    if (!stillHasCaptcha) {
                        return { success: true, attempt };
                    }
                    log('CAPTCHA finns fortfarande, försöker igen...');
                } else {
                    log('CAPTCHA-lösning misslyckades', 'error');
                }
            } else if (!captchaType) {
                // Ingen CAPTCHA, framgång!
                log('Navigation lyckades', 'success');
                return { success: true, attempt };
            }
            
        } catch (e) {
            log(`Navigeringsfel: ${e.message}`, 'error');
        }
        
        if (attempt < retries) {
            log(`Väntar ${CONFIG.RETRY_DELAY/1000}s innan nästa försök...`);
            await sleep(CONFIG.RETRY_DELAY);
        }
    }
    
    return { success: false, attempt: retries };
}

/**
 * Hämtar företagsinformation och tillgängliga dokument
 */
async function getCompanyDocuments(orgnr, options = {}) {
    const { headless = false } = options;
    
    log(`\n${'='.repeat(60)}`);
    log(`HÄMTAR DOKUMENT FÖR: ${orgnr}`);
    log(`${'='.repeat(60)}`);
    
    const { browser, page } = await createBrowser(headless);
    
    try {
        // Navigera till företagssidan
        const url = `${CONFIG.SEARCH_URL}/${orgnr}`;
        const navResult = await navigateWithRetry(page, url);
        
        if (!navResult.success) {
            return { success: false, error: 'Navigation misslyckades efter alla försök' };
        }
        
        await acceptCookies(page);
        await sleep(1000);
        
        // Extrahera företagsinfo och dokumentlänkar
        const data = await page.evaluate(() => {
            const result = {
                companyName: null,
                orgnr: null,
                documents: [],
                products: [],
                pageContent: null
            };
            
            // Företagsnamn
            const h1 = document.querySelector('h1');
            if (h1) result.companyName = h1.textContent.trim();
            
            // Sök efter dokumentlänkar och produkter
            const links = Array.from(document.querySelectorAll('a'));
            
            for (const link of links) {
                const href = link.href || '';
                const text = link.textContent.trim();
                
                if (href.includes('produkt')) {
                    result.products.push({
                        name: text,
                        url: href,
                        productCode: href.match(/produkt\/([A-Z]+)/)?.[1] || null
                    });
                }
            }
            
            // Hitta alla tillgängliga dokumenttyper
            const tables = document.querySelectorAll('table');
            tables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    if (cells.length > 0) {
                        const rowText = Array.from(cells).map(c => c.textContent.trim()).join(' | ');
                        const link = row.querySelector('a');
                        if (link) {
                            result.documents.push({
                                description: rowText,
                                url: link.href
                            });
                        }
                    }
                });
            });
            
            // Sidans fullständiga innehåll för analys
            result.pageContent = document.body.innerText.substring(0, 10000);
            
            return result;
        });
        
        // Ta slutlig screenshot
        const finalScreenshot = path.join(CONFIG.SCREENSHOT_DIR, `company_${orgnr}_${Date.now()}.png`);
        await page.screenshot({ path: finalScreenshot, fullPage: true });
        
        log(`Företag: ${data.companyName || 'Ej hittat'}`);
        log(`Produkter hittade: ${data.products.length}`);
        log(`Dokumentlänkar: ${data.documents.length}`);
        log(`Screenshot: ${finalScreenshot}`, 'success');
        
        return {
            success: true,
            orgnr,
            ...data,
            screenshot: finalScreenshot
        };
        
    } catch (e) {
        log(`Fel: ${e.message}`, 'error');
        return { success: false, error: e.message };
    } finally {
        await browser.close();
        log('Browser stängd');
    }
}

/**
 * Dokumenterar alla produkttyper på Bolagsverket
 */
async function discoverAllProducts(orgnr, options = {}) {
    const { headless = false } = options;
    
    log(`\n${'='.repeat(60)}`);
    log(`UNDERSÖKER ALLA PRODUKTTYPER`);
    log(`${'='.repeat(60)}`);
    
    const { browser, page } = await createBrowser(headless);
    
    // Kända produktkoder baserat på Bolagsverkets struktur
    const knownProductCodes = [
        'PROT',      // Bolagsstämmoprotokoll
        'REG',       // Registreringsbevis
        'ARS',       // Årsredovisning
        'BREV',      // Bevis om utlandsbosattas uppdrag
        'GRAV',      // Gravationsbevis
        'ARBE',      // Ärendebevis företrädare
        'ARNB',      // Ärendebevis nybildning
        'ARSA',      // Ärendebevis årsredovisning
        'KOPI',      // Kopia av handling
        'STIF',      // Stiftelseurkund
        'BANK',      // Bankintyg
        'BOLT',      // Bolagsordning
        'SIGN',      // Signaturkort
        'FUNK',      // Funktionärsbevis
    ];
    
    const results = {
        products: [],
        failedProducts: []
    };
    
    try {
        for (const productCode of knownProductCodes) {
            const url = `${CONFIG.SEARCH_URL}/produkt/${productCode}/organisationsnummer/${orgnr}`;
            log(`Testar produkt: ${productCode}`);
            
            try {
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
                await sleep(1500);
                
                // Kolla efter CAPTCHA
                const captchaType = await captchaSolver.detectCaptchaType(page);
                if (captchaType) {
                    log(`CAPTCHA vid ${productCode}, försöker lösa...`);
                    await captchaSolver.solveCaptcha(page);
                    await sleep(2000);
                }
                
                // Extrahera produktinfo
                const productInfo = await page.evaluate((code) => {
                    const info = {
                        code: code,
                        name: null,
                        description: null,
                        price: null,
                        available: false,
                        options: []
                    };
                    
                    // Kolla om produkten finns
                    const bodyText = document.body.innerText;
                    
                    if (bodyText.includes('finns inte') || 
                        bodyText.includes('saknas') ||
                        bodyText.includes('kunde inte hittas')) {
                        return info;
                    }
                    
                    info.available = true;
                    
                    // Produktnamn
                    const h2 = document.querySelector('h2, h3');
                    if (h2) info.name = h2.textContent.trim();
                    
                    // Pris
                    const priceMatch = bodyText.match(/(\d+)\s*kr/i);
                    if (priceMatch) info.price = parseInt(priceMatch[1]);
                    
                    // Beskrivning
                    const paragraphs = document.querySelectorAll('p');
                    paragraphs.forEach(p => {
                        if (p.textContent.length > 20 && p.textContent.length < 500) {
                            info.description = p.textContent.trim();
                        }
                    });
                    
                    // Tillgängliga alternativ (checkboxar, radioknappar)
                    const inputs = document.querySelectorAll('input[type="checkbox"], input[type="radio"]');
                    inputs.forEach(input => {
                        const label = input.labels?.[0]?.textContent?.trim() || input.id;
                        if (label) info.options.push(label);
                    });
                    
                    return info;
                }, productCode);
                
                if (productInfo.available) {
                    results.products.push(productInfo);
                    log(`  ✓ ${productCode}: ${productInfo.name || 'Tillgänglig'} - ${productInfo.price || '?'} kr`);
                } else {
                    results.failedProducts.push(productCode);
                    log(`  ✗ ${productCode}: Ej tillgänglig`);
                }
                
            } catch (e) {
                log(`  ✗ ${productCode}: Fel - ${e.message}`, 'error');
                results.failedProducts.push(productCode);
            }
        }
        
        // Spara resultat
        const outputPath = path.join(CONFIG.SCREENSHOT_DIR, `products_${orgnr}_${Date.now()}.json`);
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        log(`\nResultat sparat: ${outputPath}`, 'success');
        
        return results;
        
    } finally {
        await browser.close();
    }
}

/**
 * Sparar framgångsrika metoder för framtida användning
 */
function saveSuccessfulMethod(method, details) {
    const methodsFile = path.join(__dirname, '../../data/successful_methods.json');
    
    let methods = { methods: [] };
    if (fs.existsSync(methodsFile)) {
        try {
            methods = JSON.parse(fs.readFileSync(methodsFile, 'utf8'));
        } catch (e) {}
    }
    
    methods.methods.push({
        timestamp: new Date().toISOString(),
        method,
        details,
        success: true
    });
    
    // Behåll bara de 100 senaste
    methods.methods = methods.methods.slice(-100);
    
    fs.writeFileSync(methodsFile, JSON.stringify(methods, null, 2));
    log(`Metod sparad: ${method}`, 'success');
}

// Export
module.exports = {
    CONFIG,
    createBrowser,
    acceptCookies,
    navigateWithRetry,
    getCompanyDocuments,
    discoverAllProducts,
    saveSuccessfulMethod
};

// CLI
if (require.main === module) {
    const orgnr = process.argv[2] || '5591628660'; // Northvolt default
    const mode = process.argv[3] || 'info';
    
    (async () => {
        if (mode === 'discover') {
            const results = await discoverAllProducts(orgnr, { headless: false });
            console.log('\n📊 SAMMANFATTNING:');
            console.log(`   Tillgängliga produkter: ${results.products.length}`);
            console.log(`   Ej tillgängliga: ${results.failedProducts.length}`);
            console.log('\n📄 Produkter:');
            results.products.forEach(p => {
                console.log(`   - ${p.code}: ${p.name} (${p.price} kr)`);
            });
        } else {
            const result = await getCompanyDocuments(orgnr, { headless: false });
            console.log('\n📄 RESULTAT:');
            console.log(JSON.stringify(result, null, 2));
        }
    })().catch(console.error);
}
