/**
 * POIT Scraper - Node.js version med puppeteer-extra stealth
 * Hämtar kungörelser från Post- och Inrikes Tidningar
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Accepterar cookie-dialog om den visas
 */
async function acceptCookies(page, maxWait = 15000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
        try {
            const clicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const cookieBtn = buttons.find(b => b.textContent.includes('OK, fortsätt'));
                if (cookieBtn && cookieBtn.offsetParent !== null) {
                    cookieBtn.click();
                    return true;
                }
                return false;
            });

            if (clicked) {
                await sleep(1000);
                return true;
            }
        } catch (e) {}

        await sleep(500);
    }

    return false;
}

/**
 * Parsar sökresultat från POIT-sidan
 */
async function parseSearchResults(page) {
    return await page.evaluate(() => {
        const results = [];
        const rows = document.querySelectorAll('table tbody tr, .result-row');

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 5) {
                const linkElement = row.querySelector('a');
                results.push({
                    kungorelse_id: cells[0]?.textContent?.trim() || '',
                    uppgiftslamnare: cells[1]?.textContent?.trim() || '',
                    typ: cells[2]?.textContent?.trim() || '',
                    namn: cells[3]?.textContent?.trim() || '',
                    publicerad: cells[4]?.textContent?.trim() || '',
                    url: linkElement?.href || null
                });
            }
        });

        // Hämta antal träffar
        const antalText = document.body.innerText.match(/Antal träffar:\s*(\d+)/);
        const antalTraffar = antalText ? parseInt(antalText[1]) : results.length;

        return {
            antal_traffar: antalTraffar,
            kungorelser: results
        };
    });
}

/**
 * Söker kungörelser för ett organisationsnummer
 */
async function searchByOrgnr(orgnr, options = {}) {
    const { headless = true, timeout = 60000 } = options;

    const browser = await puppeteer.launch({
        headless: headless ? 'new' : false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--lang=sv-SE'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

    try {
        // Navigera till POIT
        await page.goto('https://poit.bolagsverket.se/poit-app/', {
            waitUntil: 'domcontentloaded',
            timeout: timeout
        });
        await sleep(3000);

        // Acceptera cookies
        await acceptCookies(page, 15000);

        // Gå till söksidan
        await page.evaluate(() => {
            const link = document.querySelector('a[href="/poit-app/sok"]');
            if (link) link.click();
        });
        await sleep(3000);

        // Acceptera cookies igen om de dyker upp
        await acceptCookies(page, 5000);

        // Fyll i organisationsnummer
        await page.waitForSelector('#personOrgnummer', { timeout: 10000 });
        await page.type('#personOrgnummer', orgnr.replace(/-/g, ''), { delay: 30 });
        await sleep(2000);

        // Klicka på sök
        const clicked = await page.evaluate(() => {
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

        if (!clicked) {
            throw new Error('Kunde inte hitta aktiv sökknapp');
        }

        await sleep(5000);

        // Parsa resultat
        const results = await parseSearchResults(page);

        return {
            success: true,
            orgnr: orgnr,
            ...results
        };

    } catch (error) {
        return {
            success: false,
            orgnr: orgnr,
            error: error.message,
            antal_traffar: 0,
            kungorelser: []
        };
    } finally {
        await browser.close();
    }
}

/**
 * Söker kungörelser för flera organisationsnummer
 */
async function searchMultiple(orgnrList, options = {}) {
    const results = [];

    for (const orgnr of orgnrList) {
        console.error(`Söker: ${orgnr}`);
        const result = await searchByOrgnr(orgnr, options);
        results.push(result);

        // Vänta lite mellan sökningar
        await sleep(2000);
    }

    return results;
}

// CLI-läge
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('Användning: node poit-scraper.js <orgnr> [--visible]');
        console.error('Exempel: node poit-scraper.js 5593220048');
        process.exit(1);
    }

    const orgnr = args[0];
    const headless = !args.includes('--visible');

    searchByOrgnr(orgnr, { headless })
        .then(result => {
            console.log(JSON.stringify(result, null, 2));
        })
        .catch(err => {
            console.error('Fel:', err.message);
            process.exit(1);
        });
}

module.exports = { searchByOrgnr, searchMultiple, acceptCookies };
