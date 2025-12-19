# Edge Functions Quick Reference

**Snabbreferens för Supabase Edge Functions**

---

## ENDPOINTS

### 1. RSS Proxy

**URL:** `https://[project].supabase.co/functions/v1/rss-proxy`

**Metod:** `POST`

**Headers:**
```
Authorization: Bearer [ANON_KEY]
Content-Type: application/json
```

**Request:**
```json
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
    "feed": { "id": "...", "name": "...", "url": "..." },
    "articles": [...],
    "metadata": {
      "fetchedAt": "2025-12-19T...",
      "articleCount": 42,
      "cacheHit": true
    }
  }]
}
```

**Cache:** 30 minuter
**Rate Limit:** 30 requests/timme per användare

---

### 2. MyNewsdesk Proxy

**URL:** `https://[project].supabase.co/functions/v1/mynewsdesk-proxy`

**Metod:** `POST`

**Headers:**
```
Authorization: Bearer [ANON_KEY]
Content-Type: application/json
```

**Request:**
```json
{
  "companyId": "uuid-optional",
  "pressroomUrl": "https://www.mynewsdesk.com/se/company",
  "includeImages": true,
  "forceRefresh": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "company": {...},
    "pressReleases": [...],
    "images": [...],
    "metadata": {
      "fetchedAt": "...",
      "cacheHit": false,
      "expiresAt": "..."
    }
  }
}
```

**Cache:** 24 timmar
**Rate Limit:** 10 requests/timme per pressrum

---

### 3. Send SMS

**URL:** `https://[project].supabase.co/functions/v1/send-sms`

**Metod:** `POST`

**Headers:**
```
Authorization: Bearer [USER_TOKEN]
Content-Type: application/json
```

**Request:**
```json
{
  "to": "+46700000000",
  "message": "Your SMS message here",
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
    "sentAt": "2025-12-19T..."
  }
}
```

**Rate Limit:** 10 SMS/timme, 50 SMS/dag per användare
**Cost:** ~0.50 SEK per SMS

---

## DATABAS-TABELLER

### Nya Tabeller

| Tabell | Syfte | RLS |
|--------|-------|-----|
| `rss_feeds` | RSS-feed konfiguration | Admin write, all read |
| `rss_articles` | Cachade RSS-artiklar | All read, system write |
| `bookmarks` | Användarens bokmärken | User own data |
| `keyword_alerts` | Nyckelordsbevakning | User own data |
| `keyword_alert_matches` | Alert-matchningar | Via alerts relation |
| `sms_logs` | SMS audit log | User own logs |
| `pressroom_cache` | MyNewsdesk cache | All read, system write |
| `rate_limits` | Rate limiting tracking | System only |

### Befintliga Tabeller

| Tabell | Beskrivning |
|--------|-------------|
| `loop_table` | 1214 bevakade företag |
| `poit_announcements` | POIT-kungörelser |
| `news_articles` | Genererade artiklar |
| `api_keys` | Admin API-nycklar |
| `user_profiles` | Användardata |

---

## SQL MIGRATIONS

### Skapa tabeller

```bash
# Kör migration
supabase db push

# Eller manuellt
psql $DATABASE_URL -f supabase/migrations/001_edge_functions_schema.sql
```

### Seed data (example RSS feeds)

```sql
INSERT INTO rss_feeds (name, url, keywords, enabled) VALUES
  ('DI - Börsnoterade', 'https://www.di.se/rss', ARRAY['börs', 'emission', 'kvartalsrapport'], true),
  ('Breakit', 'https://www.breakit.se/feed', ARRAY['startup', 'tech', 'investering'], true),
  ('Affärsvärlden', 'https://www.affarsvarlden.se/rss', ARRAY['börsen', 'analys'], true);
```

---

## RATE LIMITING

### Per Endpoint

| Endpoint | User Limit | Notes |
|----------|------------|-------|
| `rss-proxy` | 30 req/h | Per user |
| `mynewsdesk-proxy` | 10 req/h | Per pressroom URL |
| `send-sms` | 10 SMS/h, 50 SMS/day | Per user |

### Check Rate Limit Status

```typescript
const { data } = await supabase
  .from('rate_limits')
  .select('request_count, window_end')
  .eq('key', `user:${userId}`)
  .eq('endpoint', 'rss-proxy')
  .single();

console.log(`Remaining: ${10 - data.request_count}`);
```

---

## CACHING

### Cache TTL

| Resource | TTL | Invalidation |
|----------|-----|--------------|
| RSS Articles | 30 min | `forceRefresh` param |
| Pressroom Data | 24 hours | `forceRefresh` param |
| Rate Limits | 1 hour | Auto-cleanup |

### Force Refresh

```typescript
// Force refresh RSS feed
const response = await fetch(edgeFunction, {
  method: 'POST',
  body: JSON.stringify({ feedId: 'xxx', forceRefresh: true })
});

// Invalidate cache manually
await supabase
  .from('rss_feeds')
  .update({ last_fetched_at: null })
  .eq('id', feedId);
```

---

## ERROR CODES

### Common Errors

| Code | Status | Meaning |
|------|--------|---------|
| `UNAUTHORIZED` | 401 | Missing/invalid auth token |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INVALID_INPUT` | 400 | Bad request data |
| `SCRAPING_ERROR` | 500 | Failed to fetch external data |
| `INTERNAL_ERROR` | 500 | Server error |

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Maximum 10 requests per hour",
    "timestamp": "2025-12-19T..."
  }
}
```

---

## DEPLOYMENT

### Deploy Functions

```bash
# Deploy all
supabase functions deploy rss-proxy
supabase functions deploy mynewsdesk-proxy
supabase functions deploy send-sms

# Set secrets
supabase secrets set TWILIO_ACCOUNT_SID=xxx
supabase secrets set TWILIO_AUTH_TOKEN=xxx
supabase secrets set TWILIO_PHONE_NUMBER=+46xxx
```

### Test Deployment

```bash
# Test rss-proxy
curl -X POST https://xxx.supabase.co/functions/v1/rss-proxy \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{"forceRefresh":true}'

# Test mynewsdesk-proxy
curl -X POST https://xxx.supabase.co/functions/v1/mynewsdesk-proxy \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{"pressroomUrl":"https://www.mynewsdesk.com/se/example"}'

# Test send-sms
curl -X POST https://xxx.supabase.co/functions/v1/send-sms \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"to":"+46700000000","message":"Test"}'
```

---

## MONITORING

### Key Metrics

```sql
-- RSS feed health
SELECT name, error_count, last_error, last_fetched_at
FROM rss_feeds
WHERE error_count > 0
ORDER BY error_count DESC;

-- SMS usage per user (today)
SELECT user_id, COUNT(*) as sms_sent, SUM(cost_sek) as total_cost
FROM sms_logs
WHERE sent_at::date = CURRENT_DATE
GROUP BY user_id
ORDER BY total_cost DESC;

-- Cache hit rate (RSS)
SELECT
  COUNT(*) FILTER (WHERE metadata->>'cacheHit' = 'true') * 100.0 / COUNT(*) as cache_hit_rate
FROM (
  SELECT jsonb_array_elements(metadata) as metadata
  FROM rss_articles
) t;
```

---

## FRONTEND INTEGRATION

### Example: Fetch RSS Feed

```typescript
const response = await fetch(
  'https://xxx.supabase.co/functions/v1/rss-proxy',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      feedId: 'xxx',
      forceRefresh: false,
    }),
  }
);

const { success, data, error } = await response.json();

if (success) {
  data.forEach(feed => {
    feed.articles.forEach(article => {
      console.log(article.title, article.matchedKeywords);
    });
  });
}
```

### Example: Send SMS Alert

```typescript
async function sendSMSAlert(userToken: string, phoneNumber: string, message: string) {
  const response = await fetch(
    'https://xxx.supabase.co/functions/v1/send-sms',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phoneNumber,
        message: message,
      }),
    }
  );

  const result = await response.json();

  if (!result.success) {
    if (result.error.code === 'RATE_LIMIT_EXCEEDED_HOURLY') {
      alert('Du har nått gränsen för SMS per timme. Försök igen om en stund.');
    }
  }

  return result;
}
```

---

## SECURITY CHECKLIST

- [ ] All environment variables set
- [ ] RLS enabled on all tables
- [ ] Rate limiting implemented
- [ ] Input validation on all endpoints
- [ ] CORS configured for production domain
- [ ] Service role key secured (never exposed to frontend)
- [ ] SMS logs audit trail enabled
- [ ] Error messages don't leak sensitive data

---

## PERFORMANCE TIPS

1. **Use pagination** for large result sets
2. **Leverage cache** - Don't force refresh unnecessarily
3. **Batch operations** - Fetch multiple feeds in one request
4. **Monitor rate limits** - Display remaining quota to users
5. **Optimize keywords** - Fewer, more specific keywords = better performance
6. **Use indexes** - Already defined in schema

---

**Full Documentation:** `/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/docs/SUPABASE-EDGE-FUNCTIONS-DESIGN.md`
