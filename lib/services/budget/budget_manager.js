/**
 * Budget Manager - Hanterar budget och spårning av utgifter
 */

const fs = require('fs');
const path = require('path');

const BUDGET_FILE = path.join(__dirname, '../../data/budget.json');
const DOWNLOADS_DIR = path.join(__dirname, '../../data/downloads');

// Säkerställ att data-mappen finns
function ensureDataDir() {
    const dataDir = path.dirname(BUDGET_FILE);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(DOWNLOADS_DIR)) {
        fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }
}

// Ladda budget-data
function loadBudget() {
    ensureDataDir();

    if (!fs.existsSync(BUDGET_FILE)) {
        const defaultBudget = {
            monthlyLimit: 500, // SEK per månad
            purchases: [],
            settings: {
                currency: 'SEK',
                alertThreshold: 0.8, // Varna vid 80% av budget
                autoStop: true // Stoppa köp vid 100%
            }
        };
        fs.writeFileSync(BUDGET_FILE, JSON.stringify(defaultBudget, null, 2));
        return defaultBudget;
    }

    return JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
}

// Spara budget-data
function saveBudget(data) {
    ensureDataDir();
    fs.writeFileSync(BUDGET_FILE, JSON.stringify(data, null, 2));
}

// Hämta aktuell månads utgifter
function getCurrentMonthSpending() {
    const budget = loadBudget();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return budget.purchases
        .filter(p => p.date.startsWith(currentMonth))
        .reduce((sum, p) => sum + p.amount, 0);
}

// Hämta total spenderat (alla tider)
function getTotalSpending() {
    const budget = loadBudget();
    return budget.purchases.reduce((sum, p) => sum + p.amount, 0);
}

// Kontrollera om köp är tillåtet
function canPurchase(amount) {
    const budget = loadBudget();
    const currentSpending = getCurrentMonthSpending();
    const newTotal = currentSpending + amount;

    return {
        allowed: newTotal <= budget.monthlyLimit,
        currentSpending,
        monthlyLimit: budget.monthlyLimit,
        remaining: budget.monthlyLimit - currentSpending,
        wouldExceed: newTotal > budget.monthlyLimit,
        percentUsed: (currentSpending / budget.monthlyLimit) * 100
    };
}

// Registrera ett köp
function logPurchase(purchase) {
    const budget = loadBudget();

    const newPurchase = {
        id: `PUR-${Date.now()}`,
        date: new Date().toISOString(),
        amount: purchase.amount,
        orgnr: purchase.orgnr,
        companyName: purchase.companyName || null,
        documentType: purchase.documentType || 'Bolagsstämmoprotokoll',
        ordernummer: purchase.ordernummer || null,
        fileName: purchase.fileName || null,
        filePath: purchase.filePath || null
    };

    budget.purchases.push(newPurchase);
    saveBudget(budget);

    return newPurchase;
}

// Uppdatera månadsgräns
function setMonthlyLimit(limit) {
    const budget = loadBudget();
    budget.monthlyLimit = limit;
    saveBudget(budget);
    return budget;
}

// Hämta alla köp
function getAllPurchases() {
    const budget = loadBudget();
    return budget.purchases;
}

// Hämta köp för specifik månad
function getPurchasesByMonth(year, month) {
    const budget = loadBudget();
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    return budget.purchases.filter(p => p.date.startsWith(monthStr));
}

// Hämta statistik
function getStats() {
    const budget = loadBudget();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const currentMonthPurchases = budget.purchases.filter(p => p.date.startsWith(currentMonth));
    const currentMonthSpending = currentMonthPurchases.reduce((sum, p) => sum + p.amount, 0);

    // Gruppera per månad
    const byMonth = {};
    budget.purchases.forEach(p => {
        const month = p.date.substring(0, 7);
        if (!byMonth[month]) {
            byMonth[month] = { count: 0, total: 0 };
        }
        byMonth[month].count++;
        byMonth[month].total += p.amount;
    });

    return {
        monthlyLimit: budget.monthlyLimit,
        currentMonth: currentMonth,
        currentMonthSpending,
        currentMonthCount: currentMonthPurchases.length,
        remaining: budget.monthlyLimit - currentMonthSpending,
        percentUsed: Math.round((currentMonthSpending / budget.monthlyLimit) * 100),
        totalAllTime: getTotalSpending(),
        totalPurchases: budget.purchases.length,
        byMonth,
        settings: budget.settings
    };
}

// Hämta nedladdade filer
function getDownloadedFiles() {
    const budget = loadBudget();

    return budget.purchases
        .filter(p => p.filePath || p.fileName)
        .map(p => ({
            id: p.id,
            date: p.date,
            orgnr: p.orgnr,
            companyName: p.companyName,
            documentType: p.documentType,
            fileName: p.fileName,
            filePath: p.filePath,
            amount: p.amount
        }))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Registrera nedladdad fil
function registerDownload(purchase, sourceFilePath) {
    ensureDataDir();

    // Skapa tydligt filnamn
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
    const cleanCompanyName = (purchase.companyName || 'Okänt').replace(/[^a-zA-Z0-9åäöÅÄÖ\s-]/g, '').substring(0, 30);
    const docType = (purchase.documentType || 'Dokument').replace(/\s+/g, '-');

    const newFileName = `${dateStr}_${purchase.orgnr}_${cleanCompanyName}_${docType}.pdf`;
    const newFilePath = path.join(DOWNLOADS_DIR, newFileName);

    // Kopiera filen om den finns
    if (sourceFilePath && fs.existsSync(sourceFilePath)) {
        fs.copyFileSync(sourceFilePath, newFilePath);
    }

    // Uppdatera purchase med filinfo
    const budget = loadBudget();
    const purchaseIndex = budget.purchases.findIndex(p => p.id === purchase.id);
    if (purchaseIndex >= 0) {
        budget.purchases[purchaseIndex].fileName = newFileName;
        budget.purchases[purchaseIndex].filePath = newFilePath;
        saveBudget(budget);
    }

    return {
        fileName: newFileName,
        filePath: newFilePath
    };
}

module.exports = {
    loadBudget,
    saveBudget,
    getCurrentMonthSpending,
    getTotalSpending,
    canPurchase,
    logPurchase,
    setMonthlyLimit,
    getAllPurchases,
    getPurchasesByMonth,
    getStats,
    getDownloadedFiles,
    registerDownload,
    DOWNLOADS_DIR
};
