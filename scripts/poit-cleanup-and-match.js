/**
 * POIT Cleanup & Match Script
 *
 * 1. Hämtar alla bevakade företagsnamn från loop_table
 * 2. Matchar POIT-händelser mot företagsnamn i content
 * 3. Rensar bort händelser som inte matchar bevakade företag
 * 4. Skapar/uppdaterar loop_poit_events view med korrekt matchning
 *
 * Användning: SUPABASE_SERVICE_KEY=xxx node scripts/poit-cleanup-and-match.js [--dry-run]
 */

const https = require('https');

// Supabase config
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wzkohritxdrstsmwopco.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_KEY krävs');
    process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');

// HTTP helper
function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, SUPABASE_URL);
        const options = {
            method,
            hostname: url.hostname,
            path: url.pathname + url.search,
            headers: {
                'apikey': SERVICE_KEY,
                'Authorization': `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': method === 'DELETE' ? 'return=minimal' : 'return=representation'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = data ? JSON.parse(data) : {};
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
                    } else {
                        resolve(parsed);
                    }
                } catch {
                    resolve(data);
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// Normalisera företagsnamn för sökning
function normalizeCompanyName(name) {
    if (!name) return '';
    return name
        .toLowerCase()
        .replace(/\s+(ab|aktiebolag|hb|kb|ek\.?\s*för\.?|ekonomisk förening)$/i, '')
        .replace(/[,.\-()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Sök efter företagsnamn i text
function findCompanyInText(text, companies) {
    if (!text) return null;
    const lowerText = text.toLowerCase();

    for (const company of companies) {
        const searchTerms = [
            company.company_name.toLowerCase(),
            normalizeCompanyName(company.company_name)
        ];

        for (const term of searchTerms) {
            if (term && term.length > 3 && lowerText.includes(term)) {
                return company;
            }
        }
    }
    return null;
}

async function main() {
    console.log('='.repeat(60));
    console.log('POIT CLEANUP & MATCH SCRIPT');
    console.log('='.repeat(60));

    if (DRY_RUN) {
        console.log('\n⚠️  DRY RUN MODE - Inga ändringar kommer att göras\n');
    }

    // Steg 1: Hämta alla bevakade företag
    console.log('\n📦 Hämtar bevakade företag från loop_table...');
    const companies = await request('GET', '/rest/v1/loop_table?select=orgnr,company_name');
    console.log(`   Hittade ${companies.length} bevakade företag`);

    // Steg 2: Hämta alla POIT-händelser
    console.log('\n📋 Hämtar alla POIT-händelser...');
    let allAnnouncements = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
        const batch = await request('GET', `/rest/v1/poit_announcements?select=id,title,content,category,announcement_date&limit=${limit}&offset=${offset}`);
        if (batch.length === 0) break;
        allAnnouncements = allAnnouncements.concat(batch);
        offset += limit;
        if (batch.length < limit) break;
    }
    console.log(`   Hittade ${allAnnouncements.length} händelser totalt`);

    // Steg 3: Matcha händelser mot företag
    console.log('\n🔍 Matchar händelser mot bevakade företag...');
    const matched = [];
    const unmatched = [];

    for (const ann of allAnnouncements) {
        const textToSearch = `${ann.title || ''} ${ann.content || ''}`;
        const matchedCompany = findCompanyInText(textToSearch, companies);

        if (matchedCompany) {
            matched.push({
                announcement_id: ann.id,
                announcement_date: ann.announcement_date,
                category: ann.category,
                title: ann.title,
                matched_orgnr: matchedCompany.orgnr,
                matched_company_name: matchedCompany.company_name
            });
        } else {
            unmatched.push(ann.id);
        }
    }

    console.log(`   ✅ Matchade: ${matched.length} händelser`);
    console.log(`   ❌ Ej matchade: ${unmatched.length} händelser`);

    // Visa matchade företag
    const uniqueMatched = [...new Set(matched.map(m => m.matched_company_name))];
    console.log(`\n📊 Unika matchade företag (${uniqueMatched.length}):`);
    uniqueMatched.slice(0, 20).forEach(name => console.log(`   - ${name}`));
    if (uniqueMatched.length > 20) console.log(`   ... och ${uniqueMatched.length - 20} till`);

    // Steg 4: Uppdatera matchade händelser med orgnr
    if (!DRY_RUN && matched.length > 0) {
        console.log(`\n✏️  Uppdaterar ${matched.length} händelser med orgnr...`);

        let updated = 0;
        for (const m of matched) {
            try {
                await request('PATCH', `/rest/v1/poit_announcements?id=eq.${m.announcement_id}`, {
                    orgnr: m.matched_orgnr,
                    metadata: { matched_company_name: m.matched_company_name }
                });
                updated++;
                if (updated % 20 === 0) {
                    process.stdout.write(`\r   Uppdaterade: ${updated}/${matched.length}`);
                }
            } catch (e) {
                console.error(`\n   Fel vid uppdatering: ${e.message}`);
            }
        }
        console.log(`\n   ✅ Uppdaterade ${updated} händelser`);
    }

    // Steg 5: Rensa icke-matchade händelser
    if (!DRY_RUN && unmatched.length > 0) {
        console.log(`\n🗑️  Tar bort ${unmatched.length} icke-matchade händelser...`);

        // Ta bort i batchar om 100
        const batchSize = 100;
        let deleted = 0;

        for (let i = 0; i < unmatched.length; i += batchSize) {
            const batch = unmatched.slice(i, i + batchSize);
            const ids = batch.map(id => `"${id}"`).join(',');

            try {
                await request('DELETE', `/rest/v1/poit_announcements?id=in.(${ids})`);
                deleted += batch.length;
                process.stdout.write(`\r   Borttagna: ${deleted}/${unmatched.length}`);
            } catch (e) {
                console.error(`\n   Fel vid borttagning: ${e.message}`);
            }
        }
        console.log('');
    } else if (DRY_RUN) {
        console.log(`\n🗑️  [DRY RUN] Skulle ta bort ${unmatched.length} icke-matchade händelser`);
    }

    // Steg 5: Uppdatera sync metadata
    console.log('\n📝 Uppdaterar sync metadata...');
    const syncData = {
        last_cleanup: new Date().toISOString(),
        events_before_cleanup: allAnnouncements.length,
        events_after_cleanup: matched.length,
        matched_companies: uniqueMatched.length
    };

    if (!DRY_RUN) {
        // Spara till en metadata-tabell om den finns, annars logga
        console.log('   Sync data:', JSON.stringify(syncData, null, 2));
    }

    // Sammanfattning
    console.log('\n' + '='.repeat(60));
    console.log('SAMMANFATTNING');
    console.log('='.repeat(60));
    console.log(`Totalt händelser före:  ${allAnnouncements.length}`);
    console.log(`Matchade händelser:     ${matched.length}`);
    console.log(`Borttagna händelser:    ${unmatched.length}`);
    console.log(`Matchade företag:       ${uniqueMatched.length} av ${companies.length}`);
    console.log('='.repeat(60));

    // Lista de matchade händelserna för kontroll
    console.log('\n📋 Senaste matchade händelser:');
    matched
        .sort((a, b) => new Date(b.announcement_date) - new Date(a.announcement_date))
        .slice(0, 10)
        .forEach(m => {
            console.log(`   ${m.announcement_date} | ${m.category} | ${m.matched_company_name}`);
            console.log(`      ${m.title.substring(0, 60)}...`);
        });
}

main().catch(err => {
    console.error('Fel:', err.message);
    process.exit(1);
});
