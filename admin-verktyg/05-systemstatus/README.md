# Systemstatus

## Syfte
Övervaka systemets hälsa och prestanda.

## Kontroller

### Dashboard
- **URL:** http://localhost:3850
- **Status:** Kör `node dashboard/server.js`

### Externa tjänster
| Tjänst | Test |
|--------|------|
| Bolagsverket | `curl https://foretagsinfo.bolagsverket.se` |
| POIT | `curl https://pfrh.poit.bolagsverket.se/ssp/pub` |
| Supabase | Kolla .env och anslutning |
| Twilio | Skicka test-SMS |

### CAPTCHA-tjänster
| Tjänst | Kontroll |
|--------|----------|
| 2captcha | Saldo på 2captcha.com |
| NopeCHA | Extension installerad i lib/ |

## Hälsokontroll
```javascript
// Snabb systemcheck
const checks = {
    dashboard: await fetch('http://localhost:3850').then(r => r.ok),
    supabase: await supabase.from('loop_table').select('count').single(),
    budget: await budgetManager.getStatus()
};
```

## Larm
- Budget under 20 SEK → Varning
- CAPTCHA-fel 5 gånger → Byt metod
- API-fel → Kontrollera nycklar
