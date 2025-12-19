/**
 * Auto-discovery script för MyNewsdesk pressrum
 * Går igenom alla 1194 företag och försöker hitta deras pressrum
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wzkohritxdrstsmwopco.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_KEY environment variable required');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Utility: Normalisera företagsnamn till URL-slug
function nameToSlug(name: string): string[] {
    const baseName = name
        .toLowerCase()
        .replace(/\s*(ab|aktiebolag|holding|sweden|nordic|group|skandinavien|scandinavia)\s*$/gi, '')
        .trim();

    const slugs: string[] = [];

    // Standard slug
    const standardSlug = baseName
        .replace(/[åä]/g, 'a')
        .replace(/ö/g, 'o')
        .replace(/é/g, 'e')
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    if (standardSlug) slugs.push(standardSlug);

    // Utan bindestreck
    const noHyphen = standardSlug.replace(/-/g, '');
    if (noHyphen && noHyphen !== standardSlug) slugs.push(noHyphen);

    // Med understreck
    const underscore = standardSlug.replace(/-/g, '_');
    if (underscore && underscore !== standardSlug) slugs.push(underscore);

    return [...new Set(slugs)];
}

// Kontrollera om en MyNewsdesk-URL finns
async function checkMyNewsdeskUrl(slug: string, country: string = 'se'): Promise<{ exists: boolean; rssUrl?: string }> {
    const baseUrl = `https://www.mynewsdesk.com/${country}/${slug}`;
    const rssUrl = `https://www.mynewsdesk.com/${country}/${slug}/rss/pressreleases`;

    try {
        // Kolla RSS-flödet direkt (snabbare än HTML-sidan)
        const response = await fetch(rssUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
            return { exists: true, rssUrl };
        }
        return { exists: false };
    } catch (error) {
        return { exists: false };
    }
}

// Kontrollera Cision-pressrum
async function checkCisionUrl(slug: string): Promise<{ exists: boolean; rssUrl?: string }> {
    const baseUrl = `https://news.cision.com/${slug}`;

    try {
        const response = await fetch(baseUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
            return { exists: true, rssUrl: `${baseUrl}/rss` };
        }
        return { exists: false };
    } catch (error) {
        return { exists: false };
    }
}

// Hitta nyhets-RSS på företagets egen webbplats
async function findWebsiteRss(website: string): Promise<{ exists: boolean; rssUrl?: string; type?: string }> {
    const commonRssPaths = [
        '/feed',
        '/rss',
        '/feed/rss',
        '/blog/feed',
        '/news/feed',
        '/nyheter/feed',
        '/press/feed',
        '/pressmeddelanden/feed',
        '/feed.xml',
        '/rss.xml',
        '/blog/rss.xml'
    ];

    for (const path of commonRssPaths) {
        try {
            const url = new URL(path, website).toString();
            const response = await fetch(url, {
                method: 'HEAD',
                signal: AbortSignal.timeout(3000)
            });

            if (response.ok) {
                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('xml') || contentType.includes('rss')) {
                    return { exists: true, rssUrl: url, type: 'website_rss' };
                }
            }
        } catch (error) {
            continue;
        }
    }

    return { exists: false };
}

interface Company {
    orgnr: string;
    company_name: string;
    website: string | null;
}

interface DiscoveredPressroom {
    orgnr: string;
    company_name: string;
    pressroom_url: string;
    pressroom_type: string;
    rss_feed_url: string;
}

async function discoverPressrooms(batchSize: number = 50, offset: number = 0): Promise<void> {
    console.log(`\n🔍 Startar pressrum-upptäckt från offset ${offset}...`);

    // Hämta företag med webbplatser
    const { data: companies, error } = await supabase
        .from('loop_table')
        .select(`
            orgnr,
            company_name
        `)
        .range(offset, offset + batchSize - 1);

    if (error) {
        console.error('Fel vid hämtning av företag:', error);
        return;
    }

    // Hämta webbplatser från companies-tabellen
    const orgnrs = companies?.map(c => c.orgnr) || [];
    const { data: websiteData } = await supabase
        .from('companies')
        .select('orgnr, website, name')
        .in('orgnr', orgnrs);

    const websiteMap = new Map(websiteData?.map(w => [w.orgnr, w.website]) || []);

    const discovered: DiscoveredPressroom[] = [];
    let checked = 0;

    for (const company of companies || []) {
        checked++;
        const website = websiteMap.get(company.orgnr);
        console.log(`[${offset + checked}/${offset + (companies?.length || 0)}] Kollar: ${company.company_name}`);

        const slugs = nameToSlug(company.company_name);

        // 1. Kolla MyNewsdesk med olika slug-varianter
        for (const slug of slugs) {
            // Svenska MyNewsdesk
            const seResult = await checkMyNewsdeskUrl(slug, 'se');
            if (seResult.exists && seResult.rssUrl) {
                console.log(`  ✅ MyNewsdesk (SE): ${seResult.rssUrl}`);
                discovered.push({
                    orgnr: company.orgnr,
                    company_name: company.company_name,
                    pressroom_url: `https://www.mynewsdesk.com/se/${slug}`,
                    pressroom_type: 'mynewsdesk',
                    rss_feed_url: seResult.rssUrl
                });
                break;
            }

            // Internationella MyNewsdesk
            const intResult = await checkMyNewsdeskUrl(slug, 'uk');
            if (intResult.exists && intResult.rssUrl) {
                console.log(`  ✅ MyNewsdesk (UK): ${intResult.rssUrl}`);
                discovered.push({
                    orgnr: company.orgnr,
                    company_name: company.company_name,
                    pressroom_url: `https://www.mynewsdesk.com/uk/${slug}`,
                    pressroom_type: 'mynewsdesk',
                    rss_feed_url: intResult.rssUrl
                });
                break;
            }
        }

        // 2. Kolla Cision
        for (const slug of slugs.slice(0, 2)) { // Endast första 2 slugs för hastighet
            const cisionResult = await checkCisionUrl(slug);
            if (cisionResult.exists && cisionResult.rssUrl) {
                console.log(`  ✅ Cision: ${cisionResult.rssUrl}`);
                discovered.push({
                    orgnr: company.orgnr,
                    company_name: company.company_name,
                    pressroom_url: `https://news.cision.com/${slug}`,
                    pressroom_type: 'cision',
                    rss_feed_url: cisionResult.rssUrl
                });
                break;
            }
        }

        // 3. Kolla företagets egen webbplats för RSS
        if (website) {
            const websiteResult = await findWebsiteRss(website);
            if (websiteResult.exists && websiteResult.rssUrl) {
                console.log(`  ✅ Website RSS: ${websiteResult.rssUrl}`);
                discovered.push({
                    orgnr: company.orgnr,
                    company_name: company.company_name,
                    pressroom_url: website,
                    pressroom_type: 'website_rss',
                    rss_feed_url: websiteResult.rssUrl
                });
            }
        }

        // Rate limiting - vänta lite mellan varje företag
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Spara upptäckta pressrum
    if (discovered.length > 0) {
        console.log(`\n💾 Sparar ${discovered.length} upptäckta pressrum...`);

        const { error: insertError } = await supabase
            .from('company_pressrooms')
            .upsert(discovered.map(p => ({
                orgnr: p.orgnr,
                company_name: p.company_name,
                pressroom_url: p.pressroom_url,
                pressroom_type: p.pressroom_type,
                rss_feed_url: p.rss_feed_url,
                is_active: true,
                last_checked_at: new Date().toISOString()
            })), {
                onConflict: 'orgnr,pressroom_url'
            });

        if (insertError) {
            console.error('Fel vid sparning:', insertError);
        } else {
            console.log(`✅ Sparade ${discovered.length} pressrum!`);
        }
    }

    console.log(`\n📊 Resultat för batch ${offset}-${offset + batchSize}:`);
    console.log(`   Kollade: ${checked} företag`);
    console.log(`   Hittade: ${discovered.length} pressrum`);
}

// Huvudfunktion
async function main() {
    const args = process.argv.slice(2);
    const batchSize = parseInt(args[0]) || 50;
    const offset = parseInt(args[1]) || 0;

    console.log('🚀 MyNewsdesk Pressrum Auto-Discovery');
    console.log('=====================================');
    console.log(`Batch-storlek: ${batchSize}`);
    console.log(`Start offset: ${offset}`);

    await discoverPressrooms(batchSize, offset);

    // Visa total statistik
    const { data: stats } = await supabase
        .from('company_pressrooms')
        .select('pressroom_type')
        .eq('is_active', true);

    const typeCounts = stats?.reduce((acc, curr) => {
        acc[curr.pressroom_type] = (acc[curr.pressroom_type] || 0) + 1;
        return acc;
    }, {} as Record<string, number>) || {};

    console.log('\n📈 Total statistik:');
    Object.entries(typeCounts).forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
    });
    console.log(`   TOTALT: ${stats?.length || 0} pressrum`);
}

main().catch(console.error);
