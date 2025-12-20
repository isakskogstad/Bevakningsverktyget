"""
Loop Company Data API v3
FastAPI-applikation för svenska företagsdata

Funktioner:
- Aggregerad företagsdata från officiella källor
- Asynkron parallell hämtning för prestanda
- Circuit breakers för resiliens
- Metrics för övervakning
"""

from fastapi import FastAPI, HTTPException, Query, Path, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.exceptions import RequestValidationError
import markdown
from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime, date
import asyncio
import uuid
import secrets
import os

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from config import Config
from .orchestrator import DataOrchestrator, get_orchestrator
from .supabase_client import get_database
from .circuit_breaker import get_circuit_breaker, get_all_circuit_status, CircuitState
from .metrics import get_metrics
from .auth import verify_api_key, is_public_endpoint, get_api_keys_from_env

# ==================== RATE LIMITING ====================

# Rate limits (configurable via env vars)
RATE_LIMIT_DEFAULT = "100/minute"  # General endpoints
RATE_LIMIT_ENRICH = "10/minute"    # Enrichment endpoints (expensive)

limiter = Limiter(key_func=get_remote_address)

# ==================== MODELS ====================

class CompanySummary(BaseModel):
    orgnr: str
    name: str
    company_type: Optional[str]
    status: Optional[str]
    founded: Optional[int]
    municipality: Optional[str]
    key_persons: Optional[Dict[str, Optional[str]]]
    key_figures: Optional[Dict[str, Any]]
    board_size: int = 0

class FinancialPeriod(BaseModel):
    period_year: int
    is_consolidated: bool = False
    revenue: Optional[int]
    net_profit: Optional[int]
    total_assets: Optional[int]
    equity: Optional[int]
    equity_ratio: Optional[float]
    return_on_equity: Optional[float]
    num_employees: Optional[int]

class Person(BaseModel):
    name: str
    birth_year: Optional[int]
    role_type: str
    role_category: Optional[str]

class EnrichRequest(BaseModel):
    orgnr: str
    force_refresh: bool = False

class BatchEnrichRequest(BaseModel):
    orgnrs: List[str] = Field(..., max_items=10)
    force_refresh: bool = False

class SearchResult(BaseModel):
    orgnr: str
    name: str
    company_type: Optional[str] = None
    status: Optional[str] = None
    postal_city: Optional[str] = None
    revenue: Optional[int] = None
    num_employees: Optional[int] = None

class LookupResult(BaseModel):
    """Result from company name lookup in local registry"""
    orgnr: str
    name: str
    org_form: Optional[str] = None
    registration_date: Optional[str] = None
    postal_address: Optional[str] = None


class ApiKeyRequest(BaseModel):
    """Request for a new API key"""
    email: str = Field(..., description="E-postadress för kontakt")
    name: str = Field(..., min_length=2, max_length=100, description="Ditt namn")
    company: Optional[str] = Field(None, max_length=100, description="Företag (valfritt)")
    use_case: str = Field(..., min_length=10, max_length=500, description="Beskriv vad du ska använda API:et till")


# ==================== EQUITY OFFERINGS MODELS ====================

class EquityOffering(BaseModel):
    """Equity offering from nyemissioner.se"""
    id: str
    company_name: str
    company_orgnr: Optional[str] = None
    slug: str
    source_url: Optional[str] = None
    offering_type: str  # nyemission, ipo, listbyte, etc.
    exchange: Optional[str] = None
    listing_status: Optional[str] = None
    subscription_start: Optional[str] = None
    subscription_end: Optional[str] = None
    record_date: Optional[str] = None
    listing_date: Optional[str] = None
    amount_sek: Optional[int] = None
    subscription_price_sek: Optional[float] = None
    pre_money_valuation: Optional[int] = None
    post_money_valuation: Optional[int] = None
    shares_before: Optional[int] = None
    shares_offered: Optional[int] = None
    shares_after: Optional[int] = None
    quota_value: Optional[float] = None
    prospectus_url: Optional[str] = None
    memorandum_url: Optional[str] = None
    company_website: Optional[str] = None
    description: Optional[str] = None
    terms: Optional[str] = None
    status: str  # upcoming, active, completed, cancelled
    source: str
    scraped_at: Optional[str] = None
    last_updated: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None


# ==================== POIT MODELS ====================

class POITCategoryStats(BaseModel):
    """Statistics for a POIT category"""
    name: str
    count: int
    url: Optional[str] = None


class POITDailyStats(BaseModel):
    """Daily POIT statistics"""
    date: str
    scraped_at: str
    categories: Dict[str, POITCategoryStats]
    totals: Dict[str, int]


class POITAnnouncement(BaseModel):
    """A POIT announcement (kungörelse)"""
    id: str
    category: str
    subcategory: Optional[str] = None
    company_name: Optional[str] = None
    orgnr: Optional[str] = None
    publication_date: str
    details: Optional[Dict[str, Any]] = None
    source_url: Optional[str] = None
    scraped_at: Optional[str] = None


# ==================== APP ====================

app = FastAPI(
    title="Loop Company Data API",
    description="""
    Komplett API för svenska företagsdata.

    **Kategorier:**
    - **Företag** - Grunddata, struktur, kungörelser
    - **Ekonomi** - Finansiell historik och nyckeltal
    - **Personer & Befattningar** - Styrelse, ledning, revisorer
    - **Årsredovisningar** - XBRL-data från officiella årsredovisningar
    - **POIT** - Post- och Inrikes Tidningar (konkurser, registreringar, m.m.)
    - **Sök** - Sök företag på namn, filter, etc.

    **Autentisering:** Kräver X-API-Key header
    **Rate Limits:** 100 req/min generellt, 10 req/min för berikning
    """,
    version="3.4.1",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS - configured via environment variables
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.CORS_ORIGINS,
    allow_credentials=Config.CORS_ALLOW_CREDENTIALS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# ==================== AUTH MIDDLEWARE ====================

@app.middleware("http")
async def api_key_middleware(request, call_next):
    """
    Middleware to verify API key for protected endpoints.

    Validates against:
    1. Supabase api_keys table (primary)
    2. API_KEYS environment variable (fallback)

    Public endpoints (/, /health, /docs, etc.) bypass authentication.
    """
    from fastapi.responses import JSONResponse
    from .auth import validate_api_key_db

    # Skip auth for public endpoints
    if is_public_endpoint(request.url.path):
        return await call_next(request)

    # Check API key header
    api_key = request.headers.get("X-API-Key")

    if not api_key:
        return JSONResponse(
            status_code=401,
            content={"error": True, "message": "Missing API key. Provide X-API-Key header."}
        )

    # Try Supabase validation first (primary)
    if await validate_api_key_db(api_key):
        return await call_next(request)

    # Fallback to environment variable
    valid_keys = get_api_keys_from_env()
    if valid_keys and api_key in valid_keys:
        return await call_next(request)

    # If no keys configured anywhere, check if dev mode
    if not valid_keys:
        try:
            from .supabase_client import get_db
            db = get_db()
            result = db.client.table('api_keys').select('id').limit(1).execute()
            if not result.data:
                # No keys in DB either, allow request (dev mode)
                return await call_next(request)
        except Exception:
            pass

    return JSONResponse(
        status_code=403,
        content={"error": True, "message": "Invalid API key"}
    )


# ==================== DEPENDENCY ====================

def get_orch() -> DataOrchestrator:
    return get_orchestrator()

# ==================== ENDPOINTS ====================

# README innehåll (identiskt med README.md i repot)
README_CONTENT = """# Loop API

**Loop API är en datakälla för att hitta och följa data om företag och andra bolag.**

## Statistik

| Data | Antal |
|------|-------|
| Sökbara företag | 887 000+ |
| Cachade företag | ~200 |
| Årsredovisningar | XBRL-data |

## API-dokumentation

- **Swagger UI:** https://loop-auto-api.onrender.com/docs
- **ReDoc:** https://loop-auto-api.onrender.com/redoc

## Snabbstart

```bash
# Sök företag
curl "https://loop-auto-api.onrender.com/api/v1/lookup?name=spotify" \\
  -H "X-API-Key: DIN_API_NYCKEL"

# Hämta företagsdata
curl "https://loop-auto-api.onrender.com/api/v1/companies/5567037485" \\
  -H "X-API-Key: DIN_API_NYCKEL"
```

## API-nyckel

För att använda Loop API behöver du en API-nyckel.
Ansök via formuläret nedan eller i [API-dokumentationen](/docs#/API-nycklar/request_api_key_api_v1_request_key_post).

Inkludera API-nyckeln i varje anrop via headern `X-API-Key`.

## Endpoints

| Endpoint | Beskrivning |
|----------|-------------|
| `GET /api/v1/lookup?name={sökord}` | Sök företag |
| `GET /api/v1/companies/{orgnr}` | Företagsdata |
| `GET /api/v1/companies/{orgnr}/board` | Styrelse |
| `GET /api/v1/companies/{orgnr}/financials` | Ekonomi |
| `GET /api/v1/companies/{orgnr}/xbrl` | Årsredovisningar |
| `GET /api/v1/poit/stats` | POIT daglig statistik |
| `GET /api/v1/poit/bankruptcies` | Konkurser |
| `POST /api/v1/enrich` | Berika företag |

## Rate Limits

- Generellt: 100 anrop/minut
- Berikning: 10 anrop/minut

## Licens

MIT - Se [LICENSE](LICENSE)

---

**Version 3.4.1** | [API Status](https://loop-auto-api.onrender.com/health)
"""


@app.get("/", tags=["System"], response_class=HTMLResponse)
async def root():
    """
    Startsida med API-dokumentation.

    Visar samma innehåll som README.md i GitHub-repot.
    """
    # Konvertera markdown till HTML
    html_content = markdown.markdown(
        README_CONTENT,
        extensions=['tables', 'fenced_code']
    )

    # Wrap i en enkel HTML-sida med styling och formulär
    html_page = f"""<!DOCTYPE html>
<html lang="sv">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loop API</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            line-height: 1.6;
            color: #333;
        }}
        h1 {{ color: #1a1a1a; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }}
        h2 {{ color: #1a1a1a; margin-top: 30px; }}
        a {{ color: #0066cc; }}
        code {{ background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }}
        pre {{ background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }}
        pre code {{ background: none; padding: 0; }}
        table {{ border-collapse: collapse; width: 100%; margin: 15px 0; }}
        th, td {{ border: 1px solid #ddd; padding: 10px; text-align: left; }}
        th {{ background: #f4f4f4; }}
        hr {{ border: none; border-top: 1px solid #eee; margin: 30px 0; }}
        .form-container {{
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 25px;
            margin: 20px 0;
        }}
        .form-container input, .form-container textarea {{
            width: 100%;
            padding: 10px;
            margin: 8px 0 16px 0;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
            box-sizing: border-box;
        }}
        .form-container textarea {{
            min-height: 80px;
            resize: vertical;
        }}
        .form-container label {{
            font-weight: 600;
            color: #333;
        }}
        .form-container button {{
            background: #0066cc;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 5px;
            font-size: 16px;
            cursor: pointer;
            width: 100%;
        }}
        .form-container button:hover {{
            background: #0052a3;
        }}
        .form-container button:disabled {{
            background: #ccc;
            cursor: not-allowed;
        }}
        #form-msg {{
            margin-top: 15px;
            padding: 12px;
            border-radius: 5px;
            display: none;
        }}
        #form-msg.success {{
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
            display: block;
        }}
        #form-msg.error {{
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
            display: block;
        }}
    </style>
</head>
<body>
{html_content}

<h2>Ansök om API-nyckel</h2>
<div class="form-container">
    <form id="key-form">
        <label for="email">E-post *</label>
        <input type="email" id="email" name="email" placeholder="din@email.se" required>

        <label for="name">Namn *</label>
        <input type="text" id="name" name="name" placeholder="Ditt namn" required minlength="2">

        <label for="company">Företag (valfritt)</label>
        <input type="text" id="company" name="company" placeholder="Ditt företag">

        <label for="use_case">Vad ska du använda API:et till? *</label>
        <textarea id="use_case" name="use_case" placeholder="Beskriv kort vad du vill bygga eller använda API:et till..." required minlength="10"></textarea>

        <button type="submit" id="submit-btn">Skicka ansökan</button>
    </form>
    <div id="form-msg"></div>
</div>

<script>
document.getElementById('key-form').onsubmit = async (e) => {{
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    const msg = document.getElementById('form-msg');
    btn.disabled = true;
    btn.textContent = 'Skickar...';
    msg.className = '';
    msg.style.display = 'none';

    const formData = {{
        email: document.getElementById('email').value,
        name: document.getElementById('name').value,
        company: document.getElementById('company').value || null,
        use_case: document.getElementById('use_case').value
    }};

    try {{
        const res = await fetch('/api/v1/request-key', {{
            method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify(formData)
        }});
        const data = await res.json();

        if (res.ok) {{
            msg.textContent = 'Din ansökan har skickats! Du får svar inom 24 timmar.';
            msg.className = 'success';
            document.getElementById('key-form').reset();
        }} else {{
            msg.textContent = data.detail || data.message || 'Ett fel uppstod. Försök igen.';
            msg.className = 'error';
        }}
    }} catch (err) {{
        msg.textContent = 'Nätverksfel. Kontrollera din anslutning och försök igen.';
        msg.className = 'error';
    }}

    btn.disabled = false;
    btn.textContent = 'Skicka ansökan';
}};
</script>
</body>
</html>"""

    return HTMLResponse(content=html_page)

@app.get("/health", tags=["System"])
async def health():
    """
    Hälsokontroll med systemstatus.

    Returnerar status för:
    - Databasanslutning
    - Circuit breakers
    - Prestandamätningar
    """
    db = get_database()
    stats = db.get_stats()
    metrics = get_metrics()
    circuit_status = get_all_circuit_status()

    # Determine overall health status
    circuits_ok = all(
        cb.get('state') != 'open'
        for cb in circuit_status.values()
    )

    status = "healthy" if circuits_ok else "degraded"

    return {
        "status": status,
        "timestamp": datetime.now().isoformat(),
        "database": {
            "companies_cached": stats.get('companies', 0),
            "status": "connected"
        },
        "data_sources": {
            "status": "operational" if circuits_ok else "degraded",
            "total_requests": sum(
                cb.get('stats', {}).get('total_requests', 0)
                for cb in circuit_status.values()
            )
        },
        "performance": {
            "avg_fetch_time_ms": metrics.get_stats().get('summary', {}).get('avg_fetch_time_ms', 0),
            "total_requests": metrics.get_stats().get('summary', {}).get('total_requests', 0)
        }
    }


@app.get("/debug/auth", tags=["System"])
async def debug_auth():
    """
    Debug endpoint for API key authentication.
    Shows environment variable status and Supabase connection status.
    """
    from .supabase_client import get_db

    result = {
        "env_vars": {
            "SUPABASE_URL_set": bool(os.environ.get("SUPABASE_URL")),
            "SUPABASE_KEY_set": bool(os.environ.get("SUPABASE_KEY")),
            "API_KEYS_set": bool(os.environ.get("API_KEYS")),
            "SUPABASE_URL_prefix": os.environ.get("SUPABASE_URL", "")[:30] + "..." if os.environ.get("SUPABASE_URL") else None,
        },
        "supabase_connection": "unknown",
        "api_keys_in_db": 0,
        "error": None
    }

    try:
        db = get_db()
        result["supabase_connection"] = "connected" if db else "failed"

        # Count API keys in database
        keys_result = db.client.table('api_keys').select('id', count='exact').execute()
        result["api_keys_in_db"] = len(keys_result.data) if keys_result.data else 0
    except Exception as e:
        result["supabase_connection"] = "error"
        result["error"] = f"{type(e).__name__}: {str(e)}"

    return result


@app.get("/api/v1/metrics", tags=["System"])
async def get_metrics_endpoint():
    """
    Hämta detaljerade prestandamätningar.

    Returnerar:
    - Svarstider och framgångsfrekvens
    - Cache hit/miss
    - Drifttid
    """
    metrics = get_metrics()

    return {
        **metrics.get_stats()
    }

# ==================== FÖRETAG ====================

@app.get("/api/v1/companies/{orgnr}", tags=["Företag"])
async def get_company(
    orgnr: str,
    refresh: bool = Query(False, description="Tvinga uppdatering från källor")
):
    """
    Hämta komplett företagsdata.

    Returnerar all tillgänglig information om företaget.
    """
    orch = get_orch()
    company = orch.get_company(orgnr, force_refresh=refresh)

    if not company:
        raise HTTPException(status_code=404, detail=f"Företag {orgnr} hittades inte")

    return company

@app.get("/api/v1/companies/{orgnr}/summary", response_model=CompanySummary, tags=["Företag"])
async def get_company_summary(orgnr: str):
    """Hämta snabb sammanfattning av företag."""
    orch = get_orch()
    summary = orch.get_summary(orgnr)

    if not summary:
        raise HTTPException(status_code=404, detail=f"Företag {orgnr} hittades inte")

    return summary

@app.get("/api/v1/companies/{orgnr}/board", tags=["Personer & Befattningar"])
async def get_company_board(orgnr: str):
    """Hämta styrelse, ledning och revisorer."""
    orch = get_orch()
    company = orch.get_company(orgnr)

    if not company:
        raise HTTPException(status_code=404, detail=f"Företag {orgnr} hittades inte")

    roles = company.get('roles', [])

    return {
        'orgnr': orgnr,
        'name': company.get('name'),
        'styrelse': [r for r in roles if r.get('role_category') == 'BOARD'],
        'ledning': [r for r in roles if r.get('role_category') == 'MANAGEMENT'],
        'revisorer': [r for r in roles if r.get('role_category') == 'AUDITOR'],
        'ovriga': [r for r in roles if r.get('role_category') == 'OTHER'],
        'antal_totalt': len(roles)
    }

@app.get("/api/v1/companies/{orgnr}/financials", tags=["Ekonomi"])
async def get_company_financials(
    orgnr: str,
    consolidated: bool = Query(False, description="Hämta koncernredovisning"),
    years: int = Query(5, ge=1, le=10, description="Antal år att returnera")
):
    """Hämta finansiell historik."""
    orch = get_orch()
    company = orch.get_company(orgnr)

    if not company:
        raise HTTPException(status_code=404, detail=f"Företag {orgnr} hittades inte")

    financials = company.get('financials', [])

    # Filter by type
    filtered = [f for f in financials if f.get('is_consolidated') == (1 if consolidated else 0)]

    # Sort and limit
    filtered = sorted(filtered, key=lambda x: x.get('period_year', 0), reverse=True)[:years]

    return {
        'orgnr': orgnr,
        'name': company.get('name'),
        'koncernredovisning': consolidated,
        'perioder': filtered
    }

@app.get("/api/v1/companies/{orgnr}/structure", tags=["Företag"])
async def get_company_structure(orgnr: str):
    """Hämta koncernstruktur (moderbolag, dotterbolag)."""
    orch = get_orch()
    company = orch.get_company(orgnr)

    if not company:
        raise HTTPException(status_code=404, detail=f"Företag {orgnr} hittades inte")

    return {
        'orgnr': orgnr,
        'name': company.get('name'),
        'ar_koncern': company.get('is_group', False),
        'antal_i_koncern': company.get('companies_in_group'),
        'moderbolag': {
            'orgnr': company.get('parent_orgnr'),
            'name': company.get('parent_name')
        } if company.get('parent_orgnr') else None,
        'relaterade_bolag': company.get('related_companies', []),
        'branscher': company.get('industries', [])
    }

@app.get("/api/v1/companies/{orgnr}/announcements", tags=["Företag"])
async def get_company_announcements(
    orgnr: str,
    limit: int = Query(10, ge=1, le=50)
):
    """Hämta kungörelser för företaget."""
    orch = get_orch()
    company = orch.get_company(orgnr)

    if not company:
        raise HTTPException(status_code=404, detail=f"Företag {orgnr} hittades inte")

    announcements = company.get('announcements', [])[:limit]

    return {
        'orgnr': orgnr,
        'name': company.get('name'),
        'kungorelser': announcements,
        'antal_totalt': len(announcements)
    }

# ==================== HISTORIK ====================

@app.get("/api/v1/companies/{orgnr}/history", tags=["Historik"])
async def get_company_full_history(
    orgnr: str,
    limit: int = Query(50, ge=1, le=100, description="Max antal snapshots per kategori")
):
    """
    Hämta komplett historisk data för ett företag.

    Returnerar alla historiska snapshots inkl:
    - Företagsdata (namn, status, adress, nyckeltal)
    - Styrelse/befattningar över tid

    Varje snapshot inkluderar tidsstämpel.
    """
    db = get_database()
    history = db.get_full_history(orgnr)

    # Add metadata
    history['metadata'] = {
        'orgnr': orgnr,
        'foretagshistorik_antal': len(history.get('company_history', [])),
        'befattningshistorik_antal': len(history.get('roles_history', []))
    }

    return history

@app.get("/api/v1/companies/{orgnr}/history/board", tags=["Historik"])
async def get_board_history_endpoint(
    orgnr: str,
    limit: int = Query(50, ge=1, le=100)
):
    """
    Hämta historiska styrelse-snapshots för ett företag.

    Varje snapshot innehåller komplett styrelsesammansättning vid den tidpunkten.
    Använd för att spåra förändringar i bolagsledningen över tid.
    """
    db = get_database()
    history = db.get_roles_history(orgnr, limit)

    return {
        'orgnr': orgnr,
        'snapshots': history,
        'antal_snapshots': len(history)
    }

# ==================== SÖK ====================

@app.get("/api/v1/search/companies", response_model=List[SearchResult], tags=["Sök"])
async def search_companies(
    q: Optional[str] = Query(None, description="Sökfråga (namn eller orgnr)"),
    municipality: Optional[str] = Query(None, description="Filtrera på kommun/stad"),
    min_revenue: Optional[int] = Query(None, description="Minsta omsättning (tkr)"),
    max_revenue: Optional[int] = Query(None, description="Högsta omsättning (tkr)"),
    min_employees: Optional[int] = Query(None, description="Minsta antal anställda"),
    status: Optional[str] = Query(None, description="Statusfilter (ACTIVE, etc)"),
    limit: int = Query(50, ge=1, le=100)
):
    """Sök företag med filter."""
    db = get_database()

    results = db.search_companies(
        query=q,
        municipality=municipality,
        min_revenue=min_revenue,
        max_revenue=max_revenue,
        min_employees=min_employees,
        status=status,
        limit=limit
    )

    return results

@app.get("/api/v1/lookup", response_model=Dict[str, Any], tags=["Sök"])
async def lookup_company_by_name(
    name: str = Query(..., min_length=2, description="Företagsnamn att söka efter"),
    limit: int = Query(20, ge=1, le=100, description="Max antal resultat")
):
    """
    Slå upp företags organisationsnummer via namn.

    Söker i Loop:s databas med ~887,000 aktiva svenska företag.

    **Användningsområden:**
    - Hitta orgnr för att sedan hämta företagsdata
    - Hitta företag som matchar ett namnmönster
    - Autocomplete för företagsnamn

    **Exempel:**
    - `/api/v1/lookup?name=Oatly` → Returnerar alla Oatly-bolag
    - `/api/v1/lookup?name=IKEA&limit=5` → Topp 5 IKEA-matchningar

    **OBS:** Inkluderar endast AKTIVA företag.
    """
    db = get_database()
    results = db.search_company_registry(name, limit=limit)

    return {
        'sokfras': name,
        'resultat': results,
        'antal': len(results)
    }


@app.get("/api/v1/lookup/stats", tags=["Sök"])
async def lookup_registry_stats():
    """
    Hämta statistik om företagsregistret.

    Returnerar antal företag i Loop:s databas.
    """
    db = get_database()
    stats = db.get_registry_stats()

    return {
        'status': 'tillganglig',
        'antal_foretag': stats.get('total_companies', 0)
    }

# ==================== BERIKNING ====================

@app.post("/api/v1/enrich", tags=["Berikning"])
@limiter.limit(RATE_LIMIT_ENRICH)
async def enrich_company(request: Request, enrich_req: EnrichRequest):
    """
    Berika ett företag med fullständig data.

    Hämtar färsk data från alla källor när force_refresh=True.

    Rate limit: 10 anrop/minut.
    """
    orch = get_orch()
    company = orch.get_company(enrich_req.orgnr, force_refresh=enrich_req.force_refresh)

    if not company:
        raise HTTPException(status_code=404, detail=f"Företag {enrich_req.orgnr} hittades inte")

    return {
        'success': True,
        'orgnr': enrich_req.orgnr,
        'name': company.get('name'),
        'data': company
    }

@app.post("/api/v1/enrich/batch", tags=["Berikning"])
@limiter.limit(RATE_LIMIT_ENRICH)
async def enrich_batch(request: Request, batch_req: BatchEnrichRequest, background_tasks: BackgroundTasks):
    """
    Berika flera företag (max 10 per anrop).

    Använder asynkron parallellbearbetning för bättre prestanda.
    """
    orch = get_orch()

    # Use async batch processing for parallel fetching
    batch_results = await orch.enrich_batch_async(
        orgnrs=batch_req.orgnrs,
        force_refresh=batch_req.force_refresh
    )

    # Format results
    results = {}
    for orgnr, company in batch_results.items():
        if company:
            results[orgnr] = {
                'success': True,
                'name': company.get('name')
            }
        else:
            results[orgnr] = {
                'success': False,
                'name': None
            }

    successful = sum(1 for r in results.values() if r.get('success'))

    return {
        'bearbetade': len(batch_req.orgnrs),
        'lyckade': successful,
        'misslyckade': len(batch_req.orgnrs) - successful,
        'resultat': results
    }

# ==================== STATISTIK ====================

@app.get("/api/v1/stats", tags=["System"])
async def get_stats():
    """Hämta databasstatistik."""
    db = get_database()
    stats = db.get_stats()

    return {
        'databas': stats
    }

# ==================== ÅRSREDOVISNINGAR ====================

@app.get("/api/v1/companies/{orgnr}/annual-reports", tags=["Årsredovisningar"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_annual_reports(request: Request, orgnr: str, limit: int = Query(10, ge=1, le=50)):
    """
    Hämta årsredovisningar för ett företag.

    Returnerar lista över tillgängliga årsredovisningar med XBRL-data.
    """
    from .xbrl_storage import get_xbrl_storage
    storage = get_xbrl_storage()

    reports = storage.get_annual_reports_for_company(orgnr, limit=limit)

    if not reports:
        raise HTTPException(
            status_code=404,
            detail=f"Inga årsredovisningar hittades för {orgnr}"
        )

    return {
        "orgnr": orgnr,
        "antal": len(reports),
        "arsredovisningar": reports
    }


@app.get("/api/v1/companies/{orgnr}/annual-reports/{year}", tags=["Årsredovisningar"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_annual_report_by_year(request: Request, orgnr: str, year: int):
    """
    Hämta specifik årsredovisning för ett företag och räkenskapsår.

    Returnerar fullständig metadata inkl revisionsinfo och extraktionsstatistik.
    """
    from .xbrl_storage import get_xbrl_storage
    storage = get_xbrl_storage()

    report = storage.get_annual_report(orgnr, year)

    if not report:
        raise HTTPException(
            status_code=404,
            detail=f"Ingen årsredovisning hittades för {orgnr} räkenskapsår {year}"
        )

    return report


@app.get("/api/v1/companies/{orgnr}/xbrl-facts", tags=["Årsredovisningar"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_xbrl_facts(
    request: Request,
    orgnr: str,
    year: Optional[int] = None,
    namespace: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000)
):
    """
    Hämta XBRL-fakta för ett företag.

    Filtrera på:
    - year: Räkenskapsår
    - namespace: XBRL namespace (se-gen-base, se-ar-base, etc.)
    - category: Kategori (financial, audit, company, compliance)
    """
    from .xbrl_storage import get_xbrl_storage
    storage = get_xbrl_storage()

    facts = storage.get_xbrl_facts(
        orgnr,
        fiscal_year=year,
        namespace=namespace,
        category=category,
        limit=limit
    )

    return {
        "orgnr": orgnr,
        "filter": {
            "ar": year,
            "namespace": namespace,
            "kategori": category
        },
        "antal": len(facts),
        "fakta": facts
    }


@app.get("/api/v1/companies/{orgnr}/audit-history", tags=["Årsredovisningar"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_audit_history_endpoint(request: Request, orgnr: str, limit: int = Query(10, ge=1, le=50)):
    """
    Hämta revisionshistorik för ett företag.

    Returnerar historisk revisionsinformation från årsredovisningar.
    """
    from .xbrl_storage import get_xbrl_storage
    storage = get_xbrl_storage()

    history = storage.get_audit_history(orgnr, limit=limit)

    return {
        "orgnr": orgnr,
        "antal": len(history),
        "revisionshistorik": history
    }


@app.get("/api/v1/companies/{orgnr}/board-history-xbrl", tags=["Årsredovisningar"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_board_history_xbrl(
    request: Request,
    orgnr: str,
    year: Optional[int] = None,
    limit: int = Query(50, ge=1, le=200)
):
    """
    Hämta styrelsesammansättning från årsredovisningar.

    Returnerar styrelsemedlemmar extraherade från underskrifter i årsredovisningar.
    """
    from .xbrl_storage import get_xbrl_storage
    storage = get_xbrl_storage()

    history = storage.get_board_history(orgnr, fiscal_year=year, limit=limit)

    return {
        "orgnr": orgnr,
        "filter": {"ar": year},
        "antal": len(history),
        "styrelsehistorik": history
    }


@app.get("/api/v1/xbrl/stats", tags=["Årsredovisningar"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_xbrl_stats(request: Request):
    """
    Hämta XBRL-bearbetningsstatistik.

    Returnerar antal bearbetade rapporter och fakta.
    """
    from .xbrl_storage import get_xbrl_storage
    storage = get_xbrl_storage()

    stats = storage.get_processing_stats()

    return {
        "xbrl_bearbetning": stats,
        "tidsstampel": datetime.now().isoformat()
    }


@app.get("/api/v1/xbrl/status", tags=["System"])
async def xbrl_status():
    """
    Kontrollera XBRL/VDM API-konfigurationsstatus.

    Returnerar diagnostikinformation.
    """
    import os
    from .scrapers.bolagsverket_vdm import get_bolagsverket_vdm_client

    vdm_client = get_bolagsverket_vdm_client()

    return {
        "konfigurerad": vdm_client.is_configured
    }


@app.get("/api/v1/xbrl/test/{orgnr}", tags=["System"])
async def xbrl_test(orgnr: str):
    """
    Testa XBRL-hämtning för ett företag.

    Returnerar diagnostikinformation.
    """
    import os
    from .scrapers.bolagsverket_vdm import BolagsverketVDMClient

    # Create fresh client (not singleton)
    vdm_client = BolagsverketVDMClient()

    result = {
        "orgnr": orgnr,
        "konfigurerad": vdm_client.is_configured,
    }

    if not vdm_client.is_configured:
        result["fel"] = "Ej konfigurerad"
        return result

    try:
        # Try to get token
        token = await vdm_client._get_token_async()
        result["token_ok"] = bool(token)

        if not token:
            result["fel"] = "Kunde inte hämta OAuth token"
            return result

        # Try to get document list
        documents = await vdm_client.get_document_list_async(orgnr)
        result["dokument_hittade"] = len(documents)
        result["dokument"] = documents[:3] if documents else []

    except Exception as e:
        result["fel"] = str(e)

    return result


@app.post("/api/v1/companies/{orgnr}/sync-annual-reports", tags=["Årsredovisningar"])
@limiter.limit(RATE_LIMIT_ENRICH)
async def sync_annual_reports(
    request: Request,
    orgnr: str,
    years: int = Query(1, ge=1, le=10, description="Antal år att synka (standard: 1 = senaste året)"),
    force: bool = Query(False, description="Tvinga omsynkning även om redan bearbetad"),
):
    """
    Synka årsredovisningar för ett företag.

    Laddar ner iXBRL-årsredovisningar, parsar XBRL-data och lagrar
    finansiell information i databasen.

    Standard: Hämtar endast senaste tillgängliga året.
    Sätt years=3 eller years=5 för historisk data.

    Rate limit: 10 anrop/minut.
    """
    import os
    from .annual_report_sync import get_annual_report_sync
    from .scrapers.bolagsverket_vdm import get_bolagsverket_vdm_client

    # Check VDM client configuration first
    vdm_client = get_bolagsverket_vdm_client()
    if not vdm_client.is_configured:
        return {
            "status": "fel",
            "orgnr": orgnr,
            "fel": "XBRL-klient ej konfigurerad"
        }

    sync_service = get_annual_report_sync()

    try:
        # Run sync directly (not in background) so we can return result
        result = await sync_service.sync_company(orgnr, years=years, force=force)

        return {
            "status": "klar",
            "orgnr": orgnr,
            "ar_begarda": years,
            "rapporter_hittade": result.get("reports_found", 0),
            "rapporter_bearbetade": result.get("reports_processed", 0),
            "rapporter_misslyckade": result.get("reports_failed", 0),
            "fel": result.get("errors", [])[:5] if result.get("errors") else []
        }
    except Exception as e:
        return {
            "status": "fel",
            "orgnr": orgnr,
            "fel": str(e)
        }


# ==================== EQUITY OFFERINGS ====================

@app.get("/api/v1/offerings", response_model=List[EquityOffering], tags=["Nyemissioner"])
async def list_equity_offerings(
    type: Optional[str] = Query(None, description="Typ av erbjudande: nyemission, ipo, listbyte, spridningsemission"),
    status: Optional[str] = Query(None, description="Status: upcoming, active, completed, cancelled"),
    exchange: Optional[str] = Query(None, description="Handelsplats, t.ex. NGM Nordic SME"),
    limit: int = Query(50, ge=1, le=200, description="Max antal resultat"),
):
    """
    Lista alla nyemissioner och börsnoteringar.

    Hämtar från equity_offerings tabellen som synkas från nyemissioner.se.
    """
    db = get_database()

    query = db.client.table('equity_offerings').select('*')

    if type and type != 'all':
        query = query.eq('offering_type', type)
    if status and status != 'all':
        query = query.eq('status', status)
    if exchange:
        query = query.eq('exchange', exchange)

    query = query.order('created_at', desc=True).limit(limit)

    result = query.execute()
    return result.data or []


@app.get("/api/v1/offerings/stats", tags=["Nyemissioner"])
async def get_offerings_stats():
    """
    Hämta statistik över nyemissioner och börsnoteringar.
    """
    db = get_database()

    # Count by type
    all_offerings = db.client.table('equity_offerings').select('offering_type, status').execute()

    stats = {
        "total": len(all_offerings.data) if all_offerings.data else 0,
        "by_type": {},
        "by_status": {},
    }

    if all_offerings.data:
        for item in all_offerings.data:
            offering_type = item.get('offering_type', 'unknown')
            status = item.get('status', 'unknown')

            stats["by_type"][offering_type] = stats["by_type"].get(offering_type, 0) + 1
            stats["by_status"][status] = stats["by_status"].get(status, 0) + 1

    return stats


@app.get("/api/v1/offerings/{slug}", response_model=Optional[EquityOffering], tags=["Nyemissioner"])
async def get_equity_offering(slug: str):
    """
    Hämta en specifik nyemission/börsnotering via slug.

    Slug är den unika identifieraren från nyemissioner.se, t.ex. "tessin-nordic-holding-ab".
    """
    db = get_database()

    result = db.client.table('equity_offerings') \
        .select('*') \
        .eq('slug', slug) \
        .limit(1) \
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail=f"Erbjudande med slug '{slug}' hittades inte")

    return result.data[0]


@app.get("/api/v1/companies/{orgnr}/offerings", response_model=List[EquityOffering], tags=["Nyemissioner"])
async def get_company_offerings(orgnr: str):
    """
    Hämta alla nyemissioner för ett specifikt företag.

    Söker via organisationsnummer mot equity_offerings tabellen.
    """
    db = get_database()

    result = db.client.table('equity_offerings') \
        .select('*') \
        .eq('company_orgnr', orgnr) \
        .order('created_at', desc=True) \
        .execute()

    return result.data or []


# ==================== POIT (Post- och Inrikes Tidningar) ====================

@app.get("/api/v1/poit/stats", tags=["POIT"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_poit_daily_stats(request: Request):
    """
    Hämta dagens POIT-statistik.

    Returnerar antal kungörelser per kategori från Post- och Inrikes Tidningar.
    Data synkas dagligen från poit.bolagsverket.se.

    **Kategorier inkluderar:**
    - Bolagsverkets registreringar (aktiebolag, föreningar, handelsregistret)
    - Konkurser (konkursbeslut, utdelningsförslag)
    - Skuldsaneringar
    - Familjerätt (bodelning, förvaltarskap)
    - Kallelser på borgenärer
    """
    db = get_database()

    try:
        # Get the most recent stats - FIXED: using correct table and column names
        result = db.client.table('poit_sync_stats') \
            .select('*') \
            .order('sync_date', desc=True) \
            .limit(1) \
            .execute()

        if not result.data:
            return {
                "status": "ingen_data",
                "meddelande": "Ingen POIT-statistik tillgänglig. Data synkas dagligen.",
                "tidsstampel": datetime.now().isoformat()
            }

        stats = result.data[0]

        return {
            "datum": stats.get('sync_date'),
            "hamtad": stats.get('sync_completed_at'),
            "kategorier": stats.get('categories_scraped', []),
            "summering": {
                "announcements_found": stats.get('announcements_found', 0),
                "announcements_new": stats.get('announcements_new', 0),
                "watched_companies_matched": stats.get('watched_companies_matched', 0)
            },
            "kalla": "poit.bolagsverket.se"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kunde inte hämta POIT-statistik: {str(e)}")


@app.get("/api/v1/poit/stats/{stats_date}", tags=["POIT"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_poit_stats_by_date(
    request: Request,
    stats_date: str = Path(..., description="Datum i format YYYY-MM-DD")
):
    """
    Hämta POIT-statistik för ett specifikt datum.

    Returnerar historisk statistik om tillgänglig.
    """
    db = get_database()

    try:
        # FIXED: using correct table and column names
        result = db.client.table('poit_sync_stats') \
            .select('*') \
            .eq('sync_date', stats_date) \
            .limit(1) \
            .execute()

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail=f"Ingen POIT-statistik för {stats_date}"
            )

        stats = result.data[0]

        return {
            "datum": stats.get('sync_date'),
            "hamtad": stats.get('sync_completed_at'),
            "kategorier": stats.get('categories_scraped', []),
            "summering": {
                "announcements_found": stats.get('announcements_found', 0),
                "announcements_new": stats.get('announcements_new', 0),
                "watched_companies_matched": stats.get('watched_companies_matched', 0)
            },
            "kalla": "poit.bolagsverket.se"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kunde inte hämta POIT-statistik: {str(e)}")


@app.get("/api/v1/poit/bankruptcies", tags=["POIT"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_poit_bankruptcies(
    request: Request,
    limit: int = Query(50, ge=1, le=200, description="Max antal resultat"),
    days: int = Query(7, ge=1, le=30, description="Antal dagar bakåt att söka")
):
    """
    Hämta senaste konkurserna från POIT.

    Returnerar konkursbeslut och relaterade kungörelser.
    Data inkluderar företagsnamn, organisationsnummer och publiceringsdatum.

    **Underkategorier:**
    - Konkursbeslut
    - Utdelningsförslag
    """
    db = get_database()

    try:
        # Calculate date range
        from datetime import timedelta
        start_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

        # FIXED: using correct column name publication_date instead of published_date
        result = db.client.table('poit_announcements') \
            .select('*') \
            .eq('category', 'konkurser') \
            .gte('publication_date', start_date) \
            .order('publication_date', desc=True) \
            .limit(limit) \
            .execute()

        return {
            "antal": len(result.data) if result.data else 0,
            "period_dagar": days,
            "konkurser": result.data or [],
            "kalla": "poit.bolagsverket.se"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kunde inte hämta konkurser: {str(e)}")


@app.get("/api/v1/poit/announcements", tags=["POIT"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_poit_announcements(
    request: Request,
    category: Optional[str] = Query(None, description="Kategori: konkurser, registreringar, skuldsaneringar, familjeratt, kallelser"),
    subcategory: Optional[str] = Query(None, description="Underkategori, t.ex. konkursbeslut, aktiebolagsregistret"),
    limit: int = Query(50, ge=1, le=200, description="Max antal resultat"),
    days: int = Query(7, ge=1, le=30, description="Antal dagar bakåt")
):
    """
    Hämta kungörelser från POIT med filter.

    **Kategorier:**
    - `registreringar` - Bolagsverkets registreringar
    - `konkurser` - Konkursbeslut och utdelningsförslag
    - `skuldsaneringar` - Skuldsaneringsbeslut
    - `familjeratt` - Bodelning, förvaltarskap
    - `kallelser` - Kallelse på borgenärer

    **Exempel:**
    - `/api/v1/poit/announcements?category=konkurser` - Alla konkurser
    - `/api/v1/poit/announcements?category=registreringar&subcategory=aktiebolagsregistret` - Endast aktiebolag
    """
    db = get_database()

    try:
        from datetime import timedelta
        start_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

        # FIXED: using correct column name publication_date instead of published_date
        query = db.client.table('poit_announcements') \
            .select('*') \
            .gte('publication_date', start_date)

        if category:
            query = query.eq('category', category)
        if subcategory:
            query = query.eq('subcategory', subcategory)

        query = query.order('publication_date', desc=True).limit(limit)

        result = query.execute()

        return {
            "antal": len(result.data) if result.data else 0,
            "filter": {
                "kategori": category,
                "underkategori": subcategory,
                "period_dagar": days
            },
            "kungorelser": result.data or [],
            "kalla": "poit.bolagsverket.se"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kunde inte hämta kungörelser: {str(e)}")


@app.get("/api/v1/companies/{orgnr}/poit", tags=["POIT"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_company_poit_announcements(
    request: Request,
    orgnr: str,
    limit: int = Query(20, ge=1, le=100, description="Max antal resultat")
):
    """
    Hämta POIT-kungörelser för ett specifikt företag.

    Söker via organisationsnummer och returnerar alla kungörelser
    från Post- och Inrikes Tidningar relaterade till företaget.
    """
    db = get_database()

    try:
        # FIXED: using correct column name publication_date instead of published_date
        result = db.client.table('poit_announcements') \
            .select('*') \
            .eq('orgnr', orgnr) \
            .order('publication_date', desc=True) \
            .limit(limit) \
            .execute()

        # Also try to get company name from main company data
        company_name = None
        try:
            orch = get_orch()
            company = orch.get_company(orgnr)
            if company:
                company_name = company.get('name')
        except Exception:
            pass

        return {
            "orgnr": orgnr,
            "foretag": company_name,
            "antal": len(result.data) if result.data else 0,
            "kungorelser": result.data or [],
            "kalla": "poit.bolagsverket.se"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kunde inte hämta företagets kungörelser: {str(e)}")


# ==================== API-NYCKLAR ====================


def generate_api_key() -> str:
    """Generate a secure 32-character API key"""
    return secrets.token_urlsafe(24)  # 32 chars


def generate_approval_token() -> str:
    """Generate a secure token for approval links"""
    return secrets.token_urlsafe(32)


async def send_admin_notification(request_data: dict, approve_url: str, reject_url: str):
    """Send email notification to admin about new API key request"""
    try:
        import resend
        resend.api_key = os.environ.get("RESEND_API_KEY")
        admin_email = os.environ.get("ADMIN_EMAIL")

        if not resend.api_key or not admin_email:
            print(f"Email not configured. Request from {request_data['email']}")
            return False

        resend.Emails.send({
            "from": "Loop API <onboarding@resend.dev>",
            "to": admin_email,
            "subject": f"Ny API-ansökan: {request_data['email']}",
            "html": f"""
            <h2>Ny API-nyckelansökan</h2>
            <table style="border-collapse: collapse; margin: 20px 0;">
                <tr><td style="padding: 8px; border: 1px solid #ddd;"><b>E-post:</b></td><td style="padding: 8px; border: 1px solid #ddd;">{request_data['email']}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd;"><b>Namn:</b></td><td style="padding: 8px; border: 1px solid #ddd;">{request_data['name']}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd;"><b>Företag:</b></td><td style="padding: 8px; border: 1px solid #ddd;">{request_data.get('company') or '-'}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd;"><b>Användning:</b></td><td style="padding: 8px; border: 1px solid #ddd;">{request_data['use_case']}</td></tr>
            </table>
            <p style="margin: 20px 0;">
                <a href="{approve_url}" style="background:#22c55e;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;margin-right:10px;">✓ Godkänn</a>
                <a href="{reject_url}" style="background:#ef4444;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;">✗ Neka</a>
            </p>
            """
        })
        return True
    except Exception as e:
        print(f"Failed to send admin notification: {e}")
        return False


async def send_key_to_user(email: str, name: str, api_key: str):
    """Send the generated API key to the user"""
    try:
        import resend
        resend.api_key = os.environ.get("RESEND_API_KEY")

        if not resend.api_key:
            print(f"Email not configured. Key for {email}: {api_key}")
            return False

        resend.Emails.send({
            "from": "Loop API <onboarding@resend.dev>",
            "to": email,
            "subject": "Din Loop API-nyckel",
            "html": f"""
            <h2>Välkommen till Loop API!</h2>
            <p>Hej {name},</p>
            <p>Din ansökan har godkänts. Här är din API-nyckel:</p>
            <p style="background:#f4f4f4;padding:15px;font-family:monospace;font-size:16px;border-radius:5px;">
                {api_key}
            </p>
            <h3>Kom igång</h3>
            <p>Inkludera nyckeln i headern <code>X-API-Key</code> i alla anrop:</p>
            <pre style="background:#f4f4f4;padding:15px;border-radius:5px;overflow-x:auto;">
curl "https://loop-auto-api.onrender.com/api/v1/lookup?name=spotify" \\
  -H "X-API-Key: {api_key}"
            </pre>
            <p><a href="https://loop-auto-api.onrender.com/docs">Se full API-dokumentation →</a></p>
            <hr style="margin:30px 0;border:none;border-top:1px solid #eee;">
            <p style="color:#666;font-size:12px;">
                Rate limits: 100 anrop/minut generellt, 10 anrop/minut för berikning.
            </p>
            """
        })
        return True
    except Exception as e:
        print(f"Failed to send key to user: {e}")
        return False


@app.post("/api/v1/request-key", tags=["API-nycklar"])
async def request_api_key(req: ApiKeyRequest):
    """
    Ansök om en API-nyckel.

    Skicka in din e-post, namn och användningsområde.
    Du får svar inom 24 timmar.
    """
    db = get_database()

    # Check if email already has an active key
    existing = db.client.table('api_keys') \
        .select('id') \
        .eq('email', req.email) \
        .eq('status', 'active') \
        .execute()

    if existing.data:
        raise HTTPException(
            status_code=400,
            detail="Det finns redan en aktiv API-nyckel för denna e-postadress"
        )

    # Check for pending request
    pending = db.client.table('key_requests') \
        .select('id') \
        .eq('email', req.email) \
        .eq('status', 'pending') \
        .execute()

    if pending.data:
        raise HTTPException(
            status_code=400,
            detail="Det finns redan en väntande ansökan för denna e-postadress"
        )

    # Create approval token
    approval_token = generate_approval_token()

    # Store request
    db.client.table('key_requests').insert({
        'email': req.email,
        'name': req.name,
        'company': req.company,
        'use_case': req.use_case,
        'approval_token': approval_token,
        'status': 'pending'
    }).execute()

    # Build approval URLs
    base_url = os.environ.get("API_BASE_URL", "https://loop-auto-api.onrender.com")
    admin_secret = os.environ.get("ADMIN_SECRET", "")
    approve_url = f"{base_url}/admin/approve/{approval_token}?secret={admin_secret}"
    reject_url = f"{base_url}/admin/reject/{approval_token}?secret={admin_secret}"

    # Send notification to admin
    await send_admin_notification(
        {'email': req.email, 'name': req.name, 'company': req.company, 'use_case': req.use_case},
        approve_url,
        reject_url
    )

    return {
        "success": True,
        "message": "Din ansökan har skickats. Du får svar inom 24 timmar."
    }


@app.get("/admin/approve/{token}", tags=["Admin"], include_in_schema=False)
async def approve_request(token: str, secret: str = Query(...)):
    """Approve an API key request (admin only)"""
    admin_secret = os.environ.get("ADMIN_SECRET", "")

    if not admin_secret or secret != admin_secret:
        raise HTTPException(status_code=403, detail="Invalid admin secret")

    db = get_database()

    # Find request
    result = db.client.table('key_requests') \
        .select('*') \
        .eq('approval_token', token) \
        .eq('status', 'pending') \
        .execute()

    if not result.data:
        return HTMLResponse(content="""
        <html><body style="font-family:sans-serif;max-width:600px;margin:50px auto;text-align:center;">
        <h1 style="color:#ef4444;">❌ Ansökan hittades inte</h1>
        <p>Ansökan kan redan vara behandlad eller länken är ogiltig.</p>
        </body></html>
        """)

    request_data = result.data[0]

    # Generate API key
    new_api_key = generate_api_key()

    # Create API key in database
    db.client.table('api_keys').insert({
        'api_key': new_api_key,
        'email': request_data['email'],
        'name': request_data['name'],
        'status': 'active'
    }).execute()

    # Update request status
    db.client.table('key_requests') \
        .update({'status': 'approved', 'processed_at': datetime.now().isoformat()}) \
        .eq('id', request_data['id']) \
        .execute()

    # Send key to user
    await send_key_to_user(request_data['email'], request_data['name'], new_api_key)

    return HTMLResponse(content=f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:50px auto;text-align:center;">
    <h1 style="color:#22c55e;">✅ Godkänd!</h1>
    <p>API-nyckel har skapats och skickats till <b>{request_data['email']}</b></p>
    <p style="background:#f4f4f4;padding:15px;font-family:monospace;border-radius:5px;">{new_api_key}</p>
    </body></html>
    """)


@app.get("/admin/reject/{token}", tags=["Admin"], include_in_schema=False)
async def reject_request(token: str, secret: str = Query(...)):
    """Reject an API key request (admin only)"""
    admin_secret = os.environ.get("ADMIN_SECRET", "")

    if not admin_secret or secret != admin_secret:
        raise HTTPException(status_code=403, detail="Invalid admin secret")

    db = get_database()

    # Find request
    result = db.client.table('key_requests') \
        .select('*') \
        .eq('approval_token', token) \
        .eq('status', 'pending') \
        .execute()

    if not result.data:
        return HTMLResponse(content="""
        <html><body style="font-family:sans-serif;max-width:600px;margin:50px auto;text-align:center;">
        <h1 style="color:#ef4444;">❌ Ansökan hittades inte</h1>
        <p>Ansökan kan redan vara behandlad eller länken är ogiltig.</p>
        </body></html>
        """)

    request_data = result.data[0]

    # Update request status
    db.client.table('key_requests') \
        .update({'status': 'rejected', 'processed_at': datetime.now().isoformat()}) \
        .eq('id', request_data['id']) \
        .execute()

    return HTMLResponse(content=f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:50px auto;text-align:center;">
    <h1 style="color:#ef4444;">❌ Nekad</h1>
    <p>Ansökan från <b>{request_data['email']}</b> har nekats.</p>
    </body></html>
    """)


# ==================== NEWS API ====================

class NewsArticle(BaseModel):
    title: str
    url: str
    source: str
    summary: Optional[str] = None
    published_at: Optional[str] = None
    image_url: Optional[str] = None


@app.get("/api/v1/news/search/{company_name}", tags=["News"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def search_company_news(
    request: Request,
    company_name: str = Path(..., description="Företagsnamn att söka nyheter för"),
    limit: int = Query(10, ge=1, le=50, description="Max antal nyheter")
):
    """
    Sök efter nyheter om ett specifikt företag.

    Söker i svenska och internationella nyhetskällor efter artiklar
    som nämner företaget. Använder RSS-feeds och keyword-filtrering.

    **Källor:**
    - Breakit, Realtid, Ny Teknik, DI (svenska)
    - TechCrunch, Wired, BBC Tech/Business (internationella)
    """
    try:
        from .news_client import SwedishNewsClient

        client = SwedishNewsClient()

        # Search for articles mentioning the company
        articles = client.search_company(company_name, limit=limit)

        return {
            "foretag": company_name,
            "antal": len(articles.articles),
            "nyheter": [
                {
                    "titel": a.title,
                    "url": a.url,
                    "kalla": a.source,
                    "sammanfattning": getattr(a, 'summary', None),
                    "publicerad": getattr(a, 'published_at', None),
                    "bild_url": getattr(a, 'image_url', None)
                }
                for a in articles.articles
            ]
        }
    except ImportError:
        raise HTTPException(status_code=501, detail="News client not available")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kunde inte hämta nyheter: {str(e)}")


@app.get("/api/v1/news/latest", tags=["News"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def get_latest_news(
    request: Request,
    source: Optional[str] = Query(None, description="Källa: breakit, realtid, di, nyteknik, techcrunch, wired, bbc-tech"),
    limit: int = Query(20, ge=1, le=100, description="Max antal nyheter")
):
    """
    Hämta senaste nyheterna från svenska och internationella källor.

    **Svenska källor:**
    - `breakit` - Tech och startups
    - `realtid` - Finans och affärer
    - `di` - Dagens Industri
    - `nyteknik` - Teknisk utveckling

    **Internationella källor (impact-filtrerade):**
    - `techcrunch` - TechCrunch Startups
    - `wired` - Wired Technology
    - `bbc-tech` - BBC Technology
    - `bbc-business` - BBC Business
    """
    try:
        from .news_client import SwedishNewsClient

        client = SwedishNewsClient()

        if source:
            # Single source - use get_latest with string
            articles = client.get_latest(source, limit=limit)
        else:
            # Multiple sources - FIXED: use get_from_sources instead of get_latest with list
            articles = client.get_from_sources(['breakit', 'realtid', 'techcrunch'], limit=limit)

        return {
            "kalla": source or "mixed",
            "antal": len(articles),
            "nyheter": [
                {
                    "titel": a.title,
                    "url": a.url,
                    "kalla": a.source,
                    "sammanfattning": getattr(a, 'summary', None),
                    "publicerad": getattr(a, 'published_at', None)
                }
                for a in articles
            ]
        }
    except ImportError:
        raise HTTPException(status_code=501, detail="News client not available")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kunde inte hämta nyheter: {str(e)}")


@app.get("/api/v1/news/sources", tags=["News"])
@limiter.limit(RATE_LIMIT_DEFAULT)
async def list_news_sources(request: Request):
    """
    Lista alla tillgängliga nyhetskällor.
    """
    return {
        "svenska": [
            {"id": "breakit", "namn": "Breakit", "typ": "Tech/Startups", "rss": True},
            {"id": "realtid", "namn": "Realtid", "typ": "Finans", "rss": True},
            {"id": "di", "namn": "Dagens Industri", "typ": "Affärer", "rss": False},
            {"id": "nyteknik", "namn": "Ny Teknik", "typ": "Tech", "rss": False},
            {"id": "svd", "namn": "SvD Näringsliv", "typ": "Affärer", "rss": False}
        ],
        "internationella": [
            {"id": "techcrunch", "namn": "TechCrunch", "typ": "Tech/Startups", "rss": True, "impact_filter": True},
            {"id": "wired", "namn": "Wired", "typ": "Tech/Innovation", "rss": True, "impact_filter": True},
            {"id": "bbc-tech", "namn": "BBC Technology", "typ": "Tech News", "rss": True, "impact_filter": True},
            {"id": "bbc-business", "namn": "BBC Business", "typ": "Business/Finance", "rss": True, "impact_filter": True}
        ]
    }


# ==================== ERROR HANDLERS ====================

def generate_request_id() -> str:
    """Generate unique request ID for error tracking"""
    return str(uuid.uuid4())[:8]


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    """Add request ID to all responses for tracking"""
    request_id = request.headers.get("X-Request-ID", generate_request_id())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle Pydantic validation errors"""
    request_id = getattr(request.state, 'request_id', generate_request_id())

    # Extract field errors
    errors = []
    for error in exc.errors():
        errors.append({
            "field": ".".join(str(loc) for loc in error["loc"]),
            "message": error["msg"],
            "type": error["type"]
        })

    return JSONResponse(
        status_code=422,
        content={
            "error": True,
            "message": "Validation error",
            "request_id": request_id,
            "details": {
                "errors": errors
            }
        }
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions with request ID"""
    request_id = getattr(request.state, 'request_id', generate_request_id())

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": True,
            "message": exc.detail,
            "request_id": request_id,
            "status_code": exc.status_code
        }
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions"""
    request_id = getattr(request.state, 'request_id', generate_request_id())

    # Log the error (in production, send to error tracking)
    import traceback
    error_trace = traceback.format_exc()

    # Don't expose internal details in production
    return JSONResponse(
        status_code=500,
        content={
            "error": True,
            "message": "Internal server error",
            "request_id": request_id,
            "type": type(exc).__name__,
            "details": {
                "hint": "Check server logs with request_id for details"
            }
        }
    )
