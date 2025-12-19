# BATCH 2 & 3 Quick Reference
> Snabbreferens för Nyhets- & Innehållsgenerering + Automatisering & Säkerhet

**Skapad:** 2025-12-19

---

## BATCH 2: NYHETS- & INNEHÅLLSGENERERING

### 5. Generate Article

**Endpoint:** `POST /functions/v1/generate-article`

**Request:**
```json
{
  "companyId": "uuid",
  "includeImages": true,
  "articleType": "news",
  "tone": "neutral",
  "targetLength": 500
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "article": {
      "title": "...",
      "lead": "...",
      "body": "...",
      "summary": "...",
      "keywords": ["..."],
      "wordCount": 523
    },
    "metadata": {
      "tokensUsed": 1234,
      "processingTime": 3456,
      "cost": 0.42
    }
  }
}
```

**Rate Limit:** 10/h, 50/dag
**Estimated Cost:** 0.30-0.50 SEK/artikel

---

### 6. Parse PDF

**Endpoint:** `POST /functions/v1/parse-pdf`

**Request:**
```json
{
  "url": "https://example.com/document.pdf",
  "analysisType": "summary",
  "extractTables": true
}
```

**OR with base64:**
```json
{
  "base64": "JVBERi0xLjQKJeLjz9M...",
  "analysisType": "qa",
  "questions": ["Vad är huvudbudskapet?", "Vilka datum nämns?"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "text": "Extraherad text...",
    "pages": 12,
    "analysis": {
      "summary": "...",
      "keyPoints": ["...", "..."],
      "entities": [
        {
          "type": "company",
          "value": "Företag AB",
          "context": "..."
        }
      ]
    },
    "metadata": {
      "pagesProcessed": 12,
      "tokensUsed": 2345,
      "cost": 0.35
    }
  }
}
```

**Rate Limit:** 20/h, 100/dag
**Max File Size:** 10MB
**Estimated Cost:** 0.20-0.40 SEK/PDF

---

### 7. Scrape Press Images

**Endpoint:** `POST /functions/v1/scrape-press-images`

**Request:**
```json
{
  "companyId": "uuid",
  "websiteUrl": "https://company.com",
  "autoDetect": true,
  "imageFilter": {
    "minWidth": 800,
    "formats": ["jpg", "png"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "images": [
      {
        "url": "https://...",
        "downloadUrl": "https://...",
        "caption": "VD Jane Doe",
        "width": 1200,
        "height": 800,
        "format": "jpg"
      }
    ],
    "sources": [
      {
        "url": "https://company.com/press",
        "imagesFound": 15
      }
    ],
    "metadata": {
      "totalImages": 15,
      "pagesScraped": 3
    }
  }
}
```

**Rate Limit:** 30/h
**No Cost** (scraping only)

---

## BATCH 3: AUTOMATISERING & SÄKERHET

### 8. Solve CAPTCHA

**Endpoint:** `POST /functions/v1/solve-captcha`

**Request:**
```json
{
  "type": "recaptcha_v2",
  "sitekey": "6LdxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxQ",
  "pageUrl": "https://example.com/page-with-captcha"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "03AGdBq27xxx...",
    "solvedAt": "2025-12-19T12:00:00Z",
    "solveTime": 3456,
    "cost": 0.05
  }
}
```

**Rate Limit:** 20/h, 100/dag
**Estimated Cost:** 0.05 SEK/CAPTCHA
**Supported Types:** recaptcha_v2, recaptcha_v3, hcaptcha, funcaptcha

---

### 9. Fetch Bolagsverket Protocol

**Endpoint:** `POST /functions/v1/fetch-bolagsverket-protocol`

**Request:**
```json
{
  "orgnr": "5567676827",
  "year": 2023,
  "autoPurchase": false,
  "maxCost": 500
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "protocols": [
      {
        "year": 2023,
        "type": "bolagsstämma",
        "date": "2023-05-15",
        "available": true,
        "cost": 100,
        "purchased": false
      }
    ],
    "totalCost": 100,
    "purchased": 0
  }
}
```

**Rate Limit:** 10/h
**Estimated Cost:** 100 SEK/protokoll (Bolagsverket's price)

---

### 10. Budget Manager

**Endpoint:** `POST /functions/v1/budget-manager`

**Get Summary:**
```json
{
  "action": "get_summary",
  "period": "day"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "today": 12.50,
      "week": 45.30,
      "month": 123.45,
      "byService": {
        "anthropic": 10.20,
        "nopecha": 2.30
      },
      "limits": {
        "daily": 100,
        "monthly": 1000
      },
      "remainingDaily": 87.50,
      "remainingMonthly": 876.55
    }
  }
}
```

**Set Limits:**
```json
{
  "action": "set_limit",
  "dailyLimit": 150,
  "monthlyLimit": 2000
}
```

**Get History:**
```json
{
  "action": "get_history",
  "service": "anthropic"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "history": [
      {
        "date": "2025-12-19T12:00:00Z",
        "service": "anthropic",
        "operation": "generate-article",
        "cost": 0.42,
        "tokensInput": 1000,
        "tokensOutput": 500
      }
    ]
  }
}
```

**Rate Limit:** Unlimited (read-only)

---

## DEPLOYMENT

### Environment Variables

```bash
# Claude AI
ANTHROPIC_API_KEY=sk-ant-xxx

# NopeCHA
NOPECHA_API_KEY=nopecha_xxx

# Supabase (already configured)
SUPABASE_URL=xxx
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

### Deploy Functions

```bash
# Deploy all BATCH 2 & 3 functions
supabase functions deploy generate-article
supabase functions deploy parse-pdf
supabase functions deploy scrape-press-images
supabase functions deploy solve-captcha
supabase functions deploy fetch-bolagsverket-protocol
supabase functions deploy budget-manager

# Set secrets
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
supabase secrets set NOPECHA_API_KEY=nopecha_xxx
```

### Apply Database Migration

```bash
# Apply schema
supabase db push

# Or manually
psql $DATABASE_URL < supabase/migrations/002_batch_2_3_schema.sql
```

---

## DATABASE SCHEMA

### New Tables

| Table | Purpose |
|-------|---------|
| `generated_articles` | Sparar AI-genererade artiklar |
| `budget_logs` | Audit log för ALLA API-kostnader |
| `user_budget_limits` | Budget-gränser per användare |
| `bolagsverket_protocols` | Cache av hämtade protokoll |

### Helper Functions

```sql
-- Get spending summary
SELECT * FROM get_user_spending_summary(
  'user-uuid',
  'day'  -- 'day', 'week', or 'month'
);

-- Check budget before API call
SELECT check_budget_limit(
  'user-uuid',
  0.50,  -- Cost in SEK
  'day'  -- 'day' or 'month'
);
```

### Views

```sql
-- User spending overview
SELECT * FROM user_spending_overview
WHERE user_id = 'xxx';

-- Daily spending
SELECT * FROM daily_user_spending
WHERE user_id = 'xxx'
ORDER BY date DESC;
```

---

## TESTING

### cURL Examples

**Generate Article:**
```bash
curl -X POST https://xxx.supabase.co/functions/v1/generate-article \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "uuid",
    "articleType": "news",
    "tone": "neutral"
  }'
```

**Parse PDF:**
```bash
curl -X POST https://xxx.supabase.co/functions/v1/parse-pdf \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/doc.pdf",
    "analysisType": "summary"
  }'
```

**Scrape Images:**
```bash
curl -X POST https://xxx.supabase.co/functions/v1/scrape-press-images \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "websiteUrl": "https://company.com",
    "autoDetect": true
  }'
```

**Solve CAPTCHA:**
```bash
curl -X POST https://xxx.supabase.co/functions/v1/solve-captcha \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recaptcha_v2",
    "sitekey": "xxx",
    "pageUrl": "https://example.com"
  }'
```

**Budget Summary:**
```bash
curl -X POST https://xxx.supabase.co/functions/v1/budget-manager \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "get_summary",
    "period": "day"
  }'
```

---

## COST ESTIMATES

| Service | Operation | Approx. Cost (SEK) |
|---------|-----------|-------------------|
| **Anthropic Claude** | Generate 500-word article | 0.30-0.50 |
| **Anthropic Claude** | Parse 10-page PDF | 0.20-0.40 |
| **Anthropic Claude** | Q&A on PDF | 0.15-0.30 |
| **NopeCHA** | Solve CAPTCHA | 0.05 |
| **Bolagsverket** | Buy protocol | 100.00 |
| **Scraping** | Press images | 0.00 (free) |

**Daily Budget Recommendation:**
- Light usage: 50-100 SEK/dag
- Medium usage: 100-300 SEK/dag
- Heavy usage: 300-1000 SEK/dag

---

## SECURITY BEST PRACTICES

1. **Always use user authentication** - JWT tokens required
2. **Set budget limits** - Prevent runaway costs
3. **Monitor spending** - Check `budget_logs` regularly
4. **Rate limit compliance** - Respect per-function limits
5. **Input validation** - Functions validate all inputs
6. **RLS enabled** - All tables protected
7. **Service role isolation** - Functions use service role, users cannot write directly

---

## TROUBLESHOOTING

### Common Errors

**401 Unauthorized**
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid token"
  }
}
```
**Fix:** Include valid JWT token in Authorization header

---

**429 Rate Limit Exceeded**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests"
  }
}
```
**Fix:** Wait until rate limit window resets (check `Retry-After` header)

---

**Budget Exceeded**
```json
{
  "success": false,
  "error": {
    "code": "BUDGET_EXCEEDED",
    "message": "Daily budget limit reached"
  }
}
```
**Fix:** Increase budget limit or wait until next day

---

**PDF Too Large**
```json
{
  "success": false,
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "Max file size is 10MB"
  }
}
```
**Fix:** Compress PDF or split into smaller files

---

## SUPPORT

- **Full Design Doc:** `/docs/EDGE-FUNCTIONS-BATCH-2-3-DESIGN.md`
- **Database Schema:** `/supabase/migrations/002_batch_2_3_schema.sql`
- **Function Code:** `/supabase/functions/[function-name]/index.ts`

---

**Last Updated:** 2025-12-19
