import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  ClaudeClient,
  createClaudeClient,
  EffortLevel,
  fileToBase64,
  validatePdf,
} from "../_shared/claude-client.ts";

/**
 * PDF Parser Edge Function v2
 *
 * Analyserar PDF-dokument med Claude Opus 4.5.
 *
 * NYA FUNKTIONER (Opus 4.5):
 * - effort parameter (low/medium/high) - styr token-användning
 * - extended thinking - djupare analys med synligt resonemang
 * - interleaved thinking - växlande resonemang för komplexa dokument
 *
 * Input (multipart/form-data eller JSON):
 *   - file: PDF-fil (base64 om JSON)
 *   - mode: "analyze" | "protokoll" | "extract" | "deep" (default: analyze)
 *   - effort: "low" | "medium" | "high" (default: medium)
 *   - thinking: boolean (aktivera extended thinking)
 *   - thinkingBudget: number (tokens för thinking, min 1024, default 5000)
 *   - generateArticle: boolean (generera nyhetsartikel)
 *
 * Output:
 *   - Strukturerat JSON med extraherat innehåll
 *   - thinking: resonemang om thinking=true
 *   - Nyhetsartikel om generateArticle=true
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Rate limiting
const requestLog: Map<string, { count: number; resetTime: number }> = new Map();
const RATE_LIMIT_HOUR = 20;

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

// Prompt för allmän dokumentanalys
const DOCUMENT_ANALYSIS_PROMPT = `Du är en expert på dokumentanalys och textextraktion. Din uppgift är att noggrant analysera det bifogade PDF-dokumentet och extrahera ALLT innehåll på ett strukturerat sätt.

INSTRUKTIONER:

1. KOMPLETT EXTRAKTION
   - Extrahera ALL text från dokumentet, inkluderat:
     * Rubriker och underrubriker
     * Brödtext och paragrafer
     * Punktlistor och numrerade listor
     * Tabeller (formatera som tydlig textrepresentation)
     * Sidhuvuden och sidfötter
     * Fotnoter och referenser
     * Datum, namn, organisationsnummer, belopp

2. HANDSKRIVEN TEXT
   - Om dokumentet innehåller handskrivna partier, gör ditt bästa för att tyda dem
   - Markera osäkra tolkningar med [osäker: ...]
   - Om text är oläslig, markera med [oläslig text]

3. VISUELLA ELEMENT
   - Beskriv bilder, logotyper, stämplar
   - Beskriv diagram och grafer
   - Notera signaturer (utan att försöka tyda dem)

4. DOKUMENTSTRUKTUR
   - Behåll dokumentets logiska struktur
   - Använd tydlig formatering med rubriker
   - Separera olika sektioner med tomma rader

5. METADATA
   - Dokumenttyp (protokoll, årsredovisning, avtal, etc.)
   - Datum om det framgår
   - Organisation/företag om det framgår
   - Antal sidor

OUTPUTFORMAT:

Returnera ett JSON-objekt med följande struktur:
{
  "metadata": {
    "dokumenttyp": "string",
    "datum": "string eller null",
    "organisation": "string eller null",
    "organisationsnummer": "string eller null",
    "antal_sidor": number
  },
  "sammanfattning": "Kort sammanfattning av dokumentets innehåll (2-3 meningar)",
  "innehall": "Fullständig extraherad text med bibehållen struktur",
  "sektioner": [
    {
      "rubrik": "string",
      "innehall": "string"
    }
  ],
  "nyckeluppgifter": {
    "personer": ["Lista med namn som nämns"],
    "datum": ["Lista med datum som nämns"],
    "belopp": ["Lista med belopp som nämns"],
    "beslut": ["Lista med beslut/åtgärder som nämns"]
  },
  "handskrivet": {
    "finns": boolean,
    "innehall": "Extraherad handskriven text eller null"
  },
  "kvalitet": {
    "lasbarhet": "god/medel/dålig",
    "kommentarer": "Eventuella problem med dokumentet"
  }
}

Svara ENDAST med JSON-objektet, ingen annan text.`;

// Prompt för bolagsstämmoprotokoll
const PROTOKOLL_PROMPT = `Du analyserar ett BOLAGSSTÄMMOPROTOKOLL från ett svenskt aktiebolag.

Extrahera och strukturera följande information noggrant:

1. GRUNDLÄGGANDE UPPGIFTER
   - Företagsnamn
   - Organisationsnummer
   - Datum för stämman
   - Typ av stämma (ordinarie/extra bolagsstämma)
   - Plats för stämman

2. NÄRVARANDE
   - Aktieägare (namn och antal aktier/röster om angivet)
   - Styrelseledamöter
   - Revisorer
   - Övriga närvarande

3. DAGORDNING OCH BESLUT
   - Varje punkt på dagordningen
   - Beslut som fattades
   - Röstningsresultat om angivet

4. STYRELSE
   - Nuvarande styrelseledamöter
   - Ordförande
   - Eventuella förändringar i styrelsen

5. EKONOMI
   - Fastställd resultaträkning
   - Fastställd balansräkning
   - Disposition av vinst/förlust
   - Utdelning (belopp per aktie om angivet)

6. ÖVRIGT
   - Ansvarsfrihet för styrelse/VD
   - Arvoden
   - Revisorsval
   - Övriga beslut

7. UNDERSKRIFTER
   - Protokollförare
   - Justerare
   - Datum för justering

OUTPUTFORMAT - Returnera JSON:
{
  "grunduppgifter": {
    "foretagsnamn": "string",
    "organisationsnummer": "string",
    "stammodatum": "string",
    "stammatyp": "string",
    "plats": "string"
  },
  "narvarande": {
    "aktieagare": [{"namn": "string", "aktier": "string eller null", "roster": "string eller null"}],
    "styrelse": ["string"],
    "revisorer": ["string"],
    "ovriga": ["string"]
  },
  "dagordning": [
    {
      "punkt": number,
      "rubrik": "string",
      "beslut": "string",
      "rostning": "string eller null"
    }
  ],
  "styrelse": {
    "ledamoter": ["string"],
    "ordforande": "string",
    "suppleanter": ["string"],
    "forandringar": "string eller null"
  },
  "ekonomi": {
    "resultatrakning_faststalld": boolean,
    "balansrakning_faststalld": boolean,
    "vinstdisposition": "string",
    "utdelning_per_aktie": "string eller null"
  },
  "ovrigt": {
    "ansvarsfrihet": boolean,
    "arvoden": "string eller null",
    "revisorsval": "string eller null",
    "ovriga_beslut": ["string"]
  },
  "underskrifter": {
    "protokollfoare": "string",
    "justerare": ["string"],
    "justeringsdatum": "string eller null"
  },
  "fulltext": "Komplett extraherad text från dokumentet",
  "kvalitet": {
    "komplett": boolean,
    "saknade_uppgifter": ["string"],
    "kommentarer": "string"
  }
}

Svara ENDAST med JSON-objektet.`;

// Prompt för enkel textextraktion
const EXTRACT_PROMPT = `Extrahera ALL text från detta PDF-dokument.

Inkludera:
- All tryckt text
- Handskriven text (markera osäkra tolkningar med [osäker: ...])
- Tabellinnehåll (formatera läsbart)
- Datum, namn, siffror

Behåll dokumentets struktur och formatering så gott det går.
Om något är oläsligt, markera med [oläsligt].

Svara ENDAST med den extraherade texten, ingen inledning eller avslutning.`;

// Prompt för djupanalys (med extended thinking)
const DEEP_ANALYSIS_PROMPT = `Du är en expert-analytiker som ska göra en DJUPANALYS av detta PDF-dokument.

ANALYSERA NOGGRANT:

1. DOKUMENTTYP & KONTEXT
   - Vilken typ av dokument är detta?
   - Vem är avsändaren?
   - Vem är mottagaren?
   - I vilket sammanhang har dokumentet skapats?

2. INNEHÅLLSANALYS
   - Extrahera ALL text
   - Identifiera huvudbudskap
   - Lista alla fakta, siffror och datum
   - Identifiera alla namngivna personer och organisationer

3. IMPLIKATIONER
   - Vilka affärsmässiga implikationer har dokumentet?
   - Finns det potentiella nyheter/avslöjanden?
   - Vad är viktigt för journalister?

4. RISKER & VARNINGAR
   - Finns det ekonomiska varningssignaler?
   - Tecken på problem eller kriser?
   - Ovanliga formuleringar eller utelämnanden?

5. JOURNALISTISKA VINKLAR
   - Föreslå 3 potentiella nyhetsrubriker
   - Vilka följdfrågor bör ställas?
   - Vilka andra källor bör kontaktas?

OUTPUTFORMAT - Returnera JSON:
{
  "dokumenttyp": "string",
  "sammanfattning": "3-5 meningar om dokumentets kärna",
  "metadata": {
    "datum": "string eller null",
    "organisation": "string eller null",
    "organisationsnummer": "string eller null",
    "avsandare": "string eller null",
    "mottagare": "string eller null"
  },
  "nyckelinnehall": {
    "huvudbudskap": ["Viktiga punkter"],
    "fakta": ["Specifika fakta och siffror"],
    "personer": ["Personer som nämns med kontext"],
    "organisationer": ["Organisationer som nämns"]
  },
  "analys": {
    "implikationer": "Affärsmässiga och juridiska implikationer",
    "nyhetsvarde": "Bedömning av nyhetsvärde (lågt/medel/högt) med motivering",
    "varningssignaler": ["Potentiella problem eller risker"]
  },
  "journalistik": {
    "rubriker": ["3 föreslagna nyhetsrubriker"],
    "foldfragor": ["Frågor som bör ställas"],
    "kallor": ["Föreslagna källor att kontakta"]
  },
  "fulltext": "Komplett extraherad text",
  "kvalitet": {
    "lasbarhet": "god/medel/dålig",
    "komplett": boolean,
    "kommentarer": "string"
  }
}

Svara ENDAST med JSON-objektet.`;

// Prompt för nyhetsartikel
const NEWS_ARTICLE_PROMPT = `Du är nyhetsbyrån "Impact Loop" och ska agera journalist som bevakar tech-bolag och andra inom start-up branschen i Sverige.

Din uppgift är att ta fram en intresseväckande, välformulerad och avslöjande nyhetsartikel baserat på det bifogade underlaget.

VIKTIGA REGLER:
1. Analysera underlaget och ta fram ett utkast på en nyhetstext om relevanta och intressanta delar.
2. Skriv med ett naturligt språk och formulera en intresseväckande rubrik.
3. Undvik tekniska detaljer, fokusera på att formulera en nyhetstext som är intressant och läsvärd.
4. Avsändaren är "Impact Loop".
5. Personnamn är ofta mer intressanta än bolagsnamn.

OUTPUTFORMAT - Returnera JSON:
{
  "titel": "Intresseväckande rubrik",
  "ingress": "Engagerande ingress som får läsaren att vilja läsa vidare",
  "sektioner": [
    {
      "underrubrik": "string",
      "brodtext": "string med HTML-formatering (<p>, <strong>, etc.)"
    }
  ],
  "faktaruta": {
    "rubrik": "FAKTA: Företagsnamn",
    "punkter": ["Nyckeltal och fakta"]
  },
  "metadata": {
    "foretagsnamn": "string",
    "organisationsnummer": "string eller null",
    "kategori": "NYEMISSION | VD-BYTE | BOKSLUT | FÖRVÄRV | STARTUP"
  }
}

Svara ENDAST med JSON-objektet.`;

interface ParseRequest {
  file?: string; // Base64-encoded PDF
  mode?: "analyze" | "protokoll" | "extract" | "deep";
  effort?: EffortLevel;
  thinking?: boolean;
  thinkingBudget?: number;
  generateArticle?: boolean;
}

type AnalysisMode = "analyze" | "protokoll" | "extract" | "deep";

function getPromptForMode(mode: AnalysisMode): string {
  switch (mode) {
    case "protokoll":
      return PROTOKOLL_PROMPT;
    case "extract":
      return EXTRACT_PROMPT;
    case "deep":
      return DEEP_ANALYSIS_PROMPT;
    default:
      return DOCUMENT_ANALYSIS_PROMPT;
  }
}

function getEffortForMode(mode: AnalysisMode, requestedEffort?: EffortLevel): EffortLevel {
  if (requestedEffort) return requestedEffort;

  // Default effort levels per mode
  switch (mode) {
    case "extract":
      return "low"; // Simple extraction = low effort
    case "analyze":
      return "medium"; // Standard analysis = medium effort
    case "protokoll":
      return "medium"; // Structured extraction = medium effort
    case "deep":
      return "high"; // Deep analysis = high effort
    default:
      return "medium";
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
    // Create Claude client
    let claude: ClaudeClient;
    try {
      claude = createClaudeClient();
    } catch (error) {
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
          message: `Max ${RATE_LIMIT_HOUR} requests per hour`,
          remaining: 0
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let pdfBase64: string;
    let mode: AnalysisMode = "analyze";
    let effort: EffortLevel | undefined;
    let useThinking = false;
    let thinkingBudget = 5000;
    let generateArticle = false;

    // Handle different content types
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      // Handle file upload
      const formData = await req.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return new Response(
          JSON.stringify({ error: "No file uploaded" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate PDF
      const validation = validatePdf(file);
      if (!validation.valid) {
        return new Response(
          JSON.stringify({ error: validation.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      pdfBase64 = await fileToBase64(file);

      mode = (formData.get("mode") as AnalysisMode) || "analyze";
      effort = formData.get("effort") as EffortLevel | undefined;
      useThinking = formData.get("thinking") === "true";
      thinkingBudget = parseInt(formData.get("thinkingBudget") as string) || 5000;
      generateArticle = formData.get("generateArticle") === "true";

    } else {
      // Handle JSON
      const request: ParseRequest = await req.json();

      if (!request.file) {
        return new Response(
          JSON.stringify({ error: "Missing file parameter (base64 PDF)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      pdfBase64 = request.file;
      mode = request.mode || "analyze";
      effort = request.effort;
      useThinking = request.thinking || false;
      thinkingBudget = request.thinkingBudget || 5000;
      generateArticle = request.generateArticle || false;
    }

    // Ensure minimum thinking budget
    if (useThinking && thinkingBudget < 1024) {
      thinkingBudget = 1024;
    }

    // For deep mode, always use thinking
    if (mode === "deep") {
      useThinking = true;
      if (thinkingBudget < 8000) {
        thinkingBudget = 8000;
      }
    }

    const startTime = Date.now();

    // Get prompt and effort level
    const prompt = getPromptForMode(mode);
    const effectiveEffort = getEffortForMode(mode, effort);

    // Call Claude API
    let responseText: string;
    let thinkingText: string | undefined;

    if (useThinking) {
      // Use extended thinking for complex analysis
      const result = await claude.analyzePdf(pdfBase64, prompt, {
        effort: effectiveEffort,
        thinking: true,
        thinkingBudget,
      });
      responseText = result.response;
      thinkingText = result.thinking;
    } else {
      // Standard analysis with effort parameter
      const result = await claude.analyzePdf(pdfBase64, prompt, {
        effort: effectiveEffort,
      });
      responseText = result.response;
    }

    const processingTime = Date.now() - startTime;

    // Parse response
    let result: Record<string, unknown>;

    if (mode === "extract") {
      // For extract mode, return plain text
      result = {
        mode: "extract",
        text: responseText,
        effort: effectiveEffort,
        processingTimeMs: processingTime
      };
    } else {
      // Parse JSON response
      try {
        result = claude.parseJsonFromText<Record<string, unknown>>(responseText);
        result._metadata = {
          mode,
          effort: effectiveEffort,
          thinking: useThinking,
          thinkingBudget: useThinking ? thinkingBudget : undefined,
          processingTimeMs: processingTime,
          rateLimitRemaining: rateCheck.remaining
        };

        // Include thinking if available
        if (thinkingText) {
          result._thinking = thinkingText;
        }
      } catch (parseError) {
        result = {
          error: "Failed to parse response as JSON",
          rawText: responseText,
          thinking: thinkingText,
          processingTimeMs: processingTime
        };
      }
    }

    // Generate news article if requested
    if (generateArticle && mode !== "extract") {
      try {
        const articleResult = await claude.analyzePdf(pdfBase64, NEWS_ARTICLE_PROMPT, {
          effort: "medium",
        });
        const article = claude.parseJsonFromText<Record<string, unknown>>(articleResult.response);
        result.generatedArticle = article;
      } catch (articleError) {
        result.articleError = `Failed to generate article: ${articleError}`;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...result
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rateCheck.remaining),
          "X-Effort-Level": effectiveEffort
        }
      }
    );

  } catch (error) {
    console.error("PDF parse error:", error);

    return new Response(
      JSON.stringify({
        error: "Failed to parse PDF",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
