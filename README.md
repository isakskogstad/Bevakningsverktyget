# Bevakningsverktyg

Ett automatiserat bevakningsverktyg för svenska företag som övervakar Post- och Inrikes Tidningar (POIT) samt hämtar företagsinformation från olika källor.

## Funktioner

- **POIT-bevakning**: Övervakar Post- och Inrikes Tidningar för händelser som styrelseändringar, konkurser, likvidationer, fusioner och bolagsordningsändringar
- **Bolagsverket**: Hämtar bolagsstämmoprotokoll och företagsinformation
- **DI.se**: Scraper för artiklar från Dagens Industri (kräver prenumeration)
- **Ratsit**: Hämtar inkomstdeklarationer och företagsinformation
- **Allabolag**: Scraper för företagsinformation
- **Automatisk schemaläggning**: Periodiska kontroller enligt konfigurerat intervall
- **Notifikationer**: E-post och SMS-notifikationer vid händelser

## Installation

### Förutsättningar

- Node.js 18+ (för JavaScript-scrapers)
- Python 3.9+ (för Python-scrapers)
- PostgreSQL-databas (via Supabase)

### Steg 1: Klona repository

```bash
git clone https://github.com/isakskogstad/Bevakningsverktyget.git
cd Bevakningsverktyget
```

### Steg 2: Installera beroenden

#### JavaScript/Node.js
```bash
npm install
```

#### Python
```bash
pip install -r requirements.txt
```

### Steg 3: Konfigurera miljövariabler

Kopiera `.env.example` till `.env` och fyll i dina värden:

```bash
cp .env.example .env
```

Redigera `.env` och fyll i minst följande **obligatoriska** värden:

```bash
# Supabase (OBLIGATORISK)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key

# CORS (säkerhetsinställning)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8000
```

### Steg 4: Skapa företagslista

Skapa en fil `companies.json` i projektets rotkatalog med företag att bevaka:

```json
[
  {
    "namn": "Företag AB",
    "orgnr": "556123-4567"
  },
  {
    "namn": "Annat Företag AB",
    "orgnr": "559876-5432"
  }
]
```

## Konfiguration

### Obligatoriska miljövariabler

| Variabel | Beskrivning |
|----------|-------------|
| `SUPABASE_URL` | URL till din Supabase-instans |
| `SUPABASE_KEY` | Anon/public key från Supabase |
| `SUPABASE_SERVICE_KEY` | Service role key från Supabase |
| `ALLOWED_ORIGINS` | Kommaseparerad lista över tillåtna CORS-origins |

### Valfria miljövariabler för specifika funktioner

#### DI.se-scraper
```bash
DI_EMAIL=din@epost.se
DI_PASSWORD=ditt-losenord
```

#### Kortbetalningar (för köp av protokoll)
```bash
SECURE_3D_PASSWORD=ditt-3d-secure-losenord
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+46xxxxxxxxx
```

#### E-postnotifikationer
```bash
RESEND_API_KEY=re_xxxxx
```

#### Ratsit-scraper
```bash
RATSIT_EMAIL=ditt@foretag.se
RATSIT_PASSWORD=ditt-losenord
```

#### CAPTCHA-lösare (valfritt)
```bash
NOPECHA_API_KEY=din-nyckel
```

Se `.env.example` för fullständig lista över alla tillgängliga konfigurationsalternativ.

## Användning

### Starta huvudapplikationen (Python/FastAPI)

```bash
# Utvecklingsläge
python -m src.main

# Produktion (med uvicorn)
uvicorn src.main:app --host 0.0.0.0 --port 8000
```

API-dokumentation finns tillgänglig på `http://localhost:8000/docs`

### Köra specifika scrapers

#### POIT-bevakning
```bash
node lib/scrapers/poit-scraper.js
```

#### DI.se artikel
```bash
node src/scrapers/di-article-scraper.js <artikel-url>
```

#### Bolagsverket protokoll
```bash
node lib/scrapers/protokoll-scraper.js <orgnr> <email@example.com>
```

#### Ratsit inkomstuppgifter
```bash
python3 lib/scrapers/ratsit-drissionpage.py --action search --query "Person Namn Stad"
```

### Köra tester

```bash
# JavaScript-tester
npm test

# Python-tester
python -m pytest tests/
```

### Linting

```bash
# Kontrollera kodkvalitet
npm run lint

# Automatisk fix av problem
npm run lint:fix
```

## Arkitektur

```
Bevakningsverktyget/
├── src/                    # Python FastAPI-applikation
│   ├── main.py            # Huvudapplikation med API
│   ├── config.py          # Konfigurationshantering
│   ├── api/               # API routes
│   ├── services/          # Business logic
│   └── scrapers/          # Python scrapers
├── lib/                   # JavaScript/Node.js bibliotek
│   ├── scrapers/          # Olika scrapers
│   ├── services/          # Tjänster (SMS, logging etc)
│   └── utils/             # Hjälpfunktioner
├── scripts/               # Standalone scripts
├── data/                  # Data och cache
├── docs/                  # Dokumentation
└── tests/                 # Tester
```

## Säkerhet

⚠️ **VIKTIGT**: Detta verktyg hanterar känslig information och kredentialer.

- **Lagra ALDRIG** kredentialer i källkoden
- Använd alltid miljövariabler för känsliga värden
- Håll din `.env`-fil privat och versionskontrollera den INTE
- Använd starka lösenord och API-nycklar
- Begränsa CORS origins till endast betrodda domäner i produktion
- Granska regelbundet åtkomstloggar och användning

### Säkerhetsfunktioner

- Daglig utgiftsgräns för automatiska köp (100 SEK)
- Loggning av alla köp och transaktioner
- Validering innan betalning
- Krypterad lagring av API-nycklar (om admin-panel används)

## Bidra

1. Forka repository
2. Skapa en feature branch (`git checkout -b feature/ny-funktion`)
3. Committa dina ändringar (`git commit -am 'Lägg till ny funktion'`)
4. Pusha till branch (`git push origin feature/ny-funktion`)
5. Skapa en Pull Request

## Licens

Se LICENSE-filen för detaljer.

## Support

För frågor eller problem, skapa en issue på GitHub: https://github.com/isakskogstad/Bevakningsverktyget/issues

## Författare

- Isak Skogstad

## Disclaimer

Detta verktyg är avsett för laglig användning endast. Användaren ansvarar för att följa alla tillämpliga lagar och användarvillkor för de tjänster som scrappas.
