/**
 * Test för kodkonsolidering mellan lib/ och src/
 * Verifierar att re-exports fungerar korrekt
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('Code Deduplication - Re-exports', () => {
    it('src/utils/browser-factory.js ska vara en re-export', () => {
        const filePath = path.join(__dirname, '../src/utils/browser-factory.js');
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Ska innehålla re-export statement
        assert.ok(
            content.includes("require('../../lib/utils/browser-factory')"),
            'browser-factory.js ska re-exportera från lib'
        );
        
        // Ska inte innehålla implementation (puppeteer-extra import)
        assert.ok(
            !content.includes("require('puppeteer-extra')"),
            'browser-factory.js ska inte innehålla implementation'
        );
    });

    it('src/utils/popup-blocker.js ska vara en re-export', () => {
        const filePath = path.join(__dirname, '../src/utils/popup-blocker.js');
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Ska innehålla re-export statement
        assert.ok(
            content.includes("require('../../lib/utils/popup-blocker')"),
            'popup-blocker.js ska re-exportera från lib'
        );
        
        // Ska inte innehålla implementation
        assert.ok(
            !content.includes('injectCookieBlocker'),
            'popup-blocker.js ska inte innehålla implementation'
        );
    });

    it('src/scrapers/index.js ska re-exportera scrapers från lib', () => {
        const filePath = path.join(__dirname, '../src/scrapers/index.js');
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Ska re-exportera alla tre scrapers
        assert.ok(
            content.includes("require('../../lib/scrapers/allabolag-scraper')"),
            'index.js ska re-exportera allabolag-scraper'
        );
        assert.ok(
            content.includes("require('../../lib/scrapers/poit-scraper')"),
            'index.js ska re-exportera poit-scraper'
        );
        assert.ok(
            content.includes("require('../../lib/scrapers/bonnier-news-scraper')"),
            'index.js ska re-exportera bonnier-news-scraper'
        );
    });

    it('duplicerade scraper-filer ska ha tagits bort från src/', () => {
        const srcScrapersDir = path.join(__dirname, '../src/scrapers');
        const files = fs.readdirSync(srcScrapersDir);
        
        // Ska INTE innehålla de gamla filerna
        assert.ok(
            !files.includes('allabolag-scraper.js'),
            'allabolag-scraper.js ska ha tagits bort från src/scrapers'
        );
        assert.ok(
            !files.includes('poit-scraper.js'),
            'poit-scraper.js ska ha tagits bort från src/scrapers'
        );
        assert.ok(
            !files.includes('bonnier-news-scraper.js'),
            'bonnier-news-scraper.js ska ha tagits bort från src/scrapers'
        );
        
        // Ska innehålla nya index.js
        assert.ok(
            files.includes('index.js'),
            'index.js ska finnas i src/scrapers'
        );
    });

    it('lib/ ska fortfarande innehålla alla implementationer', () => {
        const libUtilsDir = path.join(__dirname, '../lib/utils');
        const libScrapersDir = path.join(__dirname, '../lib/scrapers');
        
        // Utils
        assert.ok(
            fs.existsSync(path.join(libUtilsDir, 'browser-factory.js')),
            'lib/utils/browser-factory.js ska finnas'
        );
        assert.ok(
            fs.existsSync(path.join(libUtilsDir, 'popup-blocker.js')),
            'lib/utils/popup-blocker.js ska finnas'
        );
        
        // Scrapers
        assert.ok(
            fs.existsSync(path.join(libScrapersDir, 'allabolag-scraper.js')),
            'lib/scrapers/allabolag-scraper.js ska finnas'
        );
        assert.ok(
            fs.existsSync(path.join(libScrapersDir, 'poit-scraper.js')),
            'lib/scrapers/poit-scraper.js ska finnas'
        );
        assert.ok(
            fs.existsSync(path.join(libScrapersDir, 'bonnier-news-scraper.js')),
            'lib/scrapers/bonnier-news-scraper.js ska finnas'
        );
    });

    it('scripts ska importera från lib/', () => {
        // scripts/poit-purchase-stealth.js
        const poitScript = fs.readFileSync(
            path.join(__dirname, '../scripts/poit-purchase-stealth.js'),
            'utf8'
        );
        assert.ok(
            poitScript.includes("require('../lib/utils/browser-factory')"),
            'poit-purchase-stealth.js ska importera från lib/utils'
        );
        
        // scripts/bonnier-collector.js
        const bonnierScript = fs.readFileSync(
            path.join(__dirname, '../scripts/bonnier-collector.js'),
            'utf8'
        );
        assert.ok(
            bonnierScript.includes("require('../lib/scrapers/bonnier-news-scraper')"),
            'bonnier-collector.js ska importera från lib/scrapers'
        );
    });

    it('lib/README.md ska innehålla information om kodkonsolidering', () => {
        const readme = fs.readFileSync(
            path.join(__dirname, '../lib/README.md'),
            'utf8'
        );
        
        assert.ok(
            readme.includes('Kodkonsolidering') || readme.includes('kodkonsolidering'),
            'README ska nämna kodkonsolidering'
        );
        assert.ok(
            readme.includes('re-export') || readme.includes('Re-export'),
            'README ska nämna re-exports'
        );
    });
});
