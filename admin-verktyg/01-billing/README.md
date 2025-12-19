# Billing / Betalningshantering

## Syfte
Hantera betalningar till Bolagsverket för dokumentköp.

## Betalningsflöde
1. Välj dokument att köpa
2. Kontrollera budget (`budget_manager.js`)
3. Genomför kortbetalning
4. Hantera 3D Secure via SMS (`twilio_sms_node.js`)
5. Logga köp (`purchase_logger.js`)

## Relaterade filer
- `src/services/budget_manager.js` - Budgetkontroll
- `src/services/purchase_logger.js` - Köploggar
- `src/services/twilio_sms_node.js` - SMS för 3D Secure

## Kortuppgifter
Sparas INTE i kod. Matas in manuellt eller via säker konfiguration.

## Loggar
Alla köp loggas i `data/purchase-logs/` med:
- Tidpunkt
- Dokumenttyp
- Organisationsnummer
- Pris
- Status
