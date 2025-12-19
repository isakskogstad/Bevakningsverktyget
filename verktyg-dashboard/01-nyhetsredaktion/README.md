# Nyhetsredaktion

## Syfte
Generera nyhetsartiklar baserade på företagshändelser och dokument.

## Huvudfil
`src/services/news_article_generator.js`

## Funktioner
- PDF-analys med Claude Opus 4.5
- Generera artiklar i olika stilar (DI, Breakit, etc.)
- Automatisk rubriksättning

## Användning
```javascript
const { generateArticle } = require('../../src/services/news_article_generator');

const article = await generateArticle({
    pdfPath: './output/protokoll.pdf',
    style: 'di'
});
```

## Relaterade filer
- `src/services/pdf_parser.js` - PDF-extraktion
