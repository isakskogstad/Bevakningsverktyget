/**
 * Cloudflare Bypass Utility - Node.js wrapper för cloudscraper (Python)
 *
 * Använder cloudscraper via Python subprocess för att:
 * - Hämta giltiga cookies som passerar Cloudflare
 * - Få user-agent som fungerar med sessionen
 *
 * @module cloudflare-bypass
 */

const { spawn } = require('child_process');
const path = require('path');

// Sökväg till Python-scriptet
const PYTHON_SCRIPT = path.join(__dirname, 'cloudflare-bypass.py');

// Sökväg till venv Python
const VENV_PYTHON = path.join(__dirname, '../../.venv/bin/python3');

/**
 * Kör Python cloudflare-bypass scriptet
 * @param {string[]} args - Argument till scriptet
 * @returns {Promise<Object>} - JSON-resultat från scriptet
 */
function runPythonScript(args) {
    return new Promise((resolve, reject) => {
        // Försök med venv python först, fallback till system python
        const pythonPaths = [VENV_PYTHON, 'python3', '/usr/bin/python3'];

        let currentIndex = 0;

        function tryNextPython() {
            if (currentIndex >= pythonPaths.length) {
                reject(new Error('Kunde inte hitta Python med cloudscraper installerat'));
                return;
            }

            const pythonPath = pythonPaths[currentIndex];
            currentIndex++;

            const proc = spawn(pythonPath, [PYTHON_SCRIPT, ...args], {
                timeout: 60000,
                env: { ...process.env, PYTHONUNBUFFERED: '1' }
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('error', (err) => {
                // Försök nästa Python-path
                tryNextPython();
            });

            proc.on('close', (code) => {
                if (code !== 0 && stderr.includes('No module named')) {
                    // cloudscraper ej installerat, försök nästa
                    tryNextPython();
                    return;
                }

                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    reject(new Error(`Kunde inte parsa output: ${stdout}\nStderr: ${stderr}`));
                }
            });
        }

        tryNextPython();
    });
}

/**
 * Hämta cookies som passerar Cloudflare för en URL
 * @param {string} url - URL att bypassa
 * @param {Object} options - Alternativ
 * @param {boolean} options.turnstile - Använd Turnstile-specifik lösning
 * @param {boolean} options.html - Inkludera HTML i svaret
 * @returns {Promise<{success: boolean, cookies: Array, user_agent: string, error?: string}>}
 */
async function bypassCloudflare(url, options = {}) {
    const args = [url];

    if (options.turnstile) {
        args.push('--turnstile');
    }
    if (options.html) {
        args.push('--html');
    }

    console.log(`[CloudflareBypass] Försöker bypassa: ${url}`);

    try {
        const result = await runPythonScript(args);

        if (result.success) {
            console.log(`[CloudflareBypass] Lyckades! Fick ${result.cookies?.length || 0} cookies`);
        } else {
            console.log(`[CloudflareBypass] Misslyckades: ${result.error}`);
        }

        return result;
    } catch (error) {
        console.error(`[CloudflareBypass] Error: ${error.message}`);
        return {
            success: false,
            error: error.message,
            error_type: 'wrapper_error'
        };
    }
}

/**
 * Applicera cookies från bypass till en Puppeteer-sida
 * @param {Object} page - Puppeteer page object
 * @param {Array} cookies - Cookies från bypassCloudflare
 * @param {string} domain - Domän att sätta cookies för
 */
async function applyCookiesToPage(page, cookies, domain = 'www.ratsit.se') {
    if (!cookies || !Array.isArray(cookies)) {
        console.log('[CloudflareBypass] Inga cookies att applicera');
        return;
    }

    const puppeteerCookies = cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || domain,
        path: c.path || '/',
        secure: c.secure || false,
        httpOnly: c.httpOnly || false,
        sameSite: c.sameSite || 'Lax'
    }));

    await page.setCookie(...puppeteerCookies);
    console.log(`[CloudflareBypass] Applicerade ${puppeteerCookies.length} cookies till sidan`);
}

/**
 * Hämta en sida via cloudscraper och returnera HTML
 * Användbart för sidor som blockerar Puppeteer helt
 * @param {string} url - URL att hämta
 * @returns {Promise<{success: boolean, html?: string, cookies: Array}>}
 */
async function fetchPageWithBypass(url) {
    return bypassCloudflare(url, { html: true, turnstile: true });
}

module.exports = {
    bypassCloudflare,
    applyCookiesToPage,
    fetchPageWithBypass
};
