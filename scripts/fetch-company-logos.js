/**
 * Hämta företagslogotyper från hemsidor
 * Laddar upp till Supabase Storage bucket: company-logos
 *
 * Användning: SUPABASE_SERVICE_KEY=xxx node scripts/fetch-company-logos.js [limit]
 */

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Konfig
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wzkohritxdrstsmwopco.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET_NAME = 'company-logos';

if (!SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_KEY krävs');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Hämta en URL med timeout
async function fetchUrl(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Följ redirect
                return fetchUrl(res.headers.location, timeout).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

// Försök hitta logotyp från hemsida
async function findLogo(website) {
    if (!website) return null;

    // Normalisera URL
    let baseUrl = website;
    if (!baseUrl.startsWith('http')) {
        baseUrl = 'https://' + baseUrl;
    }

    // Ta bort trailing slash
    baseUrl = baseUrl.replace(/\/$/, '');

    const possibleLogos = [
        `${baseUrl}/favicon.ico`,
        `${baseUrl}/favicon.png`,
        `${baseUrl}/apple-touch-icon.png`,
        `${baseUrl}/apple-touch-icon-precomposed.png`,
        `${baseUrl}/logo.png`,
        `${baseUrl}/images/logo.png`,
        `${baseUrl}/img/logo.png`,
        `${baseUrl}/assets/logo.png`
    ];

    for (const logoUrl of possibleLogos) {
        try {
            console.log(`  Testar: ${logoUrl}`);
            const data = await fetchUrl(logoUrl, 5000);
            if (data && data.length > 100) { // Minsta storlek för giltig bild
                console.log(`  ✓ Hittade logotyp: ${logoUrl} (${data.length} bytes)`);
                return { url: logoUrl, data };
            }
        } catch (e) {
            // Ignorera fel, prova nästa
        }
    }

    return null;
}

// Generera SVG med initialer
function generateInitialsSvg(name, orgnr) {
    if (!name) return null;

    const words = name.trim().split(/\s+/);
    let initials;
    if (words.length >= 2) {
        initials = (words[0][0] + words[1][0]).toUpperCase();
    } else {
        initials = name.substring(0, 2).toUpperCase();
    }

    const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1'];
    const colorIndex = name.charCodeAt(0) % colors.length;
    const bgColor = colors[colorIndex];

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="8" fill="${bgColor}"/>
        <text x="32" y="40" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="600" fill="white" text-anchor="middle">${initials}</text>
    </svg>`;

    return Buffer.from(svg);
}

// Ladda upp till Supabase Storage
async function uploadToStorage(orgnr, data, contentType = 'image/png') {
    const fileName = `${orgnr}.${contentType === 'image/svg+xml' ? 'svg' : 'png'}`;

    const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, data, {
            contentType,
            upsert: true
        });

    if (error) {
        console.error(`  Uppladdningsfel för ${orgnr}:`, error.message);
        return null;
    }

    const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(fileName);

    return urlData?.publicUrl;
}

// Uppdatera företag med logo_url
async function updateCompanyLogo(orgnr, logoUrl) {
    const { error } = await supabase
        .from('loop_table')
        .update({ logo_url: logoUrl })
        .eq('orgnr', orgnr);

    if (error) {
        console.error(`  DB-uppdateringsfel för ${orgnr}:`, error.message);
        return false;
    }
    return true;
}

// Huvudfunktion
async function main() {
    const limit = parseInt(process.argv[2]) || 10;

    console.log('='.repeat(60));
    console.log('LOGOTYP-HÄMTNING FÖR BEVAKNINGSVERKTYGET');
    console.log('='.repeat(60));
    console.log(`Hämtar max ${limit} företag utan logotyp...\n`);

    // Hämta företag utan logotyp som har hemsida
    const { data: companies, error } = await supabase
        .from('loop_companies_with_management')
        .select('orgnr, company_name, website')
        .is('logo_url', null)
        .not('website', 'is', null)
        .limit(limit);

    if (error) {
        console.error('Kunde inte hämta företag:', error.message);
        process.exit(1);
    }

    console.log(`Hittade ${companies.length} företag att bearbeta\n`);

    let successCount = 0;
    let fallbackCount = 0;

    for (const company of companies) {
        console.log(`\n📦 ${company.company_name} (${company.orgnr})`);
        console.log(`   Hemsida: ${company.website}`);

        // Försök hitta logotyp från hemsida
        const logoResult = await findLogo(company.website);

        let logoUrl;
        if (logoResult) {
            // Ladda upp hämtad logotyp
            logoUrl = await uploadToStorage(company.orgnr, logoResult.data);
            if (logoUrl) successCount++;
        } else {
            // Fallback: generera SVG med initialer
            console.log('  → Genererar initialer som fallback');
            const svg = generateInitialsSvg(company.company_name, company.orgnr);
            logoUrl = await uploadToStorage(company.orgnr, svg, 'image/svg+xml');
            if (logoUrl) fallbackCount++;
        }

        if (logoUrl) {
            await updateCompanyLogo(company.orgnr, logoUrl);
            console.log(`  ✅ Logo sparad: ${logoUrl}`);
        }

        // Vänta lite mellan requests
        await new Promise(r => setTimeout(r, 500));
    }

    console.log('\n' + '='.repeat(60));
    console.log('SAMMANFATTNING');
    console.log('='.repeat(60));
    console.log(`Totalt bearbetade: ${companies.length}`);
    console.log(`Logotyper från hemsidor: ${successCount}`);
    console.log(`Fallback (initialer): ${fallbackCount}`);
    console.log('='.repeat(60));
}

main().catch(console.error);
