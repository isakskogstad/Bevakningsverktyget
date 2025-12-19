# POIT-sökning

## Syfte
Söka kungörelser i Post- och Inrikes Tidningar.

## Huvudfil
`src/scrapers/poit-scraper.js`

## URL
https://pfrh.poit.bolagsverket.se/ssp/pub/search

## Kungörelsetyper
- Nybildning av aktiebolag
- Styrelseändringar
- Likvidation
- Konkurs
- Fusion
- Nyemission
- Ändring av bolagsordning

## Användning
```javascript
const { searchPOIT } = require('../../src/scrapers/poit-scraper');

const results = await searchPOIT({
    orgnr: '5591628660',
    dateFrom: '2024-01-01',
    dateTo: '2024-12-31'
});
```

## CAPTCHA
POIT använder bildbaserad CAPTCHA. Använd:
1. NopeCHA extension
2. nodriver
3. 2captcha som fallback
