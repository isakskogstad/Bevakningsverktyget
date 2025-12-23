# Supabase Edge Functions Design - Journalist Dashboard
> Backend-arkitektur för bevakningsverktyget med fokus på CORS-proxy, caching och säkerhet

**Skapad:** 2025-12-19
**Arkitekt:** backend-architect
**Stack:** Supabase Edge Functions (Deno), PostgreSQL, Row Level Security

---

## 1. ARKITEKTURÖVERSIKT

### System Context

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Pages (Statisk)                    │
│                  Journalist Dashboard Frontend               │
└──────────────────┬──────────────────────────────────────────┘
                   │ HTTPS
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Supabase Edge Functions (Deno)                  │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐    │
│  │ rss-proxy    │  │ mynewsdesk    │  │ send-sms     │    │
│  │              │  │ -proxy        │  │              │    │
│  └──────────────┘  └───────────────┘  └──────────────┘    │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase PostgreSQL                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Tables: rss_feeds, bookmarks, keyword_alerts,        │  │
│  │         sms_logs, pressroom_cache, loop_table,       │  │
│  │         poit_announcements, news_articles            │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Stateless Functions** - Alla Edge Functions är stateless, state i PostgreSQL
2. **Cache-First** - Aggressiv caching för externa API-anrop
3. **Rate Limiting** - Per-användare och per-endpoint rate limiting
4. **Security** - All känslig data i environment variables
5. **Error Handling** - Strukturerad error handling med retry logic
6. **Audit Logging** - All aktivitet loggas för transparens

---

## 2. DATABAS-SCHEMA

### 2.1 Nya Tabeller

#### `rss_feeds` - Konfigurerade RSS-feeds

```sql
CREATE TABLE public.rss_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Metadata
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  description TEXT,

  -- Konfiguration
  enabled BOOLEAN DEFAULT true,
  check_interval_minutes INTEGER DEFAULT 60,

  -- Filtering
  keywords TEXT[], -- Nyckelord att matcha mot
  exclude_keywords TEXT[], -- Nyckelord att exkludera

  -- Cache
  last_fetched_at TIMESTAMPTZ,
  last_error TEXT,
  error_count INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Index för performance
CREATE INDEX idx_rss_feeds_enabled ON rss_feeds(enabled);
CREATE INDEX idx_rss_feeds_last_fetched ON rss_feeds(last_fetched_at);
CREATE INDEX idx_rss_feeds_keywords ON rss_feeds USING GIN(keywords);

-- Trigger för updated_at
CREATE TRIGGER update_rss_feeds_updated_at
  BEFORE UPDATE ON rss_feeds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

#### `rss_articles` - Cachade RSS-artiklar

```sql
CREATE TABLE public.rss_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relation
  feed_id UUID NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,

  -- Artikel-data
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  description TEXT,
  content TEXT,
  pub_date TIMESTAMPTZ,
  author TEXT,

  -- Metadata
  guid TEXT UNIQUE, -- RSS item GUID
  raw_xml JSONB, -- Full XML item för referens

  -- Matching
  matched_keywords TEXT[],
  relevance_score DECIMAL(3,2), -- 0.00-1.00

  -- Status
  read BOOLEAN DEFAULT false,
  bookmarked BOOLEAN DEFAULT false,

  -- Timestamps
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_rss_articles_feed_id ON rss_articles(feed_id);
CREATE INDEX idx_rss_articles_pub_date ON rss_articles(pub_date DESC);
CREATE INDEX idx_rss_articles_matched_keywords ON rss_articles USING GIN(matched_keywords);
CREATE INDEX idx_rss_articles_bookmarked ON rss_articles(bookmarked) WHERE bookmarked = true;
CREATE UNIQUE INDEX idx_rss_articles_guid ON rss_articles(guid);
```

#### `bookmarks` - Bokmärken

```sql
CREATE TABLE public.bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Användare
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Bokmärke-data
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,

  -- Typ
  type TEXT NOT NULL CHECK (type IN ('rss_article', 'poit_announcement', 'company', 'other')),
  reference_id UUID, -- ID till relaterad entitet

  -- Organisering
  tags TEXT[],
  folder TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_bookmarks_user_id ON bookmarks(user_id);
CREATE INDEX idx_bookmarks_type ON bookmarks(type);
CREATE INDEX idx_bookmarks_tags ON bookmarks USING GIN(tags);
CREATE INDEX idx_bookmarks_created_at ON bookmarks(created_at DESC);
```

#### `keyword_alerts` - Nyckelordsbevakning

```sql
CREATE TABLE public.keyword_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Användare
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Alert-konfiguration
  name TEXT NOT NULL,
  keywords TEXT[] NOT NULL,
  exclude_keywords TEXT[],

  -- Notifikations-inställningar
  notify_email BOOLEAN DEFAULT false,
  notify_sms BOOLEAN DEFAULT false,
  notify_dashboard BOOLEAN DEFAULT true,

  -- Filtrering
  sources TEXT[] DEFAULT ARRAY['rss', 'poit', 'mynewsdesk'],
  company_ids UUID[], -- Specifika företag att bevaka

  -- Status
  enabled BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_keyword_alerts_user_id ON keyword_alerts(user_id);
CREATE INDEX idx_keyword_alerts_enabled ON keyword_alerts(enabled);
CREATE INDEX idx_keyword_alerts_keywords ON keyword_alerts USING GIN(keywords);
```

#### `keyword_alert_matches` - Alert-matchningar

```sql
CREATE TABLE public.keyword_alert_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relation
  alert_id UUID NOT NULL REFERENCES keyword_alerts(id) ON DELETE CASCADE,

  -- Match-data
  source TEXT NOT NULL, -- 'rss', 'poit', 'mynewsdesk'
  source_id UUID, -- ID i source-tabell
  title TEXT NOT NULL,
  url TEXT,
  matched_keywords TEXT[],

  -- Status
  read BOOLEAN DEFAULT false,
  dismissed BOOLEAN DEFAULT false,

  -- Metadata
  matched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_alert_matches_alert_id ON keyword_alert_matches(alert_id);
CREATE INDEX idx_alert_matches_read ON keyword_alert_matches(read);
CREATE INDEX idx_alert_matches_matched_at ON keyword_alert_matches(matched_at DESC);
```

#### `sms_logs` - SMS-loggning

```sql
CREATE TABLE public.sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Användare
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- SMS-data
  to_phone TEXT NOT NULL,
  message TEXT NOT NULL,

  -- Twilio response
  twilio_sid TEXT UNIQUE,
  status TEXT, -- 'queued', 'sent', 'delivered', 'failed'
  error_code TEXT,
  error_message TEXT,

  -- Rate limiting
  rate_limit_key TEXT, -- För rate limiting per användare

  -- Metadata
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,

  -- Kostnad (för budgetuppföljning)
  cost_sek DECIMAL(10,2)
);

-- Index
CREATE INDEX idx_sms_logs_user_id ON sms_logs(user_id);
CREATE INDEX idx_sms_logs_sent_at ON sms_logs(sent_at DESC);
CREATE INDEX idx_sms_logs_status ON sms_logs(status);
CREATE INDEX idx_sms_logs_rate_limit_key ON sms_logs(rate_limit_key, sent_at);
```

#### `pressroom_cache` - MyNewsdesk cache

```sql
CREATE TABLE public.pressroom_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Company info
  company_id UUID REFERENCES loop_table(id),
  company_name TEXT,
  pressroom_url TEXT NOT NULL,

  -- Cached data
  press_releases JSONB[], -- Array av pressreleaser
  images JSONB[], -- Array av bilder

  -- Cache metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,

  -- Error tracking
  fetch_error TEXT,
  fetch_attempts INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_pressroom_cache_company_id ON pressroom_cache(company_id);
CREATE INDEX idx_pressroom_cache_expires_at ON pressroom_cache(expires_at);
CREATE INDEX idx_pressroom_cache_pressroom_url ON pressroom_cache(pressroom_url);

-- Unique constraint på company (en cache-post per företag)
CREATE UNIQUE INDEX idx_pressroom_cache_company_unique ON pressroom_cache(company_id);
```

#### `rate_limits` - Rate limiting tracking

```sql
CREATE TABLE public.rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifikation
  key TEXT NOT NULL, -- user_id:endpoint eller ip:endpoint
  endpoint TEXT NOT NULL,

  -- Tracking
  request_count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  window_end TIMESTAMPTZ,

  -- Metadata
  last_request_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE UNIQUE INDEX idx_rate_limits_key_endpoint ON rate_limits(key, endpoint, window_start);
CREATE INDEX idx_rate_limits_window_end ON rate_limits(window_end);

-- Auto-cleanup av gamla rate limit poster
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM rate_limits
  WHERE window_end < NOW() - INTERVAL '1 hour';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cleanup_rate_limits
  AFTER INSERT ON rate_limits
  EXECUTE FUNCTION cleanup_old_rate_limits();
```

### 2.2 Helper Functions

```sql
-- Helper: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper: Calculate relevance score based on keyword matches
CREATE OR REPLACE FUNCTION calculate_relevance_score(
  content TEXT,
  keywords TEXT[]
)
RETURNS DECIMAL(3,2) AS $$
DECLARE
  match_count INTEGER := 0;
  keyword TEXT;
  total_keywords INTEGER := array_length(keywords, 1);
BEGIN
  IF total_keywords IS NULL OR total_keywords = 0 THEN
    RETURN 0.0;
  END IF;

  FOREACH keyword IN ARRAY keywords
  LOOP
    IF content ILIKE '%' || keyword || '%' THEN
      match_count := match_count + 1;
    END IF;
  END LOOP;

  RETURN ROUND(match_count::DECIMAL / total_keywords::DECIMAL, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

## 3. EDGE FUNCTIONS DESIGN

### 3.1 Edge Function: `rss-proxy`

**Syfte:** Hämta och parsa externa RSS-feeds med keyword-matching och caching

#### Input Schema

```typescript
interface RSSProxyRequest {
  feedId?: string;           // Specifikt feed-ID (optional, annars alla enabled feeds)
  forceRefresh?: boolean;    // Ignorera cache
  keywords?: string[];       // Override keywords
}
```

#### Output Schema

```typescript
interface RSSProxyResponse {
  success: boolean;
  data?: {
    feed: {
      id: string;
      name: string;
      url: string;
    };
    articles: Array<{
      id: string;
      title: string;
      link: string;
      description: string;
      pubDate: string;
      matchedKeywords: string[];
      relevanceScore: number;
    }>;
    metadata: {
      fetchedAt: string;
      articleCount: number;
      newArticles: number;
      cacheHit: boolean;
    };
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

#### Implementation

```typescript
// supabase/functions/rss-proxy/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Parser from 'https://esm.sh/rss-parser@3.13.0';

const CACHE_TTL_MINUTES = 30;

serve(async (req) => {
  // CORS headers
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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { feedId, forceRefresh, keywords } = await req.json();

    // Get feed configuration
    let query = supabase
      .from('rss_feeds')
      .select('*')
      .eq('enabled', true);

    if (feedId) {
      query = query.eq('id', feedId);
    }

    const { data: feeds, error: feedError } = await query;

    if (feedError) throw feedError;
    if (!feeds || feeds.length === 0) {
      return jsonResponse({ success: false, error: { code: 'NO_FEEDS', message: 'No enabled feeds found' } });
    }

    const results = [];

    for (const feed of feeds) {
      // Check cache
      if (!forceRefresh && feed.last_fetched_at) {
        const cacheAge = Date.now() - new Date(feed.last_fetched_at).getTime();
        const cacheAgeMinutes = cacheAge / (1000 * 60);

        if (cacheAgeMinutes < CACHE_TTL_MINUTES) {
          // Return cached articles
          const { data: cachedArticles } = await supabase
            .from('rss_articles')
            .select('*')
            .eq('feed_id', feed.id)
            .order('pub_date', { ascending: false })
            .limit(50);

          results.push({
            feed: { id: feed.id, name: feed.name, url: feed.url },
            articles: cachedArticles || [],
            metadata: {
              fetchedAt: feed.last_fetched_at,
              articleCount: cachedArticles?.length || 0,
              newArticles: 0,
              cacheHit: true,
            },
          });
          continue;
        }
      }

      // Fetch fresh RSS feed
      try {
        const parser = new Parser();
        const rss = await parser.parseURL(feed.url);

        const articlesToInsert = [];
        const useKeywords = keywords || feed.keywords || [];

        for (const item of rss.items) {
          // Keyword matching
          const content = `${item.title} ${item.contentSnippet || item.description || ''}`.toLowerCase();
          const matchedKeywords = useKeywords.filter(kw =>
            content.includes(kw.toLowerCase())
          );

          // Exclude keywords
          const excludeKeywords = feed.exclude_keywords || [];
          const hasExcluded = excludeKeywords.some(kw =>
            content.includes(kw.toLowerCase())
          );

          if (hasExcluded) continue;

          // Calculate relevance
          const relevanceScore = matchedKeywords.length > 0
            ? matchedKeywords.length / useKeywords.length
            : 0;

          articlesToInsert.push({
            feed_id: feed.id,
            title: item.title,
            link: item.link,
            description: item.contentSnippet || item.description,
            content: item.content,
            pub_date: item.pubDate ? new Date(item.pubDate).toISOString() : null,
            author: item.creator || item.author,
            guid: item.guid || item.link,
            raw_xml: item,
            matched_keywords: matchedKeywords,
            relevance_score: relevanceScore,
          });
        }

        // Upsert articles (on conflict do nothing to avoid duplicates)
        if (articlesToInsert.length > 0) {
          await supabase
            .from('rss_articles')
            .upsert(articlesToInsert, { onConflict: 'guid', ignoreDuplicates: true });
        }

        // Update feed metadata
        await supabase
          .from('rss_feeds')
          .update({
            last_fetched_at: new Date().toISOString(),
            last_error: null,
            error_count: 0,
          })
          .eq('id', feed.id);

        results.push({
          feed: { id: feed.id, name: feed.name, url: feed.url },
          articles: articlesToInsert,
          metadata: {
            fetchedAt: new Date().toISOString(),
            articleCount: articlesToInsert.length,
            newArticles: articlesToInsert.length,
            cacheHit: false,
          },
        });

      } catch (error) {
        // Log error and continue
        await supabase
          .from('rss_feeds')
          .update({
            last_error: error.message,
            error_count: feed.error_count + 1,
          })
          .eq('id', feed.id);

        console.error(`Failed to fetch feed ${feed.url}:`, error);
      }
    }

    return jsonResponse({ success: true, data: results });

  } catch (error) {
    console.error('RSS Proxy Error:', error);
    return jsonResponse(
      { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } },
      { status: 500 }
    );
  }
});

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

**Cache-strategi:**
- **TTL:** 30 minuter default
- **Cache key:** `feed_id`
- **Invalidation:** Force refresh parameter, eller manuell invalidation
- **Storage:** PostgreSQL `rss_articles` tabell

**Rate Limiting:**
- **Per user:** 30 requests/hour
- **Per feed:** 1 request/30 minutes (via cache TTL)

---

### 3.2 Edge Function: `mynewsdesk-proxy`

**Syfte:** Scrapa pressreleaser och bilder från MyNewsdesk-företag

#### Input Schema

```typescript
interface MyNewsdeskProxyRequest {
  companyId?: string;        // Loop table company ID
  pressroomUrl: string;      // MyNewsdesk pressrum URL
  includeImages?: boolean;   // Hämta bilder också
  forceRefresh?: boolean;    // Ignorera cache
}
```

#### Output Schema

```typescript
interface MyNewsdeskProxyResponse {
  success: boolean;
  data?: {
    company: {
      id: string;
      name: string;
      pressroomUrl: string;
    };
    pressReleases: Array<{
      title: string;
      url: string;
      publishedAt: string;
      summary: string;
      image?: string;
    }>;
    images: Array<{
      url: string;
      caption: string;
      downloadUrl: string;
    }>;
    metadata: {
      fetchedAt: string;
      cacheHit: boolean;
      expiresAt: string;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}
```

#### Implementation

```typescript
// supabase/functions/mynewsdesk-proxy/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const CACHE_TTL_HOURS = 24; // Cache pressreleases 24h

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { companyId, pressroomUrl, includeImages = true, forceRefresh = false } = await req.json();

    if (!pressroomUrl) {
      return jsonResponse({
        success: false,
        error: { code: 'MISSING_URL', message: 'pressroomUrl is required' }
      }, { status: 400 });
    }

    // Check rate limit
    const rateLimitKey = `mynewsdesk:${pressroomUrl}`;
    const isAllowed = await checkRateLimit(supabase, rateLimitKey, 10, 60); // 10 req/hour
    if (!isAllowed) {
      return jsonResponse({
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' }
      }, { status: 429 });
    }

    // Check cache
    if (!forceRefresh) {
      const { data: cached } = await supabase
        .from('pressroom_cache')
        .select('*')
        .eq('pressroom_url', pressroomUrl)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (cached) {
        return jsonResponse({
          success: true,
          data: {
            company: {
              id: cached.company_id,
              name: cached.company_name,
              pressroomUrl: cached.pressroom_url,
            },
            pressReleases: cached.press_releases || [],
            images: cached.images || [],
            metadata: {
              fetchedAt: cached.fetched_at,
              cacheHit: true,
              expiresAt: cached.expires_at,
            },
          },
        });
      }
    }

    // Fetch fresh data
    const response = await fetch(pressroomUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    if (!doc) {
      throw new Error('Failed to parse HTML');
    }

    // Scrape press releases
    const pressReleases = [];
    const releaseElements = doc.querySelectorAll('.press-release-item, .news-item, article');

    for (const element of releaseElements) {
      const titleEl = element.querySelector('h2, h3, .title');
      const linkEl = element.querySelector('a');
      const dateEl = element.querySelector('time, .date, .published');
      const summaryEl = element.querySelector('.summary, .excerpt, p');
      const imageEl = element.querySelector('img');

      if (titleEl && linkEl) {
        pressReleases.push({
          title: titleEl.textContent.trim(),
          url: new URL(linkEl.getAttribute('href'), pressroomUrl).toString(),
          publishedAt: dateEl?.getAttribute('datetime') || dateEl?.textContent || null,
          summary: summaryEl?.textContent.trim() || '',
          image: imageEl?.getAttribute('src') || null,
        });
      }
    }

    // Scrape images (if requested)
    const images = [];
    if (includeImages) {
      const imageElements = doc.querySelectorAll('.image-gallery img, .media-item img');

      for (const img of imageElements) {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        const caption = img.getAttribute('alt') || img.getAttribute('title') || '';

        if (src) {
          images.push({
            url: new URL(src, pressroomUrl).toString(),
            caption: caption,
            downloadUrl: new URL(src, pressroomUrl).toString(),
          });
        }
      }
    }

    // Get company info
    let companyName = '';
    if (companyId) {
      const { data: company } = await supabase
        .from('loop_table')
        .select('foretag')
        .eq('id', companyId)
        .single();
      companyName = company?.foretag || '';
    }

    // Cache result
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + CACHE_TTL_HOURS);

    await supabase
      .from('pressroom_cache')
      .upsert({
        company_id: companyId,
        company_name: companyName,
        pressroom_url: pressroomUrl,
        press_releases: pressReleases,
        images: images,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        fetch_error: null,
        fetch_attempts: 0,
      }, { onConflict: 'pressroom_url' });

    return jsonResponse({
      success: true,
      data: {
        company: {
          id: companyId,
          name: companyName,
          pressroomUrl: pressroomUrl,
        },
        pressReleases: pressReleases,
        images: images,
        metadata: {
          fetchedAt: new Date().toISOString(),
          cacheHit: false,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });

  } catch (error) {
    console.error('MyNewsdesk Proxy Error:', error);
    return jsonResponse({
      success: false,
      error: { code: 'SCRAPING_ERROR', message: error.message }
    }, { status: 500 });
  }
});

async function checkRateLimit(
  supabase: any,
  key: string,
  maxRequests: number,
  windowMinutes: number
): Promise<boolean> {
  const windowStart = new Date();
  windowStart.setMinutes(windowStart.getMinutes() - windowMinutes);

  const { data } = await supabase
    .from('rate_limits')
    .select('request_count')
    .eq('key', key)
    .eq('endpoint', 'mynewsdesk-proxy')
    .gte('window_start', windowStart.toISOString())
    .single();

  if (data && data.request_count >= maxRequests) {
    return false;
  }

  // Increment or create rate limit entry
  await supabase.rpc('increment_rate_limit', {
    p_key: key,
    p_endpoint: 'mynewsdesk-proxy',
    p_window_minutes: windowMinutes,
  });

  return true;
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

**Cache-strategi:**
- **TTL:** 24 timmar
- **Cache key:** `pressroom_url`
- **Invalidation:** Force refresh, eller manuell
- **Storage:** PostgreSQL `pressroom_cache` tabell

**Rate Limiting:**
- **Per pressrum:** 10 requests/hour
- **Global:** 100 requests/hour

---

### 3.3 Edge Function: `send-sms`

**Syfte:** Skicka SMS via Twilio med rate limiting och audit logging

#### Input Schema

```typescript
interface SendSMSRequest {
  to: string;                // Telefonnummer (E.164 format)
  message: string;           // SMS-meddelande
  alertId?: string;          // Optional: keyword alert ID som triggrade SMS
}
```

#### Output Schema

```typescript
interface SendSMSResponse {
  success: boolean;
  data?: {
    sid: string;             // Twilio message SID
    status: string;          // 'queued', 'sent', etc.
    to: string;
    sentAt: string;
  };
  error?: {
    code: string;
    message: string;
  };
}
```

#### Implementation

```typescript
// supabase/functions/send-sms/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

const SMS_RATE_LIMIT_PER_USER_HOURLY = 10;
const SMS_RATE_LIMIT_PER_USER_DAILY = 50;
const SMS_COST_SEK = 0.50; // Approximate cost per SMS

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Service role for auth bypass
    );

    // Get user from auth header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return jsonResponse({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' }
      }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' }
      }, { status: 401 });
    }

    const { to, message, alertId } = await req.json();

    // Validate input
    if (!to || !message) {
      return jsonResponse({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'to and message are required' }
      }, { status: 400 });
    }

    // Validate phone format (E.164)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(to)) {
      return jsonResponse({
        success: false,
        error: { code: 'INVALID_PHONE', message: 'Phone must be in E.164 format (+46xxxxxxxxx)' }
      }, { status: 400 });
    }

    // Check rate limits
    const rateLimitKey = `sms:${user.id}`;

    // Hourly limit
    const hourlyAllowed = await checkRateLimit(
      supabase,
      rateLimitKey,
      'send-sms',
      SMS_RATE_LIMIT_PER_USER_HOURLY,
      60
    );

    if (!hourlyAllowed) {
      return jsonResponse({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED_HOURLY',
          message: `Maximum ${SMS_RATE_LIMIT_PER_USER_HOURLY} SMS per hour`
        }
      }, { status: 429 });
    }

    // Daily limit
    const dailyAllowed = await checkRateLimit(
      supabase,
      rateLimitKey,
      'send-sms',
      SMS_RATE_LIMIT_PER_USER_DAILY,
      1440 // 24 hours
    );

    if (!dailyAllowed) {
      return jsonResponse({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED_DAILY',
          message: `Maximum ${SMS_RATE_LIMIT_PER_USER_DAILY} SMS per day`
        }
      }, { status: 429 });
    }

    // Send SMS via Twilio
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${twilioAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: to,
        From: TWILIO_PHONE_NUMBER,
        Body: message,
      }),
    });

    const twilioData = await twilioResponse.json();

    if (!twilioResponse.ok) {
      // Log failed SMS
      await supabase.from('sms_logs').insert({
        user_id: user.id,
        to_phone: to,
        message: message,
        status: 'failed',
        error_code: twilioData.code,
        error_message: twilioData.message,
        rate_limit_key: rateLimitKey,
        cost_sek: 0,
      });

      return jsonResponse({
        success: false,
        error: {
          code: 'TWILIO_ERROR',
          message: twilioData.message || 'Failed to send SMS'
        }
      }, { status: 500 });
    }

    // Log successful SMS
    await supabase.from('sms_logs').insert({
      user_id: user.id,
      to_phone: to,
      message: message,
      twilio_sid: twilioData.sid,
      status: twilioData.status,
      rate_limit_key: rateLimitKey,
      cost_sek: SMS_COST_SEK,
    });

    // Increment rate limit
    await supabase.rpc('increment_rate_limit', {
      p_key: rateLimitKey,
      p_endpoint: 'send-sms',
      p_window_minutes: 60,
    });

    return jsonResponse({
      success: true,
      data: {
        sid: twilioData.sid,
        status: twilioData.status,
        to: to,
        sentAt: new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error('Send SMS Error:', error);
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

**Rate Limiting:**
- **Per user:** 10 SMS/timme, 50 SMS/dag
- **Audit logging:** Alla SMS loggas i `sms_logs`
- **Cost tracking:** Kostnad per SMS sparas för budgetuppföljning

---

## 4. ROW LEVEL SECURITY (RLS) POLICIES

### 4.1 `rss_feeds`

```sql
-- Enable RLS
ALTER TABLE rss_feeds ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view all enabled feeds
CREATE POLICY "Users can view enabled feeds"
  ON rss_feeds
  FOR SELECT
  USING (enabled = true);

-- Policy: Admins can manage all feeds
CREATE POLICY "Admins can manage feeds"
  ON rss_feeds
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );
```

### 4.2 `rss_articles`

```sql
ALTER TABLE rss_articles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view all articles
CREATE POLICY "Users can view articles"
  ON rss_articles
  FOR SELECT
  USING (true);

-- Policy: Only system can insert/update articles
CREATE POLICY "System can manage articles"
  ON rss_articles
  FOR ALL
  USING (false); -- Only via Edge Functions with service role
```

### 4.3 `bookmarks`

```sql
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own bookmarks
CREATE POLICY "Users can view own bookmarks"
  ON bookmarks
  FOR SELECT
  USING (user_id = auth.uid());

-- Policy: Users can create their own bookmarks
CREATE POLICY "Users can create own bookmarks"
  ON bookmarks
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can update their own bookmarks
CREATE POLICY "Users can update own bookmarks"
  ON bookmarks
  FOR UPDATE
  USING (user_id = auth.uid());

-- Policy: Users can delete their own bookmarks
CREATE POLICY "Users can delete own bookmarks"
  ON bookmarks
  FOR DELETE
  USING (user_id = auth.uid());
```

### 4.4 `keyword_alerts`

```sql
ALTER TABLE keyword_alerts ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own alerts
CREATE POLICY "Users can view own alerts"
  ON keyword_alerts
  FOR SELECT
  USING (user_id = auth.uid());

-- Policy: Users can create their own alerts
CREATE POLICY "Users can create own alerts"
  ON keyword_alerts
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can update their own alerts
CREATE POLICY "Users can update own alerts"
  ON keyword_alerts
  FOR UPDATE
  USING (user_id = auth.uid());

-- Policy: Users can delete their own alerts
CREATE POLICY "Users can delete own alerts"
  ON keyword_alerts
  FOR DELETE
  USING (user_id = auth.uid());
```

### 4.5 `sms_logs`

```sql
ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own SMS logs
CREATE POLICY "Users can view own SMS logs"
  ON sms_logs
  FOR SELECT
  USING (user_id = auth.uid());

-- Policy: Only Edge Functions can insert SMS logs
CREATE POLICY "System can insert SMS logs"
  ON sms_logs
  FOR INSERT
  WITH CHECK (false); -- Only via service role
```

### 4.6 `pressroom_cache`

```sql
ALTER TABLE pressroom_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view all cached pressroom data
CREATE POLICY "Users can view pressroom cache"
  ON pressroom_cache
  FOR SELECT
  USING (true);

-- Policy: Only Edge Functions can manage cache
CREATE POLICY "System can manage pressroom cache"
  ON pressroom_cache
  FOR ALL
  USING (false); -- Only via service role
```

---

## 5. RATE LIMITING IMPLEMENTATION

### 5.1 Database Function

```sql
-- Function: Increment rate limit counter
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_key TEXT,
  p_endpoint TEXT,
  p_window_minutes INTEGER
)
RETURNS void AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
BEGIN
  v_window_start := NOW();
  v_window_end := NOW() + (p_window_minutes || ' minutes')::INTERVAL;

  INSERT INTO rate_limits (key, endpoint, request_count, window_start, window_end, last_request_at)
  VALUES (p_key, p_endpoint, 1, v_window_start, v_window_end, NOW())
  ON CONFLICT (key, endpoint, window_start)
  DO UPDATE SET
    request_count = rate_limits.request_count + 1,
    last_request_at = NOW();
END;
$$ LANGUAGE plpgsql;
```

### 5.2 TypeScript Helper

```typescript
// Reusable rate limit checker
export async function checkRateLimit(
  supabase: any,
  key: string,
  endpoint: string,
  maxRequests: number,
  windowMinutes: number
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const windowStart = new Date();
  windowStart.setMinutes(windowStart.getMinutes() - windowMinutes);

  const { data } = await supabase
    .from('rate_limits')
    .select('request_count, window_end')
    .eq('key', key)
    .eq('endpoint', endpoint)
    .gte('window_start', windowStart.toISOString())
    .order('window_start', { ascending: false })
    .limit(1)
    .single();

  const currentCount = data?.request_count || 0;
  const allowed = currentCount < maxRequests;
  const remaining = Math.max(0, maxRequests - currentCount);
  const resetAt = data?.window_end ? new Date(data.window_end) : new Date();

  return { allowed, remaining, resetAt };
}
```

---

## 6. CACHING STRATEGY

### 6.1 Cache Layers

```
┌─────────────────────────────────────────────┐
│  Frontend (Browser)                         │
│  - LocalStorage: User preferences           │
│  - SessionStorage: Temporary data           │
│  - Cache-Control: 5min for static assets    │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│  Edge Functions (Deno)                      │
│  - No caching (stateless)                   │
│  - Check PostgreSQL cache first             │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│  PostgreSQL (Cache Tables)                  │
│  - rss_articles: 30min TTL                  │
│  - pressroom_cache: 24h TTL                 │
│  - rate_limits: 1h TTL (auto-cleanup)       │
└─────────────────────────────────────────────┘
```

### 6.2 Cache Invalidation

```typescript
// Invalidate RSS cache
await supabase
  .from('rss_feeds')
  .update({ last_fetched_at: null })
  .eq('id', feedId);

// Invalidate pressroom cache
await supabase
  .from('pressroom_cache')
  .update({ expires_at: new Date().toISOString() })
  .eq('company_id', companyId);

// Clear old cache entries (run daily)
await supabase.rpc('cleanup_old_cache', {
  older_than_hours: 72
});
```

---

## 7. ERROR HANDLING PATTERNS

### 7.1 Structured Errors

```typescript
// Error types
type ErrorCode =
  | 'UNAUTHORIZED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_INPUT'
  | 'SCRAPING_ERROR'
  | 'INTERNAL_ERROR'
  | 'EXTERNAL_API_ERROR';

interface APIError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  timestamp: string;
  requestId?: string;
}

// Error factory
function createError(
  code: ErrorCode,
  message: string,
  details?: unknown
): APIError {
  return {
    code,
    message,
    details,
    timestamp: new Date().toISOString(),
    requestId: crypto.randomUUID(),
  };
}
```

### 7.2 Retry Logic

```typescript
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  backoffMs: number = 1000
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) {
        return response;
      }

      // Don't retry on client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Client error: ${response.status}`);
      }

      // Retry on server errors (5xx)
      if (attempt < maxRetries - 1) {
        await sleep(backoffMs * (attempt + 1)); // Exponential backoff
        continue;
      }

      throw new Error(`Server error: ${response.status}`);

    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }
      await sleep(backoffMs * (attempt + 1));
    }
  }

  throw new Error('Max retries exceeded');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 8. DEPLOYMENT CHECKLIST

### 8.1 Environment Variables

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Twilio
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+46xxxxxxxxx
```

### 8.2 Deploy Edge Functions

```bash
# Deploy all functions
supabase functions deploy rss-proxy
supabase functions deploy mynewsdesk-proxy
supabase functions deploy send-sms

# Set secrets
supabase secrets set TWILIO_ACCOUNT_SID=xxx
supabase secrets set TWILIO_AUTH_TOKEN=xxx
supabase secrets set TWILIO_PHONE_NUMBER=+46xxxxxxxxx
```

### 8.3 Database Migrations

```bash
# Apply schema
supabase db push

# Run seed data (if needed)
supabase db seed
```

---

## 9. TESTING STRATEGY

### 9.1 Unit Tests

```typescript
// Test RSS parsing
Deno.test('RSS parser handles malformed feed', async () => {
  const malformedXml = '<rss><channel></channel></rss>';
  // Test implementation
});

// Test rate limiting
Deno.test('Rate limit blocks after threshold', async () => {
  // Make 11 requests, expect 11th to fail
});
```

### 9.2 Integration Tests

```bash
# Test rss-proxy endpoint
curl -X POST https://xxx.supabase.co/functions/v1/rss-proxy \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"feedId":"xxx","forceRefresh":true}'

# Test mynewsdesk-proxy endpoint
curl -X POST https://xxx.supabase.co/functions/v1/mynewsdesk-proxy \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pressroomUrl":"https://www.mynewsdesk.com/se/company-name"}'

# Test send-sms endpoint
curl -X POST https://xxx.supabase.co/functions/v1/send-sms \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"+46700000000","message":"Test SMS"}'
```

---

## 10. MONITORING & OBSERVABILITY

### 10.1 Logging

```typescript
// Structured logging
console.log(JSON.stringify({
  level: 'info',
  timestamp: new Date().toISOString(),
  function: 'rss-proxy',
  event: 'feed_fetched',
  feedId: 'xxx',
  articleCount: 42,
  duration: 1234,
}));
```

### 10.2 Metrics to Track

- **RSS Proxy:**
  - Cache hit rate
  - Fetch duration per feed
  - Error rate per feed
  - Articles matched per keyword

- **MyNewsdesk Proxy:**
  - Scraping success rate
  - Cache hit rate
  - Response time

- **Send SMS:**
  - SMS sent per user per day
  - Delivery success rate
  - Cost per day
  - Rate limit violations

### 10.3 Alerts

```sql
-- Alert: High error rate on RSS feeds
SELECT
  name,
  url,
  error_count,
  last_error
FROM rss_feeds
WHERE error_count > 5
ORDER BY error_count DESC;

-- Alert: High SMS cost
SELECT
  user_id,
  COUNT(*) as sms_count,
  SUM(cost_sek) as total_cost
FROM sms_logs
WHERE sent_at > NOW() - INTERVAL '1 day'
GROUP BY user_id
HAVING SUM(cost_sek) > 50
ORDER BY total_cost DESC;
```

---

## 11. SECURITY CONSIDERATIONS

### 11.1 Input Validation

```typescript
// Validate phone number
function isValidE164Phone(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

// Validate URL
function isValidURL(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Sanitize HTML
function sanitizeHTML(html: string): string {
  // Remove script tags, event handlers, etc.
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '');
}
```

### 11.2 Rate Limiting Headers

```typescript
function rateLimitHeaders(
  remaining: number,
  resetAt: Date
): Record<string, string> {
  return {
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': resetAt.toISOString(),
    'Retry-After': Math.ceil((resetAt.getTime() - Date.now()) / 1000).toString(),
  };
}
```

### 11.3 CORS Configuration

```typescript
// Strict CORS for production
const ALLOWED_ORIGINS = [
  'https://your-dashboard.github.io',
  'http://localhost:3000', // Development only
];

function getCORSHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}
```

---

## 12. PERFORMANCE OPTIMIZATION

### 12.1 Database Indexes

```sql
-- Already defined above, but critical for performance:
CREATE INDEX idx_rss_articles_pub_date ON rss_articles(pub_date DESC);
CREATE INDEX idx_pressroom_cache_expires_at ON pressroom_cache(expires_at);
CREATE INDEX idx_rate_limits_window_end ON rate_limits(window_end);
```

### 12.2 Query Optimization

```typescript
// Use pagination for large result sets
const { data, error } = await supabase
  .from('rss_articles')
  .select('*')
  .eq('feed_id', feedId)
  .order('pub_date', { ascending: false })
  .range(0, 49); // First 50 results

// Use materialized views for complex aggregations
await supabase.rpc('get_feed_statistics', { feed_id: feedId });
```

### 12.3 Connection Pooling

```typescript
// Supabase handles connection pooling automatically
// But be mindful of connection limits (default: 60 for free tier)

// Use service role key for Edge Functions to bypass RLS overhead
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);
```

---

## SUMMARY

### Architecture Highlights

1. **3 Edge Functions** - rss-proxy, mynewsdesk-proxy, send-sms
2. **7 New Tables** - rss_feeds, rss_articles, bookmarks, keyword_alerts, keyword_alert_matches, sms_logs, pressroom_cache
3. **Comprehensive RLS** - All tables protected with Row Level Security
4. **Multi-Layer Caching** - PostgreSQL cache with TTL-based invalidation
5. **Rate Limiting** - Per-user and per-endpoint limits with audit logging
6. **Error Handling** - Structured errors with retry logic
7. **Audit Logging** - All SMS and API calls logged for transparency

### Key Design Decisions

- **Stateless Functions:** All Edge Functions are stateless, enabling horizontal scaling
- **Cache-First:** Aggressive caching reduces external API calls and improves response times
- **PostgreSQL as Cache:** Leverages Supabase's strength, no additional cache layer needed
- **Security by Default:** RLS on all tables, rate limiting on all endpoints
- **Audit Everything:** Complete audit trail for debugging and compliance

### Next Steps

1. Deploy database schema
2. Implement Edge Functions
3. Test with Postman/curl
4. Integrate with frontend
5. Monitor and optimize based on real usage

---

**Filer att skapa:**
- `/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/supabase/migrations/001_edge_functions_schema.sql`
- `/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/supabase/functions/rss-proxy/index.ts`
- `/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/supabase/functions/mynewsdesk-proxy/index.ts`
- `/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/supabase/functions/send-sms/index.ts`

**Kontakt:** [Din kontaktinfo]
**Projektmapp:** `/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/`
