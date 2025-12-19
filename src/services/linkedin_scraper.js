/**
 * LinkedIn Profile Scraper
 *
 * Hämtar publik profilinformation från LinkedIn med Playwright.
 * Kräver LinkedIn session cookie (li_at) för att fungera.
 */

const { chromium } = require('playwright');

// LinkedIn session cookie - MÅSTE uppdateras med giltig cookie
// Hämta från: LinkedIn -> DevTools -> Application -> Cookies -> li_at
const LI_AT_COOKIE = process.env.LINKEDIN_COOKIE || '';

/**
 * Söker efter en person på LinkedIn baserat på namn och företag
 */
async function searchLinkedInPerson(name, company = '') {
    if (!LI_AT_COOKIE) {
        console.log('[LINKEDIN] Ingen session cookie konfigurerad');
        return null;
    }

    let browser = null;

    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();

        // Sätt LinkedIn cookie
        await context.addCookies([{
            name: 'li_at',
            value: LI_AT_COOKIE,
            domain: '.linkedin.com',
            path: '/'
        }]);

        const page = await context.newPage();

        // Sök efter personen
        const searchQuery = company ? `${name} ${company}` : name;
        const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchQuery)}`;

        console.log(`[LINKEDIN] Söker: ${searchQuery}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // Vänta på sökresultat
        await page.waitForSelector('.search-results-container', { timeout: 10000 }).catch(() => null);

        // Hämta första resultatet
        const firstResult = await page.evaluate(() => {
            const card = document.querySelector('.entity-result__item');
            if (!card) return null;

            const nameEl = card.querySelector('.entity-result__title-text a span[aria-hidden="true"]');
            const titleEl = card.querySelector('.entity-result__primary-subtitle');
            const locationEl = card.querySelector('.entity-result__secondary-subtitle');
            const imgEl = card.querySelector('.entity-result__image img');
            const linkEl = card.querySelector('.entity-result__title-text a');

            return {
                name: nameEl?.textContent?.trim() || null,
                title: titleEl?.textContent?.trim() || null,
                location: locationEl?.textContent?.trim() || null,
                photoUrl: imgEl?.src || null,
                profileUrl: linkEl?.href?.split('?')[0] || null
            };
        });

        await browser.close();
        return firstResult;

    } catch (error) {
        console.error('[LINKEDIN] Sökning misslyckades:', error.message);
        if (browser) await browser.close();
        return null;
    }
}

/**
 * Hämtar detaljerad profilinformation från en LinkedIn-profil
 */
async function getLinkedInProfile(profileUrl) {
    if (!LI_AT_COOKIE) {
        console.log('[LINKEDIN] Ingen session cookie konfigurerad');
        return null;
    }

    let browser = null;

    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();

        await context.addCookies([{
            name: 'li_at',
            value: LI_AT_COOKIE,
            domain: '.linkedin.com',
            path: '/'
        }]);

        const page = await context.newPage();

        console.log(`[LINKEDIN] Hämtar profil: ${profileUrl}`);
        await page.goto(profileUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // Extrahera profildata
        const profile = await page.evaluate(() => {
            const nameEl = document.querySelector('h1.text-heading-xlarge');
            const titleEl = document.querySelector('.text-body-medium.break-words');
            const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words');
            const photoEl = document.querySelector('.pv-top-card-profile-picture__image--show');
            const aboutEl = document.querySelector('#about ~ .display-flex .inline-show-more-text');

            // Nuvarande position
            const currentPositionEl = document.querySelector('#experience ~ .pvs-list__outer-container li:first-child');
            let currentPosition = null;
            if (currentPositionEl) {
                const posTitle = currentPositionEl.querySelector('.t-bold span[aria-hidden="true"]');
                const posCompany = currentPositionEl.querySelector('.t-normal span[aria-hidden="true"]');
                currentPosition = {
                    title: posTitle?.textContent?.trim() || null,
                    company: posCompany?.textContent?.trim() || null
                };
            }

            return {
                name: nameEl?.textContent?.trim() || null,
                title: titleEl?.textContent?.trim() || null,
                location: locationEl?.textContent?.trim() || null,
                photoUrl: photoEl?.src || null,
                about: aboutEl?.textContent?.trim()?.substring(0, 300) || null,
                currentPosition
            };
        });

        profile.profileUrl = profileUrl;

        await browser.close();
        return profile;

    } catch (error) {
        console.error('[LINKEDIN] Profilhämtning misslyckades:', error.message);
        if (browser) await browser.close();
        return null;
    }
}

/**
 * Hämtar LinkedIn-profiler för en lista med personer
 */
async function getLinkedInProfiles(persons) {
    const profiles = [];

    for (const person of persons) {
        console.log(`[LINKEDIN] Söker profil för: ${person.name}`);

        // Sök först
        const searchResult = await searchLinkedInPerson(person.name, person.company);

        if (searchResult && searchResult.profileUrl) {
            // Hämta fullständig profil
            const fullProfile = await getLinkedInProfile(searchResult.profileUrl);
            if (fullProfile) {
                profiles.push({
                    ...fullProfile,
                    role: person.role // T.ex. "VD", "Styrelseordförande"
                });
            }
        } else {
            // Fallback: använd sökresultatet direkt
            if (searchResult) {
                profiles.push({
                    ...searchResult,
                    role: person.role
                });
            }
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 2000));
    }

    return profiles;
}

/**
 * Skapar mock-profiler för demo utan LinkedIn-cookie
 * Använder data från Allabolag istället
 */
function createMockProfiles(persons) {
    return persons.map(person => ({
        name: person.name,
        title: person.role || 'Befattningshavare',
        company: person.company || null,
        location: 'Sverige',
        photoUrl: null, // Kommer att visa initialer istället
        profileUrl: null,
        role: person.role
    }));
}

module.exports = {
    searchLinkedInPerson,
    getLinkedInProfile,
    getLinkedInProfiles,
    createMockProfiles
};
