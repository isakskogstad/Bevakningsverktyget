/**
 * Popup Blocker Utility - Blockerar cookie-rutor, reklam och andra störande element
 *
 * Denna modul samlar alla verktyg för att hantera:
 * - Cookie consent dialogs (GDPR)
 * - Nyhetsbrev-popups
 * - Reklam och trackers
 * - Paywalls och overlays
 *
 * Användning:
 *   const { setupPopupBlocker, dismissAllPopups, injectCookieBlocker } = require('./utils/popup-blocker');
 *
 *   // Vid browser-setup (före sidladdning)
 *   const puppeteer = setupPopupBlocker(require('puppeteer-extra'));
 *
 *   // Efter sidladdning (för cookies som redan visas)
 *   await injectCookieBlocker(page);
 *   await dismissAllPopups(page);
 *
 * @module popup-blocker
 */

const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');

// Försök ladda idcac-playwright (kan saknas)
let getInjectableScript;
try {
    getInjectableScript = require('idcac-playwright').getInjectableScript;
} catch (e) {
    console.warn('[PopupBlocker] idcac-playwright ej installerat, använder fallback');
    getInjectableScript = null;
}

/**
 * Konfigurerar puppeteer-extra med alla blockeringsplugins
 *
 * @param {Object} puppeteer - puppeteer-extra instans
 * @param {Object} options - Konfigurationsalternativ
 * @param {boolean} options.blockAds - Blockera annonser (default: true)
 * @param {boolean} options.blockTrackers - Blockera trackers (default: true)
 * @param {boolean} options.blockCookieNotices - Blockera cookie-rutor (default: true)
 * @param {boolean} options.stealth - Använd stealth-mode (default: true)
 * @returns {Object} Konfigurerad puppeteer-instans
 */
function setupPopupBlocker(puppeteer, options = {}) {
    const config = {
        blockAds: true,
        blockTrackers: true,
        blockCookieNotices: true,
        stealth: true,
        ...options
    };

    // Lägg till Stealth-plugin för att undvika bot-detection
    if (config.stealth) {
        puppeteer.use(StealthPlugin());
    }

    // Lägg till Adblocker-plugin med annoyance-blockering
    if (config.blockAds || config.blockTrackers || config.blockCookieNotices) {
        puppeteer.use(AdblockerPlugin({
            blockTrackers: config.blockTrackers,
            blockTrackersAndAnnoyances: config.blockCookieNotices,
            useCache: true
        }));
    }

    return puppeteer;
}

/**
 * Injicerar "I Don't Care About Cookies" script i sidan
 * Hanterar de flesta CMP (Consent Management Platforms)
 *
 * @param {Object} page - Puppeteer Page-objekt
 */
async function injectCookieBlocker(page) {
    if (getInjectableScript) {
        try {
            await page.evaluate(getInjectableScript());
            console.error('[PopupBlocker] IDCAC-script injicerat');
        } catch (e) {
            console.error('[PopupBlocker] Kunde ej injicera IDCAC:', e.message);
        }
    }
}

/**
 * Försöker stänga alla kända popup-typer på sidan
 *
 * @param {Object} page - Puppeteer Page-objekt
 * @param {Object} options - Alternativ
 * @param {boolean} options.verbose - Logga mer info (default: false)
 */
async function dismissAllPopups(page, options = {}) {
    const verbose = options.verbose || false;

    // 1. Cookie consent (mest vanliga CMPs)
    await dismissCookieConsent(page, verbose);

    // 2. Nyhetsbrev-popups
    await dismissNewsletterPopup(page, verbose);

    // 3. GDPR/Privacy notices
    await dismissPrivacyPopup(page, verbose);

    // 4. Generella modaler (ESC-tangent)
    await dismissGenericModals(page, verbose);

    // 5. Overlay-element
    await dismissOverlays(page, verbose);
}

/**
 * Stänger cookie consent-dialoger
 */
async function dismissCookieConsent(page, verbose = false) {
    // Vanliga consent-selectors (svenska och engelska)
    const consentSelectors = [
        // OneTrust (mycket vanlig)
        '#onetrust-accept-btn-handler',
        '#onetrust-pc-btn-handler',

        // Didomi
        '#didomi-notice-agree-button',
        '.didomi-continue-without-agreeing',

        // Cookiebot
        '#CybotCookiebotDialogBodyButtonAccept',
        '#CybotCookiebotDialogBodyLevelButtonAccept',

        // Quantcast
        '.qc-cmp2-summary-buttons button[mode="primary"]',

        // Generiska svenska
        'button:has-text("Okej")',
        'button:has-text("OK")',
        'button:has-text("Acceptera")',
        'button:has-text("Acceptera alla")',
        'button:has-text("Godkänn")',
        'button:has-text("Godkänn alla")',
        'button:has-text("Jag godkänner")',
        'button:has-text("Tillåt alla")',

        // Generiska engelska
        'button:has-text("Accept")',
        'button:has-text("Accept all")',
        'button:has-text("Allow all")',
        'button:has-text("I agree")',
        'button:has-text("Got it")',

        // Klass/ID-baserade
        'button[id*="accept"]',
        'button[class*="accept"]',
        'button[class*="consent"]',
        '.cookie-consent button',
        '.cookie-banner button',
        '[class*="cookie"] button[class*="accept"]',
        '[class*="consent"] button[class*="accept"]'
    ];

    for (const selector of consentSelectors) {
        try {
            const button = await page.$(selector);
            if (button) {
                const isVisible = await button.evaluate(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return rect.width > 0 && rect.height > 0 &&
                           style.display !== 'none' &&
                           style.visibility !== 'hidden';
                });

                if (isVisible) {
                    await button.click();
                    if (verbose) console.error(`[PopupBlocker] Cookie consent stängd: ${selector}`);
                    await sleep(500);
                    return; // Stäng endast en
                }
            }
        } catch (e) {
            // Fortsätt med nästa selector
        }
    }
}

/**
 * Stänger nyhetsbrev-popups
 */
async function dismissNewsletterPopup(page, verbose = false) {
    const selectors = [
        'button[aria-label="Stäng"]',
        'button[aria-label="Close"]',
        'button[aria-label="Dismiss"]',
        '.newsletter-popup button.close',
        '.newsletter-modal button.close',
        '[class*="newsletter"] button[class*="close"]',
        '[class*="subscribe"] button[class*="close"]',
        '.modal button.close',
        'button.modal-close',
        '[class*="popup"] button[class*="close"]',
        '[class*="modal"] [class*="close"]',
        'button[class*="dismiss"]'
    ];

    for (const selector of selectors) {
        try {
            const button = await page.$(selector);
            if (button) {
                const isVisible = await button.evaluate(el => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                });
                if (isVisible) {
                    await button.click();
                    if (verbose) console.error(`[PopupBlocker] Nyhetsbrev-popup stängd: ${selector}`);
                    await sleep(500);
                }
            }
        } catch (e) {
            // Fortsätt
        }
    }
}

/**
 * Stänger privacy/GDPR popups
 */
async function dismissPrivacyPopup(page, verbose = false) {
    const selectors = [
        '[class*="privacy"] button[class*="accept"]',
        '[class*="gdpr"] button[class*="accept"]',
        '[class*="privacy"] button[class*="close"]',
        '[class*="gdpr"] button[class*="close"]'
    ];

    for (const selector of selectors) {
        try {
            const button = await page.$(selector);
            if (button) {
                await button.click();
                if (verbose) console.error(`[PopupBlocker] Privacy-popup stängd: ${selector}`);
                await sleep(500);
            }
        } catch (e) {
            // Fortsätt
        }
    }
}

/**
 * Stänger generella modaler genom att trycka Escape
 */
async function dismissGenericModals(page, verbose = false) {
    try {
        const hasModal = await page.evaluate(() => {
            const modal = document.querySelector(
                '[class*="modal"][style*="display: block"], ' +
                '[class*="modal"]:not([style*="display: none"]), ' +
                '[role="dialog"], ' +
                '[class*="overlay"]:not([style*="display: none"])'
            );
            return !!modal;
        });

        if (hasModal) {
            await page.keyboard.press('Escape');
            if (verbose) console.error('[PopupBlocker] Tryckte Escape för modal');
            await sleep(300);
        }
    } catch (e) {
        // Ignorera
    }
}

/**
 * Tar bort overlay-element genom CSS
 */
async function dismissOverlays(page, verbose = false) {
    try {
        const removed = await page.evaluate(() => {
            const overlaySelectors = [
                '.overlay',
                '.modal-backdrop',
                '.modal-overlay',
                '[class*="overlay"]',
                '[class*="backdrop"]'
            ];

            let count = 0;
            for (const selector of overlaySelectors) {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    // Ta bara bort om det är en riktig overlay (täcker hela sidan)
                    const rect = el.getBoundingClientRect();
                    if (rect.width > window.innerWidth * 0.8 &&
                        rect.height > window.innerHeight * 0.8) {
                        el.style.display = 'none';
                        count++;
                    }
                });
            }
            return count;
        });

        if (removed > 0 && verbose) {
            console.error(`[PopupBlocker] ${removed} overlay-element dolda`);
        }
    } catch (e) {
        // Ignorera
    }
}

/**
 * Startar en bakgrundsloop som övervakar och stänger popups
 * Returnerar en funktion för att stoppa loopen
 *
 * @param {Object} page - Puppeteer Page-objekt
 * @param {number} intervalMs - Intervall mellan kontroller (default: 2000ms)
 * @returns {Function} Stoppa-funktion
 */
function startPopupWatcher(page, intervalMs = 2000) {
    let active = true;

    const interval = setInterval(async () => {
        if (active && page) {
            try {
                await dismissAllPopups(page);
            } catch (e) {
                // Ignorera fel i watcher
            }
        }
    }, intervalMs);

    // Returnera stopp-funktion
    return () => {
        active = false;
        clearInterval(interval);
    };
}

/**
 * Väntar och övervakar CAPTCHA-lösning
 *
 * @param {Object} page - Puppeteer Page-objekt
 * @param {number} maxWaitMs - Max väntetid (default: 10000ms)
 * @returns {boolean} True om ingen CAPTCHA eller om löst
 */
async function waitForCaptchaResolution(page, maxWaitMs = 10000) {
    const startTime = Date.now();
    let captchaFound = false;

    while (Date.now() - startTime < maxWaitMs) {
        const hasCaptcha = await page.evaluate(() => {
            const recaptchaV2 = document.querySelector('iframe[src*="recaptcha"]');
            const hcaptcha = document.querySelector('iframe[src*="hcaptcha"]');
            const turnstile = document.querySelector('iframe[src*="turnstile"]');
            return !!(recaptchaV2 || hcaptcha || turnstile);
        });

        if (hasCaptcha && !captchaFound) {
            captchaFound = true;
            console.error('[PopupBlocker] ⚠️  CAPTCHA upptäckt - väntar på lösning...');
        }

        if (captchaFound) {
            const isSolved = await page.evaluate(() => {
                const recaptchaResponse = document.querySelector('textarea[name="g-recaptcha-response"]');
                if (recaptchaResponse && recaptchaResponse.value) return true;

                const hcaptchaResponse = document.querySelector('textarea[name="h-captcha-response"]');
                if (hcaptchaResponse && hcaptchaResponse.value) return true;

                const checkbox = document.querySelector('.recaptcha-checkbox-checked');
                if (checkbox) return true;

                return false;
            });

            if (isSolved) {
                console.error('[PopupBlocker] ✅ CAPTCHA löst!');
                return true;
            }
        }

        await sleep(1000);
    }

    if (captchaFound) {
        console.error('[PopupBlocker] ⚠️  CAPTCHA-timeout - fortsätter ändå...');
    }

    return !captchaFound;
}

/**
 * Konfigurerar page med all popup-blockering
 * Ska köras efter page.goto()
 *
 * @param {Object} page - Puppeteer Page-objekt
 * @param {Object} options - Alternativ
 */
async function setupPagePopupBlocker(page, options = {}) {
    // 1. Injicera IDCAC om tillgängligt
    await injectCookieBlocker(page);

    // 2. Vänta kort för eventuella popups
    await sleep(1000);

    // 3. Stäng alla synliga popups
    await dismissAllPopups(page, options);
}

/**
 * Utility: Sleep-funktion
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    // Huvudfunktioner
    setupPopupBlocker,
    injectCookieBlocker,
    dismissAllPopups,
    setupPagePopupBlocker,

    // Popup-watcher
    startPopupWatcher,

    // CAPTCHA
    waitForCaptchaResolution,

    // Individuella dismiss-funktioner
    dismissCookieConsent,
    dismissNewsletterPopup,
    dismissPrivacyPopup,
    dismissGenericModals,
    dismissOverlays,

    // Utility
    sleep
};
