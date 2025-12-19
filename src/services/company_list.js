/**
 * Company List Service - Hanterar företagslistan
 *
 * OBS: xlsx-paketet har tagits bort pga säkerhetssårbarheter.
 * Företagslistan finns nu i Supabase (loop_table med 1214 företag).
 *
 * För att konvertera Excel till JSON, använd online-verktyg eller:
 * - Öppna Excel i Google Sheets
 * - Exportera som JSON
 * - Spara till data/companies_cache.json
 */

const path = require('path');
const fs = require('fs');

const CACHE_PATH = path.join(__dirname, '../../data/companies_cache.json');

let companiesCache = null;

// Ladda företagslista från JSON-cache
function loadCompaniesFromCache() {
    if (!fs.existsSync(CACHE_PATH)) {
        console.error(`Cache-fil saknas: ${CACHE_PATH}`);
        console.error('Företagslistan finns i Supabase (loop_table). Använd Supabase-klienten istället.');
        return [];
    }

    try {
        const cacheData = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        return cacheData.companies || cacheData;
    } catch (error) {
        console.error('Kunde inte läsa cache:', error.message);
        return [];
    }
}

// Formatera organisationsnummer (XXXXXX-XXXX)
function formatOrgnr(orgnr) {
    const clean = orgnr.replace(/\D/g, '').padStart(10, '0');
    return `${clean.substring(0, 6)}-${clean.substring(6)}`;
}

// Hämta alla företag (med cache)
function getAllCompanies() {
    if (companiesCache) {
        return companiesCache;
    }

    // Ladda från JSON-cache
    companiesCache = loadCompaniesFromCache();
    return companiesCache;
}

// Sök företag
function searchCompanies(query, limit = 50) {
    const companies = getAllCompanies();
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
        return companies.slice(0, limit);
    }

    // Sök på namn och orgnr
    const results = companies.filter(c =>
        c.companyName.toLowerCase().includes(lowerQuery) ||
        c.orgnr.includes(lowerQuery) ||
        c.orgnrFormatted.includes(lowerQuery)
    );

    // Sortera: exakt match först, sedan längd
    results.sort((a, b) => {
        const aNameMatch = a.companyName.toLowerCase().startsWith(lowerQuery);
        const bNameMatch = b.companyName.toLowerCase().startsWith(lowerQuery);

        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;

        return a.companyName.localeCompare(b.companyName, 'sv');
    });

    return results.slice(0, limit);
}

// Hämta företag via orgnr
function getCompanyByOrgnr(orgnr) {
    const companies = getAllCompanies();
    const cleanOrgnr = orgnr.replace(/\D/g, '');
    return companies.find(c => c.orgnr.replace(/\D/g, '') === cleanOrgnr);
}

// Hämta statistik
function getStats() {
    const companies = getAllCompanies();
    return {
        total: companies.length,
        lastUpdated: fs.existsSync(CACHE_PATH)
            ? new Date(JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')).timestamp).toISOString()
            : null
    };
}

// Rensa cache
function clearCache() {
    companiesCache = null;
    if (fs.existsSync(CACHE_PATH)) {
        fs.unlinkSync(CACHE_PATH);
    }
}

module.exports = {
    getAllCompanies,
    searchCompanies,
    getCompanyByOrgnr,
    getStats,
    clearCache,
    formatOrgnr
};
