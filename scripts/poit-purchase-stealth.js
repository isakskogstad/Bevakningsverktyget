/**
 * POIT & Bolagsverket Document Purchase - Stealth Mode
 *
 * Använder centraliserade moduler:
 * - browser-factory: Browser-skapande med stealth, adblocker, CAPTCHA-hantering
 * - popup-blocker: Cookie consent, popup-hantering
 */

const {
    createBrowser,
    createPage,
    configurePage,
    dismissAllPopups,
    humanType: humanTypeBase,
    sleep
} = require('../lib/utils/browser-factory');

// Randomiserad delay för mänskligt beteende
const humanDelay = () => sleep(Math.random() * 2000 + 1000);

/**
 * Skapa en stealth browser med alla anti-detection features
 * Använder browser-factory för centraliserad hantering
 */
async function createStealthBrowser(headless = true) {
    // Använd centraliserad browser-factory (headless=true för serverless)
    const browser = await createBrowser({ headless });
    const page = await createPage(browser, {
        viewport: { width: 1920, height: 1080 },
        extraHeaders: {
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        }
    });

    return { browser, page };
}

/**
 * Simulera mänsklig musrörelse
 */
async function humanMouseMove(page, x, y) {
    const steps = Math.floor(Math.random() * 10) + 5;
    await page.mouse.move(x, y, { steps });
}

/**
 * Simulera mänsklig typing
 * Använder browser-factory's humanType
 */
async function humanType(page, selector, text) {
    await humanTypeBase(page, selector, text, {
        minDelay: 50,
        maxDelay: 150
    });
}

/**
 * Vänta på navigation med retry
 */
async function safeNavigate(page, url, options = {}) {
    const maxRetries = options.retries || 3;

    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`   Navigerar till: ${url} (försök ${i + 1}/${maxRetries})`);
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: options.timeout || 60000
            });
            await humanDelay();
            return true;
        } catch (e) {
            console.log(`   Navigeringsfel: ${e.message}`);
            if (i === maxRetries - 1) throw e;
            await sleep(3000);
        }
    }
}

/**
 * Acceptera cookies om dialog visas
 * Använder browser-factory's dismissAllPopups
 */
async function acceptCookiesIfPresent(page) {
    try {
        await dismissAllPopups(page);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Sök kungörelser på POIT
 */
async function searchPOIT(orgnr, options = {}) {
    console.log(`\n🔍 POIT-SÖKNING FÖR: ${orgnr}`);
    console.log('=' .repeat(50));

    const { browser, page } = await createStealthBrowser(options.headless ?? true);

    try {
        // Steg 1: Navigera till POIT
        console.log('\n📌 Steg 1: Öppnar POIT...');
        await safeNavigate(page, 'https://poit.bolagsverket.se/poit-app/');

        // Ta screenshot
        await page.screenshot({ path: '/tmp/poit-step1.png' });
        console.log('   Screenshot: /tmp/poit-step1.png');

        // Vänta på att sidan laddar
        await sleep(3000);

        // Acceptera cookies
        await acceptCookiesIfPresent(page);

        // Steg 2: Gå till sök
        console.log('\n📌 Steg 2: Navigerar till söksidan...');

        // Klicka på sök-länk
        const searchClicked = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const searchLink = links.find(a =>
                a.href.includes('/sok') ||
                a.textContent.includes('Sök kungörelse')
            );
            if (searchLink) {
                searchLink.click();
                return true;
            }
            return false;
        });

        if (searchClicked) {
            console.log('   ✓ Klickade på sök-länk');
            await sleep(4000);
        } else {
            // Prova direkt URL
            await safeNavigate(page, 'https://poit.bolagsverket.se/poit-app/sok');
        }

        await page.screenshot({ path: '/tmp/poit-step2.png' });
        await acceptCookiesIfPresent(page);

        // Steg 3: Fyll i organisationsnummer
        console.log('\n📌 Steg 3: Fyller i organisationsnummer...');

        // Vänta på sökfältet
        await page.waitForSelector('#personOrgnummer, input[name="orgnr"], input[placeholder*="rganisation"]', {
            timeout: 15000
        });

        const inputSelector = await page.evaluate(() => {
            const selectors = ['#personOrgnummer', 'input[name="orgnr"]', 'input[placeholder*="rganisation"]'];
            for (const sel of selectors) {
                if (document.querySelector(sel)) return sel;
            }
            return null;
        });

        if (!inputSelector) {
            throw new Error('Kunde inte hitta sökfält');
        }

        // Rensa orgnr från bindestreck
        const cleanOrgnr = orgnr.replace(/-/g, '');

        // Simulera mänsklig typing
        await humanType(page, inputSelector, cleanOrgnr);
        console.log(`   ✓ Skrev in: ${cleanOrgnr}`);

        await page.screenshot({ path: '/tmp/poit-step3.png' });

        // Steg 4: Klicka på sök
        console.log('\n📌 Steg 4: Klickar på sök...');
        await humanDelay();

        const searchBtnClicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const searchBtn = buttons.find(b =>
                b.textContent.includes('Sök kungörelse') && !b.disabled
            );
            if (searchBtn) {
                searchBtn.click();
                return true;
            }
            return false;
        });

        if (!searchBtnClicked) {
            // Prova submit
            await page.keyboard.press('Enter');
        }

        console.log('   ✓ Sökning startad');
        await sleep(5000);

        await page.screenshot({ path: '/tmp/poit-step4.png' });

        // Steg 5: Hämta resultat
        console.log('\n📌 Steg 5: Hämtar resultat...');

        const results = await page.evaluate(() => {
            const kungorelser = [];

            // Försök olika selektorer för resultat
            const rows = document.querySelectorAll('table tbody tr, .result-item, .kungorelse-row');

            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 3) {
                    kungorelser.push({
                        id: cells[0]?.textContent?.trim(),
                        typ: cells[1]?.textContent?.trim() || cells[2]?.textContent?.trim(),
                        datum: cells[cells.length - 1]?.textContent?.trim(),
                        url: row.querySelector('a')?.href
                    });
                }
            });

            // Hämta antal träffar
            const bodyText = document.body.innerText;
            const match = bodyText.match(/(\d+)\s*träff/i);
            const antalTraffar = match ? parseInt(match[1]) : kungorelser.length;

            return {
                antal_traffar: antalTraffar,
                kungorelser: kungorelser,
                pageText: bodyText.substring(0, 2000)
            };
        });

        console.log(`   ✓ Hittade ${results.antal_traffar} kungörelse(r)`);

        if (results.kungorelser.length > 0) {
            console.log('\n📋 Kungörelser:');
            results.kungorelser.slice(0, 5).forEach((k, i) => {
                console.log(`   ${i + 1}. ${k.typ || 'Okänd typ'} - ${k.datum || ''}`);
            });
        }

        return {
            success: true,
            orgnr: orgnr,
            ...results
        };

    } catch (error) {
        console.error(`\n❌ Fel: ${error.message}`);
        await page.screenshot({ path: '/tmp/poit-error.png' });

        return {
            success: false,
            orgnr: orgnr,
            error: error.message,
            antal_traffar: 0,
            kungorelser: []
        };
    } finally {
        if (!options.keepOpen) {
            await browser.close();
        }
    }
}

/**
 * Sök och köp dokument på Företagsinformation
 */
async function searchForetagsinfo(orgnr, options = {}) {
    console.log(`\n🏢 FÖRETAGSINFORMATION FÖR: ${orgnr}`);
    console.log('=' .repeat(50));

    const { browser, page } = await createStealthBrowser(options.headless ?? true);

    try {
        // Navigera till Företagsinfo
        console.log('\n📌 Steg 1: Öppnar Företagsinfo...');
        await safeNavigate(page, 'https://foretagsinfo.bolagsverket.se/');

        await page.screenshot({ path: '/tmp/foretagsinfo-step1.png' });
        await sleep(3000);
        await acceptCookiesIfPresent(page);

        // Sök efter företag
        console.log('\n📌 Steg 2: Söker efter företag...');

        const searchInput = await page.$('input[type="search"], input[name="q"], #search-input, input[placeholder*="ök"]');
        if (searchInput) {
            await humanType(page, 'input[type="search"], input[name="q"], #search-input', orgnr.replace(/-/g, ''));
            await humanDelay();
            await page.keyboard.press('Enter');
            await sleep(5000);
        }

        await page.screenshot({ path: '/tmp/foretagsinfo-step2.png' });

        // Hämta företagsinfo
        const companyInfo = await page.evaluate(() => {
            const info = {};

            // Försök hämta företagsnamn
            const nameEl = document.querySelector('h1, .company-name, .foretag-namn');
            if (nameEl) info.name = nameEl.textContent.trim();

            // Försök hitta dokument-länkar
            const docLinks = Array.from(document.querySelectorAll('a')).filter(a =>
                a.textContent.includes('protokoll') ||
                a.textContent.includes('Protokoll') ||
                a.textContent.includes('handlingar') ||
                a.href.includes('dokument')
            );

            info.documentLinks = docLinks.map(a => ({
                text: a.textContent.trim(),
                href: a.href
            }));

            return info;
        });

        console.log(`   Företag: ${companyInfo.name || 'Ej hittat'}`);
        console.log(`   Dokumentlänkar: ${companyInfo.documentLinks?.length || 0}`);

        return {
            success: true,
            orgnr: orgnr,
            ...companyInfo
        };

    } catch (error) {
        console.error(`\n❌ Fel: ${error.message}`);
        await page.screenshot({ path: '/tmp/foretagsinfo-error.png' });

        return {
            success: false,
            orgnr: orgnr,
            error: error.message
        };
    } finally {
        if (!options.keepOpen) {
            await browser.close();
        }
    }
}

/**
 * Huvudfunktion - Kör hela flödet
 */
async function runFullFlow(orgnr) {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 STARTAR KOMPLETT DOKUMENTHÄMTNING');
    console.log('='.repeat(60));
    console.log(`Organisationsnummer: ${orgnr}`);
    console.log(`Tid: ${new Date().toLocaleString('sv-SE')}`);

    // Steg 1: Sök POIT
    const poitResult = await searchPOIT(orgnr, { headless: true });

    if (poitResult.success && poitResult.antal_traffar > 0) {
        console.log(`\n✅ POIT: Hittade ${poitResult.antal_traffar} kungörelse(r)`);
    } else {
        console.log('\n⚠️  POIT: Inga kungörelser hittades eller sökning misslyckades');
    }

    // Steg 2: Sök Företagsinfo
    const foretagsinfoResult = await searchForetagsinfo(orgnr, { headless: true });

    // Summering
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESULTAT');
    console.log('='.repeat(60));
    console.log(`POIT-kungörelser: ${poitResult.antal_traffar || 0}`);
    console.log(`Företagsinfo: ${foretagsinfoResult.success ? 'OK' : 'Misslyckades'}`);
    console.log('\nScreenshots sparade i /tmp/');

    return {
        poit: poitResult,
        foretagsinfo: foretagsinfoResult
    };
}

// CLI
if (require.main === module) {
    const orgnr = process.argv[2] || '5590019186'; // Default: Zound Industries

    runFullFlow(orgnr)
        .then(result => {
            console.log('\n📄 JSON-resultat:');
            console.log(JSON.stringify(result, null, 2));
        })
        .catch(err => {
            console.error('Kritiskt fel:', err);
            process.exit(1);
        });
}

module.exports = { searchPOIT, searchForetagsinfo, runFullFlow, createStealthBrowser };
