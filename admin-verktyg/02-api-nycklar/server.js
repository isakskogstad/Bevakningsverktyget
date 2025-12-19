/**
 * API Key Admin Panel - Express Server
 */

const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const ApiKeyService = require('./api-key-service');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize API Key Service
const apiKeyService = new ApiKeyService(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// JWT Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Routes

/**
 * POST /api/auth/login
 * Authenticate admin user
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate credentials
    if (
      username !== process.env.ADMIN_USERNAME ||
      !bcrypt.compareSync(password, bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10))
    ) {
      // For simplicity, we're hashing on every request. In production, store hashed password.
      const isValidPassword = password === process.env.ADMIN_PASSWORD;

      if (username !== process.env.ADMIN_USERNAME || !isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { username, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, expiresIn: '24h' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/keys
 * Get all API keys (masked)
 */
app.get('/api/keys', authenticateToken, async (req, res) => {
  try {
    const keys = await apiKeyService.getAllKeys();
    res.json({ keys });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/keys/:keyName
 * Get specific API key (decrypted - use with caution)
 */
app.get('/api/keys/:keyName', authenticateToken, async (req, res) => {
  try {
    const key = await apiKeyService.getKey(req.params.keyName);

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }

    res.json({ key });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/keys
 * Create or update an API key
 */
app.post('/api/keys', authenticateToken, async (req, res) => {
  try {
    const { keyName, value, serviceName, description } = req.body;

    if (!keyName || !value) {
      return res.status(400).json({ error: 'keyName and value are required' });
    }

    const result = await apiKeyService.upsertKey(
      keyName,
      value,
      serviceName,
      description
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/keys/:keyName
 * Delete an API key (soft delete)
 */
app.delete('/api/keys/:keyName', authenticateToken, async (req, res) => {
  try {
    const result = await apiKeyService.deleteKey(req.params.keyName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/keys/:keyName/test
 * Test connection for a specific API key
 */
app.post('/api/keys/:keyName/test', authenticateToken, async (req, res) => {
  try {
    const { serviceName } = req.body;
    const result = await apiKeyService.testConnection(serviceName, req.params.keyName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🔐 API Key Admin Panel`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Server running on: http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`\n📋 Available endpoints:`);
  console.log(`  POST   /api/auth/login - Login`);
  console.log(`  GET    /api/keys - List all keys`);
  console.log(`  POST   /api/keys - Create/update key`);
  console.log(`  DELETE /api/keys/:keyName - Delete key`);
  console.log(`  POST   /api/keys/:keyName/test - Test connection`);
  console.log(`  GET    /api/health - Health check`);
  console.log(`\n💡 Default credentials (change in .env!):`);
  console.log(`  Username: ${process.env.ADMIN_USERNAME || 'admin'}`);
  console.log(`  Password: ${process.env.ADMIN_PASSWORD || '(not set)'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
