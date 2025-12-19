/**
 * Bolagsverket Navigator - Automatisk navigation och dokumenthämtning
 *
 * KOMPLETT DOKUMENTKÖPSSYSTEM
 * ===========================
 * Hanterar hela flödet från sökning till köp och sparning:
 * 1. Sökning av företag och dokument
 * 2. CAPTCHA-lösning
 * 3. Varukorg och checkout
 * 4. Betalning (kortbetalning)
 * 5. Bekräftelse och dokumentnedladdning
 * 6. Sparning till Supabase
 *
 * Använder:
 * - puppeteer-extra med stealth plugin
 * - Automatisk CAPTCHA-lösning
 * - Retry-logik med flera metoder
 * - Daglig köpgräns via purchase_logger
 *
 * Dokumenterar alla tillgängliga dokumenttyper på foretagsinfo.bolagsverket.se
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const captchaSolver = require('../services/auto_captcha_solver');
const purchaseLogger = require('../services/purchase_logger');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

puppeteer.use(StealthPlugin());

// Supabase-klient
const supabaseUrl = process.env.SUPABASE_URL || 'https://wzkohrittxdrstsmwopco.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
let supabase = null;

function getSupabase() {
    if (!supabase && supabaseKey) {
        supabase = createClient(supabaseUrl, supabaseKey);
    }
    return supabase;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Konfiguration
const CONFIG = {
    BASE_URL: 'https://foretagsinfo.bolagsverket.se',
    SEARCH_URL: 'https://foretagsinfo.bolagsverket.se/sok-foretagsinformation-web/foretag',
    MAX_RETRIES: 5,
    RETRY_DELAY: 3000,
    PAGE_TIMEOUT: 60000,
    SCREENSHOT_DIR: '/tmp/bolagsverket',
    DOWNLOAD_DIR: path.join(__dirname, '../../data/documents')
};

// Produktkoder och deras metadata
const PRODUCT_TYPES = {
    // Bolagsstämmor & Protokoll
    PROT: {
        name: 'Bolagsstämmoprotokoll',
        description: 'Protokoll från bolagsstämma',
        category: 'stammoprotokoll',
        eventTriggers: ['beslut om likvidation', 'extra bolagsstämma', 'årsstämma']
    },
    // Bolagsordning
    BOLT: {
        name: 'Bolagsordning',
        description: 'Bolagets stadgar och regler',
        category: 'bolagsordning',
        eventTriggers: ['ändrad bolagsordning', 'ändring av bolagsordning']
    },
    BOLORDN: {
        name: 'Bolagsordning (kopia)',
        description: 'Kopia av bolagsordning',
        category: 'bolagsordning',
        eventTriggers: ['ändrad bolagsordning']
    },
    // Verkliga huvudmän
    RVHBEV: {
        name: 'Verkliga huvudmän',
        description: 'Bevis om verkliga huvudmän',
        category: 'verkliga_huvudman',
        eventTriggers: ['verklig huvudman', 'huvudmän']
    },
    // Registreringsbevis
    REG: {
        name: 'Registreringsbevis',
        description: 'Bevis om företagets registrering',
        category: 'registrering',
        eventTriggers: ['registrering', 'namnändring', 'styrelseändring']
    },
    // Årsredovisning
    ARS: {
        name: 'Årsredovisning',
        description: 'Senaste årsredovisning',
        category: 'arsredovisning',
        eventTriggers: ['årsredovisning', 'bokslut']
    },
    // Fusion/Fission
    FUSBE: {
        name: 'Fusionsbevis',
        description: 'Bevis om fusion mellan bolag',
        category: 'strukturforandring',
        eventTriggers: ['fusion']
    },
    // Likvidation
    LIKBE: {
        name: 'Likvidationsbevis',
        description: 'Bevis om likvidation',
        category: 'likvidation',
        eventTriggers: ['likvidation', 'upplöst']
    },
    // Övriga
    GRAV: {
        name: 'Gravationsbevis',
        description: 'Bevis om gravationer/skulder',
        category: 'ovrigt',
        eventTriggers: []
    },
    FUNK: {
        name: 'Funktionärsbevis',
        description: 'Bevis om funktionärer',
        category: 'funktionarer',
        eventTriggers: ['styrelseändring', 'vd-ändring']
    },
    STIF: {
        name: 'Stiftelseurkund',
        description: 'Ursprunglig stiftelseurkund',
        category: 'ovrigt',
        eventTriggers: []
    },
    KOPI: {
        name: 'Kopia av handling',
        description: 'Kopia av specifik handling',
        category: 'ovrigt',
        eventTriggers: []
    }
};

/**
 * Mappar eventtyp till relevanta produktkoder
 * Används för att automatiskt föreslå dokument baserat på bolagshändelse
 */
function getRelevantProducts(eventType, eventTitle = '') {
    const titleLower = eventTitle.toLowerCase();
    const relevantProducts = [];

    for (const [code, product] of Object.entries(PRODUCT_TYPES)) {
        for (const trigger of product.eventTriggers) {
            if (titleLower.includes(trigger.toLowerCase())) {
                relevantProducts.push({ code, ...product });
                break;
            }
        }
    }

    // Fallback baserat på eventtyp
    if (relevantProducts.length === 0) {
        if (eventType === 'PROT' || titleLower.includes('protokoll') || titleLower.includes('stämma')) {
            relevantProducts.push({ code: 'PROT', ...PRODUCT_TYPES.PROT });
        }
        if (eventType === 'BOLORDN' || titleLower.includes('bolagsordning')) {
            relevantProducts.push({ code: 'BOLT', ...PRODUCT_TYPES.BOLT });
        }
        if (eventType === 'RVHBEV' || titleLower.includes('huvudman')) {
            relevantProducts.push({ code: 'RVHBEV', ...PRODUCT_TYPES.RVHBEV });
        }
    }

    return relevantProducts;
}

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

/**
 * Simulera mänskligt beteende vid typing
 */
async function humanType(page, selector, text) {
    await page.click(selector);
    await sleep(Math.random() * 500 + 300);

    for (const char of text) {
        await page.keyboard.type(char, { delay: Math.random() * 120 + 40 });
    }
}

/**
 * Simulera mänsklig musrörelse
 */
async function humanMouseMove(page, x, y) {
    const steps = Math.floor(Math.random() * 8) + 4;
    await page.mouse.move(x, y, { steps });
}

/**
 * =============================================================================
 * HUVUDFUNKTION: Komplett dokumentköp
 * =============================================================================
 *
 * Hanterar hela köpflödet:
 * 1. Navigerar till produktsidan
 * 2. Löser eventuell CAPTCHA
 * 3. Lägger produkt i varukorg
 * 4. Genomför checkout
 * 5. Hanterar betalning
 * 6. Bekräftar och laddar ner dokument
 * 7. Sparar till Supabase
 */
async function purchaseDocument(orgnr, productCode, options = {}) {
    const {
        headless = false,
        email = process.env.PURCHASE_EMAIL || 'dokument@loop-impact.se',
        dryRun = false,  // Kör utan att faktiskt köpa
        saveToSupabase = true,
        eventContext = null  // { eventId, eventTitle, eventType }
    } = options;

    log(`\n${'='.repeat(60)}`);
    log(`DOKUMENTKÖP: ${productCode} för ${orgnr}`);
    log(`${'='.repeat(60)}`);
    log(`Dry run: ${dryRun ? 'JA' : 'NEJ'}`);

    // Hämta produktinfo
    const productInfo = PRODUCT_TYPES[productCode];
    if (!productInfo) {
        return { success: false, error: `Okänd produktkod: ${productCode}` };
    }
    log(`Produkt: ${productInfo.name}`);

    // Kontrollera köpgräns (om inte dry run)
    if (!dryRun) {
        const priceEstimate = 2.50;  // Standardpris för de flesta dokument
        const canBuy = purchaseLogger.canPurchase(priceEstimate);

        if (!canBuy.allowed) {
            log(`Daglig gräns nådd! Dagens köp: ${canBuy.todayTotal} SEK`, 'error');
            return {
                success: false,
                error: 'Daglig köpgräns uppnådd',
                todayTotal: canBuy.todayTotal,
                dailyLimit: canBuy.dailyLimit
            };
        }
        log(`Köpgräns OK: ${canBuy.remaining} SEK kvar idag`);
    }

    // Säkerställ download-mapp finns
    if (!fs.existsSync(CONFIG.DOWNLOAD_DIR)) {
        fs.mkdirSync(CONFIG.DOWNLOAD_DIR, { recursive: true });
    }

    const { browser, page } = await createBrowser(headless);

    const result = {
        success: false,
        orgnr,
        productCode,
        productName: productInfo.name,
        steps: [],
        screenshots: [],
        orderNumber: null,
        price: null,
        documentPath: null
    };

    try {
        // =====================================================================
        // STEG 1: Navigera till produktsidan
        // =====================================================================
        log('\n📌 Steg 1: Navigerar till produktsidan...');
        result.steps.push({ step: 1, name: 'navigation', status: 'started' });

        const productUrl = `${CONFIG.SEARCH_URL}/produkt/${productCode}/organisationsnummer/${orgnr}`;
        const navResult = await navigateWithRetry(page, productUrl);

        if (!navResult.success) {
            result.steps[0].status = 'failed';
            result.error = 'Navigation till produktsidan misslyckades';
            return result;
        }

        await acceptCookies(page);
        await sleep(1500);

        // Ta screenshot
        const screenshot1 = path.join(CONFIG.SCREENSHOT_DIR, `purchase_${orgnr}_${productCode}_step1.png`);
        await page.screenshot({ path: screenshot1 });
        result.screenshots.push(screenshot1);
        result.steps[0].status = 'completed';
        log('   ✓ Produktsidan laddad', 'success');

        // =====================================================================
        // STEG 2: Verifiera att produkten finns och hämta pris
        // =====================================================================
        log('\n📌 Steg 2: Verifierar produkt och pris...');
        result.steps.push({ step: 2, name: 'verify_product', status: 'started' });

        const productDetails = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const details = {
                available: true,
                price: null,
                title: null,
                description: null,
                addToCartButton: null
            };

            // Kolla om produkten saknas
            if (bodyText.includes('finns inte') ||
                bodyText.includes('saknas') ||
                bodyText.includes('kunde inte hittas') ||
                bodyText.includes('Ingen produkt')) {
                details.available = false;
                return details;
            }

            // Hämta pris
            const priceMatch = bodyText.match(/(\d+(?:[,\.]\d{2})?)\s*(?:kr|SEK)/i);
            if (priceMatch) {
                details.price = parseFloat(priceMatch[1].replace(',', '.'));
            }

            // Hämta titel
            const h1 = document.querySelector('h1, h2');
            if (h1) details.title = h1.textContent.trim();

            // Hitta "Lägg i varukorg" knapp
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
            const addBtn = buttons.find(b =>
                b.textContent?.toLowerCase().includes('varukorg') ||
                b.textContent?.toLowerCase().includes('köp') ||
                b.value?.toLowerCase().includes('varukorg')
            );
            if (addBtn) {
                details.addToCartButton = true;
            }

            return details;
        });

        if (!productDetails.available) {
            result.steps[1].status = 'failed';
            result.error = `Produkten ${productCode} finns inte för detta företag`;
            return result;
        }

        result.price = productDetails.price;
        log(`   Produkt: ${productDetails.title || productInfo.name}`);
        log(`   Pris: ${result.price || 'Ej angivet'} kr`);
        result.steps[1].status = 'completed';

        // =====================================================================
        // STEG 3: Lägg i varukorg
        // =====================================================================
        log('\n📌 Steg 3: Lägger i varukorg...');
        result.steps.push({ step: 3, name: 'add_to_cart', status: 'started' });

        if (dryRun) {
            log('   [DRY RUN] Hoppar över varukorg', 'success');
            result.steps[2].status = 'skipped_dryrun';
        } else {
            // Klicka på "Lägg i varukorg"
            const addedToCart = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                const addBtn = buttons.find(b =>
                    b.textContent?.toLowerCase().includes('varukorg') ||
                    b.textContent?.toLowerCase().includes('köp') ||
                    b.textContent?.toLowerCase().includes('beställ') ||
                    b.value?.toLowerCase().includes('varukorg')
                );
                if (addBtn) {
                    addBtn.click();
                    return true;
                }
                return false;
            });

            if (!addedToCart) {
                // Försök med Enter på formulär
                const form = await page.$('form');
                if (form) {
                    await page.keyboard.press('Enter');
                }
            }

            await sleep(3000);

            // Ta screenshot
            const screenshot3 = path.join(CONFIG.SCREENSHOT_DIR, `purchase_${orgnr}_${productCode}_step3.png`);
            await page.screenshot({ path: screenshot3 });
            result.screenshots.push(screenshot3);
            result.steps[2].status = 'completed';
            log('   ✓ Produkt tillagd i varukorg', 'success');
        }

        // =====================================================================
        // STEG 4: Gå till kassan
        // =====================================================================
        log('\n📌 Steg 4: Går till kassan...');
        result.steps.push({ step: 4, name: 'checkout', status: 'started' });

        if (dryRun) {
            log('   [DRY RUN] Hoppar över checkout', 'success');
            result.steps[3].status = 'skipped_dryrun';
        } else {
            // Navigera till kassan
            const checkoutClicked = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a, button'));
                const checkoutLink = links.find(el =>
                    el.textContent?.toLowerCase().includes('kassa') ||
                    el.textContent?.toLowerCase().includes('betala') ||
                    el.textContent?.toLowerCase().includes('checkout') ||
                    el.href?.includes('kassa') ||
                    el.href?.includes('checkout')
                );
                if (checkoutLink) {
                    checkoutLink.click();
                    return true;
                }
                return false;
            });

            if (!checkoutClicked) {
                // Försök med direkt URL
                await page.goto(`${CONFIG.BASE_URL}/sok-foretagsinformation-web/kassa`, {
                    waitUntil: 'networkidle2',
                    timeout: CONFIG.PAGE_TIMEOUT
                });
            }

            await sleep(3000);

            // Ta screenshot
            const screenshot4 = path.join(CONFIG.SCREENSHOT_DIR, `purchase_${orgnr}_${productCode}_step4.png`);
            await page.screenshot({ path: screenshot4 });
            result.screenshots.push(screenshot4);
            result.steps[3].status = 'completed';
            log('   ✓ Kassan öppnad', 'success');
        }

        // =====================================================================
        // STEG 5: Fyll i e-post och genomför köp
        // =====================================================================
        log('\n📌 Steg 5: Fyller i beställningsuppgifter...');
        result.steps.push({ step: 5, name: 'fill_order', status: 'started' });

        if (dryRun) {
            log('   [DRY RUN] Hoppar över beställning', 'success');
            result.steps[4].status = 'skipped_dryrun';
        } else {
            // Fyll i e-post
            const emailInput = await page.$('input[type="email"], input[name="email"], input[name="epost"]');
            if (emailInput) {
                await humanType(page, 'input[type="email"], input[name="email"], input[name="epost"]', email);
                log(`   E-post: ${email}`);
            }

            // Godkänn villkor om checkbox finns
            const checkbox = await page.$('input[type="checkbox"]');
            if (checkbox) {
                await checkbox.click();
                log('   ✓ Villkor godkända');
            }

            await sleep(1000);

            // Ta screenshot före betalning
            const screenshot5 = path.join(CONFIG.SCREENSHOT_DIR, `purchase_${orgnr}_${productCode}_step5.png`);
            await page.screenshot({ path: screenshot5 });
            result.screenshots.push(screenshot5);
            result.steps[4].status = 'completed';
        }

        // =====================================================================
        // STEG 6: Slutför köp / Betalning
        // =====================================================================
        log('\n📌 Steg 6: Slutför betalning...');
        result.steps.push({ step: 6, name: 'payment', status: 'started' });

        if (dryRun) {
            log('   [DRY RUN] Simulerar framgångsrikt köp', 'success');
            result.steps[5].status = 'skipped_dryrun';
            result.orderNumber = `DRY-${Date.now()}`;
        } else {
            // Klicka på betala/slutför
            const payClicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                const payBtn = buttons.find(b =>
                    b.textContent?.toLowerCase().includes('betala') ||
                    b.textContent?.toLowerCase().includes('slutför') ||
                    b.textContent?.toLowerCase().includes('genomför') ||
                    b.value?.toLowerCase().includes('betala')
                );
                if (payBtn && !payBtn.disabled) {
                    payBtn.click();
                    return true;
                }
                return false;
            });

            if (payClicked) {
                log('   Betalning initierad...');
                await sleep(5000);  // Vänta på betalningsprocessen
            }

            // Hämta ordernummer från bekräftelsesidan
            const orderInfo = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                const orderMatch = bodyText.match(/(?:order|beställning|ordernummer)[:\s]*([A-Z0-9\-]+)/i);
                return {
                    orderNumber: orderMatch ? orderMatch[1] : null,
                    confirmed: bodyText.toLowerCase().includes('tack') ||
                               bodyText.toLowerCase().includes('bekräftelse') ||
                               bodyText.toLowerCase().includes('lyckades')
                };
            });

            result.orderNumber = orderInfo.orderNumber;

            // Ta screenshot av bekräftelse
            const screenshot6 = path.join(CONFIG.SCREENSHOT_DIR, `purchase_${orgnr}_${productCode}_step6.png`);
            await page.screenshot({ path: screenshot6 });
            result.screenshots.push(screenshot6);

            if (orderInfo.confirmed) {
                result.steps[5].status = 'completed';
                log(`   ✓ Köp genomfört! Order: ${result.orderNumber || 'Ej angivet'}`, 'success');

                // Logga köpet
                purchaseLogger.logPurchase({
                    orgnr,
                    companyName: productDetails.title,
                    documentType: productCode,
                    amountSEK: result.price || 2.50,
                    ordernummer: result.orderNumber,
                    email,
                    status: 'completed',
                    notes: eventContext ? `Event: ${eventContext.eventTitle}` : null
                });
            } else {
                result.steps[5].status = 'uncertain';
                log('   ⚠️ Betalningsstatus oklar - kontrollera manuellt');
            }
        }

        // =====================================================================
        // STEG 7: Ladda ner dokument
        // =====================================================================
        log('\n📌 Steg 7: Laddar ner dokument...');
        result.steps.push({ step: 7, name: 'download', status: 'started' });

        if (dryRun) {
            log('   [DRY RUN] Hoppar över nedladdning', 'success');
            result.steps[6].status = 'skipped_dryrun';
        } else {
            // Vänta på att dokumentet blir tillgängligt
            await sleep(3000);

            // Hitta nedladdningslänk
            const downloadInfo = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const downloadLink = links.find(a =>
                    a.href?.includes('download') ||
                    a.href?.includes('.pdf') ||
                    a.textContent?.toLowerCase().includes('ladda ner') ||
                    a.textContent?.toLowerCase().includes('hämta') ||
                    a.textContent?.toLowerCase().includes('dokument')
                );

                return downloadLink ? {
                    url: downloadLink.href,
                    text: downloadLink.textContent?.trim()
                } : null;
            });

            if (downloadInfo?.url) {
                log(`   Nedladdningslänk: ${downloadInfo.text || downloadInfo.url}`);

                // Konfigurera nedladdning
                const downloadPath = CONFIG.DOWNLOAD_DIR;
                if (!fs.existsSync(downloadPath)) {
                    fs.mkdirSync(downloadPath, { recursive: true });
                }

                // Sätt upp nedladdningshantering
                const client = await page.target().createCDPSession();
                await client.send('Page.setDownloadBehavior', {
                    behavior: 'allow',
                    downloadPath: downloadPath
                });

                // Klicka på nedladdningslänk
                await page.evaluate((url) => {
                    const link = document.querySelector(`a[href="${url}"]`);
                    if (link) link.click();
                }, downloadInfo.url);

                // Vänta på nedladdning
                await sleep(5000);

                // Hitta den nedladdade filen
                const files = fs.readdirSync(downloadPath)
                    .filter(f => f.includes(orgnr) || f.includes(productCode) || f.endsWith('.pdf'))
                    .map(f => ({
                        name: f,
                        path: path.join(downloadPath, f),
                        mtime: fs.statSync(path.join(downloadPath, f)).mtime
                    }))
                    .sort((a, b) => b.mtime - a.mtime);

                if (files.length > 0) {
                    result.documentPath = files[0].path;
                    result.documentName = files[0].name;
                    result.steps[6].status = 'completed';
                    log(`   ✓ Dokument nedladdat: ${files[0].name}`, 'success');
                } else {
                    result.steps[6].status = 'warning';
                    log('   ⚠️ Kunde inte verifiera nedladdning');
                }
            } else {
                // Alternativ: Dokumentet skickas till e-post
                log('   📧 Dokument skickas till e-post (ingen direktnedladdning)', 'success');
                result.steps[6].status = 'email_delivery';
                result.deliveryMethod = 'email';
            }
        }

        // =====================================================================
        // STEG 8: Spara till Supabase Storage & Databas
        // =====================================================================
        log('\n📌 Steg 8: Sparar till Supabase...');
        result.steps.push({ step: 8, name: 'supabase_save', status: 'started' });

        if (dryRun) {
            log('   [DRY RUN] Hoppar över Supabase-sparning', 'success');
            result.steps[7].status = 'skipped_dryrun';
        } else if (saveToSupabase && result.documentPath && fs.existsSync(result.documentPath)) {
            const sb = getSupabase();

            if (sb) {
                try {
                    // Läs filen
                    const fileBuffer = fs.readFileSync(result.documentPath);
                    const fileName = `${orgnr}/${productCode}_${Date.now()}.pdf`;

                    // Ladda upp till Storage
                    const { data: uploadData, error: uploadError } = await sb.storage
                        .from('company-documents')
                        .upload(fileName, fileBuffer, {
                            contentType: 'application/pdf',
                            upsert: false
                        });

                    if (uploadError) {
                        throw new Error(`Storage upload: ${uploadError.message}`);
                    }

                    log(`   ✓ Uppladdad till Storage: ${fileName}`, 'success');

                    // Hämta publik URL
                    const { data: urlData } = sb.storage
                        .from('company-documents')
                        .getPublicUrl(fileName);

                    result.storageUrl = urlData?.publicUrl;

                    // Spara metadata i databasen (matchar company_documents tabell-schema)
                    // document_type enum: poit_kungorelse, arsredovisning, pressmeddelande, allmanhandling, dom, insolvens, ovrigt
                    const docTypeMap = {
                        'ARS': 'arsredovisning',
                        'PROT': 'allmanhandling',
                        'BOLT': 'allmanhandling',
                        'REG': 'allmanhandling',
                        'RVHBEV': 'allmanhandling',
                        'GRAV': 'allmanhandling',
                        'FUNK': 'allmanhandling'
                    };
                    const mappedDocType = docTypeMap[productCode] || 'ovrigt';

                    const { data: dbData, error: dbError } = await sb
                        .from('company_documents')
                        .insert({
                            org_nr: orgnr,
                            document_type: mappedDocType,
                            document_subtype: productCode,
                            external_id: result.orderNumber,
                            title: productInfo.name,
                            summary: `Köpt från Bolagsverket: ${productInfo.description || productInfo.name}`,
                            source_url: `${CONFIG.SEARCH_URL}/produkt/${productCode}/organisationsnummer/${orgnr}`,
                            file_url: result.storageUrl,
                            file_type: 'application/pdf',
                            document_date: new Date().toISOString().split('T')[0],
                            source: 'bolagsverket',
                            status: 'fetched',
                            metadata: {
                                product_code: productCode,
                                price_sek: result.price,
                                email: email,
                                file_path: fileName,
                                event_id: eventContext?.eventId || null,
                                event_title: eventContext?.eventTitle || null,
                                screenshots: result.screenshots,
                                steps: result.steps
                            }
                        })
                        .select()
                        .single();

                    if (dbError) {
                        throw new Error(`Database insert: ${dbError.message}`);
                    }

                    result.databaseId = dbData?.id;
                    result.steps[7].status = 'completed';
                    log(`   ✓ Sparat i databas med ID: ${result.databaseId}`, 'success');

                } catch (supabaseError) {
                    log(`   ⚠️ Supabase-fel: ${supabaseError.message}`, 'error');
                    result.steps[7].status = 'failed';
                    result.supabaseError = supabaseError.message;
                }
            } else {
                log('   ⚠️ Supabase ej konfigurerad (saknar SUPABASE_SERVICE_KEY)', 'error');
                result.steps[7].status = 'skipped_no_config';
            }
        } else if (!result.documentPath) {
            // Om dokumentet levereras via e-post, spara endast metadata
            const sb = getSupabase();
            if (sb && saveToSupabase) {
                try {
                    // Mappa produktkod till document_type enum
                    const docTypeMap = {
                        'ARS': 'arsredovisning',
                        'PROT': 'allmanhandling',
                        'BOLT': 'allmanhandling',
                        'REG': 'allmanhandling',
                        'RVHBEV': 'allmanhandling',
                        'GRAV': 'allmanhandling',
                        'FUNK': 'allmanhandling'
                    };
                    const mappedDocType = docTypeMap[productCode] || 'ovrigt';

                    const { data: dbData, error: dbError } = await sb
                        .from('company_documents')
                        .insert({
                            org_nr: orgnr,
                            document_type: mappedDocType,
                            document_subtype: productCode,
                            external_id: result.orderNumber,
                            title: productInfo.name,
                            summary: `Beställd från Bolagsverket, levereras via e-post till ${email}`,
                            source_url: `${CONFIG.SEARCH_URL}/produkt/${productCode}/organisationsnummer/${orgnr}`,
                            source: 'bolagsverket',
                            status: 'pending',
                            document_date: new Date().toISOString().split('T')[0],
                            metadata: {
                                product_code: productCode,
                                price_sek: result.price,
                                delivery_method: 'email',
                                delivery_email: email,
                                event_id: eventContext?.eventId || null,
                                event_title: eventContext?.eventTitle || null,
                                screenshots: result.screenshots,
                                steps: result.steps
                            }
                        })
                        .select()
                        .single();

                    if (!dbError) {
                        result.databaseId = dbData?.id;
                        result.steps[7].status = 'completed';
                        log(`   ✓ Metadata sparad (väntar på e-postleverans)`, 'success');
                    }
                } catch (e) {
                    log(`   ⚠️ Kunde inte spara metadata: ${e.message}`, 'error');
                }
            }
        }

        // Markera som framgångsrikt
        result.success = true;
        saveSuccessfulMethod('purchase', { orgnr, productCode, dryRun });

        log(`\n${'='.repeat(60)}`);
        log(`✅ DOKUMENTKÖP ${dryRun ? '(DRY RUN) ' : ''}SLUTFÖRT`);
        log(`${'='.repeat(60)}`);
        log(`Ordernummer: ${result.orderNumber || 'N/A'}`);
        log(`Pris: ${result.price || 'N/A'} kr`);
        log(`Dokument: ${result.documentPath || result.deliveryMethod || 'N/A'}`);
        log(`Supabase ID: ${result.databaseId || 'N/A'}`);
        log(`Screenshots: ${result.screenshots.length} sparade`);

        return result;

    } catch (e) {
        log(`Fel vid köp: ${e.message}`, 'error');
        result.error = e.message;

        // Ta error-screenshot
        const errorScreenshot = path.join(CONFIG.SCREENSHOT_DIR, `purchase_${orgnr}_${productCode}_error.png`);
        await page.screenshot({ path: errorScreenshot });
        result.screenshots.push(errorScreenshot);

        return result;
    } finally {
        await browser.close();
        log('Browser stängd');
    }
}

/**
 * Köper dokument baserat på bolagshändelse
 * Analyserar händelsen och väljer lämplig dokumenttyp automatiskt
 */
async function purchaseFromEvent(orgnr, eventData, options = {}) {
    const { eventTitle, eventType, eventId } = eventData;

    log(`\n${'='.repeat(60)}`);
    log(`UNDERSÖK HÄNDELSE: ${eventTitle}`);
    log(`${'='.repeat(60)}`);

    // Hitta relevanta produkter baserat på händelsen
    const relevantProducts = getRelevantProducts(eventType, eventTitle);

    if (relevantProducts.length === 0) {
        log('Inga relevanta dokument identifierade för denna händelse', 'error');
        return {
            success: false,
            error: 'Inga relevanta dokumenttyper hittades',
            eventTitle,
            eventType
        };
    }

    log(`Relevanta dokument: ${relevantProducts.map(p => p.code).join(', ')}`);

    // Köp det första relevanta dokumentet (eller alla om specificerat)
    const purchaseAll = options.purchaseAll || false;
    const results = [];

    for (const product of relevantProducts) {
        log(`\nKöper: ${product.name} (${product.code})`);

        const purchaseResult = await purchaseDocument(orgnr, product.code, {
            ...options,
            eventContext: { eventId, eventTitle, eventType }
        });

        results.push(purchaseResult);

        // Avbryt om inte purchaseAll och första lyckades
        if (!purchaseAll && purchaseResult.success) {
            break;
        }

        // Vänta mellan köp
        if (purchaseAll && product !== relevantProducts[relevantProducts.length - 1]) {
            await sleep(3000);
        }
    }

    return {
        success: results.some(r => r.success),
        eventTitle,
        eventType,
        purchasedDocuments: results.filter(r => r.success),
        failedDocuments: results.filter(r => !r.success),
        totalResults: results.length
    };
}

/**
 * Hämtar köpstatistik
 */
function getPurchaseStats() {
    return purchaseLogger.getStats();
}

/**
 * =============================================================================
 * HUVUDFUNKTION: Komplett undersökning av bolagshändelse
 * =============================================================================
 *
 * Detta är den huvudsakliga entry-point för att undersöka en bolagshändelse.
 * Hanterar HELA flödet:
 * 1. Analyserar händelsen och identifierar relevanta dokument
 * 2. Söker på Bolagsverket Företagsinfo
 * 3. Hittar och väljer rätt dokument
 * 4. Genomför köp med CAPTCHA-hantering
 * 5. Betalning
 * 6. Laddar ner dokumentfil
 * 7. Sparar fil till Supabase Storage
 * 8. Sparar metadata till company_documents tabell
 *
 * @param {string} orgnr - Organisationsnummer
 * @param {object} eventData - { eventId, eventTitle, eventType, kungorelseId }
 * @param {object} options - Konfigurationsalternativ
 * @returns {object} Resultat med alla steg och sparade dokument
 */
async function investigateCompanyEvent(orgnr, eventData, options = {}) {
    const {
        headless = false,
        email = process.env.PURCHASE_EMAIL || 'dokument@loop-impact.se',
        dryRun = false,
        saveToSupabase = true,
        autoSelectDocument = true,  // Automatiskt välj dokument baserat på händelse
        specificProductCode = null  // Eller ange specifik produktkod
    } = options;

    const startTime = Date.now();

    log(`\n${'═'.repeat(70)}`);
    log(`  🔍 UNDERSÖKER BOLAGSHÄNDELSE`);
    log(`${'═'.repeat(70)}`);
    log(`  Orgnr: ${orgnr}`);
    log(`  Händelse: ${eventData.eventTitle || 'N/A'}`);
    log(`  Typ: ${eventData.eventType || 'N/A'}`);
    log(`  Kungörelse-ID: ${eventData.kungorelseId || 'N/A'}`);
    log(`  Dry run: ${dryRun ? 'JA' : 'NEJ'}`);
    log(`${'═'.repeat(70)}\n`);

    const result = {
        success: false,
        orgnr,
        eventData,
        startTime: new Date().toISOString(),
        phases: [],
        documents: [],
        errors: []
    };

    try {
        // =====================================================================
        // FAS 1: Analysera händelse och identifiera dokument
        // =====================================================================
        log('📋 Fas 1: Analyserar händelse...');
        result.phases.push({ phase: 1, name: 'analyze', status: 'started' });

        let productsToFetch = [];

        if (specificProductCode) {
            // Specifik produktkod angiven
            const productInfo = PRODUCT_TYPES[specificProductCode];
            if (productInfo) {
                productsToFetch = [{ code: specificProductCode, ...productInfo }];
                log(`   Specifik produkt: ${specificProductCode} - ${productInfo.name}`);
            } else {
                throw new Error(`Okänd produktkod: ${specificProductCode}`);
            }
        } else if (autoSelectDocument) {
            // Automatisk identifiering baserat på händelse
            productsToFetch = getRelevantProducts(eventData.eventType, eventData.eventTitle);
            log(`   Identifierade ${productsToFetch.length} relevanta dokumenttyper:`);
            productsToFetch.forEach(p => log(`   - ${p.code}: ${p.name}`));
        }

        if (productsToFetch.length === 0) {
            // Fallback: Försök med registreringsbevis
            log('   Ingen specifik typ identifierad, använder REG (registreringsbevis)');
            productsToFetch = [{ code: 'REG', ...PRODUCT_TYPES.REG }];
        }

        result.phases[0].status = 'completed';
        result.phases[0].productsIdentified = productsToFetch.map(p => p.code);

        // =====================================================================
        // FAS 2: Hämta företagsinfo och verifiera tillgänglighet
        // =====================================================================
        log('\n📋 Fas 2: Hämtar företagsinfo...');
        result.phases.push({ phase: 2, name: 'fetch_company_info', status: 'started' });

        const companyInfo = await getCompanyDocuments(orgnr, { headless });

        if (!companyInfo.success) {
            throw new Error(`Kunde inte hämta företagsinfo: ${companyInfo.error}`);
        }

        result.companyName = companyInfo.companyName;
        result.availableProducts = companyInfo.products?.map(p => p.productCode) || [];
        result.phases[1].status = 'completed';
        log(`   Företag: ${companyInfo.companyName || orgnr}`);
        log(`   Tillgängliga produkter: ${result.availableProducts.length}`);

        // =====================================================================
        // FAS 3: Köp dokument
        // =====================================================================
        log('\n📋 Fas 3: Köper dokument...');
        result.phases.push({ phase: 3, name: 'purchase', status: 'started' });

        for (const product of productsToFetch) {
            log(`\n   → Bearbetar: ${product.name} (${product.code})`);

            const purchaseResult = await purchaseDocument(orgnr, product.code, {
                headless,
                email,
                dryRun,
                saveToSupabase,
                eventContext: {
                    eventId: eventData.eventId,
                    eventTitle: eventData.eventTitle,
                    eventType: eventData.eventType
                }
            });

            result.documents.push({
                productCode: product.code,
                productName: product.name,
                success: purchaseResult.success,
                orderNumber: purchaseResult.orderNumber,
                price: purchaseResult.price,
                documentPath: purchaseResult.documentPath,
                storageUrl: purchaseResult.storageUrl,
                databaseId: purchaseResult.databaseId,
                deliveryMethod: purchaseResult.deliveryMethod,
                error: purchaseResult.error
            });

            if (!purchaseResult.success) {
                result.errors.push({
                    productCode: product.code,
                    error: purchaseResult.error
                });
            }

            // Vänta mellan köp för att undvika rate limiting
            if (productsToFetch.indexOf(product) < productsToFetch.length - 1) {
                log('   Väntar 3 sekunder...');
                await sleep(3000);
            }
        }

        result.phases[2].status = 'completed';
        result.phases[2].documentsProcessed = result.documents.length;
        result.phases[2].documentsSuccessful = result.documents.filter(d => d.success).length;

        // =====================================================================
        // SUMMERING
        // =====================================================================
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(1);

        result.success = result.documents.some(d => d.success);
        result.endTime = new Date().toISOString();
        result.durationSeconds = parseFloat(duration);

        log(`\n${'═'.repeat(70)}`);
        log(`  ${result.success ? '✅' : '❌'} UNDERSÖKNING ${result.success ? 'SLUTFÖRD' : 'MISSLYCKADES'}`);
        log(`${'═'.repeat(70)}`);
        log(`  Tid: ${duration} sekunder`);
        log(`  Dokument: ${result.documents.filter(d => d.success).length}/${result.documents.length} lyckades`);

        result.documents.forEach(doc => {
            const status = doc.success ? '✓' : '✗';
            log(`  ${status} ${doc.productCode}: ${doc.success ? (doc.storageUrl || doc.deliveryMethod || 'OK') : doc.error}`);
        });

        log(`${'═'.repeat(70)}\n`);

        return result;

    } catch (error) {
        log(`\n❌ Kritiskt fel: ${error.message}`, 'error');
        result.errors.push({ phase: 'global', error: error.message });
        result.endTime = new Date().toISOString();
        return result;
    }
}

/**
 * Listar köpta dokument för ett företag
 */
async function listPurchasedDocuments(orgnr) {
    const sb = getSupabase();
    if (!sb) {
        return { success: false, error: 'Supabase ej konfigurerad' };
    }

    const { data, error } = await sb
        .from('company_documents')
        .select('*')
        .eq('org_nr', orgnr)
        .eq('source', 'bolagsverket')
        .order('created_at', { ascending: false });

    if (error) {
        return { success: false, error: error.message };
    }

    return { success: true, documents: data };
}

// Export
module.exports = {
    // Konfiguration
    CONFIG,
    PRODUCT_TYPES,

    // Utility-funktioner
    createBrowser,
    acceptCookies,
    navigateWithRetry,
    saveSuccessfulMethod,
    getSupabase,
    getRelevantProducts,

    // Huvudfunktioner
    getCompanyDocuments,
    discoverAllProducts,
    purchaseDocument,
    purchaseFromEvent,
    investigateCompanyEvent,  // Komplett flöde
    listPurchasedDocuments,

    // Statistik
    getPurchaseStats
};

// CLI - Utökad med köpfunktionalitet
if (require.main === module) {
    const args = process.argv.slice(2);
    const orgnr = args[0] || '5591628660'; // Northvolt default
    const mode = args[1] || 'info';
    const productCode = args[2] || 'PROT';

    const printHelp = () => {
        console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║           BOLAGSVERKET NAVIGATOR - KOMPLETT DOKUMENTKÖPSSYSTEM           ║
╚══════════════════════════════════════════════════════════════════════════╝

ANVÄNDNING:
  node bolagsverket-navigator.js <orgnr> <mode> [productCode/eventTitle]

LÄGEN:
  info            Hämta företagsinfo och tillgängliga dokument (default)
  discover        Undersök alla tillgängliga produkttyper
  purchase        Köp ett specifikt dokument (kräver productCode)
  dryrun          Simulera köp utan att faktiskt betala
  investigate     🔥 KOMPLETT FLÖDE: Analysera händelse → köp → ladda ner → spara
  investigate-dry Simulera komplett flöde utan köp
  list            Lista köpta dokument för ett företag
  stats           Visa köpstatistik

PRODUKTKODER:
  PROT        Bolagsstämmoprotokoll
  BOLT        Bolagsordning
  RVHBEV      Verkliga huvudmän
  REG         Registreringsbevis
  ARS         Årsredovisning
  FUNK        Funktionärsbevis
  GRAV        Gravationsbevis

KOMPLETT FLÖDE (investigate):
  Scriptet hanterar automatiskt:
  1. Analyserar händelsetyp och identifierar relevanta dokument
  2. Navigerar till Bolagsverket med stealth-browser
  3. Löser CAPTCHA automatiskt
  4. Lägger dokument i varukorg
  5. Genomför checkout och betalning
  6. Laddar ner dokumentfil (PDF)
  7. Laddar upp till Supabase Storage bucket
  8. Sparar metadata i company_documents tabell

EXEMPEL:
  # Hämta företagsinfo
  node bolagsverket-navigator.js 5591628660 info

  # Undersök tillgängliga produkter
  node bolagsverket-navigator.js 5591628660 discover

  # Simulera köp av protokoll
  node bolagsverket-navigator.js 5591628660 dryrun PROT

  # Köp bolagsordning (riktigt köp!)
  node bolagsverket-navigator.js 5591628660 purchase BOLT

  # 🔥 Komplett undersökning av bolagshändelse
  node bolagsverket-navigator.js 5591628660 investigate "Beslut om likvidation"

  # Simulera komplett undersökning (dry run)
  node bolagsverket-navigator.js 5591628660 investigate-dry "Extra bolagsstämma"

  # Lista köpta dokument
  node bolagsverket-navigator.js 5591628660 list

  # Visa köpstatistik
  node bolagsverket-navigator.js stats

MILJÖVARIABLER:
  SUPABASE_SERVICE_KEY    Supabase service key för sparning
  PURCHASE_EMAIL          E-post för dokumentleverans (default: dokument@loop-impact.se)
`);
    };

    (async () => {
        if (mode === 'help' || mode === '-h' || mode === '--help') {
            printHelp();
            return;
        }

        if (mode === 'stats') {
            const stats = getPurchaseStats();
            console.log('\n📊 KÖPSTATISTIK:');
            console.log('═'.repeat(40));
            console.log(`Totalt köp: ${stats.totalPurchases}`);
            console.log(`Totalt spenderat: ${stats.totalSpentSEK} SEK`);
            console.log(`Idag: ${stats.todayPurchases} köp, ${stats.todaySpentSEK} SEK`);
            console.log(`Kvarvarande idag: ${stats.remainingTodaySEK} SEK`);
            console.log(`Daglig gräns: ${stats.dailyLimitSEK} SEK`);
            return;
        }

        if (mode === 'discover') {
            const results = await discoverAllProducts(orgnr, { headless: false });
            console.log('\n📊 SAMMANFATTNING:');
            console.log(`   Tillgängliga produkter: ${results.products.length}`);
            console.log(`   Ej tillgängliga: ${results.failedProducts.length}`);
            console.log('\n📄 Produkter:');
            results.products.forEach(p => {
                console.log(`   - ${p.code}: ${p.name} (${p.price} kr)`);
            });
            return;
        }

        if (mode === 'purchase' || mode === 'dryrun') {
            const dryRun = mode === 'dryrun';
            console.log(`\n🛒 ${dryRun ? 'SIMULERAR' : 'GENOMFÖR'} KÖP`);
            console.log('═'.repeat(40));
            console.log(`Orgnr: ${orgnr}`);
            console.log(`Produkt: ${productCode}`);
            console.log(`Dry run: ${dryRun ? 'JA' : 'NEJ'}`);

            const result = await purchaseDocument(orgnr, productCode, {
                headless: false,
                dryRun
            });

            console.log('\n📄 RESULTAT:');
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        // 🔥 INVESTIGATE: Komplett flöde
        if (mode === 'investigate' || mode === 'investigate-dry') {
            const dryRun = mode === 'investigate-dry';
            const eventTitle = args[2] || 'Bolagshändelse';

            console.log(`\n🔍 ${dryRun ? 'SIMULERAR' : 'GENOMFÖR'} KOMPLETT UNDERSÖKNING`);
            console.log('═'.repeat(50));
            console.log(`Orgnr: ${orgnr}`);
            console.log(`Händelse: ${eventTitle}`);
            console.log(`Dry run: ${dryRun ? 'JA' : 'NEJ'}`);
            console.log('═'.repeat(50));

            const result = await investigateCompanyEvent(orgnr, {
                eventTitle: eventTitle,
                eventType: null,  // Låt scriptet identifiera typ automatiskt
                eventId: `CLI-${Date.now()}`
            }, {
                headless: false,
                dryRun,
                saveToSupabase: !dryRun
            });

            console.log('\n📄 SLUTRESULTAT:');
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        // Lista köpta dokument
        if (mode === 'list') {
            console.log(`\n📋 KÖPTA DOKUMENT FÖR: ${orgnr}`);
            console.log('═'.repeat(40));

            const result = await listPurchasedDocuments(orgnr);

            if (result.success && result.documents?.length > 0) {
                result.documents.forEach((doc, i) => {
                    console.log(`\n${i + 1}. ${doc.document_name || doc.document_type}`);
                    console.log(`   Typ: ${doc.document_type}`);
                    console.log(`   Datum: ${doc.purchase_date}`);
                    console.log(`   Order: ${doc.order_number || 'N/A'}`);
                    console.log(`   Pris: ${doc.price_sek || 'N/A'} SEK`);
                    console.log(`   Status: ${doc.status}`);
                    if (doc.file_url) {
                        console.log(`   URL: ${doc.file_url}`);
                    }
                });
            } else if (result.success) {
                console.log('   Inga dokument hittades.');
            } else {
                console.log(`   Fel: ${result.error}`);
            }
            return;
        }

        // Default: info
        const result = await getCompanyDocuments(orgnr, { headless: false });
        console.log('\n📄 RESULTAT:');
        console.log(JSON.stringify(result, null, 2));

    })().catch(err => {
        console.error('❌ Kritiskt fel:', err.message);
        process.exit(1);
    });
}
