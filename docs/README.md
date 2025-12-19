# Bevakningsverktyg - Dokumentation

**Komplett dokumentation för backend-arkitektur och journalist-dashboard**

---

## DOKUMENTATION ÖVERSIKT

### För Implementation

| Dokument | Beskrivning | Användning |
|----------|-------------|------------|
| **[Implementation Checklist](./IMPLEMENTATION-CHECKLIST.md)** | Steg-för-steg implementationsguide med checkboxar | ⭐ Börja här |
| **[Edge Functions Design](./SUPABASE-EDGE-FUNCTIONS-DESIGN.md)** | Komplett teknisk specifikation med kod | Full referens |
| **[Quick Reference](./EDGE-FUNCTIONS-QUICK-REFERENCE.md)** | Snabbreferens för dagligt bruk | Daglig användning |
| **[Architecture Summary](./BACKEND-ARCHITECTURE-SUMMARY.md)** | Executive summary för overview | Management |

### För Drift

| Resurs | Sökväg |
|--------|--------|
| **SQL Migration** | `/supabase/migrations/001_edge_functions_schema.sql` |
| **Edge Functions** | `/supabase/functions/*/index.ts` |
| **Test Scripts** | `/scripts/test-edge-functions.sh` |

---

## SNABBSTART

### 1. Database Setup

```bash
# Apply schema migration
cd /Users/isak/Desktop/CLAUDE_CODE\ /projects/bevakningsverktyg/
supabase link --project-ref wzkohritxdrstsmwopco
supabase db push supabase/migrations/001_edge_functions_schema.sql
```

### 2. Deploy Edge Functions

```bash
# Deploy all functions
supabase functions deploy rss-proxy
supabase functions deploy mynewsdesk-proxy
supabase functions deploy send-sms

# Set Twilio secrets
supabase secrets set TWILIO_ACCOUNT_SID=xxx
supabase secrets set TWILIO_AUTH_TOKEN=xxx
supabase secrets set TWILIO_PHONE_NUMBER=+46xxx
```

### 3. Test Endpoints

```bash
# Test RSS proxy
curl -X POST https://wzkohritxdrstsmwopco.supabase.co/functions/v1/rss-proxy \
  -H "Authorization: Bearer [ANON_KEY]" \
  -H "Content-Type: application/json" \
  -d '{"forceRefresh":true}'

# Expected: JSON with feeds and articles
```

---

## ARKITEKTUR OVERVIEW

```
GitHub Pages (Frontend)
        ↓
Supabase Edge Functions (3 functions)
  - rss-proxy (30min cache)
  - mynewsdesk-proxy (24h cache)
  - send-sms (Twilio)
        ↓
PostgreSQL (8 nya tabeller + RLS)
```

### Edge Functions

| Function | Syfte | Cache | Rate Limit |
|----------|-------|-------|------------|
| `rss-proxy` | RSS-aggregering med keyword matching | 30 min | 30 req/h |
| `mynewsdesk-proxy` | Scrapa pressreleaser + bilder | 24h | 10 req/h |
| `send-sms` | SMS via Twilio | N/A | 10/h, 50/dag |

### Databas-schema

| Tabell | Syfte | RLS |
|--------|-------|-----|
| `rss_feeds` | RSS-feed konfiguration | Admin write, all read |
| `rss_articles` | Cachade artiklar | All read, system write |
| `bookmarks` | Användarens bokmärken | User own data |
| `keyword_alerts` | Nyckelordsbevakning | User own data |
| `keyword_alert_matches` | Alert-matchningar | Via alerts |
| `sms_logs` | SMS audit log | User own logs |
| `pressroom_cache` | MyNewsdesk cache | All read, system write |
| `rate_limits` | Rate limiting | System only |

---

## API ENDPOINTS

### RSS Proxy

**Request:**
```bash
POST https://[PROJECT].supabase.co/functions/v1/rss-proxy
Authorization: Bearer [ANON_KEY]
Content-Type: application/json

{
  "feedId": "uuid-optional",
  "forceRefresh": false,
  "keywords": ["keyword1", "keyword2"]
}
```

**Response:**
```json
{
  "success": true,
  "data": [{
    "feed": { "id": "...", "name": "Dagens Industri", "url": "..." },
    "articles": [
      {
        "id": "...",
        "title": "Företag X lanserar ny produkt",
        "link": "https://...",
        "matchedKeywords": ["produkt"],
        "relevanceScore": 0.75
      }
    ],
    "metadata": {
      "fetchedAt": "2025-12-19T12:34:56Z",
      "cacheHit": true,
      "articleCount": 42
    }
  }]
}
```

---

### MyNewsdesk Proxy

**Request:**
```bash
POST https://[PROJECT].supabase.co/functions/v1/mynewsdesk-proxy
Authorization: Bearer [ANON_KEY]
Content-Type: application/json

{
  "companyId": "uuid-optional",
  "pressroomUrl": "https://www.mynewsdesk.com/se/company-name",
  "includeImages": true,
  "forceRefresh": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "company": { "id": "...", "name": "Company X", "pressroomUrl": "..." },
    "pressReleases": [
      {
        "title": "Pressrelease titel",
        "url": "https://...",
        "publishedAt": "2025-12-19",
        "summary": "Kort sammanfattning...",
        "image": "https://..."
      }
    ],
    "images": [
      {
        "url": "https://...",
        "caption": "Bildtext",
        "downloadUrl": "https://..."
      }
    ],
    "metadata": {
      "fetchedAt": "2025-12-19T12:34:56Z",
      "cacheHit": false,
      "expiresAt": "2025-12-20T12:34:56Z"
    }
  }
}
```

---

### Send SMS

**Request:**
```bash
POST https://[PROJECT].supabase.co/functions/v1/send-sms
Authorization: Bearer [USER_JWT_TOKEN]
Content-Type: application/json

{
  "to": "+46700000000",
  "message": "Nytt alert: Företag X publicerade pressrelease",
  "alertId": "uuid-optional"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sid": "SM...",
    "status": "queued",
    "to": "+46700000000",
    "sentAt": "2025-12-19T12:34:56Z"
  }
}
```

**Error (Rate Limit):**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED_HOURLY",
    "message": "Maximum 10 SMS per hour"
  }
}
```

---

## FRONTEND INTEGRATION

### Supabase Client Setup

```typescript
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wzkohritxdrstsmwopco.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function callEdgeFunction<T>(
  functionName: string,
  data?: unknown
): Promise<{ success: boolean; data?: T; error?: any }> {
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
}
```

### Example: Fetch RSS Feeds

```typescript
import { callEdgeFunction } from './lib/supabase';

async function fetchRSSFeeds() {
  const result = await callEdgeFunction('rss-proxy', {
    forceRefresh: false
  });

  if (result.success) {
    console.log('Feeds:', result.data);
  } else {
    console.error('Error:', result.error);
  }
}
```

---

## MONITORING

### Key Metrics SQL Queries

**RSS Feed Health:**
```sql
SELECT
  name,
  url,
  error_count,
  last_error,
  last_fetched_at
FROM rss_feeds
WHERE enabled = true
  AND error_count > 0
ORDER BY error_count DESC;
```

**SMS Usage Today:**
```sql
SELECT
  COUNT(*) as sms_count,
  SUM(cost_sek) as total_cost,
  COUNT(DISTINCT user_id) as unique_users
FROM sms_logs
WHERE sent_at::date = CURRENT_DATE;
```

**Cache Hit Rate:**
```sql
SELECT
  'RSS' as type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE last_fetched_at < fetched_at) as cache_hits,
  (COUNT(*) FILTER (WHERE last_fetched_at < fetched_at) * 100.0 / COUNT(*))::DECIMAL(5,2) as hit_rate_pct
FROM rss_articles
WHERE fetched_at > NOW() - INTERVAL '24 hours';
```

---

## TROUBLESHOOTING

### Problem: RSS Feed Not Updating

**Diagnos:**
```sql
SELECT name, last_fetched_at, last_error, error_count
FROM rss_feeds
WHERE id = 'feed-uuid';
```

**Lösning:**
```typescript
// Force refresh
await callEdgeFunction('rss-proxy', {
  feedId: 'feed-uuid',
  forceRefresh: true
});
```

---

### Problem: Rate Limit Exceeded

**Diagnos:**
```sql
SELECT * FROM rate_limits
WHERE key = 'user:user-uuid'
  AND endpoint = 'send-sms'
  AND window_end > NOW();
```

**Lösning:**
- Vänta tills `window_end` passerat
- Eller öka rate limit i Edge Function kod

---

### Problem: MyNewsdesk Scraping Failed

**Diagnos:**
```sql
SELECT * FROM pressroom_cache
WHERE pressroom_url = 'https://www.mynewsdesk.com/se/company'
ORDER BY fetched_at DESC
LIMIT 1;
```

**Lösning:**
- Kontrollera `fetch_error` kolumn
- Validera pressroom URL i browser
- Force refresh om URL är korrekt

---

## KOSTNAD

### Månadskostnad (uppskattad)

| Tjänst | Kostnad |
|--------|---------|
| Supabase Pro | $25 |
| Twilio SMS (1000/månad) | $50 |
| **Total** | **$75/månad** |

### Inkluderat i Supabase Pro

- 8 GB database
- 250 GB bandwidth
- 2M Edge Function invocations
- 50 GB Edge Function bandwidth

**Nuvarande användning:** Väl inom gränserna

---

## SECURITY

### RLS Policies

Alla tabeller har Row Level Security aktiverat:

- **User-owned data:** Användare ser bara sin egen data
- **Shared read:** Alla kan läsa, bara system kan skriva
- **Admin-only:** Endast admins kan hantera feeds

### Input Validation

- Phone numbers: E.164 format (`+46700000000`)
- URLs: Valid HTTP/HTTPS
- HTML: Sanitized (scripts removed)

### CORS

Production origins endast:
```typescript
const ALLOWED_ORIGINS = [
  'https://your-dashboard.github.io'
];
```

---

## NÄSTA STEG

### Phase 1: Implementation (12-20 timmar)
1. ✅ Database setup (1-2h)
2. ⏳ Edge Functions development (4-6h)
3. ⏳ Frontend integration (4-6h)
4. ⏳ Testing & optimization (2-4h)
5. ⏳ Production readiness (1-2h)

### Phase 2: Launch
- Monitor metrics
- Adjust rate limits if needed
- Optimize cache TTLs
- Gather user feedback

### Phase 3: Enhancements
- Additional RSS sources
- Email notifications
- Keyword alert UI
- Analytics dashboard

---

## SUPPORT

### Dokumentation
- **Full Design:** [SUPABASE-EDGE-FUNCTIONS-DESIGN.md](./SUPABASE-EDGE-FUNCTIONS-DESIGN.md)
- **Quick Reference:** [EDGE-FUNCTIONS-QUICK-REFERENCE.md](./EDGE-FUNCTIONS-QUICK-REFERENCE.md)
- **Implementation:** [IMPLEMENTATION-CHECKLIST.md](./IMPLEMENTATION-CHECKLIST.md)
- **Summary:** [BACKEND-ARCHITECTURE-SUMMARY.md](./BACKEND-ARCHITECTURE-SUMMARY.md)

### Projektmapp
```
/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/
```

### Kontakt
- Backend Architect: backend-architect
- Datum: 2025-12-19

---

**Status:** Design Complete - Ready for Implementation
