/**
 * Auto CAPTCHA Solver - Automatisk lösning av alla typer av CAPTCHA
 *
 * PRIORITERINGSORDNING:
 * 1. NopeCHA Extension (gratis, snabbast)
 * 2. nodriver (Python-baserad, bäst stealth)
 * 3. undetected-chromedriver (Python fallback)
 * 4. 2captcha API (betaltjänst, sista utväg)
 *
 * Stöder:
 * - Bild-CAPTCHA (text recognition)
 * - reCAPTCHA v2/v3
 * - hCaptcha
 * - Turnstile (Cloudflare)
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

puppeteer.use(StealthPlugin());

// Projektrot
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// API-nycklar
const CONFIG = {
    // 2captcha API-nyckel - skaffa på https://2captcha.com
    TWOCAPTCHA_API_KEY: process.env.TWOCAPTCHA_API_KEY || '',

    // Anti-Captcha API-nyckel - skaffa på https://anti-captcha.com
    ANTICAPTCHA_API_KEY: process.env.ANTICAPTCHA_API_KEY || '',

    // NopeCHA sökväg
    NOPECHA_EXTENSION_PATH: path.join(PROJECT_ROOT, 'lib/nopecha-extension'),

    // Timeout för CAPTCHA-lösning (sekunder)
    SOLVE_TIMEOUT: 120,

    // Antal försök per metod
    MAX_ATTEMPTS: 3,

    // Fördröjning mellan försök (ms)
    RETRY_DELAY: 2000,

    // Framgångsrika metoder loggas här
    SUCCESSFUL_METHODS_PATH: path.join(PROJECT_ROOT, 'data/successful-methods')
};

// Lägg till recaptcha plugin om API-nyckel finns
if (CONFIG.TWOCAPTCHA_API_KEY) {
    puppeteer.use(
        RecaptchaPlugin({
            provider: {
                id: '2captcha',
                token: CONFIG.TWOCAPTCHA_API_KEY
            },
            visualFeedback: true
        })
    );
}

/**
 * Sparar framgångsrik metod för framtida referens
 */
function saveSuccessfulMethod(site, action, tool, config = {}) {
    try {
        const methodsDir = CONFIG.SUCCESSFUL_METHODS_PATH;
        if (!fs.existsSync(methodsDir)) {
            fs.mkdirSync(methodsDir, { recursive: true });
        }

        const method = {
            date: new Date().toISOString(),
            site,
            action,
            tool,
            config,
            success: true
        };

        const filename = `${site.replace(/[^a-z0-9]/gi, '_')}-${action}.json`;
        fs.writeFileSync(path.join(methodsDir, filename), JSON.stringify(method, null, 2));
        console.error(`[CAPTCHA] ✅ Metod sparad: ${filename}`);
    } catch (e) {
        console.error('[CAPTCHA] Kunde inte spara metod:', e.message);
    }
}

/**
 * Hämtar senaste framgångsrika metod för en site
 */
function getSuccessfulMethod(site) {
    try {
        const methodsDir = CONFIG.SUCCESSFUL_METHODS_PATH;
        const files = fs.readdirSync(methodsDir);
        const siteFiles = files.filter(f => f.startsWith(site.replace(/[^a-z0-9]/gi, '_')));

        if (siteFiles.length > 0) {
            const latestFile = siteFiles.sort().pop();
            const method = JSON.parse(fs.readFileSync(path.join(methodsDir, latestFile), 'utf8'));
            return method;
        }
    } catch (e) {
        // Ingen tidigare metod
    }
    return null;
}

/**
 * Detekterar vilken typ av CAPTCHA som visas på sidan
 */
async function detectCaptchaType(page) {
    return await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        const bodyHtml = document.body.innerHTML.toLowerCase();

        // Kolla efter olika CAPTCHA-typer
        if (bodyHtml.includes('g-recaptcha') || bodyHtml.includes('grecaptcha')) {
            return 'recaptcha';
        }
        if (bodyHtml.includes('h-captcha') || bodyHtml.includes('hcaptcha')) {
            return 'hcaptcha';
        }
        if (bodyHtml.includes('cf-turnstile') || bodyHtml.includes('turnstile')) {
            return 'turnstile';
        }
        if (bodyText.includes('what code is in the image') ||
            bodyText.includes('enter the code') ||
            bodyText.includes('type the characters') ||
            bodyText.includes('skriv koden') ||
            bodyText.includes('kontrollkod')) {
            return 'image';
        }
        if (bodyText.includes('human visitor') ||
            bodyText.includes('automated') ||
            bodyText.includes('robot') ||
            bodyText.includes('verifiering')) {
            return 'unknown';
        }

        return null; // Ingen CAPTCHA
    });
}

/**
 * METOD 1: NopeCHA Extension
 * Gratis, snabb, auto-löser de flesta CAPTCHA-typer
 */
async function solveWithNopeCHA(page, captchaType) {
    console.error('[CAPTCHA] 🔷 Försöker NopeCHA...');

    // NopeCHA löser automatiskt när extension är laddad
    // Vi behöver bara vänta på att den ska göra sitt jobb

    const startTime = Date.now();
    const maxWait = 30000; // 30 sekunder

    while (Date.now() - startTime < maxWait) {
        await new Promise(r => setTimeout(r, 2000));

        // Kolla om CAPTCHA är löst
        const stillHasCaptcha = await detectCaptchaType(page);
        if (!stillHasCaptcha) {
            console.error('[CAPTCHA] ✅ NopeCHA löste CAPTCHA!');
            return { success: true, method: 'nopecha' };
        }

        // Kolla om NopeCHA har markerat som löst
        const nopechaSolved = await page.evaluate(() => {
            // NopeCHA lägger till attribut när löst
            const solved = document.querySelector('[data-nopecha-solved]');
            return !!solved;
        });

        if (nopechaSolved) {
            console.error('[CAPTCHA] ✅ NopeCHA rapporterar löst!');
            return { success: true, method: 'nopecha' };
        }
    }

    console.error('[CAPTCHA] ❌ NopeCHA timeout');
    return { success: false, method: 'nopecha' };
}

/**
 * METOD 2: nodriver (Python)
 * Bästa stealth-egenskaper
 */
async function solveWithNodriver(url, options = {}) {
    console.error('[CAPTCHA] 🔷 Försöker nodriver (Python)...');

    return new Promise((resolve) => {
        const pythonScript = `
import asyncio
import nodriver as uc

async def solve_captcha():
    try:
        browser = await uc.start(headless=False)
        page = await browser.get("${url}")

        # Vänta på att sidan laddar
        await asyncio.sleep(5)

        # nodriver har inbyggd stealth som ofta passerar CAPTCHA
        # Vänta lite för att se om CAPTCHA dyker upp
        await asyncio.sleep(10)

        # Ta skärmdump för debugging
        await page.save_screenshot('/tmp/nodriver_result.png')

        # Hämta sidans HTML
        html = await page.get_content()

        # Kolla om CAPTCHA fortfarande finns
        captcha_keywords = ['captcha', 'robot', 'verify', 'human']
        has_captcha = any(kw in html.lower() for kw in captcha_keywords)

        await browser.stop()

        if not has_captcha:
            print('SOLVED')
        else:
            print('FAILED')

    except Exception as e:
        print(f'ERROR: {e}')

asyncio.run(solve_captcha())
`;

        const tempFile = `/tmp/nodriver_solve_${Date.now()}.py`;
        fs.writeFileSync(tempFile, pythonScript);

        const python = spawn('python3', [tempFile], {
            timeout: 60000
        });

        let output = '';

        python.stdout.on('data', (data) => {
            output += data.toString();
        });

        python.stderr.on('data', (data) => {
            console.error('[nodriver]', data.toString());
        });

        python.on('close', (code) => {
            fs.unlinkSync(tempFile);

            if (output.includes('SOLVED')) {
                console.error('[CAPTCHA] ✅ nodriver löste CAPTCHA!');
                resolve({ success: true, method: 'nodriver' });
            } else {
                console.error('[CAPTCHA] ❌ nodriver misslyckades');
                resolve({ success: false, method: 'nodriver' });
            }
        });

        python.on('error', (err) => {
            console.error('[CAPTCHA] nodriver fel:', err.message);
            resolve({ success: false, method: 'nodriver' });
        });
    });
}

/**
 * METOD 3: undetected-chromedriver (Python)
 * Fallback med god stealth
 */
async function solveWithUndetectedChrome(url, options = {}) {
    console.error('[CAPTCHA] 🔷 Försöker undetected-chromedriver...');

    return new Promise((resolve) => {
        const pythonScript = `
import undetected_chromedriver as uc
import time

try:
    options = uc.ChromeOptions()
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')

    driver = uc.Chrome(options=options, headless=False)
    driver.get("${url}")

    # Vänta på att sidan laddar
    time.sleep(5)

    # undetected-chromedriver passerar ofta automatiskt
    time.sleep(10)

    # Ta skärmdump
    driver.save_screenshot('/tmp/uc_result.png')

    # Kolla om CAPTCHA finns
    html = driver.page_source.lower()
    captcha_keywords = ['captcha', 'robot', 'verify', 'human']
    has_captcha = any(kw in html for kw in captcha_keywords)

    driver.quit()

    if not has_captcha:
        print('SOLVED')
    else:
        print('FAILED')

except Exception as e:
    print(f'ERROR: {e}')
`;

        const tempFile = `/tmp/uc_solve_${Date.now()}.py`;
        fs.writeFileSync(tempFile, pythonScript);

        const python = spawn('python3', [tempFile], {
            timeout: 60000
        });

        let output = '';

        python.stdout.on('data', (data) => {
            output += data.toString();
        });

        python.stderr.on('data', (data) => {
            console.error('[uc]', data.toString());
        });

        python.on('close', (code) => {
            fs.unlinkSync(tempFile);

            if (output.includes('SOLVED')) {
                console.error('[CAPTCHA] ✅ undetected-chromedriver löste CAPTCHA!');
                resolve({ success: true, method: 'undetected-chromedriver' });
            } else {
                console.error('[CAPTCHA] ❌ undetected-chromedriver misslyckades');
                resolve({ success: false, method: 'undetected-chromedriver' });
            }
        });

        python.on('error', (err) => {
            console.error('[CAPTCHA] uc fel:', err.message);
            resolve({ success: false, method: 'undetected-chromedriver' });
        });
    });
}

/**
 * Extraherar CAPTCHA-bilden från sidan
 */
async function extractCaptchaImage(page) {
    const captchaData = await page.evaluate(() => {
        // Strategi 1: Hitta img element nära CAPTCHA-text
        const imgs = Array.from(document.querySelectorAll('img'));
        for (const img of imgs) {
            if (img.width > 50 && img.width < 400 && img.height > 20 && img.height < 150) {
                const parent = img.closest('form, div, table');
                if (parent && parent.querySelector('input[type="text"]')) {
                    return {
                        src: img.src,
                        width: img.width,
                        height: img.height
                    };
                }
            }
        }

        // Strategi 2: Canvas
        const canvases = Array.from(document.querySelectorAll('canvas'));
        for (const canvas of canvases) {
            if (canvas.width > 50 && canvas.width < 400) {
                return {
                    src: canvas.toDataURL('image/png'),
                    width: canvas.width,
                    height: canvas.height,
                    isCanvas: true
                };
            }
        }

        return null;
    });

    if (!captchaData) {
        console.error('[CAPTCHA] Kunde inte hitta CAPTCHA-bild');
        return null;
    }

    if (captchaData.src.startsWith('data:')) {
        return captchaData.src.split(',')[1];
    }

    try {
        const element = await page.$(`img[src="${captchaData.src}"]`);
        if (element) {
            const screenshot = await element.screenshot({ encoding: 'base64' });
            return screenshot;
        }
    } catch (e) {
        console.error('[CAPTCHA] Fel vid screenshot:', e.message);
    }

    return null;
}

/**
 * METOD 4: 2captcha API
 * Betaltjänst, sista utväg
 */
async function solveWith2Captcha(imageBase64, options = {}) {
    if (!CONFIG.TWOCAPTCHA_API_KEY) {
        console.error('[CAPTCHA] 2captcha API-nyckel saknas!');
        return null;
    }

    console.error('[CAPTCHA] 🔷 Försöker 2captcha API...');

    const { numeric = 0, minLength = 4, maxLength = 8 } = options;

    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            key: CONFIG.TWOCAPTCHA_API_KEY,
            method: 'base64',
            body: imageBase64,
            numeric: numeric,
            min_len: minLength,
            max_len: maxLength,
            json: 1
        });

        const req = https.request({
            hostname: 'api.2captcha.com',
            path: '/in.php',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', async () => {
                try {
                    const result = JSON.parse(data);
                    if (result.status !== 1) {
                        console.error('[CAPTCHA] 2captcha fel:', result.request);
                        resolve(null);
                        return;
                    }

                    const captchaId = result.request;
                    console.error(`[CAPTCHA] CAPTCHA skickad, ID: ${captchaId}`);

                    const solution = await waitFor2CaptchaSolution(captchaId);
                    resolve(solution);
                } catch (e) {
                    console.error('[CAPTCHA] Parse-fel:', e.message);
                    resolve(null);
                }
            });
        });

        req.on('error', (e) => {
            console.error('[CAPTCHA] Request-fel:', e.message);
            resolve(null);
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Väntar på 2captcha-lösning
 */
async function waitFor2CaptchaSolution(captchaId, timeout = 120) {
    const startTime = Date.now();
    const pollInterval = 5000;

    while ((Date.now() - startTime) < timeout * 1000) {
        await new Promise(r => setTimeout(r, pollInterval));

        const result = await new Promise((resolve) => {
            https.get(
                `https://2captcha.com/res.php?key=${CONFIG.TWOCAPTCHA_API_KEY}&action=get&id=${captchaId}&json=1`,
                (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            resolve({ status: 0, request: 'PARSE_ERROR' });
                        }
                    });
                }
            ).on('error', () => resolve({ status: 0, request: 'NETWORK_ERROR' }));
        });

        if (result.status === 1) {
            console.error(`[CAPTCHA] ✅ 2captcha löst! Kod: ${result.request}`);
            return result.request;
        }

        if (result.request !== 'CAPCHA_NOT_READY') {
            console.error(`[CAPTCHA] Fel: ${result.request}`);
            return null;
        }

        console.error('[CAPTCHA] Väntar på 2captcha...');
    }

    console.error('[CAPTCHA] 2captcha timeout!');
    return null;
}

/**
 * Fyller i CAPTCHA-kod på sidan
 */
async function fillCaptchaCode(page, code) {
    return await page.evaluate((captchaCode) => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"]'));

        for (const input of inputs) {
            const parent = input.closest('form, div, table');
            const parentText = parent?.innerText?.toLowerCase() || '';

            if (parentText.includes('code') ||
                parentText.includes('captcha') ||
                parentText.includes('image') ||
                parentText.includes('kontroll')) {
                input.focus();
                input.value = captchaCode;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }

        if (inputs.length > 0) {
            inputs[0].focus();
            inputs[0].value = captchaCode;
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }

        return false;
    }, code);
}

/**
 * Klickar på submit-knappen
 */
async function submitCaptcha(page) {
    return await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('input[type="submit"], button'));

        for (const btn of buttons) {
            const text = (btn.textContent || btn.value || '').toLowerCase();
            if (text.includes('submit') || text.includes('verify') ||
                text.includes('continue') || text.includes('ok') ||
                text.includes('skicka') || text.includes('verifiera')) {
                btn.click();
                return true;
            }
        }

        const submit = document.querySelector('input[type="submit"], button[type="submit"]');
        if (submit) {
            submit.click();
            return true;
        }

        return false;
    });
}

/**
 * HUVUDFUNKTION: Löser CAPTCHA med prioriterad ordning
 *
 * PRIORITET:
 * 1. NopeCHA Extension (gratis, snabb)
 * 2. nodriver (bäst stealth)
 * 3. undetected-chromedriver (fallback stealth)
 * 4. 2captcha API (betaltjänst, garanterad)
 *
 * @param {Page} page - Puppeteer page object
 * @param {Object} options - Konfiguration
 * @returns {Object} { success: boolean, code: string, method: string }
 */
async function solveCaptcha(page, options = {}) {
    const {
        url = null,
        maxAttempts = CONFIG.MAX_ATTEMPTS,
        skipMethods = []
    } = options;

    console.error('\n[CAPTCHA] ═══════════════════════════════════════════');
    console.error('[CAPTCHA] 🚀 STARTAR AUTOMATISK CAPTCHA-LÖSNING');
    console.error('[CAPTCHA] ═══════════════════════════════════════════');

    // Detektera CAPTCHA-typ
    const captchaType = await detectCaptchaType(page);
    console.error(`[CAPTCHA] Typ detekterad: ${captchaType || 'ingen'}`);

    if (!captchaType) {
        return { success: true, code: null, method: 'none', message: 'Ingen CAPTCHA detekterad' };
    }

    // Kolla om vi har en framgångsrik metod sparad
    const currentUrl = url || await page.url();
    const domain = new URL(currentUrl).hostname;
    const savedMethod = getSuccessfulMethod(domain);

    if (savedMethod) {
        console.error(`[CAPTCHA] 💡 Tidigare framgångsrik metod: ${savedMethod.tool}`);
    }

    // ═══════════════════════════════════════════════════
    // METOD 1: NopeCHA Extension
    // ═══════════════════════════════════════════════════
    if (!skipMethods.includes('nopecha')) {
        console.error('\n[CAPTCHA] ───────────────────────────────────────');
        console.error('[CAPTCHA] METOD 1/4: NopeCHA Extension');
        console.error('[CAPTCHA] ───────────────────────────────────────');

        const nopechaResult = await solveWithNopeCHA(page, captchaType);
        if (nopechaResult.success) {
            saveSuccessfulMethod(domain, 'captcha', 'nopecha');
            return nopechaResult;
        }
    }

    // ═══════════════════════════════════════════════════
    // METOD 2: nodriver (Python)
    // ═══════════════════════════════════════════════════
    if (!skipMethods.includes('nodriver') && currentUrl) {
        console.error('\n[CAPTCHA] ───────────────────────────────────────');
        console.error('[CAPTCHA] METOD 2/4: nodriver');
        console.error('[CAPTCHA] ───────────────────────────────────────');

        const nodriverResult = await solveWithNodriver(currentUrl);
        if (nodriverResult.success) {
            saveSuccessfulMethod(domain, 'captcha', 'nodriver');
            return nodriverResult;
        }
    }

    // ═══════════════════════════════════════════════════
    // METOD 3: undetected-chromedriver (Python)
    // ═══════════════════════════════════════════════════
    if (!skipMethods.includes('undetected-chromedriver') && currentUrl) {
        console.error('\n[CAPTCHA] ───────────────────────────────────────');
        console.error('[CAPTCHA] METOD 3/4: undetected-chromedriver');
        console.error('[CAPTCHA] ───────────────────────────────────────');

        const ucResult = await solveWithUndetectedChrome(currentUrl);
        if (ucResult.success) {
            saveSuccessfulMethod(domain, 'captcha', 'undetected-chromedriver');
            return ucResult;
        }
    }

    // ═══════════════════════════════════════════════════
    // METOD 4: 2captcha API (bild-CAPTCHA)
    // ═══════════════════════════════════════════════════
    if (!skipMethods.includes('2captcha') && (captchaType === 'image' || captchaType === 'unknown')) {
        console.error('\n[CAPTCHA] ───────────────────────────────────────');
        console.error('[CAPTCHA] METOD 4/4: 2captcha API');
        console.error('[CAPTCHA] ───────────────────────────────────────');

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            console.error(`[CAPTCHA] Försök ${attempt}/${maxAttempts}`);

            const imageBase64 = await extractCaptchaImage(page);
            if (!imageBase64) {
                console.error('[CAPTCHA] Kunde inte extrahera bild');
                await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY));
                continue;
            }

            const debugPath = `/tmp/captcha_${Date.now()}.png`;
            fs.writeFileSync(debugPath, Buffer.from(imageBase64, 'base64'));
            console.error(`[CAPTCHA] Bild sparad: ${debugPath}`);

            const code = await solveWith2Captcha(imageBase64);

            if (code) {
                console.error(`[CAPTCHA] Kod mottagen: ${code}`);

                const filled = await fillCaptchaCode(page, code);
                if (!filled) {
                    console.error('[CAPTCHA] Kunde inte fylla i kod');
                    continue;
                }

                await new Promise(r => setTimeout(r, 500));
                await submitCaptcha(page);
                await new Promise(r => setTimeout(r, 3000));

                const stillHasCaptcha = await detectCaptchaType(page);
                if (!stillHasCaptcha) {
                    console.error('[CAPTCHA] ✅ 2captcha LÖSTE CAPTCHA!');
                    saveSuccessfulMethod(domain, 'captcha', '2captcha');
                    return { success: true, code, method: '2captcha' };
                }

                console.error('[CAPTCHA] CAPTCHA finns fortfarande...');
            }

            await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY));
        }
    }

    console.error('\n[CAPTCHA] ═══════════════════════════════════════════');
    console.error('[CAPTCHA] ❌ ALLA METODER MISSLYCKADES');
    console.error('[CAPTCHA] ═══════════════════════════════════════════');

    return { success: false, code: null, method: null };
}

/**
 * Skapar en stealth browser med NopeCHA extension
 */
async function createBrowserWithCaptchaSolver(headless = false) {
    const extensionPath = CONFIG.NOPECHA_EXTENSION_PATH;

    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--lang=sv-SE,sv',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled'
    ];

    // Lägg till NopeCHA extension om den finns
    if (fs.existsSync(extensionPath)) {
        args.push(`--disable-extensions-except=${extensionPath}`);
        args.push(`--load-extension=${extensionPath}`);
        console.error('[CAPTCHA] NopeCHA extension laddad');
    }

    const browser = await puppeteer.launch({
        headless: headless ? 'new' : false,
        args
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    return { browser, page };
}

// Exportera modulen
module.exports = {
    CONFIG,
    detectCaptchaType,
    extractCaptchaImage,
    solveWithNopeCHA,
    solveWithNodriver,
    solveWithUndetectedChrome,
    solveWith2Captcha,
    fillCaptchaCode,
    submitCaptcha,
    solveCaptcha,
    createBrowserWithCaptchaSolver,
    saveSuccessfulMethod,
    getSuccessfulMethod
};

// CLI-test
if (require.main === module) {
    console.log('═══════════════════════════════════════════════════');
    console.log('      Auto CAPTCHA Solver v2.0');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('PRIORITERINGSORDNING:');
    console.log('  1. NopeCHA Extension (gratis, snabbast)');
    console.log('  2. nodriver (Python, bäst stealth)');
    console.log('  3. undetected-chromedriver (Python fallback)');
    console.log('  4. 2captcha API (betaltjänst, garanterad)');
    console.log('');
    console.log('KONFIGURATION:');
    console.log(`  NopeCHA Extension: ${fs.existsSync(CONFIG.NOPECHA_EXTENSION_PATH) ? '✅ Installerad' : '❌ Saknas'}`);
    console.log(`  nodriver (Python): Kör "python3 -c \\"import nodriver\\"" för test`);
    console.log(`  undetected-chromedriver: Kör "python3 -c \\"import undetected_chromedriver\\""`);
    console.log(`  2captcha API-nyckel: ${CONFIG.TWOCAPTCHA_API_KEY ? '✅ Konfigurerad' : '❌ Saknas'}`);
    console.log('');
    console.log('ANVÄNDNING:');
    console.log('  const solver = require("./auto_captcha_solver");');
    console.log('  const result = await solver.solveCaptcha(page);');
    console.log('');
}
