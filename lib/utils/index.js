/**
 * Bevakningsverktyget - Utility Modules
 *
 * Centraliserad export av alla verktygsmoduler för webbskrapning.
 *
 * Usage:
 *   const { createBrowser, createPage, fetchPage, scrape } = require('./lib/utils');
 *
 * Exempel - Enkel sidinhämtning:
 *   const { html } = await fetchPage('https://example.com');
 *
 * Exempel - Custom scraper:
 *   const data = await scrape('https://example.com', async (page) => {
 *       return await page.evaluate(() => document.title);
 *   });
 *
 * Exempel - Full kontroll:
 *   const browser = await createBrowser({ headless: true });
 *   const page = await createPage(browser);
 *   await navigateAndConfigure(page, 'https://example.com');
 *   // ... gör något ...
 *   await browser.close();
 */

const browserFactory = require('./browser-factory');
const popupBlocker = require('./popup-blocker');
const logger = require('./logger');

module.exports = {
    // ============================================
    // BROWSER FACTORY (huvudexporter)
    // ============================================

    // Browser & Page
    createBrowser: browserFactory.createBrowser,
    createPage: browserFactory.createPage,
    configurePage: browserFactory.configurePage,
    navigateAndConfigure: browserFactory.navigateAndConfigure,

    // High-level API (rekommenderas för enkel användning)
    fetchPage: browserFactory.fetchPage,
    scrape: browserFactory.scrape,

    // Cookies
    saveCookies: browserFactory.saveCookies,
    loadCookies: browserFactory.loadCookies,
    exportCookieString: browserFactory.exportCookieString,

    // CAPTCHA
    handleCaptcha: browserFactory.handleCaptcha,

    // Utilities
    humanType: browserFactory.humanType,
    takeScreenshot: browserFactory.takeScreenshot,
    sleep: browserFactory.sleep,

    // Konfiguration
    CONFIG: browserFactory.CONFIG,

    // ============================================
    // POPUP BLOCKER
    // ============================================

    setupPopupBlocker: popupBlocker.setupPopupBlocker,
    injectCookieBlocker: popupBlocker.injectCookieBlocker,
    dismissAllPopups: popupBlocker.dismissAllPopups,
    setupPagePopupBlocker: popupBlocker.setupPagePopupBlocker,
    startPopupWatcher: popupBlocker.startPopupWatcher,
    waitForCaptchaResolution: popupBlocker.waitForCaptchaResolution,
    watchPopups: browserFactory.watchPopups,

    // Individuella dismiss-funktioner
    dismissCookieConsent: popupBlocker.dismissCookieConsent,
    dismissNewsletterPopup: popupBlocker.dismissNewsletterPopup,
    dismissPrivacyPopup: popupBlocker.dismissPrivacyPopup,
    dismissGenericModals: popupBlocker.dismissGenericModals,
    dismissOverlays: popupBlocker.dismissOverlays,

    // ============================================
    // MODULER (för direkt import)
    // ============================================
    browserFactory,
    popupBlocker,

    // ============================================
    // LOGGER
    // ============================================
    createLogger: logger.createLogger,
    LOG_LEVELS: logger.LOG_LEVELS,
    logger
};
