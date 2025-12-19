# Dokumentköp

## Syfte
Köpa dokument från Bolagsverket - protokoll, årsredovisningar, registreringsbevis.

## Huvudfiler
- `src/scrapers/protokoll-scraper.js` - Köp med betalning
- `src/scrapers/bolagsverket-navigator.js` - Navigation
- `scripts/poit-purchase-stealth.js` - Stealth-köp

## Dokumenttyper
| Kod | Typ | Pris |
|-----|-----|------|
| PROT | Bolagsstämmoprotokoll | ~60 SEK |
| ARS | Årsredovisning | Gratis/Varierar |
| REG | Registreringsbevis | ~100 SEK |
| BOLT | Bolagsordning | ~60 SEK |
| GRAV | Gravationsbevis | ~100 SEK |

## Betalning
- Kortbetalning via Bolagsverket
- 3D Secure hanteras via Twilio SMS
- Se `src/services/twilio_sms_node.js`

## Budget
- Daglig gräns: 100 SEK
- Spåras i `src/services/budget_manager.js`
