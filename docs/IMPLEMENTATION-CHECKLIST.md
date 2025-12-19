# Implementation Checklist - Supabase Edge Functions

**Steg-för-steg implementation av backend för journalist-dashboard**

---

## PHASE 1: DATABASE SETUP

### 1.1 Apply Schema Migration

```bash
cd /Users/isak/Desktop/CLAUDE_CODE\ /projects/bevakningsverktyg/

# Logga in på Supabase
supabase login

# Link project (om inte redan gjort)
supabase link --project-ref [YOUR_PROJECT_REF]

# Apply migration
supabase db push supabase/migrations/001_edge_functions_schema.sql
```

**Verifiera:**
```sql
-- Kontrollera att alla tabeller finns
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'rss_feeds',
  'rss_articles',
  'bookmarks',
  'keyword_alerts',
  'keyword_alert_matches',
  'sms_logs',
  'pressroom_cache',
  'rate_limits'
);
-- Förväntat: 8 rader
```

### 1.2 Verifiera RLS Policies

```sql
-- Lista alla RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### 1.3 Test Seed Data

```sql
-- Kontrollera att RSS-feeds är seedade
SELECT name, url, enabled FROM rss_feeds;
-- Förväntat: 3 feeds (DI, Breakit, Affärsvärlden)
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

## PHASE 2: EDGE FUNCTIONS DEVELOPMENT

### 2.1 Skapa Edge Function: rss-proxy

```bash
# Skapa function directory
mkdir -p supabase/functions/rss-proxy

# Skapa index.ts (kopiera från design-doc)
touch supabase/functions/rss-proxy/index.ts
```

**Fil:** `supabase/functions/rss-proxy/index.ts`
- Kopiera implementation från `/docs/SUPABASE-EDGE-FUNCTIONS-DESIGN.md` (sektion 3.1)
- Se till att CORS headers är korrekta

**Dependencies (deno.json):**
```json
{
  "imports": {
    "supabase": "https://esm.sh/@supabase/supabase-js@2",
    "rss-parser": "https://esm.sh/rss-parser@3.13.0"
  }
}
```

**Deploy:**
```bash
supabase functions deploy rss-proxy
```

**Test:**
```bash
curl -X POST https://[PROJECT_REF].supabase.co/functions/v1/rss-proxy \
  -H "Authorization: Bearer [ANON_KEY]" \
  -H "Content-Type: application/json" \
  -d '{"forceRefresh": true}'
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

### 2.2 Skapa Edge Function: mynewsdesk-proxy

```bash
mkdir -p supabase/functions/mynewsdesk-proxy
touch supabase/functions/mynewsdesk-proxy/index.ts
```

**Fil:** `supabase/functions/mynewsdesk-proxy/index.ts`
- Kopiera implementation från design-doc (sektion 3.2)

**Dependencies (deno.json):**
```json
{
  "imports": {
    "supabase": "https://esm.sh/@supabase/supabase-js@2",
    "deno-dom": "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts"
  }
}
```

**Deploy:**
```bash
supabase functions deploy mynewsdesk-proxy
```

**Test:**
```bash
curl -X POST https://[PROJECT_REF].supabase.co/functions/v1/mynewsdesk-proxy \
  -H "Authorization: Bearer [ANON_KEY]" \
  -H "Content-Type: application/json" \
  -d '{"pressroomUrl":"https://www.mynewsdesk.com/se/[company]","includeImages":true}'
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

### 2.3 Skapa Edge Function: send-sms

```bash
mkdir -p supabase/functions/send-sms
touch supabase/functions/send-sms/index.ts
```

**Fil:** `supabase/functions/send-sms/index.ts`
- Kopiera implementation från design-doc (sektion 3.3)

**Dependencies (deno.json):**
```json
{
  "imports": {
    "supabase": "https://esm.sh/@supabase/supabase-js@2"
  }
}
```

**Set Secrets:**
```bash
supabase secrets set TWILIO_ACCOUNT_SID=[YOUR_SID]
supabase secrets set TWILIO_AUTH_TOKEN=[YOUR_TOKEN]
supabase secrets set TWILIO_PHONE_NUMBER=+46xxxxxxxxx
```

**Deploy:**
```bash
supabase functions deploy send-sms
```

**Test:**
```bash
curl -X POST https://[PROJECT_REF].supabase.co/functions/v1/send-sms \
  -H "Authorization: Bearer [USER_JWT_TOKEN]" \
  -H "Content-Type: application/json" \
  -d '{"to":"+46700000000","message":"Test SMS från bevakningsverktyg"}'
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

## PHASE 3: FRONTEND INTEGRATION

### 3.1 Supabase Client Setup

**Fil:** `dashboard/src/lib/supabase.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wzkohritxdrstsmwopco.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper för Edge Functions
export async function callEdgeFunction<T>(
  functionName: string,
  data?: unknown
): Promise<{ success: boolean; data?: T; error?: any }> {
  try {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;

    const response = await fetch(
      `${supabaseUrl}/functions/v1/${functionName}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token || supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: data ? JSON.stringify(data) : undefined,
      }
    );

    return await response.json();
  } catch (error) {
    console.error(`Edge Function ${functionName} error:`, error);
    return { success: false, error };
  }
}
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

### 3.2 RSS Feed Component

**Fil:** `dashboard/src/components/RSSFeedReader.tsx`

```typescript
import { useState, useEffect } from 'react';
import { callEdgeFunction } from '../lib/supabase';

export function RSSFeedReader() {
  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(false);

  async function fetchFeeds(forceRefresh = false) {
    setLoading(true);
    const result = await callEdgeFunction('rss-proxy', { forceRefresh });

    if (result.success) {
      setFeeds(result.data);
    } else {
      console.error('Failed to fetch feeds:', result.error);
    }

    setLoading(false);
  }

  useEffect(() => {
    fetchFeeds();
  }, []);

  return (
    <div>
      <button onClick={() => fetchFeeds(true)}>
        Uppdatera feeds
      </button>

      {loading ? (
        <p>Laddar...</p>
      ) : (
        feeds.map(feed => (
          <div key={feed.feed.id}>
            <h3>{feed.feed.name}</h3>
            <p>Artiklar: {feed.articles.length}</p>
            <p>Cache: {feed.metadata.cacheHit ? 'Ja' : 'Nej'}</p>

            {feed.articles.map(article => (
              <div key={article.id}>
                <h4>{article.title}</h4>
                <p>{article.description}</p>
                <p>Matchade: {article.matchedKeywords.join(', ')}</p>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

### 3.3 MyNewsdesk Scraper Component

**Fil:** `dashboard/src/components/MyNewsdeskScraper.tsx`

```typescript
import { useState } from 'react';
import { callEdgeFunction } from '../lib/supabase';

export function MyNewsdeskScraper() {
  const [pressroomUrl, setPressroomUrl] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function scrapePress room() {
    setLoading(true);
    const res = await callEdgeFunction('mynewsdesk-proxy', {
      pressroomUrl,
      includeImages: true,
    });

    if (res.success) {
      setResult(res.data);
    } else {
      alert(`Fel: ${res.error?.message}`);
    }

    setLoading(false);
  }

  return (
    <div>
      <input
        type="text"
        placeholder="MyNewsdesk pressrum URL"
        value={pressroomUrl}
        onChange={(e) => setPressroomUrl(e.target.value)}
      />

      <button onClick={scrapePressroom} disabled={loading}>
        {loading ? 'Hämtar...' : 'Hämta pressreleaser'}
      </button>

      {result && (
        <div>
          <h3>{result.company.name}</h3>
          <p>Pressreleaser: {result.pressReleases.length}</p>
          <p>Bilder: {result.images.length}</p>
          <p>Cache: {result.metadata.cacheHit ? 'Ja' : 'Nej'}</p>

          {result.pressReleases.map((release, i) => (
            <div key={i}>
              <h4>{release.title}</h4>
              <p>{release.summary}</p>
              <a href={release.url} target="_blank">Läs mer</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

### 3.4 SMS Alert Component

**Fil:** `dashboard/src/components/SMSAlert.tsx`

```typescript
import { useState } from 'react';
import { callEdgeFunction } from '../lib/supabase';

export function SMSAlert() {
  const [phone, setPhone] = useState('+46');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);

  async function sendSMS() {
    const res = await callEdgeFunction('send-sms', {
      to: phone,
      message: message,
    });

    if (res.success) {
      alert('SMS skickat!');
      setResult(res.data);
    } else {
      if (res.error?.code === 'RATE_LIMIT_EXCEEDED_HOURLY') {
        alert('Du har nått maxgränsen för SMS per timme. Försök igen senare.');
      } else {
        alert(`Fel: ${res.error?.message}`);
      }
    }
  }

  return (
    <div>
      <input
        type="tel"
        placeholder="+46700000000"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />

      <textarea
        placeholder="Ditt meddelande..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />

      <button onClick={sendSMS}>
        Skicka SMS
      </button>

      {result && (
        <div>
          <p>Status: {result.status}</p>
          <p>SID: {result.sid}</p>
        </div>
      )}
    </div>
  );
}
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

## PHASE 4: TESTING & OPTIMIZATION

### 4.1 Edge Function Tests

```bash
# Test alla endpoints
./scripts/test-edge-functions.sh
```

**Test script:** `scripts/test-edge-functions.sh`

```bash
#!/bin/bash

PROJECT_REF="wzkohritxdrstsmwopco"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

echo "Testing rss-proxy..."
curl -X POST https://${PROJECT_REF}.supabase.co/functions/v1/rss-proxy \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"forceRefresh":true}' | jq

echo "\nTesting mynewsdesk-proxy..."
curl -X POST https://${PROJECT_REF}.supabase.co/functions/v1/mynewsdesk-proxy \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"pressroomUrl":"https://www.mynewsdesk.com/se/example"}' | jq

echo "\nTesting send-sms (requires user token)..."
# Behöver giltig user JWT token
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

### 4.2 Performance Monitoring

```sql
-- Monitor RSS feed health
SELECT
  name,
  url,
  error_count,
  last_error,
  last_fetched_at,
  (NOW() - last_fetched_at) as age
FROM rss_feeds
WHERE enabled = true
ORDER BY error_count DESC, last_fetched_at ASC;

-- Monitor SMS usage
SELECT
  DATE(sent_at) as date,
  COUNT(*) as sms_count,
  SUM(cost_sek) as total_cost,
  COUNT(DISTINCT user_id) as unique_users
FROM sms_logs
WHERE sent_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(sent_at)
ORDER BY date DESC;

-- Monitor cache hit rate
SELECT
  'RSS Articles' as cache_type,
  COUNT(*) as total_fetches,
  COUNT(*) FILTER (WHERE fetched_at > last_fetched_at) as cache_misses,
  (COUNT(*) FILTER (WHERE fetched_at = last_fetched_at) * 100.0 / COUNT(*))::DECIMAL(5,2) as cache_hit_rate_pct
FROM rss_articles;
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

### 4.3 Rate Limit Verification

```sql
-- Check current rate limits
SELECT
  key,
  endpoint,
  request_count,
  window_start,
  window_end,
  last_request_at
FROM rate_limits
WHERE window_end > NOW()
ORDER BY last_request_at DESC
LIMIT 20;

-- Find users hitting rate limits
SELECT
  key,
  endpoint,
  COUNT(*) as limit_hits,
  MAX(request_count) as max_requests
FROM rate_limits
WHERE window_end > NOW() - INTERVAL '24 hours'
GROUP BY key, endpoint
HAVING MAX(request_count) >= 10
ORDER BY max_requests DESC;
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

## PHASE 5: PRODUCTION READINESS

### 5.1 Environment Variables

```bash
# Verifiera att alla secrets är satta
supabase secrets list

# Förväntat:
# TWILIO_ACCOUNT_SID
# TWILIO_AUTH_TOKEN
# TWILIO_PHONE_NUMBER
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

### 5.2 CORS Configuration

**Uppdatera Edge Functions med production origins:**

```typescript
// I alla Edge Functions index.ts
const ALLOWED_ORIGINS = [
  'https://your-dashboard.github.io',
  'http://localhost:3000', // Ta bort i production
];
```

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

### 5.3 Monitoring & Alerts

**Setup i Supabase Dashboard:**
- [ ] Email alerts för Edge Function errors
- [ ] Database alerts för high error count in rss_feeds
- [ ] Budget alerts för SMS cost > threshold

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

### 5.4 Documentation

- [ ] Update PROJECT.md med Edge Functions info
- [ ] Create API documentation för frontend team
- [ ] Document troubleshooting steps
- [ ] Create runbook för common issues

**Status:** ✅ Klar / ⏳ Pågår / ❌ Ej påbörjad

---

## SUMMARY

### Architecture Completed

```
GitHub Pages Frontend
      ↓
Supabase Edge Functions (3)
  - rss-proxy
  - mynewsdesk-proxy
  - send-sms
      ↓
PostgreSQL Database (8 nya tabeller)
  - rss_feeds
  - rss_articles
  - bookmarks
  - keyword_alerts
  - keyword_alert_matches
  - sms_logs
  - pressroom_cache
  - rate_limits
```

### Key Features

✅ RSS-feed aggregation med keyword matching
✅ MyNewsdesk scraping med bildextraktion
✅ SMS-notifikationer via Twilio
✅ Multi-layer caching (30min - 24h)
✅ Per-user rate limiting
✅ Comprehensive audit logging
✅ Row Level Security på alla tabeller

### Next Steps

1. Apply database migration
2. Deploy Edge Functions
3. Integrate with frontend
4. Test all functionality
5. Monitor and optimize

---

**Dokumentation:**
- Full Design: `/docs/SUPABASE-EDGE-FUNCTIONS-DESIGN.md`
- Quick Reference: `/docs/EDGE-FUNCTIONS-QUICK-REFERENCE.md`
- SQL Migration: `/supabase/migrations/001_edge_functions_schema.sql`

**Projektmapp:** `/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/`
