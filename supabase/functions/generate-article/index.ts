import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Generate Article Edge Function
 *
 * Genererar nyhetsartiklar med Claude API baserat på företagsdata.
 * Hämtar företagsinformation från loop_table och genererar
 * rubrik, ingress och brödtext.
 *
 * Input:
 *   - orgnr: Organisationsnummer (obligatoriskt)
 *   - articleType: Typ av artikel (nyemission, vd-byte, årsredovisning, etc)
 *   - tone: Ton/stil (neutral, avslöjande, positiv)
 *   - customPrompt: Valfri extra instruktion
 *   - includeFactbox: Inkludera faktaruta (default: true)
 *
 * Output:
 *   - title: Rubrik
 *   - ingress: Ingress (2-3 meningar)
 *   - content: Brödtext (HTML-formaterad)
 *   - factbox: Företagsfaktaruta
 *   - metadata: Generationsinfo
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Rate limiting
const requestLog: Map<string, { count: number; resetTime: number }> = new Map();
const RATE_LIMIT_HOUR = 10;
const RATE_LIMIT_DAY = 50;

function checkRateLimit(clientId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const hourMs = 3600000;

  const log = requestLog.get(clientId);

  if (!log || now > log.resetTime) {
    requestLog.set(clientId, { count: 1, resetTime: now + hourMs });
    return { allowed: true, remaining: RATE_LIMIT_HOUR - 1 };
  }

  if (log.count >= RATE_LIMIT_HOUR) {
    return { allowed: false, remaining: 0 };
  }

  log.count++;
  return { allowed: true, remaining: RATE_LIMIT_HOUR - log.count };
}

// Artikel-typer med promptmallar
const ARTICLE_TYPES: Record<string, { label: string; promptTemplate: string }> = {
  nyemission: {
    label: "Nyemission",
    promptTemplate: `Skriv en nyhetsartikel om att {company_name} genomfört en nyemission.
Artikeln ska vara faktabaserad och journalistisk.
Inkludera:
- Emissionens storlek och villkor (om känt)
- Bolagets nuvarande situation och historik
- Marknadskontexten för branschen
- Vad kapitalet ska användas till (om känt)`
  },
  vd_byte: {
    label: "VD-byte",
    promptTemplate: `Skriv en nyhetsartikel om ett VD-byte på {company_name}.
Artikeln ska vara faktabaserad och journalistisk.
Inkludera:
- Vem som tillträder/avgår
- Bolagets situation
- Bakgrund och erfarenhet hos ny VD
- Strategiska implikationer`
  },
  arsredovisning: {
    label: "Årsredovisning",
    promptTemplate: `Skriv en nyhetsartikel baserad på {company_name}s senaste årsredovisning.
Artikeln ska vara faktabaserad och journalistisk.
Inkludera:
- Nyckeltal (omsättning, resultat, tillväxt)
- Jämförelse med föregående år
- Strategiska höjdpunkter
- Framtidsutsikter`
  },
  konkurs: {
    label: "Konkurs/Rekonstruktion",
    promptTemplate: `Skriv en nyhetsartikel om {company_name} som försatts i konkurs eller rekonstruktion.
Artikeln ska vara faktabaserad, neutral och respektfull.
Inkludera:
- Vad som hänt
- Bolagets historik och verksamhet
- Antal anställda och påverkan
- Kontext om branschen`
  },
  forvärv: {
    label: "Förvärv",
    promptTemplate: `Skriv en nyhetsartikel om ett företagsförvärv som involverar {company_name}.
Artikeln ska vara faktabaserad och journalistisk.
Inkludera:
- Detaljer om förvärvet
- Strategiska motiv
- Finansiella termer (om kända)
- Branschkontext`
  },
  general: {
    label: "Allmän nyhet",
    promptTemplate: `Skriv en nyhetsartikel om {company_name}.
Artikeln ska vara faktabaserad och journalistisk.
Basera artikeln på tillgänglig företagsinformation.`
  }
};

// Tonlägen
const TONES: Record<string, string> = {
  neutral: "Skriv i en neutral, objektiv journalistisk ton.",
  avslojar: "Skriv i en avslöjande, undersökande ton. Använd fraser som 'Impact Loop avslöjar' eller 'kan Impact Loop nu avslöja'.",
  positiv: "Skriv i en positiv men balanserad ton som lyfter fram framgångar.",
  analytisk: "Skriv i en analytisk ton med fokus på siffror, trender och marknadsperspektiv."
};

interface CompanyData {
  orgnr: string;
  company_name: string;
  sector: string | null;
  city: string | null;
  foundation_date: string | null;
  total_funding_sek: number | null;
  latest_funding_round_sek: number | null;
  latest_funding_date: string | null;
  latest_valuation_sek: number | null;
  turnover_2024_sek: number | null;
  ebit_2024_sek: number | null;
  turnover_2023_sek: number | null;
  ebit_2023_sek: number | null;
  growth_2023_2024_percent: number | null;
  largest_owners: string | null;
  ceo_contact: string | null;
}

interface GenerateRequest {
  orgnr: string;
  articleType?: string;
  tone?: string;
  customPrompt?: string;
  includeFactbox?: boolean;
}

function formatSEK(value: number | null): string {
  if (value === null || value === undefined) return "N/A";

  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)} mdkr`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} mkr`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(0)} tkr`;
  }
  return `${value.toFixed(0)} kr`;
}

function createFactbox(company: CompanyData): string {
  const parts: string[] = [];

  parts.push(`<strong>${company.company_name}</strong>`);
  parts.push(`Orgnr: ${company.orgnr}`);

  if (company.city) {
    parts.push(`Säte: ${company.city}`);
  }

  if (company.foundation_date) {
    const year = company.foundation_date.split("-")[0];
    parts.push(`Grundat: ${year}`);
  }

  if (company.sector) {
    parts.push(`Sektor: ${company.sector}`);
  }

  if (company.turnover_2024_sek) {
    parts.push(`Omsättning (2024): ${formatSEK(company.turnover_2024_sek)}`);
  } else if (company.turnover_2023_sek) {
    parts.push(`Omsättning (2023): ${formatSEK(company.turnover_2023_sek)}`);
  }

  if (company.ebit_2024_sek !== null) {
    parts.push(`Resultat (2024): ${formatSEK(company.ebit_2024_sek)}`);
  } else if (company.ebit_2023_sek !== null) {
    parts.push(`Resultat (2023): ${formatSEK(company.ebit_2023_sek)}`);
  }

  if (company.total_funding_sek) {
    parts.push(`Total funding: ${formatSEK(company.total_funding_sek)}`);
  }

  if (company.latest_valuation_sek) {
    parts.push(`Värdering: ${formatSEK(company.latest_valuation_sek)}`);
  }

  if (company.largest_owners) {
    parts.push(`Ägare: ${company.largest_owners}`);
  }

  return parts.join(" <span class=\"separator\">|</span> ");
}

function buildPrompt(company: CompanyData, request: GenerateRequest): string {
  const articleType = ARTICLE_TYPES[request.articleType || "general"] || ARTICLE_TYPES.general;
  const tone = TONES[request.tone || "neutral"] || TONES.neutral;

  let basePrompt = articleType.promptTemplate.replace("{company_name}", company.company_name);

  // Bygg företagskontext
  const context: string[] = [];
  context.push(`Företagsnamn: ${company.company_name}`);
  context.push(`Organisationsnummer: ${company.orgnr}`);

  if (company.city) context.push(`Stad: ${company.city}`);
  if (company.sector) context.push(`Sektor: ${company.sector}`);
  if (company.foundation_date) context.push(`Grundat: ${company.foundation_date}`);

  if (company.turnover_2024_sek) {
    context.push(`Omsättning 2024: ${formatSEK(company.turnover_2024_sek)}`);
  }
  if (company.turnover_2023_sek) {
    context.push(`Omsättning 2023: ${formatSEK(company.turnover_2023_sek)}`);
  }
  if (company.ebit_2024_sek !== null) {
    context.push(`Resultat 2024: ${formatSEK(company.ebit_2024_sek)}`);
  }
  if (company.ebit_2023_sek !== null) {
    context.push(`Resultat 2023: ${formatSEK(company.ebit_2023_sek)}`);
  }
  if (company.growth_2023_2024_percent !== null) {
    context.push(`Tillväxt 2023-2024: ${company.growth_2023_2024_percent.toFixed(1)}%`);
  }
  if (company.total_funding_sek) {
    context.push(`Total finansiering: ${formatSEK(company.total_funding_sek)}`);
  }
  if (company.latest_funding_round_sek) {
    context.push(`Senaste runda: ${formatSEK(company.latest_funding_round_sek)}`);
  }
  if (company.latest_valuation_sek) {
    context.push(`Värdering: ${formatSEK(company.latest_valuation_sek)}`);
  }
  if (company.largest_owners) {
    context.push(`Största ägare: ${company.largest_owners}`);
  }
  if (company.ceo_contact) {
    context.push(`VD: ${company.ceo_contact}`);
  }

  const fullPrompt = `Du är en erfaren finansjournalist för Impact Loop, en nyhetssajt om svenska startups och investeringar.

${tone}

FÖRETAGSINFORMATION:
${context.join("\n")}

UPPGIFT:
${basePrompt}

${request.customPrompt ? `EXTRA INSTRUKTIONER:\n${request.customPrompt}` : ""}

FORMATERING:
Returnera artikeln i följande JSON-format:
{
  "title": "Artikelrubrik (max 100 tecken)",
  "ingress": "Ingress som sammanfattar nyheten (2-3 meningar, max 300 tecken)",
  "content": "Brödtext i HTML-format med <p>, <h2>, <strong> taggar. 4-6 stycken."
}

REGLER:
- Skriv på svenska
- Var faktabaserad - använd endast information som finns i företagsdatan
- Formatera siffror snyggt (mkr, tkr, mdkr)
- Använd <strong> runt personnamn i brödtexten
- Undvik spekulationer utan belägg
- Håll en professionell journalistisk ton`;

  return fullPrompt;
}

async function generateWithClaude(prompt: string, apiKey: string): Promise<{
  title: string;
  ingress: string;
  content: string;
}> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;

  if (!content) {
    throw new Error("No content in Claude response");
  }

  // Extrahera JSON från svaret
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not parse JSON from Claude response");
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Invalid JSON in Claude response: ${e}`);
  }
}

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Check API key
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limiting
    const clientId = req.headers.get("x-forwarded-for") || "default";
    const rateCheck = checkRateLimit(clientId);

    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          message: `Max ${RATE_LIMIT_HOUR} artiklar per timme`,
          remaining: 0
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request
    const request: GenerateRequest = await req.json();

    if (!request.orgnr) {
      return new Response(
        JSON.stringify({ error: "Missing orgnr parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean orgnr
    const cleanOrgnr = request.orgnr.replace(/[^0-9]/g, "");
    if (cleanOrgnr.length !== 10) {
      return new Response(
        JSON.stringify({ error: "Invalid orgnr format. Must be 10 digits." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch company data
    const { data: companyData, error: dbError } = await supabase
      .from("loop_table")
      .select("*")
      .eq("orgnr", cleanOrgnr)
      .single();

    if (dbError || !companyData) {
      // Try with formatted orgnr
      const formattedOrgnr = `${cleanOrgnr.slice(0, 6)}-${cleanOrgnr.slice(6)}`;
      const { data: retryData, error: retryError } = await supabase
        .from("loop_table")
        .select("*")
        .eq("orgnr", formattedOrgnr)
        .single();

      if (retryError || !retryData) {
        return new Response(
          JSON.stringify({
            error: "Company not found",
            orgnr: cleanOrgnr
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Use retry data
      Object.assign(companyData || {}, retryData);
    }

    const company = companyData as CompanyData;

    // Build prompt and generate article
    const prompt = buildPrompt(company, request);
    const startTime = Date.now();

    const article = await generateWithClaude(prompt, anthropicKey);

    const generationTime = Date.now() - startTime;

    // Build response
    const response: Record<string, unknown> = {
      success: true,
      article: {
        title: article.title,
        ingress: article.ingress,
        content: article.content
      },
      company: {
        orgnr: company.orgnr,
        name: company.company_name,
        city: company.city,
        sector: company.sector
      },
      metadata: {
        articleType: request.articleType || "general",
        tone: request.tone || "neutral",
        generationTimeMs: generationTime,
        rateLimitRemaining: rateCheck.remaining,
        timestamp: new Date().toISOString()
      }
    };

    // Add factbox if requested
    if (request.includeFactbox !== false) {
      response.factbox = createFactbox(company);
    }

    return new Response(
      JSON.stringify(response),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rateCheck.remaining)
        }
      }
    );

  } catch (error) {
    console.error("Generate article error:", error);

    return new Response(
      JSON.stringify({
        error: "Failed to generate article",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
