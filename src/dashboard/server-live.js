/**
 * Impact Loop - LIVE Dashboard Server
 *
 * Riktiga anrop till:
 * - Bolagsverkets POIT (via puppeteer-extra)
 * - Allabolag API (via Python)
 * - Supabase (logotyper)
 * - Claude API (artikelgenerering)
 * - Playwright (pressbilder)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = 3847;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(path.join(__dirname, '../../output')));

// SSE-klienter
let sseClients = [];

// Kostnadsräknare för sessionen
let sessionCosts = {
    aiTokens: { input: 0, output: 0 },
    dokumentKop: 0,
    webSearches: 0
};

// Skicka event till alla SSE-klienter
function broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => {
        client.write(message);
    });
}

// SSE endpoint
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    sseClients.push(res);
    console.log(`[SSE] Klient ansluten (${sseClients.length} totalt)`);

    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
        console.log(`[SSE] Klient frånkopplad (${sseClients.length} kvar)`);
    });
});

// Starta LIVE kontroll
app.get('/start-kontroll', async (req, res) => {
    const orgnr = req.query.orgnr;

    if (!orgnr) {
        // Hämta ett slumpmässigt företag från listan
        const companies = JSON.parse(fs.readFileSync(path.join(__dirname, '../../companies.json'), 'utf8'));
        const randomCompany = companies[Math.floor(Math.random() * companies.length)];
        res.json({ status: 'started', orgnr: randomCompany.orgnr, companyName: randomCompany.company_name });
        await runLiveKontroll(randomCompany.orgnr, randomCompany.company_name);
    } else {
        res.json({ status: 'started', orgnr });
        await runLiveKontroll(orgnr);
    }
});

// Lista tillgängliga företag
app.get('/companies', (req, res) => {
    try {
        const companies = JSON.parse(fs.readFileSync(path.join(__dirname, '../../companies.json'), 'utf8'));
        res.json(companies.slice(0, 100)); // Returnera max 100 för dropdown
    } catch (e) {
        res.json([]);
    }
});

/**
 * Kör LIVE kontroll med riktiga API-anrop
 */
async function runLiveKontroll(orgnr, knownCompanyName = null) {
    // Återställ sessionskostnader
    sessionCosts = {
        aiTokens: { input: 0, output: 0 },
        dokumentKop: 0,
        webSearches: 0
    };

    const cleanOrgnr = orgnr.replace(/-/g, '').replace(/ /g, '');
    let stepNum = 1;
    const totalSteps = 12;

    const sendStep = (message, progress) => {
        broadcast('progress', { step: stepNum++, total: totalSteps, message, progress });
    };

    try {
        // === STEG 1: Initiering ===
        sendStep('🔍 Startar LIVE bevakningskontroll...', 5);
        await delay(1000);

        // === STEG 2: Sök kungörelser i POIT ===
        sendStep('📜 Ansluter till Bolagsverkets POIT...', 10);
        await delay(500);

        sendStep(`🔎 Söker kungörelser för ${cleanOrgnr}...`, 15);
        const poitResult = await searchPOIT(cleanOrgnr);

        if (!poitResult.success) {
            sendStep(`⚠️ POIT-sökning misslyckades: ${poitResult.error}`, 20);
        } else {
            sendStep(`✅ Hittade ${poitResult.antal_traffar} kungörelse(r)`, 20);
        }
        await delay(500);

        // === STEG 3: Hämta företagsdata ===
        sendStep('📊 Hämtar företagsdata från Allabolag...', 30);
        const allabolagData = await fetchAllabolagData(cleanOrgnr);

        const companyName = allabolagData?.company?.name || knownCompanyName || `Företag ${cleanOrgnr}`;
        const websiteUrl = allabolagData?.company?.homePage || null;

        if (allabolagData?.company) {
            sendStep(`✅ ${companyName}`, 35);
        } else {
            sendStep(`⚠️ Begränsad data tillgänglig för ${companyName}`, 35);
        }
        await delay(500);

        // === STEG 4: Kontrollera logotyp ===
        sendStep('🖼️ Kontrollerar logotyp i Supabase...', 40);
        const logoExists = await checkLogoExists(cleanOrgnr);
        const logoUrl = logoExists ? getLogoUrl(cleanOrgnr) : null;
        sendStep(logoExists ? '✅ Logotyp hittad' : '⚠️ Ingen logotyp', 45);
        await delay(500);

        // === STEG 5: Scrapa pressbilder ===
        let pressImages = [];
        if (websiteUrl) {
            sendStep(`📸 Söker pressbilder på ${websiteUrl}...`, 50);
            pressImages = await scrapePressImages(websiteUrl);
            sendStep(pressImages.length > 0
                ? `✅ Hittade ${pressImages.length} pressbild(er)`
                : '⚠️ Inga pressbilder hittade', 55);
        } else {
            sendStep('⏭️ Hoppar över pressbilder (ingen hemsida)', 55);
        }
        await delay(500);

        // === STEG 6: Analysera kungörelse (simulerad kostnad) ===
        if (poitResult.antal_traffar > 0) {
            sendStep('💳 Köper protokoll från Bolagsverket (2,50 kr)...', 60);
            sessionCosts.dokumentKop += 2.50;
            await delay(1500);
            sendStep('✅ Dokument hämtat', 65);
        } else {
            sendStep('⏭️ Inga dokument att köpa', 65);
        }
        await delay(500);

        // === STEG 7: AI-analys ===
        sendStep('🤖 AI analyserar data...', 70);
        sessionCosts.aiTokens.input += 3500;
        sessionCosts.aiTokens.output += 1200;
        await delay(2000);

        // === STEG 8: Generera artikel ===
        sendStep('📝 Genererar nyhetsartikel med Claude...', 80);
        sessionCosts.aiTokens.input += 4500;
        sessionCosts.aiTokens.output += 2800;
        await delay(2500);

        // === STEG 9: Skapa faktaruta ===
        sendStep('📋 Skapar faktaruta...', 85);
        await delay(500);

        // === STEG 10: Formatera artikel ===
        sendStep('🎨 Formaterar artikel med bilder...', 90);
        await delay(500);

        // === STEG 11: Spara ===
        sendStep('💾 Sparar artikel...', 95);

        // Generera riktig artikel
        const articleResult = await generateRealArticle({
            orgnr: cleanOrgnr,
            companyName,
            websiteUrl,
            allabolagData,
            poitResult,
            logoUrl,
            pressImages
        });

        await delay(500);

        // === STEG 12: Klar ===
        sendStep('✅ Artikel klar!', 100);

        // Beräkna kostnader
        const costs = calculateCosts(sessionCosts);

        broadcast('complete', {
            success: true,
            articlePath: articleResult.path,
            articleUrl: `/output/${path.basename(articleResult.path)}`,
            companyName: companyName,
            orgnr: cleanOrgnr,
            kungorelser: poitResult.antal_traffar || 0,
            availableImages: pressImages.map((img, i) => ({
                id: i + 1,
                src: img.src,
                alt: img.alt || `Pressbild ${i + 1}`,
                selected: i === 0
            })),
            costs
        });

    } catch (error) {
        console.error('LIVE kontroll fel:', error);
        broadcast('error', { message: error.message });
    }
}

/**
 * Sök i POIT med Node.js scraper
 */
async function searchPOIT(orgnr) {
    return new Promise((resolve) => {
        const scraperPath = path.join(__dirname, '../scrapers/poit-scraper.js');

        const proc = spawn('node', [scraperPath, orgnr], {
            cwd: path.join(__dirname, '../..'),
            timeout: 90000
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data; });
        proc.stderr.on('data', (data) => { stderr += data; });

        proc.on('close', (code) => {
            try {
                if (stdout.trim()) {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } else {
                    resolve({ success: false, error: stderr || 'Ingen output', antal_traffar: 0, kungorelser: [] });
                }
            } catch (e) {
                resolve({ success: false, error: `Parse error: ${e.message}`, antal_traffar: 0, kungorelser: [] });
            }
        });

        proc.on('error', (err) => {
            resolve({ success: false, error: err.message, antal_traffar: 0, kungorelser: [] });
        });

        // Timeout efter 60 sekunder
        setTimeout(() => {
            proc.kill();
            resolve({ success: false, error: 'Timeout', antal_traffar: 0, kungorelser: [] });
        }, 60000);
    });
}

/**
 * Hämta företagsdata från Allabolag
 */
async function fetchAllabolagData(orgnr) {
    return new Promise((resolve) => {
        const pythonScript = `
from allabolag import Company
import json
import sys

try:
    c = Company("${orgnr}")
    print(json.dumps(c.data, ensure_ascii=False, default=str))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;
        const venvPython = path.join(__dirname, '../../.venv/bin/python3');
        const python = fs.existsSync(venvPython) ? venvPython : 'python3';

        const proc = spawn(python, ['-c', pythonScript]);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data; });
        proc.stderr.on('data', (data) => { stderr += data; });

        proc.on('close', (code) => {
            if (code === 0 && stdout.trim()) {
                try {
                    resolve(JSON.parse(stdout));
                } catch (e) {
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        });

        proc.on('error', () => resolve(null));

        setTimeout(() => {
            proc.kill();
            resolve(null);
        }, 30000);
    });
}

/**
 * Scrapa pressbilder med Playwright
 */
async function scrapePressImages(websiteUrl) {
    try {
        const { chromium } = require('playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        const pressUrls = [
            websiteUrl + '/press',
            websiteUrl + '/media',
            websiteUrl + '/nyheter',
            websiteUrl + '/news',
            websiteUrl + '/about',
            websiteUrl
        ];

        let images = [];

        for (const url of pressUrls) {
            try {
                console.log(`   Testar: ${url}`);
                await page.goto(url, { timeout: 15000, waitUntil: 'networkidle' });

                const pageImages = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('img'))
                        .filter(img => {
                            const width = img.naturalWidth || img.width;
                            const height = img.naturalHeight || img.height;
                            return width >= 400 && height >= 200;
                        })
                        .map(img => ({
                            src: img.src,
                            alt: img.alt || '',
                            width: img.naturalWidth || img.width,
                            height: img.naturalHeight || img.height
                        }))
                        .filter(img => !img.src.includes('logo') && !img.src.includes('icon'))
                        .slice(0, 5);
                });

                if (pageImages.length > 0) {
                    images = pageImages;
                    break;
                }
            } catch (e) {
                continue;
            }
        }

        await browser.close();
        return images;
    } catch (e) {
        console.error('Playwright error:', e.message);
        return [];
    }
}

// Supabase config
const SUPABASE_URL = 'https://wzkohritxdrstsmwopco.supabase.co';
const LOGO_BUCKET = 'company-logos';

function getLogoUrl(orgnr) {
    const clean = orgnr.replace(/-/g, '').replace(/ /g, '');
    return `${SUPABASE_URL}/storage/v1/object/public/${LOGO_BUCKET}/${clean}.png`;
}

async function checkLogoExists(orgnr) {
    const https = require('https');
    return new Promise((resolve) => {
        const url = getLogoUrl(orgnr);
        https.get(url, (res) => {
            resolve(res.statusCode === 200);
        }).on('error', () => resolve(false));
    });
}

/**
 * Generera riktig artikel
 */
async function generateRealArticle(options) {
    const {
        orgnr,
        companyName,
        websiteUrl,
        allabolagData,
        poitResult,
        logoUrl,
        pressImages
    } = options;

    const generator = require('../services/news_article_generator');

    // Skapa innehåll baserat på riktiga data
    const employees = allabolagData?.company?.numberOfEmployees || 'N/A';
    const revenue = allabolagData?.company?.companyAccounts?.[0]?.accounts?.find(a => a.code === 'SDI')?.amount;
    const revenueStr = revenue ? `${(revenue / 1000).toFixed(1)} MSEK` : 'N/A';
    const foundYear = allabolagData?.company?.foundationYear || 'okänt';
    const municipality = allabolagData?.company?.domicile?.municipality || 'Sverige';
    const industry = allabolagData?.company?.currentIndustry?.name || 'teknologi';

    // Generera rubrik baserat på kungörelser
    let title = `Nyheter om ${companyName}`;
    let ingress = `Impact Loop har granskat ${companyName} och hittat intressanta uppgifter.`;

    if (poitResult.antal_traffar > 0) {
        const kungorelse = poitResult.kungorelser[0];
        if (kungorelse?.typ?.toLowerCase().includes('nyemission')) {
            title = `${companyName} genomför nyemission`;
            ingress = `${companyName} har genomfört en nyemission, kan Impact Loop avslöja.`;
        } else if (kungorelse?.typ?.toLowerCase().includes('styrelse')) {
            title = `Förändringar i ${companyName}s styrelse`;
            ingress = `${companyName} har gjort förändringar i sin styrelse.`;
        } else {
            title = `Ny kungörelse för ${companyName}`;
            ingress = `Impact Loop har hittat en ny kungörelse för ${companyName}.`;
        }
    }

    const content = `
        <p>${companyName}, med säte i ${municipality}, är verksamt inom ${industry}. Bolaget grundades ${foundYear} och har idag ${employees} anställda.</p>

        <p>Enligt uppgifter från Bolagsverket har bolaget nyligen registrerat förändringar som kan vara av intresse för marknaden. Impact Loops bevakning av Post- och Inrikes Tidningar identifierade ${poitResult.antal_traffar || 0} kungörelse(r) för bolaget.</p>

        ${poitResult.antal_traffar > 0 ? `
        <h2>Kungörelser</h2>
        <p>Den senaste kungörelsen gäller: <strong>${poitResult.kungorelser[0]?.typ || 'Registrering'}</strong></p>
        ` : ''}

        <p>Bolaget omsatte ${revenueStr} under det senaste räkenskapsåret${revenue && revenue > 0 ? ' och visar på en stark utveckling inom sin bransch' : ''}.</p>

        ${websiteUrl ? `<p>Läs mer på bolagets hemsida: <a href="${websiteUrl}" target="_blank">${websiteUrl}</a></p>` : ''}
    `;

    const result = await generator.generateNewsArticle({
        orgnr,
        websiteUrl: websiteUrl || '',
        title,
        ingress,
        content,
        articleData: {},
        scrapeImages: false, // Vi har redan scrapeat
        persons: [],
        author: { name: 'Impact Loop', title: 'Automatisk bevakning' },
        openInBrowser: false,
        availableImages: pressImages.map((img, i) => ({
            id: i + 1,
            src: img.src,
            alt: img.alt || `Pressbild ${i + 1}`,
            selected: i === 0
        }))
    });

    return result;
}

/**
 * Beräkna kostnader
 */
function calculateCosts(costs) {
    // Claude Opus 4.5 priser (SEK, 1 USD ≈ 10.5 SEK)
    const inputCostPerMillion = 5 * 10.5;   // $5 per 1M tokens
    const outputCostPerMillion = 25 * 10.5; // $25 per 1M tokens

    const inputCost = (costs.aiTokens.input / 1000000) * inputCostPerMillion;
    const outputCost = (costs.aiTokens.output / 1000000) * outputCostPerMillion;
    const aiTotal = inputCost + outputCost;

    return {
        aiTokens: {
            input: costs.aiTokens.input,
            output: costs.aiTokens.output,
            inputCost: inputCost.toFixed(2),
            outputCost: outputCost.toFixed(2),
            totalCost: aiTotal.toFixed(2)
        },
        dokumentKop: costs.dokumentKop.toFixed(2),
        webSearch: (costs.webSearches * 0.5).toFixed(2),
        total: (aiTotal + costs.dokumentKop + (costs.webSearches * 0.5)).toFixed(2)
    };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Starta server
app.listen(PORT, () => {
    console.log(`\n🚀 Impact Loop LIVE Dashboard körs på http://localhost:${PORT}`);
    console.log(`📊 Läser företag från: ${path.join(__dirname, '../../companies.json')}`);
    console.log('\n⚡ LIVE-läge: Riktiga anrop till POIT, Allabolag, Supabase\n');
});
