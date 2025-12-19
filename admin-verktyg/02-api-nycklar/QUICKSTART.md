# Quick Start Guide

Kom igång med API Key Admin Panel på 5 minuter!

## Steg 1: Installera

```bash
cd "/Users/isak/Desktop/CLAUDE_CODE /projects/bevakningsverktyg/admin-verktyg/02-api-nycklar"
npm install
```

## Steg 2: Konfigurera miljövariabler

```bash
cp .env.example .env
nano .env  # eller använd din favoritredigerare
```

Generera säkra nycklar:

```bash
# Generera ENCRYPTION_KEY (32 tecken)
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(16).toString('hex'))"

# Generera JWT_SECRET (minst 32 tecken)
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

Kopiera dessa till din `.env` fil och lägg till dina Supabase-uppgifter:

```env
PORT=3001
NODE_ENV=development

ADMIN_USERNAME=admin
ADMIN_PASSWORD=ditt_starka_lösenord_här

JWT_SECRET=din_genererade_jwt_secret
ENCRYPTION_KEY=din_genererade_encryption_key

SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...
```

## Steg 3: Skapa databastabellen

Öppna Supabase SQL Editor och kör innehållet från `database-setup.sql`:

```bash
cat database-setup.sql
```

Eller använd setup-scriptet:

```bash
npm run setup-db
```

## Steg 4: Starta servern

```bash
npm start
```

Öppna http://localhost:3001

## Steg 5: Logga in

Använd:
- **Användarnamn**: `admin` (eller vad du satte i .env)
- **Lösenord**: Ditt lösenord från .env

## Steg 6: Lägg till dina första nycklar

Klicka på "Lägg till ny nyckel" och fyll i:

1. **2Captcha:**
   - Nyckelnamn: `TWOCAPTCHA_API_KEY`
   - Nyckelvärde: Din 2captcha key
   - Tjänst: `2Captcha`

2. **AntiCaptcha:**
   - Nyckelnamn: `ANTICAPTCHA_API_KEY`
   - Nyckelvärde: Din anticaptcha key
   - Tjänst: `AntiCaptcha`

3. **Twilio (3 nycklar):**
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_PHONE_NUMBER`

4. **Supabase (2 nycklar):**
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

5. **Anthropic:**
   - Nyckelnamn: `ANTHROPIC_API_KEY`
   - Nyckelvärde: Din Claude API key
   - Tjänst: `Anthropic`

## Steg 7: Använd nycklarna i din app

I din huvudapplikation:

```javascript
// I början av din app
const { initializeApiKeys } = require('./admin-verktyg/02-api-nycklar/get-api-keys');

async function main() {
  // Ladda alla nycklar från Supabase
  await initializeApiKeys();

  // Nu kan du använda dem!
  console.log(process.env.TWOCAPTCHA_API_KEY);
  console.log(process.env.ANTHROPIC_API_KEY);

  // Starta din app
  // ...
}

main();
```

## Test av nycklar

Klicka på "Testa" vid varje nyckel för att verifiera att den fungerar.

## Vanliga kommandon

```bash
# Starta servern
npm start

# Kör setup igen
npm run setup-db

# Kör exempel
node example-usage.js
```

## Felsökning

### Port redan använd
```bash
# Ändra PORT i .env till 3002 eller annat
PORT=3002
```

### ENCRYPTION_KEY fel längd
```bash
# Måste vara exakt 32 tecken
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### Kan inte ansluta till Supabase
Kontrollera att:
- SUPABASE_URL är korrekt
- SUPABASE_SERVICE_KEY har rätt permissions (service_role)
- Tabellen `api_keys` existerar

### Database setup misslyckas
Kör SQL manuellt i Supabase Dashboard:
1. Gå till SQL Editor
2. Kopiera innehållet från `database-setup.sql`
3. Kör queryn

## Säkerhet

- ✅ Använd HTTPS i produktion
- ✅ Byt ADMIN_PASSWORD till ett starkt lösenord (minst 16 tecken)
- ✅ Håll ENCRYPTION_KEY hemlig
- ✅ Dela ALDRIG .env-filen
- ✅ Använd en password manager för admin-uppgifter

## Nästa steg

- Läs `README.md` för fullständig dokumentation
- Se `example-usage.js` för integrationsmönster
- Utforska API-endpoints i `server.js`

Klar! Du har nu ett säkert system för att hantera API-nycklar. 🎉
