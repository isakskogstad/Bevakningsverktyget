/**
 * Bevakningsverktyget - Express Server
 * Serverar statiska filer + API-routes med env var injection
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Environment Configuration
// ============================================
const ENV_CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  API_BASE_URL: process.env.API_BASE_URL || '',
  NODE_ENV: process.env.NODE_ENV || 'development'
};

// Validera kritiska env vars
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missingEnvVars = requiredEnvVars.filter(key => !process.env[key]);

if (missingEnvVars.length > 0 && process.env.NODE_ENV === 'production') {
  console.warn(`Warning: Missing environment variables: ${missingEnvVars.join(', ')}`);
}

// ============================================
// Middleware
// ============================================
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://bevakningsverktyget.onrender.com', /\.supabase\.co$/]
    : '*',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging (i development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

// ============================================
// Health Check Endpoint
// ============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    environment: ENV_CONFIG.NODE_ENV,
    uptime: process.uptime()
  });
});

// ============================================
// HTML Injection Middleware
// Injicerar environment variables i HTML-filer
// ============================================
const publicPath = path.join(__dirname, '../public');

app.use((req, res, next) => {
  // Endast för HTML-filer och directory requests
  const isHtmlRequest =
    req.path.endsWith('.html') ||
    req.path.endsWith('/') ||
    (!req.path.includes('.') && req.method === 'GET');

  if (!isHtmlRequest) {
    return next();
  }

  // Bestäm filsökväg
  let filePath;
  if (req.path === '/' || req.path === '/index.html') {
    filePath = path.join(publicPath, 'index.html');
  } else if (req.path.endsWith('/')) {
    filePath = path.join(publicPath, req.path, 'index.html');
  } else if (req.path.endsWith('.html')) {
    filePath = path.join(publicPath, req.path);
  } else {
    // Försök hitta index.html i directory
    filePath = path.join(publicPath, req.path, 'index.html');
  }

  // Kolla om filen finns
  if (fs.existsSync(filePath)) {
    try {
      let html = fs.readFileSync(filePath, 'utf8');

      // Skapa meta tags och window.ENV för env vars
      const injectedScript = `
    <!-- Environment Config (injected by server) -->
    <meta name="supabase-url" content="${ENV_CONFIG.SUPABASE_URL}">
    <meta name="supabase-anon-key" content="${ENV_CONFIG.SUPABASE_ANON_KEY}">
    <meta name="api-base-url" content="${ENV_CONFIG.API_BASE_URL}">
    <script>
      window.ENV = {
        SUPABASE_URL: "${ENV_CONFIG.SUPABASE_URL}",
        SUPABASE_ANON_KEY: "${ENV_CONFIG.SUPABASE_ANON_KEY}",
        API_BASE_URL: "${ENV_CONFIG.API_BASE_URL}",
        NODE_ENV: "${ENV_CONFIG.NODE_ENV}"
      };
    </script>`;

      // Inject efter <head>
      if (html.includes('<head>')) {
        html = html.replace('<head>', '<head>' + injectedScript);
      } else {
        // Fallback: lägg i början av HTML
        html = injectedScript + html;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return next();
    }
  }

  next();
});

// ============================================
// Static Files
// ============================================
app.use(express.static(publicPath, {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
  lastModified: true,
  index: 'index.html'
}));

// ============================================
// API Routes
// ============================================
app.use('/api', require('./routes/api'));

// ============================================
// SPA Fallback
// Alla okända routes -> index.html
// ============================================
app.get('*', (req, res) => {
  // Försök servera filen om den finns
  const requestedPath = path.join(publicPath, req.path);

  if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()) {
    return res.sendFile(requestedPath);
  }

  // Annars servera index.html
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ============================================
// Error Handler
// ============================================
app.use((err, req, res, next) => {
  console.error('Server error:', err);

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('Bevakningsverktyget Server');
  console.log('='.repeat(50));
  console.log(`Port:        ${PORT}`);
  console.log(`Environment: ${ENV_CONFIG.NODE_ENV}`);
  console.log(`Static:      ${publicPath}`);
  console.log(`Supabase:    ${ENV_CONFIG.SUPABASE_URL ? 'Configured' : 'NOT SET'}`);
  console.log('='.repeat(50));
  console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = app;
