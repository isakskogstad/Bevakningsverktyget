/**
 * Bevakningsverktyget - API Routes
 * Proxy och utility endpoints
 */

const express = require('express');
const router = express.Router();

// ============================================
// Health Check
// ============================================
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/health',
      'POST /api/edge/:function',
      'GET /api/config'
    ]
  });
});

// ============================================
// Config Endpoint (för frontend)
// Returnerar publika config-värden
// ============================================
router.get('/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    apiBaseUrl: process.env.API_BASE_URL || '',
    environment: process.env.NODE_ENV || 'development',
    // ALDRIG returnera secrets här!
    // supabaseKey ska komma via window.ENV injection
  });
});

// ============================================
// Edge Function Proxy
// Proxy:ar requests till Supabase Edge Functions
// ============================================
router.all('/edge/:functionName', async (req, res) => {
  const { functionName } = req.params;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: 'Supabase configuration missing'
    });
  }

  try {
    const edgeUrl = `${supabaseUrl}/functions/v1/${functionName}`;

    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
        ...req.headers['x-custom-header'] && {
          'x-custom-header': req.headers['x-custom-header']
        }
      }
    };

    // Lägg till body för POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(edgeUrl, fetchOptions);

    // Hantera response
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      res.status(response.status).json(data);
    } else {
      const text = await response.text();
      res.status(response.status).send(text);
    }

  } catch (error) {
    console.error(`Edge function proxy error [${functionName}]:`, error);
    res.status(500).json({
      error: 'Edge function proxy failed',
      message: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

// ============================================
// Supabase Database Proxy (för requests som behöver service key)
// ============================================
router.all('/db/*', async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: 'Supabase service configuration missing'
    });
  }

  try {
    // Bygg Supabase REST URL
    const dbPath = req.path.replace('/db/', '');
    const dbUrl = `${supabaseUrl}/rest/v1/${dbPath}`;

    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': req.headers['prefer'] || 'return=representation'
      }
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(dbUrl, fetchOptions);
    const data = await response.json();

    res.status(response.status).json(data);

  } catch (error) {
    console.error('Database proxy error:', error);
    res.status(500).json({
      error: 'Database proxy failed'
    });
  }
});

// ============================================
// POIT Search Endpoint
// ============================================
router.post('/poit/search', async (req, res) => {
  const { orgnr, fromDate, toDate } = req.body;

  if (!orgnr) {
    return res.status(400).json({ error: 'orgnr is required' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    const response = await fetch(
      `${supabaseUrl}/functions/v1/poit-kungorelse`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`
        },
        body: JSON.stringify({ orgnr, fromDate, toDate })
      }
    );

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('POIT search error:', error);
    res.status(500).json({ error: 'POIT search failed' });
  }
});

// ============================================
// Budget API Endpoints
// ============================================
router.get('/budget', async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    const response = await fetch(
      `${supabaseUrl}/functions/v1/budget`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('Budget fetch error:', error);
    res.status(500).json({ error: 'Budget fetch failed' });
  }
});

router.post('/budget/purchase', async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    const response = await fetch(
      `${supabaseUrl}/functions/v1/budget`,
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
    console.error('Budget purchase error:', error);
    res.status(500).json({ error: 'Budget purchase failed' });
  }
});

module.exports = router;
