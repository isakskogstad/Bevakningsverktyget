import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLABOLAG_BASE_URL = "https://www.allabolag.se";

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

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const orgnr = url.searchParams.get("orgnr");

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
