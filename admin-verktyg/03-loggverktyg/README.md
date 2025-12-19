# Loggverktyg

## Syfte
Spåra alla aktiviteter - köp, sökningar, fel.

## Loggtyper

### Köploggar
**Plats:** `data/purchase-logs/`
**Format:** JSON
```json
{
    "timestamp": "2024-12-19T12:00:00Z",
    "type": "purchase",
    "document": "PROT",
    "orgnr": "5591628660",
    "price": 60,
    "status": "success"
}
```

### Framgångsrika metoder
**Plats:** `data/successful-methods/`
**Format:** JSON
```json
{
    "site": "foretagsinfo.bolagsverket.se",
    "action": "bypass_captcha",
    "tool": "nodriver",
    "config": {},
    "success": true
}
```

### Felloggar
**Plats:** `output/` (skärmdumpar vid fel)

## Huvudfil
`src/services/purchase_logger.js`

## Användning
```javascript
const { PurchaseLogger } = require('../../src/services/purchase_logger');

const logger = new PurchaseLogger();
await logger.log({
    type: 'purchase',
    document: 'PROT',
    orgnr: '5591628660',
    price: 60
});
```
