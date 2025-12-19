/**
 * Bevakningsverktyg Dashboard Server
 * Budget, dokumenthantering och företagsväljare
 */

const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3850;

// Supabase client
const SUPABASE_URL = 'https://wzkohritxdrstsmwopco.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a29ocml0eGRyc3RzbXdvcGNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMjkzMjUsImV4cCI6MjA4MDgwNTMyNX0.GigaAVp781QF9rv-AslVD_p4ksT8auWHwXU72H1kOqo';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a29ocml0eGRyc3RzbXdvcGNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIyOTMyNSwiZXhwIjoyMDgwODA1MzI1fQ.LHTvqimTgY7-vIoaKhh2G-Vl4BkRA7WYs5Leti-9fBY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===========================================
// API: Budget & Statistik
// ===========================================

// Hämta budget-inställningar
app.get('/api/budget/settings', async (req, res) => {
    const { data, error } = await supabase
        .from('budget_settings')
        .select('*')
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.json(data);
});

// Uppdatera budget-inställningar
app.put('/api/budget/settings', async (req, res) => {
    const { monthly_limit_sek, alert_threshold, auto_stop } = req.body;

    const { data, error } = await supabaseAdmin
        .from('budget_settings')
        .update({
            monthly_limit_sek,
            alert_threshold,
            auto_stop,
            updated_at: new Date().toISOString()
        })
        .eq('id', req.body.id)
        .select()
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.json(data);
});

// Hämta budget-statistik
app.get('/api/budget/stats', async (req, res) => {
    try {
        // Hämta inställningar
        const { data: settings } = await supabase
            .from('budget_settings')
            .select('*')
            .single();

        // Hämta alla köp
        const { data: purchases } = await supabase
            .from('document_purchases')
            .select('amount_sek, created_at')
            .order('created_at', { ascending: false });

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // Beräkna statistik
        const currentMonthPurchases = (purchases || []).filter(p =>
            p.created_at.startsWith(currentMonth)
        );
        const currentMonthSpending = currentMonthPurchases.reduce((sum, p) => sum + parseFloat(p.amount_sek), 0);
        const totalAllTime = (purchases || []).reduce((sum, p) => sum + parseFloat(p.amount_sek), 0);

        // Gruppera per månad
        const byMonth = {};
        (purchases || []).forEach(p => {
            const month = p.created_at.substring(0, 7);
            if (!byMonth[month]) {
                byMonth[month] = { count: 0, total: 0 };
            }
            byMonth[month].count++;
            byMonth[month].total += parseFloat(p.amount_sek);
        });

        res.json({
            monthlyLimit: settings?.monthly_limit_sek || 500,
            currentMonth,
            currentMonthSpending,
            currentMonthCount: currentMonthPurchases.length,
            remaining: (settings?.monthly_limit_sek || 500) - currentMonthSpending,
            percentUsed: Math.round((currentMonthSpending / (settings?.monthly_limit_sek || 500)) * 100),
            totalAllTime,
            totalPurchases: (purchases || []).length,
            byMonth,
            settings
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// API: Dokumentköp
// ===========================================

// Hämta alla köpta dokument
app.get('/api/documents', async (req, res) => {
    const { limit = 50, offset = 0 } = req.query;

    const { data, error, count } = await supabase
        .from('document_purchases')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.json({ documents: data, total: count });
});

// Registrera nytt dokumentköp
app.post('/api/documents', async (req, res) => {
    const purchase = req.body;

    const { data, error } = await supabaseAdmin
        .from('document_purchases')
        .insert({
            orgnr: purchase.orgnr,
            company_name: purchase.companyName,
            document_type: purchase.documentType || 'Bolagsstämmoprotokoll',
            document_date: purchase.documentDate,
            amount_sek: purchase.amount,
            ordernummer: purchase.ordernummer,
            email: purchase.email,
            file_name: purchase.fileName,
            file_path: purchase.filePath,
            storage_path: purchase.storagePath,
            storage_url: purchase.storageUrl,
            payment_status: 'completed',
            metadata: purchase.metadata || {}
        })
        .select()
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.json(data);
});

// Ladda upp dokument till Supabase Storage
app.post('/api/documents/upload', multer({ dest: '/tmp/uploads/' }).single('file'), async (req, res) => {
    try {
        const file = req.file;
        const { orgnr, companyName, documentType } = req.body;

        if (!file) {
            return res.status(400).json({ error: 'Ingen fil uppladdad' });
        }

        // Skapa filnamn
        const date = new Date().toISOString().split('T')[0];
        const cleanName = (companyName || 'Okänt').replace(/[^a-zA-Z0-9åäöÅÄÖ\s-]/g, '').substring(0, 30);
        const fileName = `${date}_${orgnr}_${cleanName}_${documentType || 'Dokument'}.pdf`;
        const storagePath = `${orgnr}/${fileName}`;

        // Läs filen
        const fileBuffer = fs.readFileSync(file.path);

        // Ladda upp till Supabase Storage
        const { data, error } = await supabaseAdmin.storage
            .from('company-documents')
            .upload(storagePath, fileBuffer, {
                contentType: 'application/pdf',
                upsert: true
            });

        // Ta bort temp-fil
        fs.unlinkSync(file.path);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // Hämta public URL
        const { data: urlData } = supabaseAdmin.storage
            .from('company-documents')
            .getPublicUrl(storagePath);

        res.json({
            success: true,
            storagePath,
            storageUrl: urlData.publicUrl,
            fileName
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// API: Företag (från loop_table)
// ===========================================

// Sök företag
app.get('/api/companies/search', async (req, res) => {
    const { q, limit = 50 } = req.query;

    let query = supabase
        .from('loop_table')
        .select('orgnr, company_name, sector, city')
        .order('company_name')
        .limit(parseInt(limit));

    if (q && q.length > 0) {
        // Sök på namn eller orgnr
        query = query.or(`company_name.ilike.%${q}%,orgnr.ilike.%${q}%`);
    }

    const { data, error } = await query;

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    // Formatera orgnr
    const companies = (data || []).map(c => ({
        ...c,
        orgnrFormatted: c.orgnr ? `${c.orgnr.substring(0, 6)}-${c.orgnr.substring(6)}` : c.orgnr
    }));

    res.json(companies);
});

// Hämta företagsdetaljer
app.get('/api/companies/:orgnr', async (req, res) => {
    const { orgnr } = req.params;
    const cleanOrgnr = orgnr.replace(/-/g, '');

    // Hämta från loop_table
    const { data: loopData } = await supabase
        .from('loop_table')
        .select('*')
        .eq('orgnr', cleanOrgnr)
        .single();

    // Hämta från companies för mer detaljer
    const { data: companyData } = await supabase
        .from('companies')
        .select('*, roles(*)')
        .eq('orgnr', cleanOrgnr)
        .single();

    // Hämta logotyp
    const { data: logoUrl } = supabase.storage
        .from('company-logos')
        .getPublicUrl(`${cleanOrgnr}.png`);

    // Hämta köpta dokument för detta företag
    const { data: documents } = await supabase
        .from('document_purchases')
        .select('*')
        .eq('orgnr', cleanOrgnr)
        .order('created_at', { ascending: false });

    res.json({
        loop: loopData,
        company: companyData,
        logoUrl: logoUrl?.publicUrl,
        documents: documents || []
    });
});

// Hämta statistik om företagslistan
app.get('/api/companies/stats', async (req, res) => {
    const { count: loopCount } = await supabase
        .from('loop_table')
        .select('*', { count: 'exact', head: true });

    const { data: sectors } = await supabase
        .from('loop_sectors')
        .select('sector_name')
        .limit(1000);

    // Räkna unika sektorer
    const uniqueSectors = [...new Set((sectors || []).map(s => s.sector_name))];

    res.json({
        totalCompanies: loopCount,
        uniqueSectors: uniqueSectors.length,
        sectorList: uniqueSectors.sort()
    });
});

// ===========================================
// API: Nyheter & Artiklar
// ===========================================

// Sök nyheter för ett företag (SSE endpoint) - Steg 1: Returnerar händelser
app.post('/api/news/search', async (req, res) => {
    const { orgnr, companyName } = req.body;

    if (!orgnr) {
        return res.status(400).json({ error: 'Orgnr krävs' });
    }

    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const cleanOrgnr = orgnr.replace(/-/g, '');

        // Steg 1: Initiering
        sendEvent({ type: 'log', message: `Startar snabbsökning för ${companyName} (${cleanOrgnr})...` });
        await sleep(500);

        // Steg 2: Söker på POIT
        sendEvent({ type: 'log', message: 'Ansluter till poit.bolagsverket.se...' });
        await sleep(800);
        sendEvent({ type: 'log', message: 'Söker efter registrerade bolagshändelser...' });

        // Simulera POIT-sökning (ersätts med riktig scraper senare)
        const poitResults = await searchPOIT(cleanOrgnr, sendEvent);

        // Steg 3: Söker företagsinfo
        sendEvent({ type: 'log', message: 'Hämtar företagsinformation...' });
        await sleep(400);

        const { data: companyData } = await supabase
            .from('companies')
            .select('*, roles(*)')
            .eq('orgnr', cleanOrgnr)
            .single();

        const { data: loopData } = await supabase
            .from('loop_table')
            .select('*')
            .eq('orgnr', cleanOrgnr)
            .single();

        if (companyData || loopData) {
            sendEvent({ type: 'log', message: `✓ Hittade företagsdata för ${companyName}` });
        } else {
            sendEvent({ type: 'log', message: `⚠ Ingen detaljerad företagsdata hittades` });
        }

        // Skicka upptäckta händelser till frontend för val
        sendEvent({
            type: 'events',
            events: poitResults,
            companyData: {
                orgnr: cleanOrgnr,
                companyName: companyName || loopData?.company_name || 'Okänt företag',
                sector: loopData?.sector,
                city: loopData?.city,
                numEmployees: companyData?.num_employees,
                roles: companyData?.roles || [],
                loopData: loopData || null
            }
        });

        // Avsluta - användaren väljer nu vilka händelser att granska
        sendEvent({ type: 'complete', message: 'Snabbsökning klar - välj händelser att granska' });
        res.end();

    } catch (error) {
        console.error('Sökning misslyckades:', error);
        sendEvent({ type: 'error', message: `Fel: ${error.message}` });
        res.end();
    }
});

// Djupgranskning av valda händelser (SSE endpoint) - Steg 2: Genererar artiklar
app.post('/api/news/investigate', async (req, res) => {
    const { orgnr, companyName, events, companyData } = req.body;

    if (!orgnr || !events || events.length === 0) {
        return res.status(400).json({ error: 'Orgnr och minst en händelse krävs' });
    }

    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const cleanOrgnr = orgnr.replace(/-/g, '');
        const articles = [];

        sendEvent({ type: 'log', level: 'info', message: `Startar djupgranskning av ${events.length} händelse(r)...` });
        await sleep(500);

        // Gå igenom varje vald händelse
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            const eventNum = i + 1;

            sendEvent({
                type: 'progress',
                current: eventNum,
                total: events.length,
                event: event.type
            });

            sendEvent({ type: 'log', level: 'info', message: `\n[${eventNum}/${events.length}] Granskar: ${event.type}` });
            await sleep(400);

            // Simulera dokumenthämtning för vissa händelsetyper
            if (['Årsredovisning', 'Styrelseändring', 'Kapitalförändring', 'Bolagsstämmoprotokoll'].includes(event.type)) {
                sendEvent({ type: 'log', level: 'info', message: `   → Hämtar underlag från Bolagsverket...` });
                await sleep(1200);

                // Simulera dokumentköp
                const cost = getEventCost(event.type);
                if (cost > 0) {
                    sendEvent({ type: 'log', level: 'success', message: `   ✓ Dokument hämtat (${cost} SEK)` });

                    // Registrera köp i databasen (simulerat)
                    sendEvent({ type: 'purchase', eventType: event.type, cost: cost });
                } else {
                    sendEvent({ type: 'log', level: 'success', message: `   ✓ Dokument hämtat (gratis)` });
                }
            }

            // Analysera händelsen
            sendEvent({ type: 'log', level: 'info', message: `   → Analyserar innehåll...` });
            await sleep(800);

            // Generera artikel för denna händelse
            sendEvent({ type: 'log', level: 'info', message: `   → Genererar artikelutkast...` });
            await sleep(1000);

            const article = generateEventArticle({
                orgnr: cleanOrgnr,
                companyName,
                event,
                companyData
            });

            articles.push(article);
            sendEvent({ type: 'log', level: 'success', message: `   ✓ Artikel genererad: "${article.headline}"` });
        }

        // Sammanfattning
        sendEvent({ type: 'log', level: 'info', message: `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` });
        sendEvent({ type: 'log', level: 'success', message: `✓ Djupgranskning slutförd!` });
        sendEvent({ type: 'log', level: 'info', message: `  ${articles.length} artikelutkast genererade` });

        // Skicka alla artiklar
        sendEvent({
            type: 'articles',
            articles: articles
        });

        sendEvent({ type: 'complete', message: 'Djupgranskning slutförd' });
        res.end();

    } catch (error) {
        console.error('Djupgranskning misslyckades:', error);
        sendEvent({ type: 'error', message: `Fel: ${error.message}` });
        res.end();
    }
});

// Kostnad per händelsetyp
function getEventCost(eventType) {
    const costs = {
        'Årsredovisning': 40,
        'Styrelseändring': 20,
        'Adressändring': 0,
        'Kapitalförändring': 20,
        'Firmaändring': 20,
        'Bolagsstämmoprotokoll': 50
    };
    return costs[eventType] || 20;
}

// Generera artikel för en specifik händelse
function generateEventArticle({ orgnr, companyName, event, companyData }) {
    const today = new Date().toLocaleDateString('sv-SE');

    let headline = '';
    let lead = '';
    let body = '';

    // Anpassa rubrik och innehåll baserat på händelsetyp
    switch (event.type) {
        case 'Styrelseändring':
            headline = `${companyName} genomför förändringar i styrelsen`;
            lead = `${companyName} har registrerat förändringar i sin styrelsesammansättning hos Bolagsverket, enligt uppgifter från det officiella registret.`;
            body = buildArticleBody(companyName, orgnr, event, companyData,
                'Ändringen i styrelsesammansättningen kan signalera en ny strategisk inriktning för bolaget.');
            break;

        case 'Årsredovisning':
            headline = `${companyName} lämnar in årsredovisning`;
            lead = `${companyName} har registrerat sin årsredovisning hos Bolagsverket. Dokumentet ger insyn i bolagets ekonomiska utveckling under det gångna räkenskapsåret.`;
            body = buildArticleBody(companyName, orgnr, event, companyData,
                'Årsredovisningen innehåller balans- och resultaträkning samt förvaltningsberättelse.');
            break;

        case 'Kapitalförändring':
            headline = `${companyName} ändrar aktiekapital`;
            lead = `${companyName} har registrerat en förändring av aktiekapitalet hos Bolagsverket. Ändringen kan vara resultatet av en nyemission, minskning av aktiekapital eller annan kapitalåtgärd.`;
            body = buildArticleBody(companyName, orgnr, event, companyData,
                'Kapitalförändringar kan indikera expansion, omstrukturering eller anpassning till nya förutsättningar.');
            break;

        case 'Firmaändring':
            headline = `${companyName} ändrar firmanamn`;
            lead = `${companyName} har registrerat ett nytt firmanamn hos Bolagsverket. Namnbytet träder i kraft omedelbart vid registreringen.`;
            body = buildArticleBody(companyName, orgnr, event, companyData,
                'Namnändringar kan bero på ny verksamhetsinriktning, varumärkesstrategi eller ägarförändringar.');
            break;

        case 'Adressändring':
            headline = `${companyName} flyttar sin verksamhet`;
            lead = `${companyName} har registrerat en ny företagsadress hos Bolagsverket. Flytten kan signalera expansion, omorganisation eller kostnadsbesparing.`;
            body = buildArticleBody(companyName, orgnr, event, companyData,
                'Den nya adressen är nu registrerad i det officiella företagsregistret.');
            break;

        case 'Bolagsstämmoprotokoll':
            headline = `${companyName} håller bolagsstämma`;
            lead = `${companyName} har registrerat protokoll från bolagsstämma hos Bolagsverket. Stämman har fattat beslut som påverkar bolagets framtida utveckling.`;
            body = buildArticleBody(companyName, orgnr, event, companyData,
                'Bolagsstämman är det högsta beslutande organet i ett aktiebolag.');
            break;

        default:
            headline = `${companyName}: Ny registrering hos Bolagsverket`;
            lead = `${companyName} har registrerat en ny händelse hos Bolagsverket: ${event.description || event.type}.`;
            body = buildArticleBody(companyName, orgnr, event, companyData, '');
    }

    return {
        headline,
        lead,
        body,
        orgnr,
        companyName,
        eventType: event.type,
        eventDate: event.date,
        sourceData: {
            event,
            companyData
        }
    };
}

// Hjälpfunktion för att bygga artikelkropp
function buildArticleBody(companyName, orgnr, event, companyData, additionalContext) {
    const parts = [];

    // Intro
    let intro = `${companyName} (org.nr ${orgnr}) är ett företag`;
    if (companyData?.sector) {
        intro += ` verksamt inom ${companyData.sector}`;
    }
    if (companyData?.city) {
        intro += ` med säte i ${companyData.city}`;
    }
    intro += '.';
    parts.push(intro);

    // Händelsedetaljer
    parts.push(`\nHändelse registrerad: ${event.date}`);
    parts.push(`Typ: ${event.type}`);
    if (event.description) {
        parts.push(`Beskrivning: ${event.description}`);
    }

    // Extra kontext
    if (additionalContext) {
        parts.push(`\n${additionalContext}`);
    }

    // Företagsinfo
    if (companyData?.numEmployees) {
        parts.push(`\nAntal anställda: ${companyData.numEmployees}`);
    }

    // VD/ledning
    if (companyData?.roles && companyData.roles.length > 0) {
        const vd = companyData.roles.find(r => r.role_type === 'VD' || r.role_type === 'Verkställande direktör');
        if (vd) {
            parts.push(`VD: ${vd.name}`);
        }
    }

    // Källa
    parts.push(`\nKälla: Bolagsverket (poit.bolagsverket.se)`);

    return parts.join('\n');
}

// Hjälpfunktion för POIT-sökning (simulerad för nu)
async function searchPOIT(orgnr, sendEvent) {
    // I framtiden: integrera med riktig POIT-scraper
    // För nu: simulera resultat baserat på orgnr

    sendEvent({ type: 'log', message: 'Söker registrerade ärenden...' });
    await sleep(1200);

    // Simulerade resultat (ersätts med riktig data)
    const mockResults = [];

    // Slumpmässigt antal händelser för demo
    const numEvents = Math.floor(Math.random() * 4);

    const eventTypes = [
        { type: 'Årsredovisning', desc: 'Inlämnad årsredovisning' },
        { type: 'Styrelseändring', desc: 'Ändring i styrelsesammansättning' },
        { type: 'Adressändring', desc: 'Ändrad företagsadress' },
        { type: 'Kapitalförändring', desc: 'Förändring av aktiekapital' },
        { type: 'Firmaändring', desc: 'Namnändring registrerad' }
    ];

    for (let i = 0; i < numEvents; i++) {
        const event = eventTypes[Math.floor(Math.random() * eventTypes.length)];
        const daysAgo = Math.floor(Math.random() * 90);
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);

        mockResults.push({
            type: event.type,
            description: event.desc,
            date: date.toISOString().split('T')[0],
            source: 'poit.bolagsverket.se'
        });
    }

    if (mockResults.length > 0) {
        sendEvent({ type: 'log', message: `✓ Hittade ${mockResults.length} bolagshändelse(r)` });
        mockResults.forEach(r => {
            sendEvent({ type: 'log', message: `  • ${r.type} (${r.date})` });
        });
    } else {
        sendEvent({ type: 'log', message: '○ Inga nya bolagshändelser registrerade' });
    }

    return mockResults;
}

// Generera artikel baserat på data
function generateArticle({ orgnr, companyName, poitResults, companyData, loopData }) {
    const today = new Date().toLocaleDateString('sv-SE');

    // Headline baserad på senaste händelse
    let headline = `${companyName}: Senaste bolagshändelser`;
    let lead = '';
    let body = '';

    if (poitResults.length > 0) {
        const latestEvent = poitResults[0];
        headline = `${companyName} registrerar ${latestEvent.type.toLowerCase()}`;
        lead = `${companyName} har nyligen registrerat ${latestEvent.description.toLowerCase()} hos Bolagsverket, visar en genomgång av offentliga registeruppgifter.`;
    } else {
        headline = `${companyName}: Inga nya bolagshändelser`;
        lead = `En genomgång av Bolagsverkets register visar inga nya registrerade händelser för ${companyName} under den senaste perioden.`;
    }

    // Bygg body
    const bodyParts = [];

    // Intro
    bodyParts.push(`${companyName} (org.nr ${orgnr}) är ett företag`);

    if (loopData?.sector) {
        bodyParts[0] += ` verksamt inom ${loopData.sector}`;
    }
    if (loopData?.city) {
        bodyParts[0] += ` med säte i ${loopData.city}`;
    }
    bodyParts[0] += '.';

    // Händelser
    if (poitResults.length > 0) {
        bodyParts.push('\nEnligt uppgifter från Bolagsverket har följande händelser registrerats:');
        poitResults.forEach(event => {
            bodyParts.push(`• ${event.type}: ${event.description} (${event.date})`);
        });
    }

    // Företagsinfo
    if (companyData) {
        bodyParts.push('\nOm företaget:');
        if (companyData.num_employees) {
            bodyParts.push(`Antal anställda: ${companyData.num_employees}`);
        }
        if (companyData.roles && companyData.roles.length > 0) {
            const vd = companyData.roles.find(r => r.role_type === 'VD' || r.role_type === 'Verkställande direktör');
            if (vd) {
                bodyParts.push(`VD: ${vd.name}`);
            }
        }
    }

    body = bodyParts.join('\n');

    return {
        headline,
        lead,
        body,
        companyName,
        orgnr
    };
}

// Hjälpfunktion för fördröjning
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Hämta sparade artiklar
app.get('/api/news/articles', async (req, res) => {
    const { limit = 10, offset = 0 } = req.query;

    const { data, error, count } = await supabase
        .from('news_articles')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.json({
        articles: data || [],
        total: count || 0,
        limit: parseInt(limit),
        offset: parseInt(offset)
    });
});

// Spara ny artikel
app.post('/api/news/articles', async (req, res) => {
    const { orgnr, companyName, headline, lead, body, sourceData } = req.body;

    const { data, error } = await supabaseAdmin
        .from('news_articles')
        .insert({
            orgnr,
            company_name: companyName,
            headline,
            lead,
            body,
            article_type: 'bolagshändelse',
            source_data: sourceData || {},
            poit_results: sourceData?.poitResults || [],
            status: 'draft'
        })
        .select()
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.json(data);
});

// Hämta enskild artikel
app.get('/api/news/articles/:id', async (req, res) => {
    const { id } = req.params;

    const { data, error } = await supabase
        .from('news_articles')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.json(data);
});

// Uppdatera artikel
app.put('/api/news/articles/:id', async (req, res) => {
    const { id } = req.params;
    const { headline, lead, body, status } = req.body;

    const { data, error } = await supabaseAdmin
        .from('news_articles')
        .update({
            headline,
            lead,
            body,
            status,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.json(data);
});

// Ta bort artikel
app.delete('/api/news/articles/:id', async (req, res) => {
    const { id } = req.params;

    const { error } = await supabaseAdmin
        .from('news_articles')
        .delete()
        .eq('id', id);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
});

// ===========================================
// Serve Dashboard
// ===========================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n🎛️  Bevakningsverktyg Dashboard körs på http://localhost:${PORT}`);
    console.log(`📊 Budget & Dokumenthantering`);
    console.log(`🏢 ${1214} företag från Supabase loop_table\n`);
});

module.exports = app;
