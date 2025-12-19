/**
 * POIT Scraper - Node.js version med puppeteer-extra stealth
 * Hämtar kungörelser från Post- och Inrikes Tidningar
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
    sleep
} = require('../utils/browser-factory');

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

    // Använd centraliserad browser-factory
    const browser = await createBrowser({ headless });
    const page = await createPage(browser);

    try {
        // Navigera till POIT
        await page.goto('https://poit.bolagsverket.se/poit-app/', {
            waitUntil: 'domcontentloaded',
            timeout: timeout
        });
        await sleep(3000);

        // Konfigurera sidan och stäng popups/cookies
        await configurePage(page);
        await dismissAllPopups(page);

        // Gå till söksidan
        await page.evaluate(() => {
            const link = document.querySelector('a[href="/poit-app/sok"]');
            if (link) link.click();
        });
        await sleep(3000);

        // Stäng eventuella nya popups
        await dismissAllPopups(page);

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

/**
 * Hämtar detaljerad information om en specifik kungörelse
 * @param {string} kungorelseId - Kungörelse-ID (t.ex. "K967902/25" eller "K967902-25")
 * @param {object} options - Alternativ (headless, timeout)
 * @returns {object} Detaljerad kungörelse-information
 */
async function getKungorelseDetails(kungorelseId, options = {}) {
    const { headless = true, timeout = 60000 } = options;

    // Normalisera ID: K967902/25 -> K967902-25
    const normalizedId = kungorelseId.replace('/', '-');
    const url = `https://poit.bolagsverket.se/poit-app/kungorelse/${normalizedId}`;

    // Använd centraliserad browser-factory
    const browser = await createBrowser({ headless });
    const page = await createPage(browser);

    try {
        console.error(`Hämtar kungörelse: ${url}`);

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: timeout
        });
        await sleep(3000);

        // Konfigurera sidan och stäng popups/cookies
        await configurePage(page);
        await dismissAllPopups(page);
        await sleep(1000);

        // Extrahera all information från sidan
        const details = await page.evaluate(() => {
            const result = {
                kungorelseText: '',
                typ: '',
                uppgiftslamnare: '',
                foretag: '',
                orgnummer: '',
                datum: '',
                forvaltare: null,
                adress: null,
                telefon: null,
                epost: null,
                domstol: null,
                diarienummer: null,
                andringar: [],
                rawText: ''
            };

            // Hämta hela texten på sidan
            const bodyText = document.body.innerText;
            result.rawText = bodyText;

            // Försök hitta huvudinnehållet
            const mainContent = document.querySelector('main, .content, .kungorelse-content, article');
            if (mainContent) {
                result.kungorelseText = mainContent.innerText.trim();
            } else {
                result.kungorelseText = bodyText;
            }

            // Extrahera organisationsnummer (format: 556890-8288)
            const orgnrMatch = bodyText.match(/\b(\d{6}-\d{4})\b/);
            if (orgnrMatch) {
                result.orgnummer = orgnrMatch[1];
            }

            // Extrahera företagsnamn (vanligtvis före orgnumret)
            if (result.orgnummer) {
                const beforeOrgnr = bodyText.split(result.orgnummer)[0];
                const lines = beforeOrgnr.split('\n').filter(l => l.trim());
                // Ta sista icke-tomma raden före orgnumret
                for (let i = lines.length - 1; i >= 0; i--) {
                    const line = lines[i].trim();
                    if (line.length > 3 && line.length < 200 && !line.match(/^\d/) && !line.includes('Kungörelse')) {
                        result.foretag = line;
                        break;
                    }
                }
            }

            // Extrahera förvaltare (konkursfall)
            const forvaltareMatch = bodyText.match(/[Ff]örvaltare\s*(?:är|:)?\s*(?:advokat\s*)?([^,\n]+?)(?:,|\.|telefon|tel|$)/i);
            if (forvaltareMatch) {
                result.forvaltare = forvaltareMatch[1].trim();
            }

            // Extrahera telefonnummer
            const telefonMatch = bodyText.match(/(?:telefon|tel\.?|tfn\.?)[\s:]*([0-9\s\-+()]{8,20})/i);
            if (telefonMatch) {
                result.telefon = telefonMatch[1].trim();
            }

            // Extrahera e-post
            const epostMatch = bodyText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (epostMatch) {
                result.epost = epostMatch[1];
            }

            // Extrahera domstol/tingsrätt
            const domstolMatch = bodyText.match(/(\w+\s+tingsrätt)/i);
            if (domstolMatch) {
                result.domstol = domstolMatch[1];
            }

            // Extrahera datum
            const datumMatch = bodyText.match(/(\d{4}-\d{2}-\d{2})/);
            if (datumMatch) {
                result.datum = datumMatch[1];
            }

            // Bestäm typ av kungörelse
            const lowerText = bodyText.toLowerCase();
            if (lowerText.includes('konkursbeslut') || lowerText.includes('försatt i konkurs')) {
                result.typ = 'Konkursbeslut';
            } else if (lowerText.includes('likvidation')) {
                result.typ = 'Likvidation';
            } else if (lowerText.includes('fusion')) {
                result.typ = 'Fusion';
            } else if (lowerText.includes('kallelse') && lowerText.includes('borgenär')) {
                result.typ = 'Kallelse på okända borgenärer';
            } else if (lowerText.includes('aktiebolagsregistret')) {
                result.typ = 'Aktiebolagsregistret';
            } else if (lowerText.includes('nyemission') || lowerText.includes('aktiekapital')) {
                result.typ = 'Nyemission';
            } else if (lowerText.includes('styrelse')) {
                result.typ = 'Styrelseändring';
            } else if (lowerText.includes('bolagsordning')) {
                result.typ = 'Bolagsordningsändring';
            } else {
                result.typ = 'Kungörelse';
            }

            // Extrahera ändringar (för Aktiebolagsregistret)
            const andringarSection = bodyText.match(/Ändringar som har registrerats[:\s]*([^]*?)(?=Uppgiftslämnare|$)/i);
            if (andringarSection) {
                const andringarText = andringarSection[1];
                const andringarLines = andringarText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                result.andringar = andringarLines;
            }

            // Extrahera uppgiftslämnare
            const uppgiftslamnareMatch = bodyText.match(/Uppgiftslämnare[:\s]*([^\n]+)/i);
            if (uppgiftslamnareMatch) {
                result.uppgiftslamnare = uppgiftslamnareMatch[1].trim();
            }

            return result;
        });

        return {
            success: true,
            kungorelse_id: normalizedId,
            url: url,
            ...details,
            fetched_at: new Date().toISOString()
        };

    } catch (error) {
        return {
            success: false,
            kungorelse_id: normalizedId,
            url: url,
            error: error.message
        };
    } finally {
        await browser.close();
    }
}

/**
 * Hämtar detaljer för flera kungörelser
 * @param {string[]} kungorelseIds - Lista med kungörelse-IDs
 * @param {object} options - Alternativ
 * @returns {object[]} Lista med detaljerade kungörelser
 */
async function getMultipleKungorelseDetails(kungorelseIds, options = {}) {
    const results = [];

    for (const id of kungorelseIds) {
        console.error(`Hämtar detaljer för: ${id}`);
        const result = await getKungorelseDetails(id, options);
        results.push(result);

        // Vänta lite mellan förfrågningar
        await sleep(2000);
    }

    return results;
}

// CLI-läge - utökat med --details flagga
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('Användning:');
        console.error('  Sökning:  node poit-scraper.js <orgnr> [--visible]');
        console.error('  Detaljer: node poit-scraper.js --details <kungörelse-id> [--visible]');
        console.error('');
        console.error('Exempel:');
        console.error('  node poit-scraper.js 5593220048');
        console.error('  node poit-scraper.js --details K967902-25');
        process.exit(1);
    }

    const headless = !args.includes('--visible');
    const isDetails = args.includes('--details');

    if (isDetails) {
        const detailsIndex = args.indexOf('--details');
        const kungorelseId = args[detailsIndex + 1];

        if (!kungorelseId || kungorelseId.startsWith('--')) {
            console.error('Fel: Ange kungörelse-ID efter --details');
            process.exit(1);
        }

        getKungorelseDetails(kungorelseId, { headless })
            .then(result => {
                console.log(JSON.stringify(result, null, 2));
            })
            .catch(err => {
                console.error('Fel:', err.message);
                process.exit(1);
            });
    } else {
        const orgnr = args[0];

        searchByOrgnr(orgnr, { headless })
            .then(result => {
                console.log(JSON.stringify(result, null, 2));
            })
            .catch(err => {
                console.error('Fel:', err.message);
                process.exit(1);
            });
    }
}

module.exports = {
    searchByOrgnr,
    searchMultiple,
    getKungorelseDetails,
    getMultipleKungorelseDetails
};
