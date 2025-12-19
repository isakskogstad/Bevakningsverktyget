# Edge Functions Design - BATCH 2 & 3
> Nyhets- & Innehållsgenerering + Automatisering & Säkerhet

**Skapad:** 2025-12-19
**Stack:** Supabase Edge Functions (Deno), PostgreSQL, Anthropic Claude API
**Baserat på:** Befintlig kod i `/src/scrapers/` och BATCH 1-design

---

## ÖVERSIKT

### BATCH 2 - Nyhets- & Innehållsgenerering
5. **Nyhetsartikelgenerator med Claude** - Pipeline: företagsdata → pressbilder → Claude → artikel
6. **PDF-parser med AI-analys** - Extrahera text från PDF och analysera med Claude
7. **Pressbildsscraper** - Hitta pressbilder på företags /press, /media-sidor

### BATCH 3 - Automatisering & Säkerhet
8. **Auto CAPTCHA-lösare** - NopeCHA integration
9. **Protokoll-scraper med köp** - Bolagsstämmoprotokoll från Bolagsverket
10. **Budget Manager** - Spåra utgifter för API-anrop

---

## BATCH 2: NYHETS- & INNEHÅLLSGENERERING

---

## 5. EDGE FUNCTION: `generate-article`

**Syfte:** Generera nyheters­artikel från företagsdata med Claude AI

### 5.1 Input Schema

```typescript
interface GenerateArticleRequest {
  companyId: string;              // ID från loop_table
  includeImages?: boolean;        // Hämta och inkludera pressbilder
  articleType?: 'news' | 'profile' | 'analysis';  // Artikeltyp
  tone?: 'neutral' | 'positive' | 'critical';     // Ton
  targetLength?: number;          // Önskad längd i ord
  customPrompt?: string;          // Custom instruktioner till Claude
}
```

### 5.2 Output Schema

```typescript
interface GenerateArticleResponse {
  success: boolean;
  data?: {
    article: {
      title: string;
      lead: string;              // Ingress
      body: string;              // Huvudtext (markdown)
      summary: string;           // Kort sammanfattning
      keywords: string[];        // Extraherade nyckelord
      wordCount: number;
    };
    sourceData: {
      companyId: string;
      companyName: string;
      financials?: any;          // Finansiell data använd
      pressReleases?: any[];     // Pressreleaser använd
      images?: Array<{
        url: string;
        caption: string;
      }>;
    };
    metadata: {
      generatedAt: string;
      model: string;             // Claude model version
      tokensUsed: number;
      processingTime: number;    // ms
      cost: number;              // SEK
    };
  };
  error?: {
    code: string;
    message: string;
  };
}
```

### 5.3 Implementation

```typescript
// supabase/functions/generate-article/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CLAUDE_MODEL = 'claude-3-5-sonnet-20241022';

// Pricing (SEK, approximate)
const PRICING = {
  'claude-3-5-sonnet-20241022': {
    input: 0.03 / 1000,   // 0.03 SEK per 1k input tokens
    output: 0.15 / 1000,  // 0.15 SEK per 1k output tokens
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Auth check
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' }
      }, { status: 401 });
    }

    const {
      companyId,
      includeImages = true,
      articleType = 'news',
      tone = 'neutral',
      targetLength = 500,
      customPrompt
    } = await req.json();

    if (!companyId) {
      return jsonResponse({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'companyId is required' }
      }, { status: 400 });
    }

    const startTime = Date.now();

    // 1. Fetch company data from loop_table
    const { data: company, error: companyError } = await supabase
      .from('loop_table')
      .select('*')
      .eq('id', companyId)
      .single();

    if (companyError || !company) {
      return jsonResponse({
        success: false,
        error: { code: 'COMPANY_NOT_FOUND', message: 'Company not found' }
      }, { status: 404 });
    }

    // 2. Fetch recent POIT announcements
    const { data: announcements } = await supabase
      .from('poit_announcements')
      .select('*')
      .eq('orgnr', company.orgnr)
      .order('publication_date', { ascending: false })
      .limit(5);

    // 3. Fetch pressroom data if available
    let pressData = null;
    if (includeImages && company.pressroom_url) {
      const { data: cached } = await supabase
        .from('pressroom_cache')
        .select('*')
        .eq('company_id', companyId)
        .gt('expires_at', new Date().toISOString())
        .single();

      pressData = cached;
    }

    // 4. Build context for Claude
    const context = buildArticleContext({
      company,
      announcements: announcements || [],
      pressData,
      articleType,
    });

    // 5. Generate article with Claude
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const systemPrompt = buildSystemPrompt(articleType, tone, targetLength);
    const userPrompt = customPrompt || buildUserPrompt(context);

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const article = parseClaudeResponse(response.content[0].text);

    // 6. Calculate cost
    const tokensUsed = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    };

    const cost = calculateCost(tokensUsed, CLAUDE_MODEL);

    // 7. Log usage to budget_logs
    await supabase.from('budget_logs').insert({
      user_id: user.id,
      service: 'anthropic',
      operation: 'generate-article',
      tokens_input: tokensUsed.input,
      tokens_output: tokensUsed.output,
      cost_sek: cost,
      metadata: {
        companyId,
        articleType,
        model: CLAUDE_MODEL,
      },
    });

    // 8. Save generated article
    const { data: savedArticle } = await supabase
      .from('generated_articles')
      .insert({
        user_id: user.id,
        company_id: companyId,
        title: article.title,
        lead: article.lead,
        body: article.body,
        summary: article.summary,
        keywords: article.keywords,
        word_count: article.wordCount,
        article_type: articleType,
        tone: tone,
        model: CLAUDE_MODEL,
        tokens_used: tokensUsed.input + tokensUsed.output,
        cost_sek: cost,
      })
      .select()
      .single();

    const processingTime = Date.now() - startTime;

    return jsonResponse({
      success: true,
      data: {
        article,
        sourceData: {
          companyId,
          companyName: company.foretag,
          financials: company.financials,
          pressReleases: pressData?.press_releases || [],
          images: pressData?.images || [],
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          model: CLAUDE_MODEL,
          tokensUsed: tokensUsed.input + tokensUsed.output,
          processingTime,
          cost,
        },
      },
    });

  } catch (error) {
    console.error('Generate Article Error:', error);
    return jsonResponse({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message }
    }, { status: 500 });
  }
});

// Helper: Build context object
function buildArticleContext(data: any): any {
  const { company, announcements, pressData, articleType } = data;

  return {
    company: {
      name: company.foretag,
      orgnr: company.orgnr,
      description: company.description,
      industry: company.industry,
      employees: company.num_employees,
      revenue: company.revenue,
      netProfit: company.net_profit,
      website: company.website,
    },
    recentEvents: announcements.map((a: any) => ({
      type: a.announcement_type,
      date: a.publication_date,
      description: a.description,
    })),
    pressReleases: pressData?.press_releases?.slice(0, 3) || [],
    financials: company.financials,
  };
}

// Helper: Build system prompt
function buildSystemPrompt(
  articleType: string,
  tone: string,
  targetLength: number
): string {
  const typeInstructions = {
    news: 'Skriv en nyhetartikel i journalistisk stil. Fokusera på fakta och senaste händelser.',
    profile: 'Skriv en företagsprofil som introducerar företaget och dess verksamhet.',
    analysis: 'Skriv en analytisk artikel som gräver djupare i företagets ekonomi och strategi.',
  };

  const toneInstructions = {
    neutral: 'Håll en objektiv och neutral ton.',
    positive: 'Använd en positiv och uppskattande ton.',
    critical: 'Använd en granskande och kritisk ton där det är motiverat.',
  };

  return `Du är en erfaren affärsjournalist på en svensk nyhetstidning.

${typeInstructions[articleType]}

${toneInstructions[tone]}

STRUKTUR:
- Titel: Kort och fängslande (max 80 tecken)
- Ingress: Sammanfattning av kärnan (2-3 meningar)
- Huvudtext: ${targetLength} ord, uppdelat i stycken
- Sammanfattning: 1-2 meningar med nyckelbudskap
- Nyckelord: 5-7 relevanta nyckelord

STILGUIDE:
- Skriv på svenska
- Använd aktiv form
- Undvik jargong
- Inkludera konkreta siffror och fakta
- Citera källor när relevant

SVARA I FÖLJANDE JSON-FORMAT:
{
  "title": "...",
  "lead": "...",
  "body": "...",
  "summary": "...",
  "keywords": ["...", "..."]
}`;
}

// Helper: Build user prompt
function buildUserPrompt(context: any): string {
  return `Företagsinformation:
Namn: ${context.company.name}
Orgnr: ${context.company.orgnr}
Bransch: ${context.company.industry || 'Ej specificerad'}
Anställda: ${context.company.employees || 'Ej tillgängligt'}
Omsättning: ${context.company.revenue ? (context.company.revenue / 1000000).toFixed(1) + ' MSEK' : 'Ej tillgängligt'}
Resultat: ${context.company.netProfit ? (context.company.netProfit / 1000000).toFixed(1) + ' MSEK' : 'Ej tillgängligt'}

Senaste händelser:
${context.recentEvents.map((e: any) => `- ${e.date}: ${e.type} - ${e.description}`).join('\n') || 'Inga händelser registrerade'}

${context.pressReleases.length > 0 ? `
Senaste pressreleaser:
${context.pressReleases.map((pr: any) => `- ${pr.publishedAt}: ${pr.title}`).join('\n')}
` : ''}

Skriv en artikel baserat på denna information.`;
}

// Helper: Parse Claude response
function parseClaudeResponse(text: string): any {
  try {
    const json = JSON.parse(text);
    return {
      title: json.title,
      lead: json.lead,
      body: json.body,
      summary: json.summary,
      keywords: json.keywords,
      wordCount: json.body.split(/\s+/).length,
    };
  } catch (error) {
    // Fallback: try to extract structure from plain text
    const lines = text.split('\n').filter(l => l.trim());
    return {
      title: lines[0] || 'Untitled',
      lead: lines[1] || '',
      body: lines.slice(2).join('\n\n'),
      summary: lines[1] || '',
      keywords: [],
      wordCount: text.split(/\s+/).length,
    };
  }
}

// Helper: Calculate cost
function calculateCost(tokens: any, model: string): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;

  const inputCost = tokens.input * pricing.input;
  const outputCost = tokens.output * pricing.output;

  return Math.round((inputCost + outputCost) * 100) / 100; // Round to 2 decimals
}

function corsResponse() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

function jsonResponse(data: unknown, options?: { status?: number }) {
  return new Response(JSON.stringify(data), {
    status: options?.status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

### 5.4 Databas-schema

```sql
-- Table: generated_articles
CREATE TABLE public.generated_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relations
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES loop_table(id) ON DELETE SET NULL,

  -- Article content
  title TEXT NOT NULL,
  lead TEXT NOT NULL,
  body TEXT NOT NULL,
  summary TEXT,
  keywords TEXT[],
  word_count INTEGER,

  -- Metadata
  article_type TEXT CHECK (article_type IN ('news', 'profile', 'analysis')),
  tone TEXT CHECK (tone IN ('neutral', 'positive', 'critical')),

  -- AI metadata
  model TEXT NOT NULL,
  tokens_used INTEGER,
  cost_sek DECIMAL(10,2),

  -- Status
  published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_generated_articles_user_id ON generated_articles(user_id);
CREATE INDEX idx_generated_articles_company_id ON generated_articles(company_id);
CREATE INDEX idx_generated_articles_created_at ON generated_articles(created_at DESC);
CREATE INDEX idx_generated_articles_keywords ON generated_articles USING GIN(keywords);

-- RLS
ALTER TABLE generated_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own articles"
  ON generated_articles
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own articles"
  ON generated_articles
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own articles"
  ON generated_articles
  FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own articles"
  ON generated_articles
  FOR DELETE
  USING (user_id = auth.uid());
```

### 5.5 Miljövariabler

```bash
ANTHROPIC_API_KEY=sk-ant-xxx  # Claude API key
```

### 5.6 Rate Limiting

- **Per user:** 10 artiklar/timme, 50 artiklar/dag
- **Budget cap:** Max 100 SEK/dag per användare (konfigurerbara)

---

## 6. EDGE FUNCTION: `parse-pdf`

**Syfte:** Extrahera text från PDF och analysera med Claude AI

### 6.1 Input Schema

```typescript
interface ParsePDFRequest {
  url?: string;                   // URL till PDF
  base64?: string;                // Base64-encoded PDF
  analysisType?: 'summary' | 'extract' | 'qa';  // Analystyp
  questions?: string[];           // Frågor för Q&A mode
  extractTables?: boolean;        // Extrahera tabeller
  extractImages?: boolean;        // Extrahera bilder
}
```

### 6.2 Output Schema

```typescript
interface ParsePDFResponse {
  success: boolean;
  data?: {
    text: string;                 // Extraherad text
    pages: number;                // Antal sidor
    analysis?: {
      summary?: string;           // AI-genererad sammanfattning
      keyPoints?: string[];       // Nyckelpunkter
      entities?: Array<{          // Extraherade entiteter
        type: string;             // 'person', 'company', 'date', etc.
        value: string;
        context: string;
      }>;
      answers?: Array<{           // Q&A svar
        question: string;
        answer: string;
        confidence: number;
      }>;
    };
    tables?: any[];               // Extraherade tabeller
    images?: any[];               // Extraherade bilder
    metadata: {
      filename?: string;
      fileSize: number;
      pagesProcessed: number;
      processingTime: number;     // ms
      tokensUsed?: number;
      cost?: number;              // SEK
    };
  };
  error?: {
    code: string;
    message: string;
  };
}
```

### 6.3 Implementation

```typescript
// supabase/functions/parse-pdf/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CLAUDE_MODEL = 'claude-3-5-sonnet-20241022';

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Auth check
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' }
      }, { status: 401 });
    }

    const {
      url,
      base64,
      analysisType = 'summary',
      questions = [],
      extractTables = false,
      extractImages = false,
    } = await req.json();

    if (!url && !base64) {
      return jsonResponse({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'url or base64 is required' }
      }, { status: 400 });
    }

    const startTime = Date.now();

    // 1. Fetch PDF
    let pdfBytes: Uint8Array;
    let filename = 'document.pdf';

    if (url) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      pdfBytes = new Uint8Array(arrayBuffer);
      filename = url.split('/').pop() || 'document.pdf';
    } else {
      pdfBytes = Uint8Array.from(atob(base64!), c => c.charCodeAt(0));
    }

    // Check file size
    if (pdfBytes.length > MAX_FILE_SIZE) {
      return jsonResponse({
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: `Max file size is ${MAX_FILE_SIZE / 1024 / 1024}MB` }
      }, { status: 400 });
    }

    // 2. Load PDF with pdf-lib
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();

    // 3. Extract text using Claude with PDF support
    // Claude 3.5 Sonnet supports PDF documents directly via API
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    // Convert PDF to base64 for Claude API
    const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));

    const systemPrompt = buildPDFAnalysisPrompt(analysisType, questions);

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: buildPDFUserPrompt(analysisType, questions),
            },
          ],
        },
      ],
    });

    const analysis = parsePDFAnalysis(response.content[0].text, analysisType);

    // 4. Calculate cost
    const tokensUsed = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    };

    const cost = calculateCost(tokensUsed, CLAUDE_MODEL);

    // 5. Log usage
    await supabase.from('budget_logs').insert({
      user_id: user.id,
      service: 'anthropic',
      operation: 'parse-pdf',
      tokens_input: tokensUsed.input,
      tokens_output: tokensUsed.output,
      cost_sek: cost,
      metadata: {
        filename,
        pages: pageCount,
        analysisType,
        model: CLAUDE_MODEL,
      },
    });

    const processingTime = Date.now() - startTime;

    return jsonResponse({
      success: true,
      data: {
        text: analysis.text || '',
        pages: pageCount,
        analysis: {
          summary: analysis.summary,
          keyPoints: analysis.keyPoints,
          entities: analysis.entities,
          answers: analysis.answers,
        },
        tables: [], // TODO: Implement table extraction
        images: [], // TODO: Implement image extraction
        metadata: {
          filename,
          fileSize: pdfBytes.length,
          pagesProcessed: pageCount,
          processingTime,
          tokensUsed: tokensUsed.input + tokensUsed.output,
          cost,
        },
      },
    });

  } catch (error) {
    console.error('Parse PDF Error:', error);
    return jsonResponse({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message }
    }, { status: 500 });
  }
});

// Helper: Build system prompt for PDF analysis
function buildPDFAnalysisPrompt(analysisType: string, questions: string[]): string {
  const basePrompt = 'Du är en expert på dokumentanalys. ';

  const typePrompts = {
    summary: basePrompt + 'Sammanfatta dokumentet kortfattat och peka ut de viktigaste punkterna.',
    extract: basePrompt + 'Extrahera strukturerad information från dokumentet: personer, företag, datum, siffror.',
    qa: basePrompt + 'Besvara frågorna baserat på innehållet i dokumentet. Om informationen inte finns, säg det tydligt.',
  };

  return typePrompts[analysisType] + '\n\nSvara alltid på svenska och i JSON-format.';
}

// Helper: Build user prompt
function buildPDFUserPrompt(analysisType: string, questions: string[]): string {
  if (analysisType === 'qa' && questions.length > 0) {
    return `Besvara följande frågor:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
  }

  if (analysisType === 'extract') {
    return `Extrahera följande information:
- Personer (namn, roller)
- Företag (namn, orgnr om tillgängligt)
- Datum (viktiga datum)
- Siffror (ekonomiska siffror, nyckeltal)
- Nyckelord`;
  }

  return 'Sammanfatta dokumentet och lista de 5 viktigaste punkterna.';
}

// Helper: Parse Claude's PDF analysis
function parsePDFAnalysis(text: string, analysisType: string): any {
  try {
    const json = JSON.parse(text);
    return json;
  } catch (error) {
    // Fallback: return text as-is
    return {
      text,
      summary: text.substring(0, 500),
      keyPoints: [],
      entities: [],
      answers: [],
    };
  }
}

// Helper: Calculate cost (same as generate-article)
function calculateCost(tokens: any, model: string): number {
  const PRICING = {
    'claude-3-5-sonnet-20241022': {
      input: 0.03 / 1000,
      output: 0.15 / 1000,
    },
  };

  const pricing = PRICING[model];
  if (!pricing) return 0;

  const inputCost = tokens.input * pricing.input;
  const outputCost = tokens.output * pricing.output;

  return Math.round((inputCost + outputCost) * 100) / 100;
}

function corsResponse() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

function jsonResponse(data: unknown, options?: { status?: number }) {
  return new Response(JSON.stringify(data), {
    status: options?.status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

### 6.4 Rate Limiting

- **Per user:** 20 PDFs/timme, 100 PDFs/dag
- **File size:** Max 10MB per PDF

---

## 7. EDGE FUNCTION: `scrape-press-images`

**Syfte:** Hitta och scrapa pressbilder från företags webbplatser

### 7.1 Input Schema

```typescript
interface ScrapePressImagesRequest {
  companyId?: string;             // ID från loop_table
  websiteUrl: string;             // Företagets webbplats
  autoDetect?: boolean;           // Auto-detect /press, /media pages
  specificPaths?: string[];       // Specifika sökvägar att scrapa
  imageFilter?: {
    minWidth?: number;            // Min bredd (px)
    minHeight?: number;           // Min höjd (px)
    formats?: string[];           // ['jpg', 'png', 'webp']
  };
}
```

### 7.2 Output Schema

```typescript
interface ScrapePressImagesResponse {
  success: boolean;
  data?: {
    images: Array<{
      url: string;
      downloadUrl: string;        // Direct download URL
      thumbnail: string;          // Thumbnail URL
      caption?: string;           // Alt text eller caption
      title?: string;
      width?: number;
      height?: number;
      format: string;             // 'jpg', 'png', 'webp'
      fileSize?: number;          // bytes
      context?: string;           // Surrounding text
    }>;
    sources: Array<{              // Sidor som scrapats
      url: string;
      imagesFound: number;
    }>;
    metadata: {
      totalImages: number;
      pagesScraped: number;
      processingTime: number;     // ms
    };
  };
  error?: {
    code: string;
    message: string;
  };
}
```

### 7.3 Implementation

```typescript
// supabase/functions/scrape-press-images/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const DEFAULT_PRESS_PATHS = [
  '/press',
  '/media',
  '/pressbilder',
  '/pressrum',
  '/nyheter',
  '/om-oss/press',
  '/sv/press',
  '/en/press',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Auth check
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' }
      }, { status: 401 });
    }

    const {
      companyId,
      websiteUrl,
      autoDetect = true,
      specificPaths = [],
      imageFilter = {},
    } = await req.json();

    if (!websiteUrl) {
      return jsonResponse({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'websiteUrl is required' }
      }, { status: 400 });
    }

    const startTime = Date.now();

    // 1. Build list of URLs to scrape
    const baseUrl = new URL(websiteUrl);
    const urlsToScrape: string[] = [];

    if (autoDetect) {
      // Try common press page paths
      for (const path of DEFAULT_PRESS_PATHS) {
        urlsToScrape.push(new URL(path, baseUrl).toString());
      }
    }

    if (specificPaths.length > 0) {
      for (const path of specificPaths) {
        urlsToScrape.push(new URL(path, baseUrl).toString());
      }
    }

    // Fallback: scrape homepage
    if (urlsToScrape.length === 0) {
      urlsToScrape.push(websiteUrl);
    }

    // 2. Scrape each URL
    const allImages: any[] = [];
    const sources: any[] = [];

    for (const url of urlsToScrape) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        });

        if (!response.ok) continue;

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        if (!doc) continue;

        // Find images
        const images = extractImages(doc, url, imageFilter);

        if (images.length > 0) {
          allImages.push(...images);
          sources.push({
            url,
            imagesFound: images.length,
          });
        }

      } catch (error) {
        console.error(`Failed to scrape ${url}:`, error);
        continue;
      }
    }

    // 3. Deduplicate images
    const uniqueImages = deduplicateImages(allImages);

    // 4. Save to database (optional)
    if (companyId && uniqueImages.length > 0) {
      await supabase
        .from('pressroom_cache')
        .upsert({
          company_id: companyId,
          pressroom_url: websiteUrl,
          images: uniqueImages,
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h
        }, { onConflict: 'company_id' });
    }

    const processingTime = Date.now() - startTime;

    return jsonResponse({
      success: true,
      data: {
        images: uniqueImages,
        sources,
        metadata: {
          totalImages: uniqueImages.length,
          pagesScraped: sources.length,
          processingTime,
        },
      },
    });

  } catch (error) {
    console.error('Scrape Press Images Error:', error);
    return jsonResponse({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message }
    }, { status: 500 });
  }
});

// Helper: Extract images from HTML
function extractImages(doc: any, pageUrl: string, filter: any): any[] {
  const images: any[] = [];

  // Target selectors for press images
  const selectors = [
    '.press-image',
    '.media-image',
    '.pressbilder img',
    '.gallery img',
    'article img',
    '.content img',
    'img[data-press]',
  ];

  const imgElements = doc.querySelectorAll(selectors.join(', '));

  for (const img of imgElements) {
    const src = img.getAttribute('src') || img.getAttribute('data-src');
    if (!src) continue;

    // Build absolute URL
    const absoluteUrl = new URL(src, pageUrl).toString();

    // Apply filters
    if (filter.formats && filter.formats.length > 0) {
      const format = absoluteUrl.split('.').pop()?.toLowerCase();
      if (!filter.formats.includes(format)) continue;
    }

    // Extract metadata
    const caption = img.getAttribute('alt') || img.getAttribute('title') || '';
    const width = parseInt(img.getAttribute('width') || '0', 10);
    const height = parseInt(img.getAttribute('height') || '0', 10);

    // Apply size filter
    if (filter.minWidth && width < filter.minWidth) continue;
    if (filter.minHeight && height < filter.minHeight) continue;

    // Get surrounding context
    const parent = img.parentElement;
    const context = parent?.textContent?.trim().substring(0, 200) || '';

    images.push({
      url: absoluteUrl,
      downloadUrl: absoluteUrl,
      thumbnail: absoluteUrl, // TODO: Generate thumbnail
      caption,
      title: caption,
      width: width || undefined,
      height: height || undefined,
      format: absoluteUrl.split('.').pop()?.toLowerCase() || 'unknown',
      context,
    });
  }

  return images;
}

// Helper: Deduplicate images by URL
function deduplicateImages(images: any[]): any[] {
  const seen = new Set<string>();
  const unique: any[] = [];

  for (const img of images) {
    if (!seen.has(img.url)) {
      seen.add(img.url);
      unique.push(img);
    }
  }

  return unique;
}

function corsResponse() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

function jsonResponse(data: unknown, options?: { status?: number }) {
  return new Response(JSON.stringify(data), {
    status: options?.status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

### 7.4 Rate Limiting

- **Per user:** 30 requests/timme
- **Per domain:** 10 requests/timme (för att inte överbelasta företags servrar)

---

## BATCH 3: AUTOMATISERING & SÄKERHET

---

## 8. EDGE FUNCTION: `solve-captcha`

**Syfte:** Lösa CAPTCHA med NopeCHA API

### 8.1 Input Schema

```typescript
interface SolveCaptchaRequest {
  type: 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'funcaptcha';
  sitekey: string;                // CAPTCHA site key
  pageUrl: string;                // URL där CAPTCHA visas
  action?: string;                // För reCAPTCHA v3
  data?: Record<string, any>;     // Extra data för specific CAPTCHA types
}
```

### 8.2 Output Schema

```typescript
interface SolveCaptchaResponse {
  success: boolean;
  data?: {
    token: string;                // CAPTCHA solution token
    solvedAt: string;
    solveTime: number;            // ms
    cost: number;                 // SEK
  };
  error?: {
    code: string;
    message: string;
  };
}
```

### 8.3 Implementation

```typescript
// supabase/functions/solve-captcha/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const NOPECHA_API_KEY = Deno.env.get('NOPECHA_API_KEY');
const NOPECHA_BASE_URL = 'https://api.nopecha.com';

// NopeCHA pricing (approx)
const NOPECHA_COST_PER_SOLVE = 0.05; // SEK

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Auth check
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' }
      }, { status: 401 });
    }

    const { type, sitekey, pageUrl, action, data: extraData } = await req.json();

    if (!type || !sitekey || !pageUrl) {
      return jsonResponse({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'type, sitekey, and pageUrl are required' }
      }, { status: 400 });
    }

    // Rate limit check
    const rateLimitKey = `captcha:${user.id}`;
    const isAllowed = await checkRateLimit(supabase, rateLimitKey, 'solve-captcha', 20, 60);
    if (!isAllowed) {
      return jsonResponse({
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Max 20 CAPTCHAs per hour' }
      }, { status: 429 });
    }

    const startTime = Date.now();

    // Create CAPTCHA task
    const taskResponse = await fetch(`${NOPECHA_BASE_URL}/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NOPECHA_API_KEY}`,
      },
      body: JSON.stringify({
        type,
        sitekey,
        url: pageUrl,
        action,
        ...extraData,
      }),
    });

    if (!taskResponse.ok) {
      const error = await taskResponse.json();
      throw new Error(`NopeCHA error: ${error.message || taskResponse.statusText}`);
    }

    const taskData = await taskResponse.json();
    const taskId = taskData.data;

    // Poll for solution
    let solution = null;
    const maxAttempts = 60; // 60 seconds timeout
    const pollInterval = 1000; // 1 second

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(pollInterval);

      const resultResponse = await fetch(`${NOPECHA_BASE_URL}/task/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${NOPECHA_API_KEY}`,
        },
      });

      if (!resultResponse.ok) continue;

      const resultData = await resultResponse.json();

      if (resultData.data && resultData.data !== 'processing') {
        solution = resultData.data;
        break;
      }
    }

    if (!solution) {
      throw new Error('CAPTCHA solving timed out');
    }

    const solveTime = Date.now() - startTime;

    // Log usage
    await supabase.from('budget_logs').insert({
      user_id: user.id,
      service: 'nopecha',
      operation: 'solve-captcha',
      cost_sek: NOPECHA_COST_PER_SOLVE,
      metadata: {
        type,
        sitekey,
        pageUrl,
        solveTime,
      },
    });

    // Increment rate limit
    await supabase.rpc('increment_rate_limit', {
      p_key: rateLimitKey,
      p_endpoint: 'solve-captcha',
      p_window_minutes: 60,
    });

    return jsonResponse({
      success: true,
      data: {
        token: solution,
        solvedAt: new Date().toISOString(),
        solveTime,
        cost: NOPECHA_COST_PER_SOLVE,
      },
    });

  } catch (error) {
    console.error('Solve CAPTCHA Error:', error);
    return jsonResponse({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message }
    }, { status: 500 });
  }
});

async function checkRateLimit(
  supabase: any,
  key: string,
  endpoint: string,
  maxRequests: number,
  windowMinutes: number
): Promise<boolean> {
  const windowStart = new Date();
  windowStart.setMinutes(windowStart.getMinutes() - windowMinutes);

  const { data } = await supabase
    .from('rate_limits')
    .select('request_count')
    .eq('key', key)
    .eq('endpoint', endpoint)
    .gte('window_start', windowStart.toISOString())
    .single();

  return !data || data.request_count < maxRequests;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function corsResponse() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

function jsonResponse(data: unknown, options?: { status?: number }) {
  return new Response(JSON.stringify(data), {
    status: options?.status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

### 8.4 Miljövariabler

```bash
NOPECHA_API_KEY=nopecha_xxx  # NopeCHA API key
```

### 8.5 Rate Limiting

- **Per user:** 20 CAPTCHAs/timme, 100/dag
- **Cost cap:** Max 50 SEK/dag per användare

---

## 9. EDGE FUNCTION: `fetch-bolagsverket-protocol`

**Syfte:** Hämta och köpa bolagsstämmoprotokoll från Bolagsverket

### 9.1 Input Schema

```typescript
interface FetchBolagsverketProtocolRequest {
  orgnr: string;                  // Organisationsnummer
  year?: number;                  // Specifikt år (optional)
  autoPurchase?: boolean;         // Automatiskt köpa protokoll
  maxCost?: number;               // Max kostnad i SEK
}
```

### 9.2 Output Schema

```typescript
interface FetchBolagsverketProtocolResponse {
  success: boolean;
  data?: {
    protocols: Array<{
      year: number;
      type: string;               // 'bolagsstämma', 'extra bolagsstämma'
      date: string;
      available: boolean;
      cost: number;               // SEK
      documentId?: string;
      pdfUrl?: string;            // Om redan köpt
      purchased: boolean;
    }>;
    totalCost: number;
    purchased: number;
    metadata: {
      fetchedAt: string;
      processingTime: number;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}
```

### 9.3 Implementation

```typescript
// supabase/functions/fetch-bolagsverket-protocol/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const BOLAGSVERKET_BASE_URL = 'https://www.bolagsverket.se';
const PROTOCOL_COST = 100; // SEK per protokoll (approximate)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Auth check
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' }
      }, { status: 401 });
    }

    const {
      orgnr,
      year,
      autoPurchase = false,
      maxCost = 500, // Default max 500 SEK
    } = await req.json();

    if (!orgnr) {
      return jsonResponse({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'orgnr is required' }
      }, { status: 400 });
    }

    const startTime = Date.now();

    // 1. Search for protocols on Bolagsverket
    const searchUrl = `${BOLAGSVERKET_BASE_URL}/sok/foretagsinformation/${orgnr}/handlingar`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch from Bolagsverket: ${response.status}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    if (!doc) {
      throw new Error('Failed to parse HTML');
    }

    // 2. Extract available protocols
    const protocols: any[] = [];
    const protocolElements = doc.querySelectorAll('.document-item, .protocol-item');

    for (const element of protocolElements) {
      const titleEl = element.querySelector('.document-title, .title');
      const dateEl = element.querySelector('.document-date, .date');
      const costEl = element.querySelector('.document-cost, .price');
      const downloadEl = element.querySelector('a[href*="download"], a[href*="pdf"]');

      const title = titleEl?.textContent.trim() || '';
      const date = dateEl?.textContent.trim() || '';
      const costText = costEl?.textContent.trim() || '';
      const downloadUrl = downloadEl?.getAttribute('href') || '';

      // Filter for protocols only
      if (!title.toLowerCase().includes('stämmoprotokoll')) continue;

      // Extract year
      const yearMatch = date.match(/\d{4}/);
      const protocolYear = yearMatch ? parseInt(yearMatch[0], 10) : null;

      // Skip if year filter specified and doesn't match
      if (year && protocolYear !== year) continue;

      // Parse cost
      const costMatch = costText.match(/(\d+)/);
      const cost = costMatch ? parseInt(costMatch[0], 10) : PROTOCOL_COST;

      protocols.push({
        year: protocolYear,
        type: title.includes('extra') ? 'extra bolagsstämma' : 'bolagsstämma',
        date,
        available: !!downloadUrl,
        cost,
        documentId: downloadUrl.split('/').pop() || '',
        pdfUrl: downloadUrl ? new URL(downloadUrl, BOLAGSVERKET_BASE_URL).toString() : undefined,
        purchased: false,
      });
    }

    // 3. Auto-purchase if enabled
    let totalCost = 0;
    let purchased = 0;

    if (autoPurchase) {
      for (const protocol of protocols) {
        if (!protocol.available || protocol.pdfUrl) continue;
        if (totalCost + protocol.cost > maxCost) break;

        // TODO: Implement actual purchase flow
        // This would require:
        // 1. BankID authentication
        // 2. Payment integration
        // 3. Document download

        // For now, just mark as available to purchase
        protocol.purchased = false;
        totalCost += protocol.cost;
      }
    }

    // 4. Save to database
    for (const protocol of protocols) {
      await supabase.from('bolagsverket_protocols').upsert({
        orgnr,
        year: protocol.year,
        type: protocol.type,
        date: protocol.date,
        cost: protocol.cost,
        pdf_url: protocol.pdfUrl,
        purchased: protocol.purchased,
        fetched_at: new Date().toISOString(),
      }, { onConflict: 'orgnr,year,type' });
    }

    const processingTime = Date.now() - startTime;

    return jsonResponse({
      success: true,
      data: {
        protocols,
        totalCost,
        purchased,
        metadata: {
          fetchedAt: new Date().toISOString(),
          processingTime,
        },
      },
    });

  } catch (error) {
    console.error('Fetch Bolagsverket Protocol Error:', error);
    return jsonResponse({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message }
    }, { status: 500 });
  }
});

function corsResponse() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

function jsonResponse(data: unknown, options?: { status?: number }) {
  return new Response(JSON.stringify(data), {
    status: options?.status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

### 9.4 Databas-schema

```sql
-- Table: bolagsverket_protocols
CREATE TABLE public.bolagsverket_protocols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Company info
  orgnr TEXT NOT NULL,
  company_name TEXT,

  -- Protocol info
  year INTEGER NOT NULL,
  type TEXT NOT NULL,
  date TEXT,

  -- Purchase info
  cost DECIMAL(10,2),
  purchased BOOLEAN DEFAULT false,
  purchased_at TIMESTAMPTZ,
  pdf_url TEXT,
  pdf_stored_at TEXT, -- Supabase Storage path

  -- Metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraint
  UNIQUE(orgnr, year, type)
);

-- Indexes
CREATE INDEX idx_bolagsverket_protocols_orgnr ON bolagsverket_protocols(orgnr);
CREATE INDEX idx_bolagsverket_protocols_year ON bolagsverket_protocols(year DESC);
CREATE INDEX idx_bolagsverket_protocols_purchased ON bolagsverket_protocols(purchased);

-- RLS
ALTER TABLE bolagsverket_protocols ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all protocols"
  ON bolagsverket_protocols
  FOR SELECT
  USING (true);

CREATE POLICY "System can manage protocols"
  ON bolagsverket_protocols
  FOR ALL
  USING (false); -- Only via service role
```

---

## 10. EDGE FUNCTION: `budget-manager`

**Syfte:** Spåra och hantera API-utgifter

### 10.1 Input Schema

```typescript
interface BudgetManagerRequest {
  action: 'get_summary' | 'set_limit' | 'get_history';
  period?: 'day' | 'week' | 'month';
  service?: string;               // Filter by service
  dailyLimit?: number;            // SEK (for set_limit action)
  monthlyLimit?: number;          // SEK (for set_limit action)
}
```

### 10.2 Output Schema

```typescript
interface BudgetManagerResponse {
  success: boolean;
  data?: {
    summary?: {
      today: number;              // SEK spent today
      week: number;               // SEK spent this week
      month: number;              // SEK spent this month
      byService: Record<string, number>; // Breakdown by service
      limits: {
        daily: number;
        monthly: number;
      };
      remainingDaily: number;
      remainingMonthly: number;
    };
    history?: Array<{
      date: string;
      service: string;
      operation: string;
      cost: number;
      tokensInput?: number;
      tokensOutput?: number;
    }>;
  };
  error?: {
    code: string;
    message: string;
  };
}
```

### 10.3 Implementation

```typescript
// supabase/functions/budget-manager/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Auth check
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' }
      }, { status: 401 });
    }

    const { action, period = 'day', service, dailyLimit, monthlyLimit } = await req.json();

    if (action === 'set_limit') {
      // Set budget limits
      await supabase
        .from('user_budget_limits')
        .upsert({
          user_id: user.id,
          daily_limit: dailyLimit,
          monthly_limit: monthlyLimit,
        }, { onConflict: 'user_id' });

      return jsonResponse({
        success: true,
        data: {
          summary: {
            limits: {
              daily: dailyLimit,
              monthly: monthlyLimit,
            },
          },
        },
      });
    }

    if (action === 'get_history') {
      // Get spending history
      const { data: history } = await supabase
        .from('budget_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);

      return jsonResponse({
        success: true,
        data: {
          history: (history || []).map(log => ({
            date: log.created_at,
            service: log.service,
            operation: log.operation,
            cost: log.cost_sek,
            tokensInput: log.tokens_input,
            tokensOutput: log.tokens_output,
          })),
        },
      });
    }

    // Default: get_summary
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Query spending
    let query = supabase
      .from('budget_logs')
      .select('service, cost_sek')
      .eq('user_id', user.id);

    if (service) {
      query = query.eq('service', service);
    }

    const { data: logs } = await query;

    const spendingByPeriod = {
      today: 0,
      week: 0,
      month: 0,
    };

    const byService: Record<string, number> = {};

    (logs || []).forEach(log => {
      const logDate = new Date(log.created_at);
      const cost = log.cost_sek || 0;

      if (logDate >= startOfDay) spendingByPeriod.today += cost;
      if (logDate >= startOfWeek) spendingByPeriod.week += cost;
      if (logDate >= startOfMonth) spendingByPeriod.month += cost;

      byService[log.service] = (byService[log.service] || 0) + cost;
    });

    // Get limits
    const { data: limits } = await supabase
      .from('user_budget_limits')
      .select('*')
      .eq('user_id', user.id)
      .single();

    const dailyLimitValue = limits?.daily_limit || 100;
    const monthlyLimitValue = limits?.monthly_limit || 1000;

    return jsonResponse({
      success: true,
      data: {
        summary: {
          today: Math.round(spendingByPeriod.today * 100) / 100,
          week: Math.round(spendingByPeriod.week * 100) / 100,
          month: Math.round(spendingByPeriod.month * 100) / 100,
          byService,
          limits: {
            daily: dailyLimitValue,
            monthly: monthlyLimitValue,
          },
          remainingDaily: Math.max(0, dailyLimitValue - spendingByPeriod.today),
          remainingMonthly: Math.max(0, monthlyLimitValue - spendingByPeriod.month),
        },
      },
    });

  } catch (error) {
    console.error('Budget Manager Error:', error);
    return jsonResponse({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message }
    }, { status: 500 });
  }
});

function corsResponse() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

function jsonResponse(data: unknown, options?: { status?: number }) {
  return new Response(JSON.stringify(data), {
    status: options?.status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

### 10.4 Databas-schema

```sql
-- Table: budget_logs (shared by all services)
CREATE TABLE public.budget_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Service info
  service TEXT NOT NULL, -- 'anthropic', 'nopecha', 'twilio', etc.
  operation TEXT NOT NULL, -- 'generate-article', 'parse-pdf', 'solve-captcha'

  -- Cost tracking
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_sek DECIMAL(10,2) NOT NULL,

  -- Metadata
  metadata JSONB,

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: user_budget_limits
CREATE TABLE public.user_budget_limits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  daily_limit DECIMAL(10,2) DEFAULT 100,
  monthly_limit DECIMAL(10,2) DEFAULT 1000,

  -- Alert thresholds (%)
  alert_threshold_daily INTEGER DEFAULT 80,
  alert_threshold_monthly INTEGER DEFAULT 80,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_budget_logs_user_id ON budget_logs(user_id);
CREATE INDEX idx_budget_logs_service ON budget_logs(service);
CREATE INDEX idx_budget_logs_created_at ON budget_logs(created_at DESC);

-- RLS
ALTER TABLE budget_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own logs"
  ON budget_logs
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "System can insert logs"
  ON budget_logs
  FOR INSERT
  WITH CHECK (false); -- Only via service role

ALTER TABLE user_budget_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own limits"
  ON user_budget_limits
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own limits"
  ON user_budget_limits
  FOR ALL
  USING (user_id = auth.uid());
```

---

## SAMMANFATTNING

### Nya Edge Functions (BATCH 2 & 3)

| Function | Syfte | Inputs | Key Features |
|----------|-------|--------|--------------|
| **generate-article** | Generera nyhetsartiklar med Claude | Company ID, article type | AI-genererad text, pressbilder, kostnadsberäkning |
| **parse-pdf** | PDF-analys med Claude | PDF URL/base64, analysis type | Text extraction, AI-sammanfattning, Q&A |
| **scrape-press-images** | Hitta pressbilder | Website URL, filters | Auto-detect /press pages, image metadata |
| **solve-captcha** | CAPTCHA-lösning | CAPTCHA type, sitekey | NopeCHA integration, async polling |
| **fetch-bolagsverket-protocol** | Hämta protokoll | Orgnr, year | Scraping, auto-purchase flow |
| **budget-manager** | Budget-tracking | Action, period | Spending summary, limits, history |

### Gemensamma Databas-tabeller

```sql
-- Används av flera functions
CREATE TABLE budget_logs (...)         -- Alla API-kostnader
CREATE TABLE user_budget_limits (...)  -- Budgetgränser
CREATE TABLE generated_articles (...)  -- Sparade artiklar
CREATE TABLE bolagsverket_protocols (...) -- Protokoll-cache
```

### Miljövariabler (Sammanfattning)

```bash
# Claude AI
ANTHROPIC_API_KEY=sk-ant-xxx

# NopeCHA
NOPECHA_API_KEY=nopecha_xxx

# Supabase (redan konfigurerade)
SUPABASE_URL=xxx
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

### Rate Limiting (Översikt)

| Function | Per User Limit |
|----------|---------------|
| generate-article | 10/h, 50/dag |
| parse-pdf | 20/h, 100/dag |
| scrape-press-images | 30/h |
| solve-captcha | 20/h, 100/dag |
| fetch-bolagsverket-protocol | 10/h |
| budget-manager | Unlimited (read-only) |

### Säkerhetsöverväganden

1. **Authentication** - Alla endpoints kräver valid JWT token
2. **Rate Limiting** - Per-user limits för att förhindra missbruk
3. **Budget Caps** - Automatiska budgetgränser (default 100 SEK/dag)
4. **Input Validation** - Validering av alla inputs (URL, phone, etc.)
5. **RLS Policies** - Row Level Security på alla tabeller
6. **Audit Logging** - Alla API-anrop loggas i `budget_logs`

### Kostnadskalkylering (Approximate)

| Service | Operation | Cost/Request |
|---------|-----------|--------------|
| Anthropic Claude | Generate article (500 ord) | 0.30-0.50 SEK |
| Anthropic Claude | Parse PDF (10 sidor) | 0.20-0.40 SEK |
| NopeCHA | Solve CAPTCHA | 0.05 SEK |
| Bolagsverket | Köp protokoll | 100 SEK |

### Next Steps

1. Implementera Edge Functions i `/supabase/functions/`
2. Köra databas-migrationer
3. Konfigurera miljövariabler (secrets)
4. Testa endpoints med curl/Postman
5. Integrera med frontend dashboard

---

**Filer att skapa:**

```
/supabase/functions/generate-article/index.ts
/supabase/functions/parse-pdf/index.ts
/supabase/functions/scrape-press-images/index.ts
/supabase/functions/solve-captcha/index.ts
/supabase/functions/fetch-bolagsverket-protocol/index.ts
/supabase/functions/budget-manager/index.ts
/supabase/migrations/002_batch_2_3_schema.sql
```

**Dokumentation:** `/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/docs/EDGE-FUNCTIONS-BATCH-2-3-DESIGN.md`
