# API Key Admin Panel - Complete Index

## Quick Navigation

| Document | Purpose | Read Time |
|----------|---------|-----------|
| **[QUICKSTART.md](QUICKSTART.md)** | Get started in 5 minutes | 5 min |
| **[README.md](README.md)** | Full feature documentation | 10 min |
| **[INTEGRATION.md](INTEGRATION.md)** | Integrate with your app | 15 min |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | System architecture deep dive | 20 min |

## Files Overview

### 📚 Documentation

| File | Description |
|------|-------------|
| `QUICKSTART.md` | 5-minute setup guide - start here! |
| `README.md` | Complete documentation with examples |
| `INTEGRATION.md` | How to use keys in your main application |
| `ARCHITECTURE.md` | System design, security, data flow |
| `INDEX.md` | This file - navigation guide |

### 🚀 Backend (Node.js/Express)

| File | Description | Lines |
|------|-------------|-------|
| `server.js` | Express API server with authentication | ~200 |
| `api-key-service.js` | CRUD operations for API keys | ~250 |
| `encryption.js` | AES-256 encryption/decryption | ~100 |
| `setup-database.js` | Database setup script | ~100 |
| `database-setup.sql` | SQL schema for Supabase | ~80 |

### 🎨 Frontend (HTML/JS)

| File | Description | Lines |
|------|-------------|-------|
| `public/index.html` | Admin panel UI with login | ~400 |
| `public/app.js` | Client-side logic and API calls | ~350 |

### 🔌 Integration

| File | Description | Lines |
|------|-------------|-------|
| `get-api-keys.js` | Runtime key retrieval for your app | ~150 |
| `example-usage.js` | Integration examples and patterns | ~200 |

### ⚙️ Configuration

| File | Description |
|------|-------------|
| `package.json` | Dependencies and scripts |
| `.env.example` | Environment variables template |
| `.gitignore` | Git ignore rules |

## Getting Started Paths

### Path 1: Quick Start (Recommended)
1. Read [QUICKSTART.md](QUICKSTART.md)
2. Follow the 7 steps
3. You're done! ✅

### Path 2: Deep Dive
1. Read [README.md](README.md) for full features
2. Read [ARCHITECTURE.md](ARCHITECTURE.md) for system design
3. Read [INTEGRATION.md](INTEGRATION.md) for app integration
4. Customize to your needs

### Path 3: Integration First
1. Skim [QUICKSTART.md](QUICKSTART.md) to set up
2. Jump to [INTEGRATION.md](INTEGRATION.md)
3. Copy/paste integration code
4. Done! ✅

## Common Tasks

### Setup Admin Panel
```bash
# Step 1: Install
cd /Users/isak/Desktop/CLAUDE_CODE\ /projects/bevakningsverktyg/admin-verktyg/02-api-nycklar
npm install

# Step 2: Configure
cp .env.example .env
nano .env

# Step 3: Setup database
npm run setup-db

# Step 4: Start
npm start
```
**Guide:** [QUICKSTART.md](QUICKSTART.md)

### Add API Keys
1. Open http://localhost:3001
2. Login with admin credentials
3. Click "Lägg till ny nyckel"
4. Fill in details and save

**Guide:** [README.md#usage](README.md#usage)

### Use Keys in Your App
```javascript
const { initializeApiKeys } = require('./admin-verktyg/02-api-nycklar/get-api-keys');

async function main() {
  await initializeApiKeys();
  // Keys now available in process.env
}
```
**Guide:** [INTEGRATION.md](INTEGRATION.md)

### Test a Key Connection
1. Admin panel → Find your key
2. Click "Testa"
3. See connection status

**Guide:** [README.md#test-connection](README.md#usage)

## Features at a Glance

### Security
- ✅ AES-256-CBC encryption
- ✅ JWT authentication (24h expiry)
- ✅ Unique IV per key
- ✅ Supabase RLS (Row Level Security)
- ✅ Masked values in UI
- ✅ HTTPS ready

### Supported Services
- 2Captcha (with balance check)
- AntiCaptcha (with balance check)
- Twilio (SMS/phone)
- Supabase (database)
- Anthropic Claude (AI)
- Generic (any API key)

### API Endpoints
- `POST /api/auth/login` - Login
- `GET /api/keys` - List keys (masked)
- `POST /api/keys` - Create/update key
- `DELETE /api/keys/:keyName` - Delete key
- `POST /api/keys/:keyName/test` - Test connection
- `GET /api/health` - Health check

### Integration Methods
1. **initializeApiKeys()** - Load all keys at startup
2. **getApiKey(name)** - Get single key on-demand
3. **getAllApiKeys()** - Get all keys as object

## Code Examples

### Example 1: Basic Setup
```javascript
// Load keys at app startup
const { initializeApiKeys } = require('./get-api-keys');
await initializeApiKeys();

// Use anywhere
const key = process.env.TWOCAPTCHA_API_KEY;
```

### Example 2: With Validation
```javascript
const { initializeApiKeys } = require('./get-api-keys');
const { validateApiKeys } = require('./validate-api-keys');

await initializeApiKeys();
validateApiKeys(['TWOCAPTCHA_API_KEY', 'ANTHROPIC_API_KEY']);
```

### Example 3: Single Key
```javascript
const { getApiKey } = require('./get-api-keys');
const key = await getApiKey('ANTHROPIC_API_KEY');
```

## Architecture Quick View

```
Admin Panel (Port 3001)
    │
    ├─ HTML/JS UI
    ├─ Express API
    ├─ AES-256 Encryption
    │
    ▼
Supabase Database
    │
    └─ api_keys table (encrypted)
    │
    ▼
Main Application
    │
    ├─ Load keys at startup
    └─ Use from process.env
```

**Full diagram:** [ARCHITECTURE.md](ARCHITECTURE.md)

## Technology Stack

### Backend
- Node.js + Express
- @supabase/supabase-js
- bcryptjs (password hashing)
- jsonwebtoken (JWT auth)
- crypto (AES-256 encryption)

### Frontend
- Vanilla HTML/CSS/JS
- No frameworks (lightweight!)
- Responsive design
- Mobile-friendly

### Database
- Supabase (PostgreSQL)
- Row Level Security (RLS)
- Automatic timestamps
- Indexes for performance

## FAQ

**Q: How long does setup take?**
A: 5-10 minutes if you follow QUICKSTART.md

**Q: Do I need to modify my existing code?**
A: Minimal changes - just add `initializeApiKeys()` at startup

**Q: Can I migrate from .env files?**
A: Yes! See migration script in INTEGRATION.md

**Q: Is it secure for production?**
A: Yes, with HTTPS and strong passwords

**Q: What if I lose ENCRYPTION_KEY?**
A: Keys become unrecoverable - store it securely!

## Troubleshooting

| Issue | Solution | Guide |
|-------|----------|-------|
| Port already in use | Change PORT in .env | [QUICKSTART.md](QUICKSTART.md) |
| ENCRYPTION_KEY wrong length | Generate 32-char key | [README.md](README.md) |
| Database setup fails | Run SQL manually | [QUICKSTART.md](QUICKSTART.md) |
| Can't connect to Supabase | Check URL and service key | [README.md](README.md) |
| "API key not found" | Add key via admin panel | [README.md#usage](README.md) |

## Next Steps

### Just Starting?
→ [QUICKSTART.md](QUICKSTART.md)

### Want Full Details?
→ [README.md](README.md)

### Integrating with Your App?
→ [INTEGRATION.md](INTEGRATION.md)

### Understanding the System?
→ [ARCHITECTURE.md](ARCHITECTURE.md)

## File Line Counts

```
Total Lines of Code: ~2,000
- Backend:    ~800 lines
- Frontend:   ~750 lines
- Integration: ~350 lines
- Docs:        ~1,500 lines
```

## Version History

- **v1.0** - Initial release
  - AES-256 encryption
  - JWT authentication
  - Full CRUD operations
  - Test connections
  - Admin panel UI

## License

MIT License - Free to use in your projects!

---

**Ready to start?** → [QUICKSTART.md](QUICKSTART.md)
**Have questions?** → Check [README.md](README.md) or [ARCHITECTURE.md](ARCHITECTURE.md)
