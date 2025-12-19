# Budget-hantering

## Syfte
Hantera daglig budget för dokumentköp.

## Huvudfil
`src/services/budget_manager.js`

## Konfiguration
```bash
# I .env
DAILY_BUDGET_SEK=100
```

## Funktioner
- Spåra dagliga köp
- Varna vid låg budget
- Blockera köp över gräns
- Återställ vid ny dag

## Användning
```javascript
const { BudgetManager } = require('../../src/services/budget_manager');

const budget = new BudgetManager();

// Kontrollera före köp
if (await budget.canPurchase(60)) {
    // Genomför köp
    await budget.recordPurchase(60, 'PROT', '5591628660');
}

// Visa status
const status = await budget.getStatus();
console.log(`Använt: ${status.used} / ${status.limit} SEK`);
```
