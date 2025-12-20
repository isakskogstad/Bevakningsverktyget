/**
 * Purchase Logger - Loggar alla köp och hanterar daglig gräns
 * Säkerhetsfunktion för att undvika misskötsel
 */

const fs = require('fs');
const path = require('path');

// Konfiguration
const CONFIG = {
    DAILY_LIMIT_SEK: 100,  // Max 100 kr per dag
    LOG_FILE: path.join(__dirname, '../../data/purchase_log.json'),
    DATA_DIR: path.join(__dirname, '../../data')
};

/**
 * Säkerställ att data-mappen finns
 */
function ensureDataDir() {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
        fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    }
}

/**
 * Läs köploggen
 */
function readPurchaseLog() {
    ensureDataDir();

    if (!fs.existsSync(CONFIG.LOG_FILE)) {
        return { purchases: [], dailyTotals: {} };
    }

    try {
        const data = fs.readFileSync(CONFIG.LOG_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error('Fel vid läsning av köplog:', e.message);
        return { purchases: [], dailyTotals: {} };
    }
}

/**
 * Spara köploggen
 */
function savePurchaseLog(log) {
    ensureDataDir();
    fs.writeFileSync(CONFIG.LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
}

/**
 * Hämta dagens datum som sträng (YYYY-MM-DD)
 */
function getTodayString() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Hämta dagens totala köpbelopp
 */
function getTodayTotal() {
    const log = readPurchaseLog();
    const today = getTodayString();
    return log.dailyTotals[today] || 0;
}

/**
 * Kontrollera om ett köp är tillåtet (under daglig gräns)
 */
function canPurchase(amountSEK) {
    const todayTotal = getTodayTotal();
    const newTotal = todayTotal + amountSEK;

    return {
        allowed: newTotal <= CONFIG.DAILY_LIMIT_SEK,
        todayTotal: todayTotal,
        newTotal: newTotal,
        dailyLimit: CONFIG.DAILY_LIMIT_SEK,
        remaining: Math.max(0, CONFIG.DAILY_LIMIT_SEK - todayTotal)
    };
}

/**
 * Logga ett köp
 */
function logPurchase(purchaseData) {
    const log = readPurchaseLog();
    const today = getTodayString();
    const timestamp = new Date().toISOString();

    // Skapa köppost
    const purchase = {
        id: `PUR-${Date.now()}`,
        timestamp: timestamp,
        date: today,
        orgnr: purchaseData.orgnr,
        companyName: purchaseData.companyName || null,
        documentType: purchaseData.documentType || 'PROTOKOLL',
        amountSEK: purchaseData.amountSEK,
        ordernummer: purchaseData.ordernummer || null,
        email: purchaseData.email,
        status: purchaseData.status || 'completed',
        paymentMethod: purchaseData.paymentMethod || 'card',
        notes: purchaseData.notes || null
    };

    // Lägg till i listan
    log.purchases.push(purchase);

    // Uppdatera daglig total
    if (!log.dailyTotals[today]) {
        log.dailyTotals[today] = 0;
    }
    log.dailyTotals[today] += purchaseData.amountSEK;

    // Spara
    savePurchaseLog(log);

    console.error(`[PURCHASE LOG] ${purchase.id}: ${purchase.amountSEK} SEK för ${purchase.orgnr}`);
    console.error(`[PURCHASE LOG] Dagens total: ${log.dailyTotals[today]} / ${CONFIG.DAILY_LIMIT_SEK} SEK`);

    return purchase;
}

/**
 * Hämta köphistorik
 */
function getPurchaseHistory(options = {}) {
    const log = readPurchaseLog();
    let purchases = log.purchases;

    // Filtrera på datum
    if (options.date) {
        purchases = purchases.filter(p => p.date === options.date);
    }

    // Filtrera på orgnr
    if (options.orgnr) {
        purchases = purchases.filter(p => p.orgnr === options.orgnr);
    }

    // Sortera (senaste först)
    purchases.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Begränsa antal
    if (options.limit) {
        purchases = purchases.slice(0, options.limit);
    }

    return purchases;
}

/**
 * Hämta statistik
 */
function getStats() {
    const log = readPurchaseLog();
    const today = getTodayString();

    const totalPurchases = log.purchases.length;
    const totalSpent = log.purchases.reduce((sum, p) => sum + p.amountSEK, 0);
    const todayTotal = log.dailyTotals[today] || 0;
    const todayPurchases = log.purchases.filter(p => p.date === today).length;

    return {
        totalPurchases,
        totalSpentSEK: totalSpent,
        todayPurchases,
        todaySpentSEK: todayTotal,
        dailyLimitSEK: CONFIG.DAILY_LIMIT_SEK,
        remainingTodaySEK: Math.max(0, CONFIG.DAILY_LIMIT_SEK - todayTotal),
        dailyTotals: log.dailyTotals
    };
}

module.exports = {
    CONFIG,
    canPurchase,
    logPurchase,
    getTodayTotal,
    getPurchaseHistory,
    getStats
};

// CLI-test
if (require.main === module) {
    console.log('=== Purchase Logger Test ===\n');

    const stats = getStats();
    console.log('Statistik:', JSON.stringify(stats, null, 2));

    console.log('\nKan köpa 2.50 SEK?');
    const check = canPurchase(2.50);
    console.log(JSON.stringify(check, null, 2));
}
