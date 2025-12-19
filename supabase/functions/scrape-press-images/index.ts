import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Press Images Scraper Edge Function
 *
 * Söker pressbilder på företagswebbplatser genom att:
 * 1. Testa vanliga press/media-sidor
 * 2. Extrahera img-taggar från HTML
 * 3. Filtrera på storlek och kvalitet
 *
 * Input (JSON):
 *   - websiteUrl: Företagets webbplats (t.ex. "https://example.com")
 *   - minWidth: Minsta bildbredd (default: 400)
 *   - minHeight: Minsta bildhöjd (default: 300)
 *   - maxImages: Max antal bilder att returnera (default: 10)
 *
 * Output:
 *   - images: Array med bildinformation
 *   - source: Vilken sida bilderna hittades på
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Rate limiting
const requestLog: Map<string, { count: number; resetTime: number }> = new Map();
const RATE_LIMIT_HOUR = 60;

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

interface ScrapeRequest {
  websiteUrl: string;
  minWidth?: number;
  minHeight?: number;
  maxImages?: number;
}

interface ImageInfo {
  src: string;
  alt: string;
  title: string;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  isPressImage: boolean;
  score: number;
}

// Press page paths to try
const PRESS_PATHS = [
  "/press",
  "/media",
  "/nyheter",
  "/news",
  "/about",
  "/om-oss",
  "/pressmaterial",
  "/pressrum",
  "/newsroom",
  "/about-us",
  ""
];

// Keywords that suggest a press/professional image
const PRESS_KEYWORDS = [
  "press", "media", "portrait", "headshot", "team", "ceo", "founder",
  "vd", "grundare", "styrelse", "board", "leadership", "executive",
  "profile", "profil", "about", "om-oss"
];

// Keywords to exclude (likely not press images)
const EXCLUDE_KEYWORDS = [
  "logo", "icon", "button", "banner", "ad", "advertisement",
  "sprite", "pixel", "tracking", "spacer", "arrow", "social",
  "facebook", "twitter", "linkedin", "instagram", "youtube",
  "cart", "checkout", "payment"
];

function normalizeUrl(base: string, src: string): string {
  if (!src) return "";
  if (src.startsWith("data:")) return "";
  if (src.startsWith("//")) return "https:" + src;
  if (src.startsWith("http")) return src;
  if (src.startsWith("/")) {
    const baseUrl = new URL(base);
    return `${baseUrl.protocol}//${baseUrl.host}${src}`;
  }
  return new URL(src, base).href;
}

function scoreImage(img: ImageInfo, pageUrl: string): number {
  let score = 0;

  // Larger images get higher scores
  if (img.width && img.height) {
    const area = img.width * img.height;
    if (area > 500000) score += 3;
    else if (area > 200000) score += 2;
    else if (area > 100000) score += 1;
  }

  // Check for press-related keywords
  const searchText = `${img.src} ${img.alt} ${img.title} ${pageUrl}`.toLowerCase();

  for (const keyword of PRESS_KEYWORDS) {
    if (searchText.includes(keyword)) {
      score += 2;
    }
  }

  // Penalize likely non-press images
  for (const keyword of EXCLUDE_KEYWORDS) {
    if (searchText.includes(keyword)) {
      score -= 5;
    }
  }

  // Prefer images from press/media pages
  const urlLower = pageUrl.toLowerCase();
  if (urlLower.includes("/press") || urlLower.includes("/media") || urlLower.includes("/newsroom")) {
    score += 3;
  }

  // Prefer JPG/PNG over other formats
  if (img.src.match(/\.(jpg|jpeg|png)(\?|$)/i)) {
    score += 1;
  }

  // Penalize very small images
  if (img.width && img.width < 200) score -= 3;
  if (img.height && img.height < 150) score -= 3;

  return score;
}

async function extractImagesFromHtml(html: string, baseUrl: string): Promise<ImageInfo[]> {
  const images: ImageInfo[] = [];

  // Simple regex to extract img tags
  const imgRegex = /<img[^>]+>/gi;
  const matches = html.match(imgRegex) || [];

  for (const imgTag of matches) {
    // Extract attributes
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);
    const titleMatch = imgTag.match(/title=["']([^"']*)["']/i);
    const widthMatch = imgTag.match(/width=["']?(\d+)/i);
    const heightMatch = imgTag.match(/height=["']?(\d+)/i);

    if (!srcMatch) continue;

    const src = normalizeUrl(baseUrl, srcMatch[1]);
    if (!src) continue;

    // Skip data URIs and tracking pixels
    if (src.includes("data:") || src.includes("1x1") || src.includes("pixel")) {
      continue;
    }

    const width = widthMatch ? parseInt(widthMatch[1]) : null;
    const height = heightMatch ? parseInt(heightMatch[1]) : null;

    const img: ImageInfo = {
      src,
      alt: altMatch ? altMatch[1] : "",
      title: titleMatch ? titleMatch[1] : "",
      width,
      height,
      aspectRatio: width && height ? (width / height).toFixed(2) : null,
      isPressImage: false,
      score: 0
    };

    // Calculate score
    img.score = scoreImage(img, baseUrl);
    img.isPressImage = img.score > 0;

    images.push(img);
  }

  // Also try to extract from srcset
  const srcsetRegex = /srcset=["']([^"']+)["']/gi;
  const srcsetMatches = html.matchAll(srcsetRegex);

  for (const match of srcsetMatches) {
    const srcset = match[1];
    // Get the largest image from srcset
    const parts = srcset.split(",").map(s => s.trim());
    for (const part of parts) {
      const [url] = part.split(/\s+/);
      const normalized = normalizeUrl(baseUrl, url);
      if (normalized && !images.some(i => i.src === normalized)) {
        images.push({
          src: normalized,
          alt: "",
          title: "",
          width: null,
          height: null,
          aspectRatio: null,
          isPressImage: false,
          score: 0
        });
      }
    }
  }

  return images;
}

async function fetchPage(url: string): Promise<{ html: string; status: number } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8"
      },
      signal: controller.signal,
      redirect: "follow"
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { html: "", status: response.status };
    }

    const html = await response.text();
    return { html, status: response.status };

  } catch (e) {
    return null;
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

    const request: ScrapeRequest = await req.json();

    if (!request.websiteUrl) {
      return new Response(
        JSON.stringify({ error: "Missing websiteUrl parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize website URL
    let baseUrl = request.websiteUrl.trim();
    if (!baseUrl.startsWith("http")) {
      baseUrl = "https://" + baseUrl;
    }
    baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash

    const minWidth = request.minWidth || 400;
    const minHeight = request.minHeight || 300;
    const maxImages = request.maxImages || 10;

    const startTime = Date.now();
    let allImages: ImageInfo[] = [];
    let successfulPage: string | null = null;
    const triedPages: string[] = [];
    const failedPages: string[] = [];

    // Try each press path
    for (const path of PRESS_PATHS) {
      const fullUrl = baseUrl + path;
      triedPages.push(fullUrl);

      const result = await fetchPage(fullUrl);

      if (!result || result.status >= 400) {
        failedPages.push(fullUrl);
        continue;
      }

      const pageImages = await extractImagesFromHtml(result.html, fullUrl);

      // Filter by minimum size if dimensions are known
      const filteredImages = pageImages.filter(img => {
        if (img.width !== null && img.width < minWidth) return false;
        if (img.height !== null && img.height < minHeight) return false;
        return true;
      });

      if (filteredImages.length > 0) {
        allImages = filteredImages;
        successfulPage = fullUrl;
        break; // Found images, stop searching
      }
    }

    // Sort by score (best first) and deduplicate
    const seen = new Set<string>();
    const uniqueImages = allImages
      .sort((a, b) => b.score - a.score)
      .filter(img => {
        if (seen.has(img.src)) return false;
        seen.add(img.src);
        return true;
      })
      .slice(0, maxImages);

    const processingTime = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        success: true,
        websiteUrl: baseUrl,
        source: successfulPage,
        images: uniqueImages,
        totalFound: allImages.length,
        returned: uniqueImages.length,
        triedPages,
        failedPages,
        processingTimeMs: processingTime,
        _metadata: {
          rateLimitRemaining: rateCheck.remaining
        }
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rateCheck.remaining)
        }
      }
    );

  } catch (error) {
    console.error("Press images scrape error:", error);

    return new Response(
      JSON.stringify({
        error: "Failed to scrape press images",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
