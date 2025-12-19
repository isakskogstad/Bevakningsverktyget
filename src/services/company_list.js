/**
 * Company List Service - Hanterar företagslistan från Excel
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const EXCEL_PATH = '/Users/isak/Desktop/Bevakaren.Företagslista.xlsx';
const CACHE_PATH = path.join(__dirname, '../../data/companies_cache.json');

let companiesCache = null;

// Ladda företagslista från Excel
function loadCompaniesFromExcel() {
    if (!fs.existsSync(EXCEL_PATH)) {
        console.error(`Excel-fil saknas: ${EXCEL_PATH}`);
        return [];
    }

    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    return data.map((row, index) => ({
        id: index + 1,
        orgnr: String(row.orgnr || '').padStart(10, '0'),
        orgnrFormatted: formatOrgnr(String(row.orgnr || '')),
        companyName: row.company_name || row['Företagsnamn'] || '',
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    }));
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

    // Försök ladda från cache först
    if (fs.existsSync(CACHE_PATH)) {
        const cacheData = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        const cacheAge = Date.now() - cacheData.timestamp;

        // Använd cache om den är mindre än 1 timme gammal
        if (cacheAge < 3600000) {
            companiesCache = cacheData.companies;
            return companiesCache;
        }
    }

    // Ladda från Excel
    companiesCache = loadCompaniesFromExcel();

    // Spara till cache
    const dataDir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify({
        timestamp: Date.now(),
        companies: companiesCache
    }));

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
