/**
 * Impact Loop - Real-time Dashboard Server
 *
 * Utökad server med:
 * - Detaljerade processsteg
 * - Kostnadsberäkning (AI-tokens, dokumentköp)
 * - LinkedIn-profilsökning via web search
 * - Bildhantering från Mynewsdesk
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3847;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(path.join(__dirname, '../../output')));

// SSE-klienter
let sseClients = [];

// Kostnadsberäkning - Claude Opus 4.5 priser (konverterat till SEK, 1 USD ≈ 10.5 SEK)
const PRICING = {
    inputTokensPerMillion: 5 * 10.5,    // $5 per 1M tokens = 52.5 SEK
    outputTokensPerMillion: 25 * 10.5,  // $25 per 1M tokens = 262.5 SEK
    bolagsverketProtokoll: 40,          // 40 SEK per protokoll
    webSearchQuery: 0.05 * 10.5         // Uppskattad kostnad per sökning
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

// Starta kontroll
app.get('/start-kontroll', async (req, res) => {
    const orgnr = req.query.orgnr || '559322-0048';
    res.json({ status: 'started', orgnr });

    // Kör hela processen
    await runKontroll(orgnr);
});

// Kör kontroll med detaljerade realtidsuppdateringar
async function runKontroll(orgnr) {
    // Spåra kostnader
    const costs = {
        inputTokens: 0,
        outputTokens: 0,
        dokumentKop: 0,
        webSearch: 0
    };

    // Detaljerade processsteg (utökade med fler steg och längre delays)
    const steps = [
        // Fas 1: Initiering och sökning
        { step: 1, total: 24, message: 'Startar bevakningskontroll...', progress: 2 },
        { step: 2, total: 24, message: 'Ansluter till Bolagsverkets API...', progress: 5 },
        { step: 3, total: 24, message: `Söker efter ${orgnr} i företagsregistret...`, progress: 8 },
        { step: 4, total: 24, message: 'Identifierar bolag: Zpark Energy Systems AB...', progress: 11 },
        { step: 5, total: 24, message: 'Analyserar tillgängliga handlingar...', progress: 14 },

        // Fas 2: Dokumentköp
        { step: 6, total: 24, message: 'Hittar nytt bolagsstämmoprotokoll...', progress: 17 },
        { step: 7, total: 24, message: 'Förbereder köp av handling...', progress: 20 },
        { step: 8, total: 24, message: 'Genomför betalning (2,50 kr)...', progress: 24, addCost: { dokumentKop: 2.50 } },
        { step: 9, total: 24, message: 'Betalning godkänd – väntar på leverans...', progress: 28 },
        { step: 10, total: 24, message: 'Hämtar PDF från Bolagsverket...', progress: 32 },

        // Fas 3: Dokumentanalys
        { step: 11, total: 24, message: 'Extraherar text från PDF (OCR)...', progress: 36 },
        { step: 12, total: 24, message: 'Förbereder dokument för AI-analys...', progress: 40 },
        { step: 13, total: 24, message: 'AI analyserar dokumentinnehåll...', progress: 44, addCost: { inputTokens: 3500, outputTokens: 800 } },
        { step: 14, total: 24, message: 'Extraherar nyckeluppgifter från protokoll...', progress: 48 },

        // Fas 4: Datainsamling
        { step: 15, total: 24, message: 'Hämtar företagsdata från Allabolag...', progress: 52 },
        { step: 16, total: 24, message: 'Kontrollerar logotyp i Supabase...', progress: 56 },
        { step: 17, total: 24, message: 'Söker pressbilder på företagets hemsida...', progress: 60 },
        { step: 18, total: 24, message: 'Hämtar bilder från Mynewsdesk...', progress: 64 },
        { step: 19, total: 24, message: 'Optimerar och cachelagrar bilder...', progress: 68 },

        // Fas 5: LinkedIn-sökning
        { step: 20, total: 24, message: 'Söker LinkedIn-profiler för nyckelpersoner...', progress: 72, addCost: { webSearch: 2, inputTokens: 1500, outputTokens: 500 } },
        { step: 21, total: 24, message: 'Verifierar personuppgifter...', progress: 76 },

        // Fas 6: Artikelgenerering
        { step: 22, total: 24, message: 'AI genererar nyhetsartikel...', progress: 82, addCost: { inputTokens: 4000, outputTokens: 2500 } },
        { step: 23, total: 24, message: 'Formaterar artikel med bilder och faktaruta...', progress: 90 },
        { step: 24, total: 24, message: 'Sparar och förbereder resultat...', progress: 96 }
    ];

    // Kör steg med längre delay (1500-2500ms per steg)
    for (const step of steps) {
        // Lägg till kostnader om definierade
        if (step.addCost) {
            if (step.addCost.inputTokens) costs.inputTokens += step.addCost.inputTokens;
            if (step.addCost.outputTokens) costs.outputTokens += step.addCost.outputTokens;
            if (step.addCost.dokumentKop) costs.dokumentKop += step.addCost.dokumentKop;
            if (step.addCost.webSearch) costs.webSearch += step.addCost.webSearch;
        }

        broadcast('progress', step);
        await delay(1500 + Math.random() * 1000); // 1.5-2.5 sekunder per steg
    }

    // Generera artikel
    try {
        const result = await generateArticle(orgnr);

        // Beräkna totalkostnad
        const costBreakdown = calculateCosts(costs);

        broadcast('complete', {
            success: true,
            articlePath: result.path,
            articleUrl: `/output/${path.basename(result.path)}`,
            companyName: result.companyName,
            availableImages: result.availableImages || [],
            costs: costBreakdown
        });
    } catch (error) {
        broadcast('error', { message: error.message });
    }
}

// Beräkna kostnader i SEK
// Demo-värden: 2,50 kr för Bolagsverket, 5,98 kr för AI
function calculateCosts(costs) {
    // Använd fasta demovärden för demonstration
    const demoAiCost = 5.98;        // AI-kostnad i SEK
    const demoDokumentKop = 2.50;   // Bolagsverket-dokument i SEK
    const demoWebSearch = 0.00;     // Inga websökningar i denna demo
    const totalCost = demoAiCost + demoDokumentKop + demoWebSearch;

    return {
        aiTokens: {
            input: costs.inputTokens,
            output: costs.outputTokens,
            inputCost: (demoAiCost * 0.3).toFixed(2),  // ~30% input
            outputCost: (demoAiCost * 0.7).toFixed(2), // ~70% output
            totalCost: demoAiCost.toFixed(2)
        },
        dokumentKop: demoDokumentKop.toFixed(2),
        webSearch: demoWebSearch.toFixed(2),
        total: totalCost.toFixed(2)
    };
}

// Generera artikel med bilder från Mynewsdesk
async function generateArticle(orgnr) {
    const generator = require('../services/news_article_generator');

    // Hämta bilder från Mynewsdesk
    const mynewsdeskImages = await fetchMynewsdeskImages();

    const result = await generator.generateNewsArticle({
        orgnr: orgnr,
        websiteUrl: 'https://zpark.se',
        title: 'Zpark tar in nya miljoner – värderas till 40 miljoner',
        ingress: 'Det Luleå-baserade laddbolaget Zpark Energy Systems har genomfört en riktad nyemission, kan Impact Loop avslöja. Bolaget värderas nu till drygt 40 miljoner kronor.',
        content: `
            <p>I samband med att Impact Loop gick igenom nya protokoll från Bolagsverket upptäckte vi intressanta uppgifter om <strong>Zpark Energy Systems</strong>. Bolaget, som utvecklar laddlösningar för elfordon, har genomfört en riktad nyemission till ett antal nya investerare. Enligt dokumenten uppgår teckningskursen till 850 kronor per aktie, vilket ger bolaget en implicit värdering på drygt 40 miljoner kronor.</p>

            <p>Zpark grundades 2021 av <strong>Klas Jimmy Abrahamsson</strong> och har sitt säte i Luleå där bolaget driver sin utvecklingsverksamhet. Moderbolaget Tech Invest North AB kvarstår som största ägare efter emissionen. Bolaget har under det senaste räkenskapsåret omsatt 52,7 miljoner kronor och redovisat ett positivt resultat på 1,6 miljoner kronor.</p>

            <p>Med nio anställda och en stark tillväxtkurva positionerar sig Zpark som en intressant aktör inom den snabbt växande marknaden för elbilsladdning i Norden. Bolaget fokuserar på att utveckla och marknadsföra produkter och mjukvara med inriktning mot laddning, uppvärmning och parkering av personbilar.</p>

            <h2>Stark marknadstillväxt</h2>

            <p>Marknaden för laddinfrastruktur växer kraftigt i takt med att försäljningen av elbilar ökar. Enligt branschorganisationen Power Circle installerades över 15 000 nya publika laddpunkter i Sverige under 2024, en ökning med 40 procent jämfört med föregående år. Zpark har positionerat sig inom segmentet för bostadsrättsladdning och företagslösningar.</p>

            <p>Enligt Bolagsverkets handlingar har emissionen riktats till ett flertal investerare, däribland både privatpersoner och bolag med koppling till fastighetsbranschen. Det kan tyda på att Zpark siktar på att expandera sin närvaro inom bostadssegmentet där efterfrågan på laddlösningar ökar i takt med att fler bostadsrättsföreningar vill erbjuda laddning till sina medlemmar.</p>

            <p>Luleå-bolaget är ett av flera svenska företag som satsar på den snabbt växande marknaden för elbilsladdning. Konkurrensen är hård med både etablerade energibolag och nystartade techbolag som kämpar om marknadsandelar. Zparks fokus på mjukvara och integration kan dock ge bolaget en konkurrensfördel gentemot mer hårdvarufokuserade aktörer.</p>
        `,
        articleData: {},
        scrapeImages: true,
        persons: [
            { name: 'Klas Jimmy Abrahamsson', role: 'Grundare & VD' }
        ],
        author: { name: 'Impact Loop', title: 'Redaktionen' },
        openInBrowser: false, // VIKTIGT: Öppna inte automatiskt
        availableImages: mynewsdeskImages // Skicka bilderna till artikelgeneratorn
    });

    return {
        path: result.path,
        companyName: result.factbox?.companyName || 'Zpark Energy Systems AB',
        availableImages: mynewsdeskImages
    };
}

// Hämta pressbilder (lokala exempelbilder)
async function fetchMynewsdeskImages() {
    // Lokala exempelbilder för demo
    return [
        {
            id: 1,
            src: '/images/DSC02352.avif',
            alt: 'Pressbild 1 - Kontor',
            selected: true
        },
        {
            id: 2,
            src: '/images/20240704-084150-5764.avif',
            alt: 'Pressbild 2 - Event'
        },
        {
            id: 3,
            src: '/images/20231212-120055-6345.avif',
            alt: 'Pressbild 3 - Team'
        }
    ];
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Starta server
app.listen(PORT, () => {
    console.log(`\n🚀 Impact Loop Dashboard körs på http://localhost:${PORT}\n`);
});
