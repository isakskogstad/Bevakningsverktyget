/**
 * Scrapers - Re-export from lib
 * 
 * This index file provides backwards-compatible re-exports of all scrapers.
 * The actual implementations are in lib/scrapers/
 * 
 * @module scrapers
 */

// Re-export all scrapers from lib
module.exports = {
    ...require('../../lib/scrapers/allabolag-scraper'),
    ...require('../../lib/scrapers/poit-scraper'),
    ...require('../../lib/scrapers/bonnier-news-scraper'),
};
