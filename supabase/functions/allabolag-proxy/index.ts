import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLABOLAG_BASE_URL = "https://www.allabolag.se";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";

const ACCOUNT_CODE_MAP: Record<string, string> = {
  SDI: "revenue",
  AVI: "other_income",
  RRK: "operating_costs",
  RVK: "raw_materials",
  HVK: "goods",
  ADI: "depreciation_intangible",
  ADK: "depreciation_tangible",
  AEK: "other_external_costs",
  LFL: "inventory_change",
  RR: "operating_profit",
  FI: "financial_income",
  FK: "financial_costs",
  RFFN: "profit_after_financial",
  DR: "net_profit",
  SIA: "intangible_assets",
  SMA: "tangible_assets",
  SFA: "financial_assets",
  SVL: "inventory",
  SKG: "receivables",
  SKO: "cash",
  SGE: "total_assets",
  AKT: "share_capital",
  SEK: "equity",
  SOB: "untaxed_reserves",
  SAS: "provisions",
  SLS: "long_term_liabilities",
  SKS: "short_term_liabilities",
  avk_eget_kapital: "return_on_equity",
  avk_totalt_kapital: "return_on_assets",
  EKA: "equity_ratio",
  RG: "profit_margin",
  kassalikviditet: "quick_ratio",
  ANT: "num_employees",
  loner_styrelse_vd: "salaries_board_ceo",
  loner_ovriga: "salaries_other",
  sociala_avgifter: "social_costs",
  RPE: "revenue_per_employee",
};

const NO_MULTIPLY_CODES = new Set([
  "ANT",
  "EKA",
  "RG",
  "RPE",
  "avk_eget_kapital",
  "avk_totalt_kapital",
  "kassalikviditet",
]);

const ROLE_CATEGORY_MAP: Record<string, string> = {
  Styrelseledamot: "BOARD",
  Styrelsesuppleant: "BOARD",
  Styrelseordförande: "BOARD",
  Ledamot: "BOARD",
  Suppleant: "BOARD",
  Ordförande: "BOARD",
  "Vice verkställande direktör": "MANAGEMENT",
  "Verkställande direktör": "MANAGEMENT",
  "Extern verkställande direktör": "MANAGEMENT",
  VD: "MANAGEMENT",
  Revisor: "AUDITOR",
  Revisorssuppleant: "AUDITOR",
  "Huvudansvarig revisor": "AUDITOR",
  Lekmannarevisor: "AUDITOR",
  "Extern firmatecknare": "OTHER",
  Bolagsman: "OTHER",
  Komplementär: "OTHER",
  Likvidator: "OTHER",
};

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Rate limiting - simple in-memory (resets on cold start)
const requestLog: Map<string, number[]> = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute

function checkRateLimit(clientId: string): boolean {
  const now = Date.now();
  const requests = requestLog.get(clientId) || [];

  // Filter requests within the window
  const recentRequests = requests.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  recentRequests.push(now);
  requestLog.set(clientId, recentRequests);
  return true;
}

function parseEmployees(value: string | number | null | undefined): number | null {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.includes("-")) {
      const [min] = trimmed.split("-");
      return Number(min) || null;
    }
    return Number(trimmed) || null;
  }
  return null;
}

function parseFinancialPeriod(period: Record<string, unknown>, isConsolidated: boolean) {
  if (!period) return null;
  const year = Number(period.year || period["year"]) || null;
  const length = Number(period.length || period["length"] || 12) || 12;

  const result: Record<string, unknown> = {
    period_year: year,
    period_months: length,
    is_consolidated: isConsolidated ? 1 : 0,
    source: "allabolag",
  };

  const accounts = Array.isArray(period.accounts) ? period.accounts : [];
  for (const acc of accounts) {
    const code = acc.code as string | undefined;
    const amount = acc.amount as string | number | undefined;
    if (!code || amount === undefined || !(code in ACCOUNT_CODE_MAP)) continue;

    const field = ACCOUNT_CODE_MAP[code];
    const value = Number(amount);
    if (Number.isNaN(value)) continue;

    result[field] = NO_MULTIPLY_CODES.has(code) ? Math.round(value) : Math.round(value * 1000);
  }

  return result;
}

function buildFinancials(orgnr: string, company: Record<string, any>) {
  const financials: Record<string, unknown>[] = [];

  const companyAccounts = Array.isArray(company.companyAccounts) ? company.companyAccounts : [];
  const corporateAccounts = Array.isArray(company.corporateAccounts) ? company.corporateAccounts : [];

  for (const period of companyAccounts) {
    const parsed = parseFinancialPeriod(period, false);
    if (parsed) {
      financials.push({ orgnr, ...parsed });
    }
  }

  for (const period of corporateAccounts) {
    const parsed = parseFinancialPeriod(period, true);
    if (parsed) {
      financials.push({ orgnr, ...parsed });
    }
  }

  return financials;
}

function mapRoleCategory(groupName: string, roleType: string) {
  if (ROLE_CATEGORY_MAP[roleType]) return ROLE_CATEGORY_MAP[roleType];
  const groupMapping: Record<string, string> = {
    Management: "MANAGEMENT",
    Board: "BOARD",
    Revision: "AUDITOR",
    Other: "OTHER",
  };
  return groupMapping[groupName] || "OTHER";
}

function buildRoles(orgnr: string, company: Record<string, any>) {
  const roles: Record<string, unknown>[] = [];
  const roleGroups = company?.roles?.roleGroups || [];

  for (const group of roleGroups) {
    const groupName = group?.name || "";
    for (const roleEntry of group?.roles || []) {
      if (roleEntry?.type === "Company") continue;
      const roleType = roleEntry?.role || "";
      roles.push({
        orgnr,
        name: roleEntry?.name || null,
        birth_year: parseBirthYear(roleEntry?.birthDate),
        role_type: roleType,
        role_category: mapRoleCategory(groupName, roleType),
        source: "allabolag",
      });
    }
  }

  return roles;
}

function parseBirthYear(value?: string | null) {
  if (!value || typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length >= 3) {
    const year = Number(parts[2]);
    return Number.isNaN(year) ? null : year;
  }
  return null;
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
    const orgnr = (body?.orgnr || url.searchParams.get("orgnr")) as string | null;
    const save = Boolean(body?.save || url.searchParams.get("save"));

    if (!orgnr) {
      return new Response(
        JSON.stringify({ error: "Missing orgnr parameter" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Validate orgnr format (10 digits)
    const cleanOrgnr = orgnr.replace(/[^0-9]/g, "");
    if (cleanOrgnr.length !== 10) {
      return new Response(
        JSON.stringify({ error: "Invalid orgnr format. Must be 10 digits." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Rate limiting by client IP or a default identifier
    const clientId = req.headers.get("x-forwarded-for") || "default";
    if (!checkRateLimit(clientId)) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Max 10 requests per minute." }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Fetch from Allabolag
    const allabolagUrl = `${ALLABOLAG_BASE_URL}/${cleanOrgnr}`;

    const response = await fetch(allabolagUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "sv,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: `Allabolag returned ${response.status}`,
          status: response.status
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const html = await response.text();

    // Extract __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);

    if (!nextDataMatch) {
      return new Response(
        JSON.stringify({ error: "Could not extract company data from page" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const pageProps = nextData?.props?.pageProps;

      if (!pageProps?.company) {
        return new Response(
          JSON.stringify({ error: "Company not found in page data" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }

      if (save && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const company = pageProps.company;
        const now = new Date().toISOString();

        const { data: existing } = await supabase
          .from("company_details")
          .select("last_synced_at")
          .eq("orgnr", cleanOrgnr)
          .single();

        if (existing?.last_synced_at) {
          const lastSync = new Date(existing.last_synced_at).getTime();
          const hoursSince = (Date.now() - lastSync) / (1000 * 60 * 60);
          if (hoursSince < 12) {
            return new Response(
              JSON.stringify({ success: true, orgnr: cleanOrgnr, skipped: true }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        const postal = company.postalAddress || {};
        const visitor = company.visitorAddress || {};
        const location = company.location || {};
        const coords = location.coordinates?.[0] || {};

        const details = {
          orgnr: cleanOrgnr,
          name: company.name || company.legalName,
          company_type: company.companyType?.code,
          status: company.status?.status || "UNKNOWN",
          purpose: company.purpose,
          registered_date: company.registrationDate,
          foundation_year: company.foundationYear,
          source_basic: "allabolag",
          last_synced_at: now,
          postal_street: postal.addressLine,
          postal_code: postal.zipCode,
          postal_city: postal.postPlace,
          visiting_street: visitor.addressLine,
          visiting_code: visitor.zipCode,
          visiting_city: visitor.postPlace,
          phone: company.phone || company.legalPhone,
          email: company.email,
          website: company.homePage,
          latitude: coords.ycoordinate,
          longitude: coords.xcoordinate,
          municipality: location.municipality,
          municipality_code: location.municipalityCode,
          county: location.county,
          county_code: location.countyCode,
          lei_code: company.leiCode || company.lei,
          moms_registered: company.registeredForVat ? 1 : 0,
          employer_registered: company.registeredForPayrollTax ? 1 : 0,
          f_skatt: company.registeredForPrepayment ? 1 : 0,
          is_group: company.corporateStructure?.numberOfSubsidiaries ? 1 : 0,
          companies_in_group: company.corporateStructure?.numberOfCompanies || null,
          parent_orgnr: company.corporateStructure?.parentCompanyOrganisationNumber,
          parent_name: company.corporateStructure?.parentCompanyName,
          share_capital: company.shareCapital ? Number(company.shareCapital) : null,
          revenue: company.revenue ? Math.round(Number(company.revenue) * 1000) : null,
          net_profit: company.profit ? Math.round(Number(company.profit) * 1000) : null,
          num_employees: parseEmployees(company.numberOfEmployees),
        };

        await supabase.from("company_details").upsert(details, { onConflict: "orgnr" });

        const roles = buildRoles(cleanOrgnr, company);
        if (roles.length) {
          await supabase.from("company_roles").delete().eq("orgnr", cleanOrgnr);
          await supabase.from("company_roles").insert(roles);
        }

        const financials = buildFinancials(cleanOrgnr, company);
        if (financials.length) {
          await supabase.from("company_financials").delete().eq("orgnr", cleanOrgnr);
          await supabase.from("company_financials").insert(financials);
        }
      }

      // Return the structured data
      return new Response(
        JSON.stringify({
          success: true,
          orgnr: cleanOrgnr,
          data: pageProps
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600" // Cache for 1 hour
          }
        }
      );
    } catch (parseError) {
      return new Response(
        JSON.stringify({ error: "Failed to parse company data" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

  } catch (error) {
    console.error("Allabolag proxy error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
