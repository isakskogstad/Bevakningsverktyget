import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Ratsit Income Edge Function
 *
 * Hanterar inkomstdata från Ratsit.se:
 * - GET: Hämta cachad inkomstdata
 * - POST: Spara ny inkomstdata (från CLI-scraper)
 * - SEARCH: Sök bland cachade personer
 *
 * Endpoints:
 *   GET  ?action=get&name=Isak%20Skogstad
 *   GET  ?action=search&query=Skogstad
 *   GET  ?action=list&limit=50
 *   POST { action: "save", data: {...} }
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Rate limiting
const requestLog: Map<string, number[]> = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 30;

function checkRateLimit(clientId: string): boolean {
  const now = Date.now();
  const requests = requestLog.get(clientId) || [];
  const recentRequests = requests.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  recentRequests.push(now);
  requestLog.set(clientId, recentRequests);
  return true;
}

interface IncomeData {
  name: string;
  personnummer?: string;
  address?: string;
  age?: number;
  birth_year?: number;
  taxable_income?: number;
  capital_income?: number;
  total_tax?: number;
  final_tax?: number;
  income_year?: number;
  profile_url?: string;
  properties?: object[];
  vehicles?: object[];
  scraped_at?: string;
}

function normalizeSearchName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Ta bort diakritiska tecken
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const isPost = req.method === "POST";
    const body = isPost ? await req.json().catch(() => ({})) : {};

    const action = body?.action || url.searchParams.get("action") || "get";

    // Rate limiting
    const clientId = req.headers.get("x-forwarded-for") || "default";
    if (!checkRateLimit(clientId)) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Max 30 requests per minute." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Skapa Supabase-klient
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(
        JSON.stringify({ error: "Supabase not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    switch (action) {
      case "get": {
        // Hämta inkomstdata för en specifik person
        const name = body?.name || url.searchParams.get("name");
        const birthYear = body?.birth_year || url.searchParams.get("birth_year");

        if (!name) {
          return new Response(
            JSON.stringify({ error: "Missing name parameter" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        let query = supabase
          .from("ratsit_income")
          .select("*")
          .ilike("name", `%${name}%`)
          .order("scraped_at", { ascending: false })
          .limit(10);

        if (birthYear) {
          query = query.eq("birth_year", parseInt(birthYear));
        }

        const { data, error } = await query;

        if (error) {
          console.error("Database error:", error);
          return new Response(
            JSON.stringify({ error: "Database error", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            count: data?.length || 0,
            data: data || [],
            cached: true,
            message: data?.length ? undefined : "Ingen cachad data hittades. Kör CLI-verktyget för att hämta ny data."
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "search": {
        // Sök bland cachade personer
        const query = body?.query || url.searchParams.get("query");
        const limit = parseInt(body?.limit || url.searchParams.get("limit") || "20");

        if (!query || query.length < 2) {
          return new Response(
            JSON.stringify({ error: "Query must be at least 2 characters" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data, error } = await supabase
          .from("ratsit_income")
          .select("id, name, birth_year, address, taxable_income, income_year, scraped_at")
          .or(`name.ilike.%${query}%,address.ilike.%${query}%`)
          .order("scraped_at", { ascending: false })
          .limit(limit);

        if (error) {
          return new Response(
            JSON.stringify({ error: "Search failed", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            query,
            count: data?.length || 0,
            results: data || []
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "list": {
        // Lista senaste inkomstdata
        const limit = parseInt(body?.limit || url.searchParams.get("limit") || "50");
        const offset = parseInt(body?.offset || url.searchParams.get("offset") || "0");

        const { data, error, count } = await supabase
          .from("ratsit_income")
          .select("id, name, birth_year, address, taxable_income, capital_income, income_year, scraped_at", { count: "exact" })
          .order("scraped_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) {
          return new Response(
            JSON.stringify({ error: "List failed", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            total: count,
            limit,
            offset,
            data: data || []
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "save": {
        // Spara inkomstdata (från CLI-scraper)
        if (!isPost) {
          return new Response(
            JSON.stringify({ error: "POST method required for save" }),
            { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const incomeData = body?.data as IncomeData;

        if (!incomeData?.name) {
          return new Response(
            JSON.stringify({ error: "Missing income data or name" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Normalisera data för lagring
        const record = {
          name: incomeData.name,
          name_normalized: normalizeSearchName(incomeData.name),
          personnummer: incomeData.personnummer || null,
          address: incomeData.address || null,
          age: incomeData.age || null,
          birth_year: incomeData.birth_year || null,
          taxable_income: incomeData.taxable_income || null,
          capital_income: incomeData.capital_income || null,
          total_tax: incomeData.total_tax || null,
          final_tax: incomeData.final_tax || null,
          income_year: incomeData.income_year || null,
          profile_url: incomeData.profile_url || null,
          properties: incomeData.properties || null,
          vehicles: incomeData.vehicles || null,
          scraped_at: incomeData.scraped_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Upsert baserat på namn + födelseår
        const { data, error } = await supabase
          .from("ratsit_income")
          .upsert(record, {
            onConflict: "name_normalized,birth_year",
            ignoreDuplicates: false
          })
          .select()
          .single();

        if (error) {
          console.error("Save error:", error);
          return new Response(
            JSON.stringify({ error: "Failed to save", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: "Income data saved",
            id: data?.id
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "stats": {
        // Statistik över cachad data
        const { count: totalRecords } = await supabase
          .from("ratsit_income")
          .select("*", { count: "exact", head: true });

        const { data: recentData } = await supabase
          .from("ratsit_income")
          .select("scraped_at")
          .order("scraped_at", { ascending: false })
          .limit(1)
          .single();

        const { data: incomeYears } = await supabase
          .from("ratsit_income")
          .select("income_year")
          .not("income_year", "is", null);

        const uniqueYears = [...new Set(incomeYears?.map(r => r.income_year))].sort().reverse();

        return new Response(
          JSON.stringify({
            success: true,
            stats: {
              total_records: totalRecords || 0,
              last_updated: recentData?.scraped_at || null,
              income_years: uniqueYears
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({
            error: "Unknown action",
            available_actions: ["get", "search", "list", "save", "stats"]
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

  } catch (error) {
    console.error("Ratsit income error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
