# API Key Admin Panel

Säker admin-panel för att hantera API-nycklar krypterat i Supabase.

## Features

- 🔐 Lösenordsskyddad admin-panel
- 🔒 AES-256-CBC kryptering av nycklar
- 💾 Lagring i Supabase (inte i .env)
- 👁️ Maskerade värden (****) för säkerhet
- ✅ Test av anslutning för varje tjänst
- 🔄 CRUD-operationer för nycklar

## Supported Services

- 2Captcha
- AntiCaptcha
- Twilio
- Supabase
- Anthropic Claude

## Installation

1. **Installera dependencies:**
```bash
cd /Users/isak/Desktop/CLAUDE_CODE\ /projects/bevakningsverktyg/admin-verktyg/02-api-nycklar/
npm install
```

2. **Konfigurera miljövariabler:**
```bash
cp .env.example .env
```

Redigera `.env` och sätt:
- `ADMIN_USERNAME` - Ditt admin-användarnamn
- `ADMIN_PASSWORD` - Ditt admin-lösenord
- `JWT_SECRET` - Slumpmässig sträng för JWT (minst 32 tecken)
- `ENCRYPTION_KEY` - Exakt 32 tecken för AES-256
- `SUPABASE_URL` - Din Supabase URL
- `SUPABASE_SERVICE_KEY` - Din Supabase service role key

3. **Skapa databastabellen:**
```bash
npm run setup-db
```

Om detta inte fungerar, kopiera SQL från output och kör i Supabase SQL Editor.

4. **Starta servern:**
```bash
npm start
```

Öppna http://localhost:3001 i din webbläsare.

## Usage

### Logga in
Använd dina admin-uppgifter från `.env` filen.

### Lägg till ny nyckel
1. Klicka på "Lägg till ny nyckel"
2. Fyll i:
   - **Nyckelnamn**: T.ex. `TWOCAPTCHA_API_KEY`
   - **Nyckelvärde**: Din faktiska API-nyckel
   - **Tjänst**: Välj från listan
   - **Beskrivning**: Valfri beskrivning
3. Klicka "Spara"

### Testa anslutning
Klicka på "Testa" för att verifiera att nyckeln fungerar.

### Redigera nyckel
1. Klicka på "Redigera"
2. Uppdatera värden
3. Klicka "Spara"

### Ta bort nyckel
Klicka på "Ta bort" och bekräfta.

## Säkerhet

- ✅ Nycklar krypteras med AES-256-CBC
- ✅ Unik IV (initialization vector) för varje nyckel
- ✅ JWT-baserad autentisering
- ✅ Maskerade värden i UI
- ✅ HTTPS rekommenderas i produktion
- ✅ Service role key krävs för Supabase-åtkomst

## API Endpoints

```
POST   /api/auth/login         - Logga in
GET    /api/keys               - Hämta alla nycklar (maskerade)
GET    /api/keys/:keyName      - Hämta specifik nyckel (dekrypterad)
POST   /api/keys               - Skapa/uppdatera nyckel
DELETE /api/keys/:keyName      - Ta bort nyckel
POST   /api/keys/:keyName/test - Testa anslutning
GET    /api/health             - Health check
```

## Använda nycklar i din app

```javascript
const { createClient } = require('@supabase/supabase-js');
const { decrypt } = require('./encryption');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getApiKey(keyName) {
  const { data, error } = await supabase
    .from('api_keys')
    .select('encrypted_value, iv')
    .eq('key_name', keyName)
    .eq('is_active', true)
    .single();

  if (error) throw error;

  return decrypt(data.encrypted_value, data.iv);
}

// Exempel
const twoCaptchaKey = await getApiKey('TWOCAPTCHA_API_KEY');
```

## Database Schema

```sql
api_keys (
  id UUID PRIMARY KEY,
  key_name VARCHAR(255) UNIQUE,
  encrypted_value TEXT,
  iv TEXT,
  description TEXT,
  service_name VARCHAR(255),
  is_active BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

## Troubleshooting

### "ENCRYPTION_KEY must be exactly 32 characters"
Generera en 32-teckens nyckel:
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### "Invalid or expired token"
Logga ut och logga in igen.

### Database setup fails
Kör SQL manuellt i Supabase SQL Editor (se output från `npm run setup-db`).

## Production Recommendations

1. **HTTPS**: Använd alltid HTTPS i produktion
2. **Strong passwords**: Använd starka lösenord (minst 16 tecken)
3. **Rotate keys**: Byt krypteringsnycklar regelbundet
4. **Backups**: Backup Supabase-databasen regelbundet
5. **Rate limiting**: Lägg till rate limiting på API-endpoints
6. **Audit logs**: Logga alla ändringar av nycklar

## License

MIT
