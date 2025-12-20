/**
 * Ratsit Income API Server
 *
 * REST API som exponerar Ratsit-scrapern för webbplattformen.
 * Stödjer real-time progress via polling och sparar till Supabase.
 *
 * Endpoints:
 *   POST /api/ratsit/fetch         - Starta inkomsthämtning (returnerar job_id)
 *   GET  /api/ratsit/job/:id       - Hämta jobbstatus med progress
 *   POST /api/ratsit/search        - Sök efter person
 *   GET  /api/ratsit/status        - Kontrollera serverstatus
 *
 * Usage:
 *   npm run ratsit-server
 */

const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { RatsitIncomeScraper } = require('../lib/scrapers/ratsit-income-scraper');
const { parseLonekollenPdf } = require('../lib/pdf-parser');
const { incomeService } = require('../lib/supabase-income');

// ============================================
// KONFIGURATION
// ============================================

const PORT = process.env.RATSIT_SERVER_PORT || 3847;
const HOST = process.env.RATSIT_SERVER_HOST || 'localhost';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wzkohritxdrstsmwopco.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Supabase client (service role for admin access)
const supabase = SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : null;

// Scraper-instans
let scraperInstance = null;
let lastActivity = Date.now();
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

// Aktiva jobb (in-memory tracking)
const activeJobs = new Map();

// ============================================
// EXPRESS APP
// ============================================

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString().substring(11, 19)}] ${req.method} ${req.path}`);
    next();
});

// ============================================
// SCRAPER HANTERING
// ============================================

async function getScraper() {
    const now = Date.now();
    if (scraperInstance && (now - lastActivity > SESSION_TIMEOUT_MS)) {
        console.log('[Server] Session timeout, stänger gammal instans');
        await scraperInstance.close().catch(() => {});
        scraperInstance = null;
    }

    if (!scraperInstance) {
        console.log('[Server] Skapar ny scraper-instans...');
        scraperInstance = new RatsitIncomeScraper({
            headless: process.env.HEADLESS !== 'false',
            useCaptchaSolver: process.env.USE_CAPTCHA_SOLVER === 'true',
            saveScreenshots: process.env.SAVE_SCREENSHOTS === 'true',
            noProxy: process.env.NO_PROXY_SCRAPER === 'true'
        });
        await scraperInstance.init();
        console.log('[Server] Scraper redo');
    }

    lastActivity = now;
    return scraperInstance;
}

async function closeScraper() {
    if (scraperInstance) {
        await scraperInstance.close().catch(() => {});
        scraperInstance = null;
    }
}

// ============================================
// PROGRESS STEG
// ============================================

// Progress steps matchar frontend ProgressBar
const PROGRESS_STEPS = {
    STARTING: { progress: 5, step: 0, message: 'Inhämtar uppgifter...' },
    BROWSER_READY: { progress: 10, step: 0, message: 'Browser klar' },
    LOGGING_IN: { progress: 15, step: 0, message: 'Loggar in på Ratsit...' },
    LOGGED_IN: { progress: 20, step: 0, message: 'Inloggad' },
    SEARCHING: { progress: 30, step: 1, message: 'Analyserar underlag...' },
    FOUND_PERSON: { progress: 40, step: 1, message: 'Person hittad' },
    DOWNLOADING_PDF: { progress: 50, step: 2, message: 'Laddar ner underlag...' },
    PARSING_PDF: { progress: 60, step: 2, message: 'Extraherar data...' },
    VALIDATING: { progress: 75, step: 3, message: 'Kontrollerar resultat...' },
    UPLOADING_PDF: { progress: 80, step: 3, message: 'Laddar upp PDF...' },
    SAVING: { progress: 90, step: 4, message: 'Sparar till databas...' },
    COMPLETED: { progress: 100, step: 4, message: 'Klart!' },
    FAILED: { progress: 0, step: -1, message: 'Misslyckades' }
};

function updateJobProgress(jobId, stepKey, error = null) {
    const job = activeJobs.get(jobId);
    if (!job) return;

    const stepInfo = PROGRESS_STEPS[stepKey] || { progress: 0, step: 0, message: stepKey };

    job.status = stepKey === 'COMPLETED' ? 'completed' : stepKey === 'FAILED' ? 'failed' : 'running';
    job.progress = stepInfo.progress;
    job.currentStep = stepInfo.message;
    job.stepIndex = stepInfo.step;
    if (error) job.error = error;
    job.updatedAt = Date.now();

    // Uppdatera Supabase-jobb om tillgängligt
    incomeService.updateFetchJob(jobId, {
        status: job.status,
        progress: job.progress,
        currentStep: job.currentStep,
        error: error
    }).catch(() => {}); // Ignorera fel

    console.log(`[Job ${jobId.slice(0, 8)}] ${stepInfo.message} (${stepInfo.progress}%)`);
}

// ============================================
// API ENDPOINTS
// ============================================

/**
 * GET /api/ratsit/status
 */
app.get('/api/ratsit/status', (req, res) => {
    res.json({
        status: 'ok',
        hasSession: !!scraperInstance,
        isLoggedIn: scraperInstance?.isLoggedIn ?? false,
        hasSupabase: !!supabase,
        activeJobs: activeJobs.size,
        uptime: process.uptime()
    });
});

/**
 * POST /api/ratsit/fetch
 * Starta inkomsthämtning med progress-tracking
 *
 * Body: { personName, birthYear?, location?, companyOrgnr?, companyName?, roleType?, userId? }
 * Response: { jobId }
 */
app.post('/api/ratsit/fetch', async (req, res) => {
    try {
        const {
            personName,
            birthYear,
            location,
            companyOrgnr,
            companyName,
            roleType,
            userId
        } = req.body;

        if (!personName) {
            return res.status(400).json({ error: 'Missing required field: personName' });
        }

        // Generera jobb-ID
        const jobId = crypto.randomUUID();

        // Skapa jobb i minnet
        const job = {
            id: jobId,
            personName,
            birthYear,
            location,
            companyOrgnr,
            companyName,
            roleType,
            userId,
            status: 'pending',
            progress: 0,
            currentStep: 'Väntar...',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        activeJobs.set(jobId, job);

        // Returnera jobId direkt
        res.json({ jobId, status: 'pending' });

        // Kör hämtning asynkront
        runFetchJob(jobId).catch(err => {
            console.error(`[Job ${jobId.slice(0, 8)}] Unexpected error:`, err);
            updateJobProgress(jobId, 'FAILED', err.message);
        });

    } catch (error) {
        console.error('[Server] Fetch error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Kör hämtningsjobb med PDF-parsing och Supabase-lagring
 */
async function runFetchJob(jobId) {
    const job = activeJobs.get(jobId);
    if (!job) return;

    try {
        updateJobProgress(jobId, 'STARTING');

        // Skapa jobb i Supabase
        await incomeService.createFetchJob(jobId, job);

        // Hämta scraper
        const scraper = await getScraper();
        updateJobProgress(jobId, 'BROWSER_READY');

        // Logga in
        updateJobProgress(jobId, 'LOGGING_IN');
        if (!scraper.isLoggedIn) {
            await scraper.login();
        }
        updateJobProgress(jobId, 'LOGGED_IN');

        // Sök efter person
        updateJobProgress(jobId, 'SEARCHING');
        const searchResult = await scraper.searchPerson(job.personName, job.location || '');

        if (!searchResult || searchResult.length === 0) {
            updateJobProgress(jobId, 'FAILED', 'Person hittades inte i sökningen');
            return;
        }

        updateJobProgress(jobId, 'FOUND_PERSON');

        // Ladda ner PDF från Lönekollen
        updateJobProgress(jobId, 'DOWNLOADING_PDF');
        const pdfPath = await scraper.downloadIncomePdf(searchResult[0], {
            birthYear: job.birthYear
        });

        if (!pdfPath) {
            updateJobProgress(jobId, 'FAILED', 'Kunde inte ladda ner PDF');
            return;
        }

        // Parsa PDF:en
        updateJobProgress(jobId, 'PARSING_PDF');
        const parsedData = await parseLonekollenPdf(pdfPath, job.personName);

        if (!parsedData || !parsedData.inkomster || parsedData.inkomster.length === 0) {
            updateJobProgress(jobId, 'FAILED', 'Kunde inte extrahera inkomstdata från PDF');
            return;
        }

        // Validera resultat
        updateJobProgress(jobId, 'VALIDATING');
        console.log(`[Job ${jobId.slice(0, 8)}] Extracted ${parsedData.inkomster.length} years for ${parsedData.namn}`);

        // Ladda upp PDF till Supabase Storage
        updateJobProgress(jobId, 'UPLOADING_PDF');
        const pdfStoragePath = await incomeService.uploadPdf(
            pdfPath,
            parsedData.namn || job.personName,
            job.companyOrgnr
        );

        // Spara inkomstdata till Supabase
        updateJobProgress(jobId, 'SAVING');
        const saveResult = await incomeService.saveIncomeData(
            parsedData,
            {
                companyOrgnr: job.companyOrgnr,
                companyName: job.companyName,
                roleType: job.roleType,
                userId: job.userId
            },
            pdfStoragePath
        );

        if (!saveResult.success && saveResult.errors.length > 0) {
            console.warn(`[Job ${jobId.slice(0, 8)}] Partial save: ${saveResult.errors.length} errors`);
        }

        // Bygg resultat för frontend
        job.result = {
            personName: parsedData.namn,
            address: parsedData.adress,
            pdfPath: pdfStoragePath,
            incomes: parsedData.inkomster.map(inc => ({
                year: inc.inkomstar,
                age: inc.alder,
                salaryRanking: inc.loneranking,
                hasPaymentRemarks: inc.betalningsanmarkning,
                taxableIncome: inc.lon_forvarvsinkomst,
                capitalIncome: inc.kapitalinkomst
            })),
            savedIds: saveResult.savedIds
        };

        job.resultId = saveResult.savedIds[0]?.id || null;

        // Markera som klar
        updateJobProgress(jobId, 'COMPLETED');

    } catch (error) {
        console.error(`[Job ${jobId.slice(0, 8)}] Error:`, error.message);
        updateJobProgress(jobId, 'FAILED', error.message);
    }
}

/**
 * GET /api/ratsit/job/:id
 * Hämta jobbstatus med progress
 */
app.get('/api/ratsit/job/:id', (req, res) => {
    const job = activeJobs.get(req.params.id);

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
        id: job.id,
        status: job.status,
        progress: job.progress,
        stepIndex: job.stepIndex || 0,
        currentStep: job.currentStep,
        error: job.error,
        result: job.result,
        resultId: job.resultId,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
    });
});

/**
 * GET /api/ratsit/income/:personName
 * Hämta sparad inkomstdata för en person
 */
app.get('/api/ratsit/income/:personName', async (req, res) => {
    try {
        const personName = decodeURIComponent(req.params.personName);
        const companyOrgnr = req.query.orgnr || null;

        const incomes = await incomeService.getPersonIncome(personName, companyOrgnr);

        res.json({
            success: true,
            personName,
            count: incomes.length,
            incomes: incomes.map(inc => ({
                id: inc.id,
                year: inc.income_year,
                age: inc.age_at_income_year,
                salaryRanking: inc.salary_ranking,
                hasPaymentRemarks: inc.has_payment_remarks,
                taxableIncome: inc.taxable_income,
                capitalIncome: inc.capital_income,
                address: inc.address,
                pdfPath: inc.pdf_storage_path,
                scrapedAt: inc.scraped_at
            }))
        });

    } catch (error) {
        console.error('[Server] Get income error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/ratsit/pdf-url/:storagePath
 * Hämta signerad URL för PDF-nedladdning
 */
app.get('/api/ratsit/pdf-url/*', async (req, res) => {
    try {
        const storagePath = req.params[0];

        if (!storagePath) {
            return res.status(400).json({ error: 'Missing storage path' });
        }

        const signedUrl = await incomeService.getPdfDownloadUrl(storagePath);

        if (!signedUrl) {
            return res.status(404).json({ error: 'PDF not found or access denied' });
        }

        res.json({ url: signedUrl, expiresIn: 3600 });

    } catch (error) {
        console.error('[Server] PDF URL error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/ratsit/search
 * Sök efter person (utan att hämta inkomst)
 */
app.post('/api/ratsit/search', async (req, res) => {
    try {
        const { name, location } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }

        const scraper = await getScraper();
        const results = await scraper.searchPerson(name, location || '');

        res.json({
            success: true,
            count: results.length,
            results
        });

    } catch (error) {
        console.error('[Server] Search error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/ratsit/close
 * Stäng scraper-session
 */
app.post('/api/ratsit/close', async (req, res) => {
    try {
        await closeScraper();
        res.json({ success: true, message: 'Session closed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cleanup gamla jobb (äldre än 1 timme)
setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, job] of activeJobs) {
        if (job.updatedAt < cutoff) {
            activeJobs.delete(id);
        }
    }
}, 5 * 60 * 1000);

// ============================================
// SERVER START
// ============================================

const server = app.listen(PORT, HOST, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    RATSIT INCOME API SERVER                   ║
╠══════════════════════════════════════════════════════════════╣
║  Server:     http://${HOST}:${PORT}                              ║
║  Status:     http://${HOST}:${PORT}/api/ratsit/status            ║
║                                                              ║
║  Endpoints:                                                  ║
║    POST /api/ratsit/fetch    - Starta hämtning (med jobId)   ║
║    GET  /api/ratsit/job/:id  - Hämta progress                ║
║    POST /api/ratsit/search   - Sök efter person              ║
║                                                              ║
║  Supabase:  ${supabase ? 'Ansluten ✓' : 'Ej konfigurerad (SUPABASE_SERVICE_KEY saknas)'}
║                                                              ║
║  Miljövariabler:                                             ║
║    RATSIT_EMAIL     - Ratsit-kontots e-post                  ║
║    RATSIT_PASSWORD  - Ratsit-kontots lösenord                ║
║    HEADLESS=false   - Visa browser (för debug/CAPTCHA)       ║
╚══════════════════════════════════════════════════════════════╝
`);
});

process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down...');
    await closeScraper();
    server.close(() => process.exit(0));
});

process.on('SIGTERM', async () => {
    await closeScraper();
    server.close(() => process.exit(0));
});

module.exports = app;
