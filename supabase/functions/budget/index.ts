import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Budget Manager Edge Function
 *
 * Hanterar budget och köphistorik för protokollköp.
 *
 * Endpoints:
 *   GET /budget - Hämta budgetstatus och statistik
 *   POST /budget/check - Kontrollera om köp är tillåtet
 *   POST /budget/purchase - Registrera ett köp
 *   PUT /budget/settings - Uppdatera budgetinställningar
 *   GET /budget/history - Hämta köphistorik
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

interface BudgetSettings {
  id: string;
  monthly_limit_sek: number;
  daily_limit_sek: number;
  alert_threshold: number;
  auto_stop: boolean;
  currency: string;
}

interface Purchase {
  id: string;
  orgnr: string;
  company_name: string | null;
  document_type: string;
  amount_sek: number;
  ordernummer: string | null;
  file_name: string | null;
  file_url: string | null;
  status: string;
  payment_method: string;
  notes: string | null;
  created_at: string;
}

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase configuration");
  }

  return createClient(supabaseUrl, supabaseKey);
}

async function getSettings(supabase: ReturnType<typeof createClient>): Promise<BudgetSettings> {
  const { data, error } = await supabase
    .from("budget_settings")
    .select("*")
    .limit(1)
    .single();

  if (error || !data) {
    // Returnera default-värden
    return {
      id: "default",
      monthly_limit_sek: 500,
      daily_limit_sek: 100,
      alert_threshold: 0.8,
      auto_stop: true,
      currency: "SEK"
    };
  }

  return data as BudgetSettings;
}

async function getCurrentMonthSpending(supabase: ReturnType<typeof createClient>): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  const { data, error } = await supabase
    .from("purchases")
    .select("amount_sek")
    .gte("created_at", startOfMonth)
    .lte("created_at", endOfMonth);

  if (error || !data) return 0;

  return data.reduce((sum: number, p: { amount_sek: number }) => sum + Number(p.amount_sek), 0);
}

async function getTodaySpending(supabase: ReturnType<typeof createClient>): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const { data, error } = await supabase
    .from("purchases")
    .select("amount_sek")
    .gte("created_at", today.toISOString())
    .lt("created_at", tomorrow.toISOString());

  if (error || !data) return 0;

  return data.reduce((sum: number, p: { amount_sek: number }) => sum + Number(p.amount_sek), 0);
}

async function getStats(supabase: ReturnType<typeof createClient>) {
  const settings = await getSettings(supabase);
  const currentMonthSpending = await getCurrentMonthSpending(supabase);
  const todaySpending = await getTodaySpending(supabase);

  // Hämta totalt antal köp och summa
  const { data: allPurchases, error } = await supabase
    .from("purchases")
    .select("amount_sek, created_at");

  const totalPurchases = allPurchases?.length || 0;
  const totalSpent = allPurchases?.reduce((sum: number, p: { amount_sek: number }) => sum + Number(p.amount_sek), 0) || 0;

  // Gruppera per månad
  const byMonth: Record<string, { count: number; total: number }> = {};
  if (allPurchases) {
    for (const p of allPurchases) {
      const month = p.created_at.substring(0, 7);
      if (!byMonth[month]) {
        byMonth[month] = { count: 0, total: 0 };
      }
      byMonth[month].count++;
      byMonth[month].total += Number(p.amount_sek);
    }
  }

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return {
    settings,
    currentMonth,
    currentMonthSpending,
    currentMonthRemaining: settings.monthly_limit_sek - currentMonthSpending,
    monthlyPercentUsed: Math.round((currentMonthSpending / settings.monthly_limit_sek) * 100),
    todaySpending,
    todayRemaining: settings.daily_limit_sek - todaySpending,
    dailyPercentUsed: Math.round((todaySpending / settings.daily_limit_sek) * 100),
    totalPurchases,
    totalSpent,
    byMonth
  };
}

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient();
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/budget\/?/, "").replace(/\/$/, "");

    // GET /budget - Hämta statistik
    if (req.method === "GET" && (path === "" || path === "stats")) {
      const stats = await getStats(supabase);

      return new Response(
        JSON.stringify({ success: true, ...stats }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET /budget/history - Hämta köphistorik
    if (req.method === "GET" && path === "history") {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const orgnr = url.searchParams.get("orgnr");

      let query = supabase
        .from("purchases")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (orgnr) {
        query = query.eq("orgnr", orgnr);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      return new Response(
        JSON.stringify({ success: true, purchases: data || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /budget/check - Kontrollera om köp är tillåtet
    if (req.method === "POST" && path === "check") {
      const { amount } = await req.json();

      if (!amount || isNaN(amount)) {
        return new Response(
          JSON.stringify({ error: "Missing or invalid amount" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const settings = await getSettings(supabase);
      const todaySpending = await getTodaySpending(supabase);
      const monthSpending = await getCurrentMonthSpending(supabase);

      const newDailyTotal = todaySpending + amount;
      const newMonthlyTotal = monthSpending + amount;

      const dailyAllowed = newDailyTotal <= settings.daily_limit_sek;
      const monthlyAllowed = newMonthlyTotal <= settings.monthly_limit_sek;
      const allowed = dailyAllowed && monthlyAllowed;

      return new Response(
        JSON.stringify({
          success: true,
          allowed,
          dailyAllowed,
          monthlyAllowed,
          amount,
          daily: {
            current: todaySpending,
            afterPurchase: newDailyTotal,
            limit: settings.daily_limit_sek,
            remaining: Math.max(0, settings.daily_limit_sek - todaySpending)
          },
          monthly: {
            current: monthSpending,
            afterPurchase: newMonthlyTotal,
            limit: settings.monthly_limit_sek,
            remaining: Math.max(0, settings.monthly_limit_sek - monthSpending)
          },
          autoStop: settings.auto_stop
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /budget/purchase - Registrera ett köp
    if (req.method === "POST" && path === "purchase") {
      const purchase = await req.json();

      if (!purchase.orgnr || !purchase.amount_sek) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: orgnr, amount_sek" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Kontrollera budget först
      const settings = await getSettings(supabase);
      const todaySpending = await getTodaySpending(supabase);
      const monthSpending = await getCurrentMonthSpending(supabase);

      const newDailyTotal = todaySpending + purchase.amount_sek;
      const newMonthlyTotal = monthSpending + purchase.amount_sek;

      if (settings.auto_stop) {
        if (newDailyTotal > settings.daily_limit_sek) {
          return new Response(
            JSON.stringify({
              error: "Daily limit exceeded",
              todaySpending,
              dailyLimit: settings.daily_limit_sek,
              remaining: Math.max(0, settings.daily_limit_sek - todaySpending)
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (newMonthlyTotal > settings.monthly_limit_sek) {
          return new Response(
            JSON.stringify({
              error: "Monthly limit exceeded",
              monthSpending,
              monthlyLimit: settings.monthly_limit_sek,
              remaining: Math.max(0, settings.monthly_limit_sek - monthSpending)
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Registrera köpet
      const { data, error } = await supabase
        .from("purchases")
        .insert({
          orgnr: purchase.orgnr,
          company_name: purchase.company_name || null,
          document_type: purchase.document_type || "Bolagsstämmoprotokoll",
          amount_sek: purchase.amount_sek,
          ordernummer: purchase.ordernummer || null,
          file_name: purchase.file_name || null,
          file_url: purchase.file_url || null,
          status: purchase.status || "completed",
          payment_method: purchase.payment_method || "card",
          notes: purchase.notes || null
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to log purchase: ${error.message}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          purchase: data,
          newDailyTotal,
          newMonthlyTotal,
          dailyRemaining: settings.daily_limit_sek - newDailyTotal,
          monthlyRemaining: settings.monthly_limit_sek - newMonthlyTotal
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PUT /budget/settings - Uppdatera inställningar
    if (req.method === "PUT" && path === "settings") {
      const updates = await req.json();

      const allowedFields = ["monthly_limit_sek", "daily_limit_sek", "alert_threshold", "auto_stop"];
      const validUpdates: Record<string, unknown> = {};

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          validUpdates[field] = updates[field];
        }
      }

      if (Object.keys(validUpdates).length === 0) {
        return new Response(
          JSON.stringify({ error: "No valid fields to update" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      validUpdates.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from("budget_settings")
        .update(validUpdates)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update settings: ${error.message}`);
      }

      return new Response(
        JSON.stringify({ success: true, settings: data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Budget error:", error);

    return new Response(
      JSON.stringify({
        error: "Budget operation failed",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
