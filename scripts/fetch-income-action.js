#!/usr/bin/env node
/**
 * fetch-income-action.js
 *
 * GitHub Actions wrapper för ratsit-income-scraper.
 * Körs av GitHub Actions workflow och uppdaterar Supabase med progress.
 *
 * Usage:
 *   node fetch-income-action.js \
 *     --job-id="uuid" \
 *     --person-name="Anna Andersson" \
 *     --location="Stockholm" \
 *     --birth-year="1985" \
 *     --company-orgnr="5591234567" \
 *     --company-name="Företaget AB" \
 *     --role-type="VD"
 */

const { createClient } = require('@supabase/supabase-js');
const { RatsitIncomeScraper } = require('../lib/scrapers/ratsit-income-scraper');
const { parseLonekollenPdf } = require('../lib/pdf-parser');
const { incomeService } = require('../lib/supabase-income');

// Parse CLI arguments
function parseArgs() {
    const args = {};
    process.argv.slice(2).forEach(arg => {
        if (arg.startsWith('--')) {
            const [key, ...valueParts] = arg.slice(2).split('=');
            const value = valueParts.join('=');
            // Convert kebab-case to camelCase
            const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            args[camelKey] = value || '';
        }
    });
    return args;
}

// Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Update job progress in Supabase
async function updateProgress(jobId, progress, currentStep, status = 'running') {
    const update = {
        progress,
        current_step: currentStep,
        status
    };

    if (status === 'completed' || status === 'failed') {
        update.completed_at = new Date().toISOString();
    }

    try {
        await supabase
            .from('income_fetch_jobs')
            .update(update)
            .eq('id', jobId);

        console.log(`[Progress ${progress}%] ${currentStep}`);
    } catch (e) {
        console.error('Failed to update progress:', e.message);
    }
}

// Main execution
async function main() {
    const args = parseArgs();

    const {
        jobId,
        personName,
        birthYear,
        location,
        companyOrgnr,
        companyName,
        roleType
    } = args;

    if (!jobId) {
        console.error('Error: --job-id is required');
        process.exit(1);
    }

    if (!personName) {
        console.error('Error: --person-name is required');
        process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('FETCH INCOME ACTION');
    console.log('='.repeat(60));
    console.log(`Job ID: ${jobId}`);
    console.log(`Person: ${personName}`);
    console.log(`Location: ${location || 'N/A'}`);
    console.log(`Birth Year: ${birthYear || 'N/A'}`);
    console.log(`Company: ${companyName || 'N/A'} (${companyOrgnr || 'N/A'})`);
    console.log('='.repeat(60));

    let scraper = null;

    try {
        // Initialize scraper
        await updateProgress(jobId, 15, 'Initierar browser...');

        scraper = new RatsitIncomeScraper({
            headless: process.env.HEADLESS !== 'false',
            noProxy: true,
            saveScreenshots: true
        });

        await scraper.init();
        await updateProgress(jobId, 25, 'Loggar in på Ratsit...');

        // Search for person
        await updateProgress(jobId, 35, 'Söker efter person...');
        const searchResults = await scraper.searchPerson(personName, location || '');

        if (!searchResults || searchResults.length === 0) {
            await updateProgress(jobId, 0, 'Person hittades inte', 'failed');

            await supabase
                .from('income_fetch_jobs')
                .update({ error_message: 'Ingen person hittades med det angivna namnet' })
                .eq('id', jobId);

            console.error('No search results found');
            process.exit(1);
        }

        console.log(`Found ${searchResults.length} results`);

        // Select best match based on birth year if provided
        let target = searchResults[0];
        if (birthYear) {
            const year = parseInt(birthYear);
            const expectedAge = new Date().getFullYear() - year;
            const filtered = searchResults.filter(r =>
                r.age && Math.abs(r.age - expectedAge) <= 2
            );
            if (filtered.length > 0) {
                target = filtered[0];
                console.log(`Filtered to ${filtered.length} results by birth year`);
            }
        }

        await updateProgress(jobId, 45, 'Person hittad, hämtar profil...');

        // Get income data from profile
        await updateProgress(jobId, 55, 'Laddar ner inkomstuppgifter...');

        // Try to download PDF from Lönekollen
        let incomeData = null;
        let pdfPath = null;

        try {
            pdfPath = await scraper.downloadIncomePdf(target, {
                birthYear: birthYear ? parseInt(birthYear) : null
            });

            if (pdfPath) {
                await updateProgress(jobId, 65, 'Extraherar data från PDF...');
                incomeData = await parseLonekollenPdf(pdfPath, personName);
            }
        } catch (pdfError) {
            console.log('PDF download failed, using profile scrape:', pdfError.message);
        }

        // Fallback to profile scrape if PDF failed
        if (!incomeData || !incomeData.inkomster || incomeData.inkomster.length === 0) {
            await updateProgress(jobId, 60, 'Hämtar data från profil...');
            const profileData = await scraper.getIncomeFromProfile(target.profileUrl);

            if (profileData && profileData.taxableIncome) {
                incomeData = {
                    namn: profileData.name,
                    adress: profileData.address,
                    inkomster: [{
                        inkomstar: profileData.incomeYear || new Date().getFullYear() - 1,
                        lon_forvarvsinkomst: profileData.taxableIncome,
                        kapitalinkomst: profileData.capitalIncome,
                        alder: profileData.age,
                        betalningsanmarkning: false
                    }]
                };
            }
        }

        if (!incomeData || !incomeData.inkomster || incomeData.inkomster.length === 0) {
            await updateProgress(jobId, 0, 'Kunde inte extrahera inkomstdata', 'failed');

            await supabase
                .from('income_fetch_jobs')
                .update({ error_message: 'Ingen inkomstdata hittades för personen' })
                .eq('id', jobId);

            console.error('No income data found');
            process.exit(1);
        }

        console.log(`Extracted ${incomeData.inkomster.length} years of income data`);

        // Upload PDF if available
        let pdfStoragePath = null;
        if (pdfPath) {
            await updateProgress(jobId, 75, 'Laddar upp PDF...');
            try {
                pdfStoragePath = await incomeService.uploadPdf(
                    pdfPath,
                    incomeData.namn || personName,
                    companyOrgnr
                );
            } catch (uploadError) {
                console.log('PDF upload failed:', uploadError.message);
            }
        }

        // Save to database
        await updateProgress(jobId, 85, 'Sparar till databas...');

        const saveResult = await incomeService.saveIncomeData(
            incomeData,
            {
                companyOrgnr: companyOrgnr || null,
                companyName: companyName || null,
                roleType: roleType || null,
                userId: null // No user in Actions context
            },
            pdfStoragePath
        );

        if (!saveResult.success) {
            console.error('Save errors:', saveResult.errors);
        }

        // Build result for job
        const result = {
            personName: incomeData.namn || personName,
            address: incomeData.adress,
            pdfPath: pdfStoragePath,
            incomes: incomeData.inkomster.map(inc => ({
                year: inc.inkomstar,
                age: inc.alder,
                salaryRanking: inc.loneranking,
                hasPaymentRemarks: inc.betalningsanmarkning,
                taxableIncome: inc.lon_forvarvsinkomst,
                capitalIncome: inc.kapitalinkomst
            })),
            savedIds: saveResult.savedIds
        };

        // Update job as completed
        await supabase
            .from('income_fetch_jobs')
            .update({
                status: 'completed',
                progress: 100,
                current_step: 'Klart!',
                completed_at: new Date().toISOString(),
                result_id: saveResult.savedIds[0]?.id || null
            })
            .eq('id', jobId);

        console.log('='.repeat(60));
        console.log('SUCCESS!');
        console.log(`Saved ${saveResult.savedIds.length} income records`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);

        await supabase
            .from('income_fetch_jobs')
            .update({
                status: 'failed',
                progress: 0,
                current_step: 'Fel uppstod',
                completed_at: new Date().toISOString(),
                error_message: error.message
            })
            .eq('id', jobId);

        process.exit(1);

    } finally {
        if (scraper) {
            await scraper.close();
        }
    }
}

main();
