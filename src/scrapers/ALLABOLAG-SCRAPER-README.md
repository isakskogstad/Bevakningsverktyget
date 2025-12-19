# Allabolag Scraper

Uppdaterad scraper för att hämta utökad bolagsdata från Allabolag.se med integration till Supabase.

## Funktioner

- **Grundläggande bolagsinfo**: Namn, organisationsnummer, adress, kontaktuppgifter
- **Styrelse och ledning**: Alla roller med födelsedatum och kategorisering
- **Finansiella data**: Senaste 5 år av resultat- och balansräkning
- **Koncernstruktur**: Moderbolag och dotterbolag
- **Registreringar**: F-skatt, moms, arbetsgivare
- **SNI-koder**: Branschklassificering
- **Kungörelser**: Senaste 10 kungörelserna

## Användning

### Python (med Supabase)

```python
from scrapers.allabolag_scraper import AllabolagScraper
import os

# Initiera med Supabase credentials
scraper = AllabolagScraper(
    supabase_url=os.getenv('SUPABASE_URL'),
    supabase_key=os.getenv('SUPABASE_SERVICE_KEY'),
    delay=1.0,  # 1 sekund mellan anrop
    cache_hours=24  # Uppdatera bara om data är äldre än 24h
)

# Scrapa bolag (sync)
data = scraper.scrape_company('5567676827')

# Async version
import asyncio
data = asyncio.run(scraper.scrape_company_async('5567676827'))

# Force scraping (ignorera cache)
data = scraper.scrape_company('5567676827', force=True)
```

### Python (utan Supabase)

```python
from scrapers.allabolag_scraper import scrape_allabolag

# Quick scrape utan databas-integration
data = scrape_allabolag('5567676827')

# Data struktur
print(data['name'])           # Företagsnamn
print(data['roles'])          # Lista med styrelse/ledning
print(data['financials'])     # Lista med finansiella perioder
print(data['related_companies'])  # Koncernstruktur
```

### Node.js

```javascript
const { scrapeCompany } = require('./allabolag-scraper');

// Scrapa bolag
const data = await scrapeCompany('5567676827');

// Med custom delay
const data = await scrapeCompany('5567676827', { delay: 2000 });

// Data struktur
console.log(data.name);           // Företagsnamn
console.log(data.roles);          // Styrelse/ledning
console.log(data.financials);     // Finansiella data
console.log(data.related_companies);  // Koncernstruktur
```

## Data Struktur

### company_details

```javascript
{
  orgnr: '5567676827',
  name: 'Företaget AB',
  company_type: 'AB',
  status: 'ACTIVE',

  // Adress
  postal_street: 'Kungsgatan 1',
  postal_code: '11143',
  postal_city: 'Stockholm',
  visiting_street: 'Kungsgatan 1',
  visiting_code: '11143',
  visiting_city: 'Stockholm',

  // Kontakt
  phone: '08-123 456 78',
  email: 'info@foretaget.se',
  website: 'https://foretaget.se',

  // GPS
  latitude: 59.3293,
  longitude: 18.0686,

  // Registreringar
  f_skatt: 1,
  moms_registered: 1,
  employer_registered: 1,

  // Koncern
  is_group: 1,
  companies_in_group: 5,
  parent_orgnr: '5567676826',
  parent_name: 'Moderbolaget AB',

  // Finansiellt
  revenue: 15000000,
  net_profit: 2000000,
  total_assets: 10000000,
  equity: 5000000,
  num_employees: 25,
  equity_ratio: 50.0,
  return_on_equity: 15.5,

  // Metadata
  source_basic: 'allabolag',
  last_synced_at: '2025-12-19T12:00:00Z'
}
```

### company_roles

```javascript
[
  {
    orgnr: '5567676827',
    name: 'Anna Andersson',
    birth_year: 1975,
    role_type: 'Verkställande direktör',
    role_category: 'MANAGEMENT',
    source: 'allabolag'
  },
  {
    orgnr: '5567676827',
    name: 'Erik Eriksson',
    birth_year: 1968,
    role_type: 'Styrelseordförande',
    role_category: 'BOARD',
    source: 'allabolag'
  },
  {
    orgnr: '5567676827',
    name: 'Maria Nilsson',
    birth_year: 1982,
    role_type: 'Styrelseledamot',
    role_category: 'BOARD',
    source: 'allabolag'
  }
]
```

### company_financials

```javascript
[
  {
    orgnr: '5567676827',
    period_year: 2024,
    period_months: 12,
    is_consolidated: 0,

    // Resultaträkning
    revenue: 15000000,
    operating_costs: -12000000,
    operating_profit: 3000000,
    net_profit: 2000000,

    // Balansräkning
    total_assets: 10000000,
    equity: 5000000,
    cash: 1000000,

    // Nyckeltal
    equity_ratio: 50.0,
    return_on_equity: 15.5,

    // Personal
    num_employees: 25,

    source: 'allabolag'
  },
  {
    orgnr: '5567676827',
    period_year: 2023,
    period_months: 12,
    is_consolidated: 0,
    // ... föregående år
  }
]
```

## Rate Limiting

- **Minimum 1 sekund** mellan anrop (default)
- Konfigurerbart via `delay` parameter
- Automatisk hantering av rate limits

## Caching

Python-versionen har inbyggd caching via Supabase:

- Kontrollerar `last_synced_at` i `company_details`
- Uppdaterar endast om data är äldre än `cache_hours` (default 24h)
- Använd `force=True` för att ignorera cache

## Felhantering

- Graceful fallbacks om vissa fält saknas
- Loggar fel till console
- Returnerar `null`/`None` om scraping misslyckas

## Dependencies

### Python
```bash
pip install httpx beautifulsoup4 supabase
```

### Node.js
```bash
npm install axios cheerio
```

## Tabellschema

Se `/supabase/migrations/` för fullständiga tabellscheman.

Huvudtabeller:
- `company_details` - Grundläggande bolagsinfo
- `company_roles` - Styrelse, ledning, revisorer
- `company_financials` - Finansiella perioder

## Integration med Loop Auto API

För att berika bolagsdata från Loop Auto:

```python
from scrapers.allabolag_scraper import AllabolagScraper

scraper = AllabolagScraper(
    supabase_url=os.getenv('SUPABASE_URL'),
    supabase_key=os.getenv('SUPABASE_SERVICE_KEY')
)

# Hämta bolag från Loop Auto
loop_data = fetch_from_loop_auto(orgnr)

# Berika med Allabolag-data
allabolag_data = scraper.scrape_company(orgnr)

# Kombinera och visa i detaljvy
enriched_data = {**loop_data, **allabolag_data}
```

## Exempel: Batch-scraping

```python
import asyncio
from scrapers.allabolag_scraper import AllabolagScraper

scraper = AllabolagScraper(
    supabase_url=os.getenv('SUPABASE_URL'),
    supabase_key=os.getenv('SUPABASE_SERVICE_KEY')
)

orgnrs = ['5567676827', '5561234567', '5569876543']

# Async batch scraping
async def scrape_all():
    tasks = [scraper.scrape_company_async(orgnr) for orgnr in orgnrs]
    results = await asyncio.gather(*tasks)
    return results

results = asyncio.run(scrape_all())
```

## Rate Limits och Best Practices

- **Respektera Allabolags webbplats**: Använd rimliga delays (minst 1 sekund)
- **Batch-scraping**: Använd async version för bättre prestanda
- **Caching**: Aktivera caching för att minska antal anrop
- **Error handling**: Hantera alltid potentiella fel gracefully

## Support

Se källkoden för fullständig dokumentation:
- `/src/scrapers/allabolag_scraper.py` (Python)
- `/src/scrapers/allabolag-scraper.js` (Node.js)
