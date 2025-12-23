/**
 * VDM Data Sync Script
 *
 * Hämtar företagsdata från Bolagsverket VDM API för företag som saknar data
 * Kör endast för rader där kritiska värden är NULL
 *
 * Usage: SUPABASE_SERVICE_KEY="..." npx tsx scripts/sync-vdm-data.ts [--dry-run] [--limit N]
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Configuration
const SUPABASE_URL = 'https://wzkohritxdrstsmwopco.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const VDM_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/bolagsverket-vdm`;
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a29ocml0eGRyc3RzbXdvcGNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMjkzMjUsImV4cCI6MjA4MDgwNTMyNX0.GigaAVp781QF9rv-AslVD_p4ksT8auWHwXU72H1kOqo';

// Rate limiting
const REQUESTS_PER_BATCH = 10;
const DELAY_BETWEEN_REQUESTS = 200; // ms
const DELAY_BETWEEN_BATCHES = 2000; // ms

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || 100 : 100;

interface CompanyRow {
  orgnr: string;
  namn?: string;
  name?: string;
  status?: string;
  postal_city?: string;
  postal_street?: string;
  registered_date?: string;
  last_synced_at?: string;
  source_vdm?: boolean;
}

interface VDMResponse {
  success: boolean;
  data?: {
    orgnr: string;
    name: string;
    status: string;
    company_type?: string;
    company_type_code?: string;
    legal_form?: string;
    legal_form_code?: string;
    registered_date?: string;
    postal_street?: string;
    postal_co?: string;
    postal_code?: string;
    postal_city?: string;
    postal_country?: string;
    industries?: Array<{
      sni_code: string;
      sni_description: string;
      is_primary: number;
    }>;
    ad_block?: boolean;
    source?: string;
  };
  error?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchVDMData(orgnr: string): Promise<VDMResponse | null> {
  try {
    const response = await fetch(
      `${VDM_FUNCTION_URL}?action=company&orgnr=${orgnr}`,
      {
        headers: {
          'Authorization': `Bearer ${ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error(`  VDM API error for ${orgnr}: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`  Failed to fetch VDM data for ${orgnr}:`, error);
    return null;
  }
}

async function getCompaniesNeedingSync(supabase: SupabaseClient): Promise<CompanyRow[]> {
  // Först: Hämta alla orgnr från loop_table
  const { data: loopCompanies, error: loopError } = await supabase
    .from('loop_table')
    .select('orgnr, company_name')
    .not('orgnr', 'is', null);

  if (loopError) {
    console.error('Error fetching loop_table:', loopError);
    return [];
  }

  console.log(`Found ${loopCompanies?.length || 0} companies in loop_table`);

  // Sen: Hämta befintliga company_details
  const { data: existingDetails, error: detailsError } = await supabase
    .from('company_details')
    .select('orgnr, name, status, postal_city, postal_street, registered_date, last_synced_at');

  if (detailsError) {
    console.error('Error fetching company_details:', detailsError);
  }

  // Skapa lookup för befintliga
  const existingMap = new Map<string, CompanyRow>();
  (existingDetails || []).forEach(row => {
    existingMap.set(row.orgnr, row);
  });

  // Identifiera företag som behöver synkas
  const needsSync: CompanyRow[] = [];

  for (const company of loopCompanies || []) {
    const existing = existingMap.get(company.orgnr);

    // Behöver synkas om:
    // 1. Inte finns i company_details
    // 2. Saknar kritiska värden (status, adress, registreringsdatum)
    // 3. Synkades för mer än 30 dagar sedan
    const needsUpdate = !existing ||
      !existing.status ||
      !existing.postal_city ||
      !existing.registered_date ||
      (existing.last_synced_at && new Date(existing.last_synced_at) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    if (needsUpdate) {
      needsSync.push({
        orgnr: company.orgnr,
        namn: company.company_name,
        ...existing,
      });
    }
  }

  return needsSync;
}

async function upsertCompanyDetails(
  supabase: SupabaseClient,
  data: VDMResponse['data']
): Promise<boolean> {
  if (!data) return false;

  const record = {
    orgnr: data.orgnr,
    name: data.name,
    company_type: data.company_type_code || data.company_type,
    status: data.status,
    registered_date: data.registered_date,
    postal_street: data.postal_street,
    postal_code: data.postal_code,
    postal_city: data.postal_city,
    source_basic: 'bolagsverket_vdm',
    last_synced_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('company_details')
    .upsert(record, {
      onConflict: 'orgnr',
      // Uppdatera bara om värdet är NULL eller om vi har nyare data
    });

  if (error) {
    console.error(`  Failed to upsert ${data.orgnr}:`, error.message);
    return false;
  }

  return true;
}

async function upsertIndustries(
  supabase: SupabaseClient,
  orgnr: string,
  industries: VDMResponse['data']['industries']
): Promise<void> {
  if (!industries || industries.length === 0) return;

  // Filtrera bort tomma SNI-koder
  const validIndustries = industries.filter(
    ind => ind.sni_code && ind.sni_code.trim() !== '' && ind.sni_code.trim() !== '     '
  );

  if (validIndustries.length === 0) return;

  // Kolla om tabellen company_industries finns
  const records = validIndustries.map(ind => ({
    orgnr,
    sni_code: ind.sni_code.trim(),
    sni_description: ind.sni_description,
    is_primary: ind.is_primary === 1,
  }));

  // Först ta bort gamla
  await supabase
    .from('company_industries')
    .delete()
    .eq('orgnr', orgnr);

  // Sen lägg till nya
  const { error } = await supabase
    .from('company_industries')
    .insert(records);

  if (error && !error.message.includes('does not exist')) {
    console.error(`  Failed to insert industries for ${orgnr}:`, error.message);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('VDM DATA SYNC SCRIPT');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`Limit: ${LIMIT} companies`);
  console.log('');

  if (!SUPABASE_KEY) {
    console.error('ERROR: SUPABASE_SERVICE_KEY environment variable required');
    console.log('Usage: SUPABASE_SERVICE_KEY="..." npx tsx scripts/sync-vdm-data.ts');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Hitta företag som behöver synkas
  console.log('1. Finding companies that need sync...');
  const needsSync = await getCompaniesNeedingSync(supabase);
  console.log(`   Found ${needsSync.length} companies needing sync`);

  if (needsSync.length === 0) {
    console.log('   All companies are up to date!');
    return;
  }

  // Begränsa till LIMIT
  const toSync = needsSync.slice(0, LIMIT);
  console.log(`   Processing ${toSync.length} companies`);

  // 2. Test VDM API health
  console.log('\n2. Testing VDM API health...');
  const healthCheck = await fetchVDMData('5567037485'); // Spotify som test
  if (!healthCheck?.success) {
    console.error('   VDM API health check failed!');
    process.exit(1);
  }
  console.log('   VDM API is healthy');

  // 3. Process i batches
  console.log('\n3. Syncing companies...');

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < toSync.length; i += REQUESTS_PER_BATCH) {
    const batch = toSync.slice(i, i + REQUESTS_PER_BATCH);
    const batchNum = Math.floor(i / REQUESTS_PER_BATCH) + 1;
    const totalBatches = Math.ceil(toSync.length / REQUESTS_PER_BATCH);

    console.log(`\n   Batch ${batchNum}/${totalBatches} (${batch.length} companies)`);

    for (const company of batch) {
      const orgnr = company.orgnr;
      process.stdout.write(`   ${orgnr} (${company.namn || 'unknown'})... `);

      // Hämta VDM-data
      const vdmData = await fetchVDMData(orgnr);

      if (!vdmData?.success || !vdmData.data) {
        console.log('SKIP (no data)');
        skipped++;
        await sleep(DELAY_BETWEEN_REQUESTS);
        continue;
      }

      if (DRY_RUN) {
        console.log(`OK (dry-run) - ${vdmData.data.name}`);
        synced++;
      } else {
        // Spara till databas
        const success = await upsertCompanyDetails(supabase, vdmData.data);

        if (success) {
          // Spara industrier om möjligt
          if (vdmData.data.industries) {
            await upsertIndustries(supabase, orgnr, vdmData.data.industries);
          }
          console.log(`OK - ${vdmData.data.name}`);
          synced++;
        } else {
          console.log('FAILED');
          failed++;
        }
      }

      await sleep(DELAY_BETWEEN_REQUESTS);
    }

    // Vänta mellan batches
    if (i + REQUESTS_PER_BATCH < toSync.length) {
      console.log(`   Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
      await sleep(DELAY_BETWEEN_BATCHES);
    }
  }

  // 4. Sammanfattning
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total processed: ${synced + failed + skipped}`);
  console.log(`Synced:          ${synced}`);
  console.log(`Failed:          ${failed}`);
  console.log(`Skipped:         ${skipped}`);
  console.log(`Remaining:       ${needsSync.length - toSync.length}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
