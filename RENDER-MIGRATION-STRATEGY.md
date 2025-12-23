# Bevakningsverktyget: GitHub Pages → Render.com Migration Strategy

## Executive Summary

Denna strategi beskriver en komplett migrering av Bevakningsverktyget från GitHub Pages (statisk frontend) till en fullstack Render.com deployment som kombinerar frontend, backend och Docker-stöd för Puppeteer-scrapers.

**Målsättning:** En unified fullstack-applikation på Render.com med:
- Express.js server som serverar statiska filer + API-routes
- Docker-container med Chrome för headless scraping
- Supabase som databas och Edge Functions
- Automatisk deployment via GitHub push

---

## 1. Nuvarande Arkitektur (Baseline)

### 1.1 Frontend (GitHub Pages)
```
docs/
├── index.html              # Dashboard
├── assets/
│   ├── css/               # 6 CSS-filer
│   └── js/                # 5 JS-filer (config, auth, api, utils, components)
├── verktyg/               # 10 verktygsidor
├── nyhetsverktyg/         # 3 nyhetsverktyg
├── admin/                 # Admin-sidor
├── installningar/         # Inställningar
└── sms-notiser/          # SMS-konfiguration
```

**Problem med nuvarande setup:**
- Secrets (Supabase keys) exponerade i `config.js`
- Ingen server-side rendering
- Ingen backend-koppling (bara Edge Functions)
- Kan inte köra Puppeteer-scrapers

### 1.2 Backend (Fragmenterat)
| Komponent | Teknologi | Körning |
|-----------|-----------|---------|
| Python FastAPI | `src/main.py` | Lokalt/Docker |
| Node.js Scripts | `scripts/`, `src/scrapers/` | Lokalt med Chrome |
| Edge Functions | `supabase/functions/` | Supabase Cloud |

### 1.3 Databas
- **Provider:** Supabase PostgreSQL
- **Tabeller:** companies (1358), roles (8528), financials (6381), poit_announcements (3805)
- **RLS:** Aktiverat

---

## 2. Ny Arkitektur (Target State)

### 2.1 Arkitekturdiagram
```
┌─────────────────────────────────────────────────────────────┐
│                     RENDER.COM                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │            WEB SERVICE (Docker)                      │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │              EXPRESS.JS SERVER              │    │    │
│  │  │                                             │    │    │
│  │  │  ┌─────────────┐    ┌─────────────────┐    │    │    │
│  │  │  │   STATIC    │    │   API ROUTES    │    │    │    │
│  │  │  │   FILES     │    │                 │    │    │    │
│  │  │  │  (public/)  │    │  /api/scrape    │    │    │    │
│  │  │  │             │    │  /api/poit      │    │    │    │
│  │  │  │  HTML/CSS   │    │  /api/budget    │    │    │    │
│  │  │  │  JS/Assets  │    │  /health        │    │    │    │
│  │  │  └─────────────┘    └─────────────────┘    │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  │                        │                            │    │
│  │                        ▼                            │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │         CHROME/PUPPETEER (Headless)         │    │    │
│  │  │                                             │    │    │
│  │  │  Scrapers: Allabolag, POIT, Protokoll      │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      SUPABASE                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  PostgreSQL  │  │    Edge      │  │   Storage    │       │
│  │   Database   │  │  Functions   │  │    (CDN)     │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Ny Mappstruktur
```
Bevakningsverktyget/
├── server/                    # NY: Express server
│   ├── index.js              # Huvudserver
│   ├── routes/               # API-routes
│   │   ├── api.js
│   │   ├── scraper.js
│   │   └── health.js
│   └── middleware/           # Express middleware
│       ├── inject-env.js     # Inject env vars i HTML
│       └── error-handler.js
├── public/                   # Flyttad: docs/ → public/
│   ├── index.html
│   ├── assets/
│   ├── verktyg/
│   ├── nyhetsverktyg/
│   ├── admin/
│   ├── installningar/
│   └── sms-notiser/
├── scrapers/                 # Flyttad/omorganiserad
│   ├── allabolag.js
│   ├── poit.js
│   ├── protokoll.js
│   └── browser-factory.js
├── supabase/                 # Oförändrad
│   └── functions/
├── Dockerfile                # Uppdaterad för Node.js + Chrome
├── docker-compose.yml
├── render.yaml               # NY: Render Blueprint
├── package.json              # Uppdaterad
├── .env.example
└── .gitignore
```

---

## 3. Implementation Plan

### Fas 1: Förberedelser (30 min)
**Mål:** Säkerhetskopiera och förbereda repo

```bash
# 1. Skapa backup
git checkout -b pre-render-migration
git push origin pre-render-migration

# 2. Skapa ny migration branch
git checkout main
git checkout -b render-migration
```

### Fas 2: Skapa Express Server (45 min)
**Mål:** Fungerande Express server som serverar statiska filer

**Nya filer att skapa:**

#### `server/index.js`
```javascript
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment config
const ENV_CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  API_BASE_URL: process.env.API_BASE_URL || '',
  NODE_ENV: process.env.NODE_ENV || 'development'
};

// Middleware
app.use(cors());
app.use(express.json());

// Health check (för Render)
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Inject env vars i HTML-filer
app.use((req, res, next) => {
  // Endast för HTML-filer och root
  const isHtmlRequest = req.path.endsWith('.html') ||
                        req.path.endsWith('/') ||
                        !req.path.includes('.');

  if (isHtmlRequest) {
    let filePath;
    if (req.path === '/' || req.path === '/index.html') {
      filePath = path.join(__dirname, '../public/index.html');
    } else if (req.path.endsWith('/')) {
      filePath = path.join(__dirname, '../public', req.path, 'index.html');
    } else {
      filePath = path.join(__dirname, '../public', req.path);
      if (!filePath.endsWith('.html')) {
        filePath = path.join(__dirname, '../public', req.path, 'index.html');
      }
    }

    if (fs.existsSync(filePath)) {
      let html = fs.readFileSync(filePath, 'utf8');

      // Inject meta tags efter <head>
      const metaTags = `
    <!-- Environment Config (injected by server) -->
    <meta name="supabase-url" content="${ENV_CONFIG.SUPABASE_URL || ''}">
    <meta name="supabase-anon-key" content="${ENV_CONFIG.SUPABASE_ANON_KEY || ''}">
    <meta name="api-base-url" content="${ENV_CONFIG.API_BASE_URL || ''}">
    <script>
      window.ENV = {
        SUPABASE_URL: "${ENV_CONFIG.SUPABASE_URL || ''}",
        SUPABASE_ANON_KEY: "${ENV_CONFIG.SUPABASE_ANON_KEY || ''}",
        API_BASE_URL: "${ENV_CONFIG.API_BASE_URL || ''}"
      };
    </script>`;

      html = html.replace('<head>', '<head>' + metaTags);
      return res.send(html);
    }
  }
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));

// API routes
app.use('/api', require('./routes/api'));

// SPA fallback - alla okända routes -> index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Serving static files from: ${path.join(__dirname, '../public')}`);
  console.log(`🔧 Environment: ${ENV_CONFIG.NODE_ENV}`);
});
```

#### `server/routes/api.js`
```javascript
const express = require('express');
const router = express.Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// Proxy till Supabase Edge Functions (om needed)
router.post('/edge/:function', async (req, res) => {
  const functionName = req.params.function;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/${functionName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`
        },
        body: JSON.stringify(req.body)
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

### Fas 3: Flytta Frontend (15 min)
**Mål:** Flytta docs/ till public/

```bash
# Flytta docs till public
mv docs public

# Uppdatera config.js för att använda window.ENV
# Se nästa sektion
```

#### Uppdatera `public/assets/js/config.js`
```javascript
/* ==========================================================================
   CONFIG - Applikationskonfiguration
   Med stöd för server-injicerade environment variables
   ========================================================================== */

// Hämta config från window.ENV (injicerat av server) eller fallback
const getEnvValue = (key, fallback = '') => {
  if (typeof window !== 'undefined' && window.ENV && window.ENV[key]) {
    return window.ENV[key];
  }
  return fallback;
};

const CONFIG = {
    // Supabase - nu med env var support
    supabase: {
        url: getEnvValue('SUPABASE_URL', 'https://wzkohritxdrstsmwopco.supabase.co'),
        anonKey: getEnvValue('SUPABASE_ANON_KEY', ''),  // Tas bort i produktion
        publishableKey: 'sb_publishable_Bveoa4m3wp8BwLCeXYhP5Q_W4NzfUgT'
    },

    // API endpoints
    api: {
        baseUrl: getEnvValue('API_BASE_URL', 'https://loop-auto-api.onrender.com'),
        // API key bör INTE vara i frontend-kod i produktion
        // Flytta till server-side proxy
    },

    // Edge Functions
    edgeFunctions: {
        rssProxy: '/functions/v1/rss-proxy',
        mynewsdeskProxy: '/functions/v1/mynewsdesk-proxy',
        sendSms: '/functions/v1/send-sms'
    },

    // App settings
    app: {
        name: 'Bevakningsverktyget',
        version: '2.0.0',
        defaultPageSize: 20,
        maxPageSize: 100,
        refreshInterval: 60000
    },

    // POIT-kategorier
    poitCategories: {
        'Konkurs': { class: 'tag-konkurs', icon: '⚠️' },
        'Nyregistrering': { class: 'tag-registrering', icon: '🆕' },
        'Ändring': { class: 'tag-andring', icon: '✏️' },
        'Kallelse': { class: 'tag-kallelse', icon: '📢' },
        'Skuld': { class: 'tag-skuld', icon: '💰' },
        'Fusion': { class: 'tag-fusion', icon: '🔄' },
        'Likvidation': { class: 'tag-likvidation', icon: '📉' }
    },

    // Debug mode
    debug: typeof window !== 'undefined' &&
           (window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1')
};

// Frys konfigurationen
Object.freeze(CONFIG);
Object.freeze(CONFIG.supabase);
Object.freeze(CONFIG.api);
Object.freeze(CONFIG.edgeFunctions);
Object.freeze(CONFIG.app);
Object.freeze(CONFIG.poitCategories);

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
```

### Fas 4: Docker-konfiguration (30 min)
**Mål:** Uppdatera Dockerfile för Node.js + Chrome

#### `Dockerfile` (UPPDATERAD)
```dockerfile
# ================================================
# Bevakningsverktyget - Fullstack Docker Image
# Node.js + Chrome för Puppeteer scraping
# ================================================

FROM node:20-slim

# Installera Chrome dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Installera Chrome
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set environment
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV NODE_ENV=production

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["node", "server/index.js"]
```

### Fas 5: Render Configuration (20 min)
**Mål:** Skapa render.yaml blueprint

#### `render.yaml` (NY)
```yaml
# ================================================
# Bevakningsverktyget - Render Blueprint
# Infrastructure as Code
# ================================================

services:
  - type: web
    name: bevakningsverktyget
    runtime: docker
    region: frankfurt  # Nära Sverige
    plan: standard     # Ändra till 'free' för test

    # Docker config
    dockerfilePath: ./Dockerfile
    dockerContext: ./

    # Health check
    healthCheckPath: /health

    # Environment variables
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3000

      # Supabase (sätt manuellt i Dashboard)
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_ANON_KEY
        sync: false
      - key: SUPABASE_SERVICE_KEY
        sync: false

      # API
      - key: API_BASE_URL
        sync: false

      # Puppeteer
      - key: PUPPETEER_EXECUTABLE_PATH
        value: /usr/bin/google-chrome-stable
      - key: HEADLESS
        value: "true"

      # Optional: Twilio för SMS
      - key: TWILIO_ACCOUNT_SID
        sync: false
      - key: TWILIO_AUTH_TOKEN
        sync: false
      - key: TWILIO_PHONE_NUMBER
        sync: false

      # Optional: Anthropic för AI
      - key: ANTHROPIC_API_KEY
        sync: false

    # Auto-deploy från GitHub
    autoDeploy: true

    # Build filter (om monorepo)
    # buildFilter:
    #   paths:
    #     - server/**
    #     - public/**
    #     - scrapers/**
    #     - Dockerfile
```

### Fas 6: Uppdatera package.json (10 min)

#### `package.json` (UPPDATERAD)
```json
{
  "name": "bevakningsverktyget",
  "version": "2.0.0",
  "description": "Svenskt företagsbevakningsverktyg",
  "main": "server/index.js",
  "scripts": {
    "start": "node server/index.js",
    "dev": "nodemon server/index.js",
    "test": "jest",
    "build": "echo 'No build step needed'",

    "scrape:poit": "node scrapers/poit.js",
    "scrape:allabolag": "node scrapers/allabolag.js",
    "scrape:protokoll": "node scrapers/protokoll.js"
  },
  "engines": {
    "node": ">=18.x"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.71.2",
    "@supabase/supabase-js": "^2.89.0",
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "puppeteer": "^22.0.0",
    "puppeteer-extra": "^3.3.6",
    "puppeteer-extra-plugin-stealth": "^2.11.2",
    "resend": "^6.6.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1",
    "jest": "^29.7.0"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/isakskogstad/Bevakningsverktyget.git"
  },
  "author": "Isak Skogstad",
  "license": "MIT"
}
```

---

## 4. Verifikation & Test

### 4.1 Lokal Test
```bash
# 1. Installera dependencies
npm install

# 2. Skapa .env fil
cp .env.example .env
# Fyll i SUPABASE_URL, SUPABASE_ANON_KEY, etc.

# 3. Starta server
npm run dev

# 4. Öppna i webbläsare
open http://localhost:3000

# 5. Verifiera:
# - [ ] Startsidan laddas
# - [ ] CSS/JS assets laddas (inga 404s)
# - [ ] Supabase-anslutning fungerar (kolla console)
# - [ ] Alla verktygsidor fungerar
# - [ ] Inloggning fungerar
```

### 4.2 Docker Test
```bash
# 1. Bygg image
docker build -t bevakningsverktyget .

# 2. Kör container
docker run -p 3000:3000 \
  -e SUPABASE_URL=https://xxx.supabase.co \
  -e SUPABASE_ANON_KEY=xxx \
  bevakningsverktyget

# 3. Testa
curl http://localhost:3000/health
open http://localhost:3000
```

### 4.3 Render Deploy
```bash
# 1. Pusha till GitHub
git add .
git commit -m "feat: Migrate to Render.com fullstack deployment"
git push origin render-migration

# 2. I Render Dashboard:
# - New > Blueprint
# - Connect repo: isakskogstad/Bevakningsverktyget
# - Render läser render.yaml automatiskt

# 3. Sätt environment variables i Dashboard:
# SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, etc.

# 4. Deploy!
```

### 4.4 Post-Deploy Checklista
- [ ] `/health` returnerar 200 OK
- [ ] Startsidan laddas
- [ ] Alla 10 verktyg fungerar
- [ ] Alla 3 nyhetsverktyg fungerar
- [ ] Supabase Auth fungerar
- [ ] POIT-bevakning fungerar
- [ ] Allabolag-sökning fungerar
- [ ] Artikelgenerator fungerar
- [ ] SMS-notiser fungerar
- [ ] Puppeteer-scrapers fungerar

---

## 5. Rollback Plan

### Om något går fel:
```bash
# 1. Gå tillbaka till backup-branch
git checkout pre-render-migration

# 2. I Render Dashboard: Manual Rollback till previous deploy

# 3. Om GitHub Pages behöver återaktiveras:
# Settings > Pages > Source: Deploy from branch (main /docs)
```

---

## 6. Tidsuppskattning

| Fas | Aktivitet | Tid |
|-----|-----------|-----|
| 1 | Förberedelser & backup | 30 min |
| 2 | Express server | 45 min |
| 3 | Flytta frontend | 15 min |
| 4 | Docker config | 30 min |
| 5 | Render config | 20 min |
| 6 | Lokal test | 30 min |
| 7 | Docker test | 20 min |
| 8 | Render deploy | 30 min |
| 9 | Post-deploy test | 30 min |
| **Total** | | **~4 timmar** |

---

## 7. Efter Migration

### Stänga av GitHub Pages
```bash
# I repo Settings > Pages
# Source: None (disable GitHub Pages)
```

### Uppdatera DNS (om custom domain)
```
# Ändra DNS från GitHub Pages till Render
# A-record: → Renders IP
# CNAME: www → bevakningsverktyget.onrender.com
```

### Cleanup
```bash
# Ta bort gammal docs-mapp referens från .gitignore om den finns
# Uppdatera README med ny deployment URL
```

---

## 8. Kostnadsuppskattning (Render.com)

| Plan | Pris/månad | RAM | Inkluderar |
|------|------------|-----|------------|
| Free | $0 | 512MB | Sleep efter 15 min inaktivitet |
| Starter | $7 | 512MB | Ingen sleep |
| Standard | $25 | 2GB | Autoscaling, health checks |
| Pro | $85 | 4GB | Multi-region, SLA |

**Rekommendation:** Börja med Standard ($25/månad) för stabil Puppeteer-drift.

---

## 9. Nästa Steg (Efter Fas 1)

1. **Scraper Integration** - Migrera scrapers till server/routes
2. **Background Jobs** - Render Cron för schemalagda kontroller
3. **Logging** - Integrera med Render Logs
4. **Monitoring** - Sätt upp alerting
5. **CDN** - Aktivera Edge Caching för static assets

---

*Dokument skapat: 2025-12-23*
*Version: 1.0*
*Författare: Claude Code (Migration Agent)*
