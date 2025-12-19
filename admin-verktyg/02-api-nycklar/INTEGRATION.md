# Integration Guide

Så här integrerar du API Key Manager i din bevakningsapplikation.

## Steg 1: Installera dependencies i huvudprojektet

Eftersom admin-panelen använder Supabase client, lägg till det i ditt huvudprojekt:

```bash
cd /Users/isak/Desktop/CLAUDE_CODE\ /projects/bevakningsverktyg
npm install @supabase/supabase-js
```

## Steg 2: Uppdatera .env i huvudprojektet

Lägg till dessa variabler i `/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/.env`:

```env
# API Key Manager Configuration
ENCRYPTION_KEY=your_32_character_encryption_key_here
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...
```

(Samma värden som i admin-panelens .env)

## Steg 3: Skapa en startup-helper

Skapa `/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/lib/load-api-keys.js`:

```javascript
/**
 * Load API Keys from Supabase at startup
 */
const { initializeApiKeys } = require('../admin-verktyg/02-api-nycklar/get-api-keys');

async function loadApiKeys() {
  try {
    console.log('Loading API keys from Supabase...');
    const keys = await initializeApiKeys();

    const keyNames = Object.keys(keys);
    console.log(`✅ Loaded ${keyNames.length} API keys successfully`);
    console.log('Available keys:', keyNames.join(', '));

    return keys;
  } catch (error) {
    console.error('❌ Failed to load API keys:', error.message);
    console.error('Make sure:');
    console.error('  1. Admin panel is set up (run: cd admin-verktyg/02-api-nycklar && npm start)');
    console.error('  2. API keys are added via admin panel');
    console.error('  3. .env has SUPABASE_URL, SUPABASE_SERVICE_KEY, ENCRYPTION_KEY');
    throw error;
  }
}

module.exports = { loadApiKeys };
```

## Steg 4: Uppdatera din huvudfil

I din huvudapplikation (t.ex. `src/index.js` eller `app.js`):

```javascript
require('dotenv').config();
const { loadApiKeys } = require('./lib/load-api-keys');

async function main() {
  try {
    // Ladda API-nycklar från Supabase
    await loadApiKeys();

    // Nu kan du använda nycklarna överallt:
    // process.env.TWOCAPTCHA_API_KEY
    // process.env.ANTHROPIC_API_KEY
    // osv.

    // Starta din applikation
    const scraper = require('./src/scraper');
    await scraper.run();

  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

main();
```

## Steg 5: Använd nycklarna i din kod

### Exempel 1: 2Captcha

```javascript
// src/captcha-solver.js
const axios = require('axios');

async function solveCaptcha(siteKey, pageUrl) {
  const apiKey = process.env.TWOCAPTCHA_API_KEY;

  if (!apiKey) {
    throw new Error('TWOCAPTCHA_API_KEY not found. Add it via admin panel.');
  }

  // Använd API-nyckeln
  const response = await axios.get('https://2captcha.com/in.php', {
    params: {
      key: apiKey,
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl,
      json: 1
    }
  });

  return response.data;
}

module.exports = { solveCaptcha };
```

### Exempel 2: Anthropic Claude

```javascript
// src/ai-analyzer.js
const Anthropic = require('@anthropic-ai/sdk');

async function analyzeData(data) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not found. Add it via admin panel.');
  }

  const anthropic = new Anthropic({
    apiKey: apiKey
  });

  const message = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Analyze this data: ${JSON.stringify(data)}`
    }]
  });

  return message.content;
}

module.exports = { analyzeData };
```

### Exempel 3: Twilio

```javascript
// src/notification.js
const twilio = require('twilio');

async function sendSMS(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('Twilio credentials not found. Add them via admin panel.');
  }

  const client = twilio(accountSid, authToken);

  const result = await client.messages.create({
    body: message,
    from: fromNumber,
    to: to
  });

  return result;
}

module.exports = { sendSMS };
```

## Steg 6: Hantera saknade nycklar

Skapa en helper för att validera att alla nödvändiga nycklar finns:

```javascript
// lib/validate-api-keys.js

function validateApiKeys(requiredKeys) {
  const missing = [];

  for (const key of requiredKeys) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error('❌ Missing required API keys:');
    missing.forEach(key => console.error(`  - ${key}`));
    console.error('\nAdd them via admin panel: http://localhost:3001');
    throw new Error(`Missing ${missing.length} required API keys`);
  }

  console.log(`✅ All ${requiredKeys.length} required API keys are present`);
}

module.exports = { validateApiKeys };
```

Använd den:

```javascript
const { loadApiKeys } = require('./lib/load-api-keys');
const { validateApiKeys } = require('./lib/validate-api-keys');

async function main() {
  await loadApiKeys();

  // Validera att alla nycklar som behövs finns
  validateApiKeys([
    'TWOCAPTCHA_API_KEY',
    'ANTHROPIC_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER'
  ]);

  // Fortsätt med din app...
}
```

## Steg 7: Deployment

### Lokalt

1. Kör admin-panelen: `npm start` (i admin-verktyg/02-api-nycklar)
2. Lägg till alla nycklar via UI
3. Kör huvudapplikationen

### Produktion

1. Admin-panelen körs på en säker intern server (endast tillgänglig för admins)
2. Huvudapplikationen hämtar nycklar från Supabase vid start
3. Ingen .env-fil behövs för API-nycklar (endast ENCRYPTION_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY)

## Migration från .env till Supabase

Om du redan har nycklar i `.env`:

```javascript
// scripts/migrate-keys-to-supabase.js
const { createClient } = require('@supabase/supabase-js');
const { encrypt } = require('../admin-verktyg/02-api-nycklar/encryption');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const keysToMigrate = [
  { name: 'TWOCAPTCHA_API_KEY', service: 'twocaptcha', description: '2Captcha API key' },
  { name: 'ANTICAPTCHA_API_KEY', service: 'anticaptcha', description: 'AntiCaptcha API key' },
  { name: 'ANTHROPIC_API_KEY', service: 'anthropic', description: 'Claude API key' },
  // Lägg till fler...
];

async function migrateKeys() {
  for (const key of keysToMigrate) {
    const value = process.env[key.name];

    if (!value) {
      console.log(`⚠️  Skipping ${key.name} (not found in .env)`);
      continue;
    }

    const { encryptedValue, iv } = encrypt(value);

    const { error } = await supabase
      .from('api_keys')
      .insert({
        key_name: key.name,
        encrypted_value: encryptedValue,
        iv: iv,
        service_name: key.service,
        description: key.description
      });

    if (error) {
      console.error(`❌ Failed to migrate ${key.name}:`, error.message);
    } else {
      console.log(`✅ Migrated ${key.name}`);
    }
  }
}

migrateKeys();
```

Kör: `node scripts/migrate-keys-to-supabase.js`

## Felsökning

### "API key not found"
Kontrollera att nyckeln finns i admin-panelen och är markerad som aktiv.

### "Decryption failed"
ENCRYPTION_KEY måste vara identisk i både admin-panel och huvudapp.

### "Supabase connection error"
Verifiera SUPABASE_URL och SUPABASE_SERVICE_KEY.

## Best Practices

1. **Separera concerns**: Admin-panelen körs separat från huvudapplikationen
2. **Cache keys**: Hämta nycklar vid startup, inte vid varje request
3. **Validera tidigt**: Kontrollera att nycklar finns innan applikationen startar
4. **Logga inte nycklar**: Använd maskerade värden i loggar
5. **Rotera regelbundet**: Uppdatera nycklar via admin-panelen, inte i kod

## Exempel på komplett setup

```javascript
// app.js - Huvudapplikation
require('dotenv').config();
const { loadApiKeys } = require('./lib/load-api-keys');
const { validateApiKeys } = require('./lib/validate-api-keys');

const REQUIRED_KEYS = [
  'TWOCAPTCHA_API_KEY',
  'ANTHROPIC_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER'
];

async function main() {
  console.log('🚀 Starting Bevakningsverktyg...\n');

  try {
    // 1. Ladda API-nycklar från Supabase
    await loadApiKeys();

    // 2. Validera att alla nödvändiga nycklar finns
    validateApiKeys(REQUIRED_KEYS);

    // 3. Starta huvudapplikationen
    console.log('\n🏃 Starting scraper...');
    const scraper = require('./src/scraper');
    await scraper.run();

    console.log('\n✅ Application started successfully!');

  } catch (error) {
    console.error('\n❌ Failed to start application:', error.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Run admin panel: cd admin-verktyg/02-api-nycklar && npm start');
    console.error('  2. Add missing keys at: http://localhost:3001');
    console.error('  3. Verify .env has SUPABASE_URL, SUPABASE_SERVICE_KEY, ENCRYPTION_KEY');
    process.exit(1);
  }
}

main();
```

Klar! Din applikation hämtar nu API-nycklar säkert från Supabase istället för att lagra dem i .env-filer.
