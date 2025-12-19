/**
 * Example: Supabase Edge Function integration with Allabolag scraper
 *
 * This shows how to use the Allabolag scraper in a Supabase Edge Function
 * to enrich company data.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Import scraper (adjust path as needed)
import { scrapeCompany } from '../allabolag-scraper.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get orgnr from request
    const { orgnr, force = false } = await req.json();

    if (!orgnr) {
      return new Response(
        JSON.stringify({ error: 'orgnr is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if we should scrape (cache check)
    if (!force) {
      const { data: existing, error: fetchError } = await supabaseClient
        .from('company_details')
        .select('last_synced_at')
        .eq('orgnr', orgnr)
        .single();

      if (!fetchError && existing?.last_synced_at) {
        const lastSynced = new Date(existing.last_synced_at);
        const hoursSinceSync = (Date.now() - lastSynced.getTime()) / (1000 * 60 * 60);

        if (hoursSinceSync < 24) {
          // Use cached data
          const { data: cached } = await supabaseClient
            .from('company_details')
            .select('*')
            .eq('orgnr', orgnr)
            .single();

          return new Response(
            JSON.stringify({
              data: cached,
              cached: true,
              lastSynced: existing.last_synced_at
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Scrape fresh data
    console.log(`Scraping ${orgnr}...`);
    const scrapedData = await scrapeCompany(orgnr);

    if (!scrapedData) {
      return new Response(
        JSON.stringify({ error: 'Failed to scrape company data' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Save to company_details
    const detailsData = { ...scrapedData };
    delete detailsData.roles;
    delete detailsData.financials;
    delete detailsData.related_companies;
    delete detailsData.announcements;
    delete detailsData.industries;

    const { error: detailsError } = await supabaseClient
      .from('company_details')
      .upsert(detailsData, { onConflict: 'orgnr' });

    if (detailsError) {
      console.error('Error saving company_details:', detailsError);
    }

    // Save roles
    if (scrapedData.roles && scrapedData.roles.length > 0) {
      // Delete existing roles
      await supabaseClient
        .from('company_roles')
        .delete()
        .eq('orgnr', orgnr);

      // Insert new roles
      const rolesData = scrapedData.roles.map(role => ({
        orgnr,
        ...role
      }));

      const { error: rolesError } = await supabaseClient
        .from('company_roles')
        .insert(rolesData);

      if (rolesError) {
        console.error('Error saving roles:', rolesError);
      }
    }

    // Save financials
    if (scrapedData.financials && scrapedData.financials.length > 0) {
      // Delete existing financials
      await supabaseClient
        .from('company_financials')
        .delete()
        .eq('orgnr', orgnr);

      // Insert new financials
      const financialsData = scrapedData.financials.map(fin => ({
        orgnr,
        ...fin
      }));

      const { error: financialsError } = await supabaseClient
        .from('company_financials')
        .insert(financialsData);

      if (financialsError) {
        console.error('Error saving financials:', financialsError);
      }
    }

    // Return enriched data
    return new Response(
      JSON.stringify({
        data: scrapedData,
        cached: false,
        lastSynced: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Example usage from client:
 *
 * const { data, error } = await supabase.functions.invoke('enrich-company', {
 *   body: {
 *     orgnr: '5567676827',
 *     force: false  // Use cache if available
 *   }
 * });
 *
 * if (data) {
 *   console.log('Company data:', data.data);
 *   console.log('From cache:', data.cached);
 *   console.log('Last synced:', data.lastSynced);
 * }
 */
