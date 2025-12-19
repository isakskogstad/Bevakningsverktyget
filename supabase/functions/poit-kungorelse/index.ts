// Supabase Edge Function: poit-kungorelse
// Purpose: Fetch POIT announcement details via proxy
// Note: POIT is a JavaScript SPA - we fetch the page and extract key data

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const POIT_BASE_URL = 'https://poit.bolagsverket.se/poit-app/kungorelse/';

interface POITRequest {
  kungorelseId: string;  // e.g., "K967902-25" or "K967902/25"
}

interface POITResponse {
  success: boolean;
  data?: {
    id: string;
    url: string;
    text: string;
    type: string;
    details: Record<string, string>;
    fetchedAt: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

serve(async (req) => {
  // CORS handling
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const { kungorelseId }: POITRequest = await req.json();

    if (!kungorelseId) {
      return jsonResponse({
        success: false,
        error: {
          code: 'MISSING_ID',
          message: 'kungorelseId krävs (t.ex. "K967902-25")'
        }
      }, 400);
    }

    // Normalize ID format: K967902/25 -> K967902-25
    const normalizedId = kungorelseId.replace('/', '-');

    // Validate format
    const idRegex = /^K\d{5,7}-\d{2}$/;
    if (!idRegex.test(normalizedId)) {
      return jsonResponse({
        success: false,
        error: {
          code: 'INVALID_ID_FORMAT',
          message: `Ogiltigt format: "${kungorelseId}". Förväntat: K######-## (t.ex. K967902-25)`
        }
      }, 400);
    }

    const url = `${POIT_BASE_URL}${normalizedId}`;
    console.log(`Fetching POIT: ${url}`);

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return jsonResponse({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Kungörelse ${normalizedId} hittades inte`
          }
        }, 404);
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Check if it's a CAPTCHA page or bot detection
    if (html.includes('cf-browser-verification') || html.includes('captcha')) {
      return jsonResponse({
        success: false,
        error: {
          code: 'BOT_DETECTED',
          message: 'POIT blockerar automatiska förfrågningar. Använd direktlänk istället.'
        }
      }, 403);
    }

    // Parse basic info from HTML
    const parsed = parsePoitHtml(html, normalizedId);

    return jsonResponse({
      success: true,
      data: {
        id: normalizedId,
        url: url,
        text: parsed.text,
        type: parsed.type,
        details: parsed.details,
        fetchedAt: new Date().toISOString(),
      }
    });

  } catch (error) {
    console.error('POIT Error:', error);
    return jsonResponse({
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: error.message || 'Kunde inte hämta kungörelsen'
      }
    }, 500);
  }
});

function parsePoitHtml(html: string, id: string): { text: string; type: string; details: Record<string, string> } {
  const details: Record<string, string> = {};

  // Try to extract text content (POIT uses Angular/JS rendering, so limited parsing possible)
  // Most content is rendered client-side, so we extract what we can from static HTML

  // Remove scripts and styles
  let cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Extract patterns from any static text
  const patterns = [
    { key: 'forvaltare', regex: /förvaltare[:\s]+([^,\n]+)/i },
    { key: 'telefon', regex: /(?:telefon|tel\.?)[:\s]+([\d\s\-+()]+)/i },
    { key: 'orgnummer', regex: /(\d{6}-\d{4})/i },
    { key: 'domstol', regex: /(\w+\s+tingsrätt)/i },
  ];

  for (const p of patterns) {
    const match = cleanHtml.match(p.regex);
    if (match) {
      details[p.key] = match[1].trim();
    }
  }

  // Determine type from content
  let type = 'Kungörelse';
  const lowerHtml = cleanHtml.toLowerCase();
  if (lowerHtml.includes('konkursbeslut') || lowerHtml.includes('konkurs')) {
    type = 'Konkursbeslut';
  } else if (lowerHtml.includes('likvidation')) {
    type = 'Likvidation';
  } else if (lowerHtml.includes('fusion')) {
    type = 'Fusion';
  } else if (lowerHtml.includes('kallelse')) {
    type = 'Kallelse';
  } else if (lowerHtml.includes('aktiebolagsregistret')) {
    type = 'Aktiebolagsregistret';
  }

  // Truncate text if too long
  const text = cleanHtml.length > 2000 ? cleanHtml.substring(0, 2000) + '...' : cleanHtml;

  return { text, type, details };
}

function jsonResponse(data: POITResponse, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
