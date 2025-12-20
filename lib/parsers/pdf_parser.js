/**
 * PDF Parser med Claude Opus 4.5 + Nyhetsgeneration + E-post
 * Extraherar och analyserar innehåll från PDF-filer
 * Hanterar inscannade dokument, handskrivet text, tabeller, etc.
 * Genererar nyhetsartiklar och skickar via e-post
 *
 * Pipeline:
 * 1. PDF → Claude Opus 4.5 → Strukturerad data
 * 2. Data → Nyhetsartikel med länkar
 * 3. Artikel + PDF → E-post till redaktionen
 */

const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

// Claude API-konfiguration
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!CLAUDE_API_KEY) {
    console.warn('[PDF Parser] ANTHROPIC_API_KEY saknas - sätt miljövariabel eller använd admin-panelen');
}

// Resend API-konfiguration
const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_123'; // Sätt din API-nyckel
const EMAIL_TO = 'isak.skogstad@me.com';
const EMAIL_FROM = 'Impact Loop <nyheter@impactloop.se>'; // Kräver verifierad domän i Resend

// Skapa klienter
const anthropic = new Anthropic({
    apiKey: CLAUDE_API_KEY
});

const resend = new Resend(RESEND_API_KEY);

/**
 * System-prompt för dokumentanalys
 */
const DOCUMENT_ANALYSIS_PROMPT = `Du är en expert på dokumentanalys och textextraktion. Din uppgift är att noggrant analysera det bifogade PDF-dokumentet och extrahera ALLT innehåll på ett strukturerat sätt.

INSTRUKTIONER:

1. KOMPLETT EXTRAKTION
   - Extrahera ALL text från dokumentet, inkluderat:
     * Rubriker och underrubriker
     * Brödtext och paragrafer
     * Punktlistor och numrerade listor
     * Tabeller (formatera som tydlig textrepresentation)
     * Sidhuvuden och sidfötter
     * Fotnoter och referenser
     * Datum, namn, organisationsnummer, belopp

2. HANDSKRIVEN TEXT
   - Om dokumentet innehåller handskrivna partier, gör ditt bästa för att tyda dem
   - Markera osäkra tolkningar med [osäker: ...]
   - Om text är oläslig, markera med [oläslig text]

3. VISUELLA ELEMENT
   - Beskriv bilder, logotyper, stämplar
   - Beskriv diagram och grafer
   - Notera signaturer (utan att försöka tyda dem)

4. DOKUMENTSTRUKTUR
   - Behåll dokumentets logiska struktur
   - Använd tydlig formatering med rubriker
   - Separera olika sektioner med tomma rader

5. METADATA
   - Dokumenttyp (protokoll, årsredovisning, avtal, etc.)
   - Datum om det framgår
   - Organisation/företag om det framgår
   - Antal sidor

OUTPUTFORMAT:

Returnera ett JSON-objekt med följande struktur:
{
  "metadata": {
    "dokumenttyp": "string",
    "datum": "string eller null",
    "organisation": "string eller null",
    "organisationsnummer": "string eller null",
    "antal_sidor": number
  },
  "sammanfattning": "Kort sammanfattning av dokumentets innehåll (2-3 meningar)",
  "innehall": "Fullständig extraherad text med bibehållen struktur",
  "sektioner": [
    {
      "rubrik": "string",
      "innehall": "string"
    }
  ],
  "nyckeluppgifter": {
    "personer": ["Lista med namn som nämns"],
    "datum": ["Lista med datum som nämns"],
    "belopp": ["Lista med belopp som nämns"],
    "beslut": ["Lista med beslut/åtgärder som nämns"]
  },
  "handskrivet": {
    "finns": boolean,
    "innehall": "Extraherad handskriven text eller null"
  },
  "kvalitet": {
    "lasbarhet": "god/medel/dålig",
    "kommentarer": "Eventuella problem med dokumentet"
  }
}

Svara ENDAST med JSON-objektet, ingen annan text.`;

/**
 * Analyserar en PDF-fil med Claude Opus 4.5
 *
 * @param {string} pdfPath - Sökväg till PDF-filen
 * @returns {Object} Analyserat innehåll som JSON
 */
async function analyzePDF(pdfPath) {
    console.error(`[PDF-PARSER] Analyserar: ${pdfPath}`);

    // Kontrollera att filen finns
    if (!fs.existsSync(pdfPath)) {
        throw new Error(`PDF-filen hittades inte: ${pdfPath}`);
    }

    // Läs och base64-koda PDF:en
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const fileSizeKB = (pdfBuffer.length / 1024).toFixed(2);

    console.error(`[PDF-PARSER] Filstorlek: ${fileSizeKB} KB`);
    console.error(`[PDF-PARSER] Skickar till Claude Opus 4.5...`);

    try {
        const startTime = Date.now();

        const message = await anthropic.messages.create({
            model: 'claude-opus-4-5-20251101',
            max_tokens: 16000,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'document',
                            source: {
                                type: 'base64',
                                media_type: 'application/pdf',
                                data: pdfBase64
                            }
                        },
                        {
                            type: 'text',
                            text: DOCUMENT_ANALYSIS_PROMPT
                        }
                    ]
                }
            ]
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`[PDF-PARSER] Analys klar efter ${elapsed}s`);
        console.error(`[PDF-PARSER] Tokens - Input: ${message.usage.input_tokens}, Output: ${message.usage.output_tokens}`);

        // Extrahera svaret
        const responseText = message.content[0].text;

        // Försök parsa JSON
        try {
            // Rensa eventuell markdown-formatering
            let jsonText = responseText;
            if (jsonText.startsWith('```json')) {
                jsonText = jsonText.slice(7);
            }
            if (jsonText.startsWith('```')) {
                jsonText = jsonText.slice(3);
            }
            if (jsonText.endsWith('```')) {
                jsonText = jsonText.slice(0, -3);
            }
            jsonText = jsonText.trim();

            const result = JSON.parse(jsonText);

            // Lägg till API-metadata
            result._api_metadata = {
                model: 'claude-opus-4-5-20251101',
                input_tokens: message.usage.input_tokens,
                output_tokens: message.usage.output_tokens,
                processing_time_seconds: parseFloat(elapsed),
                source_file: path.basename(pdfPath),
                source_file_size_kb: parseFloat(fileSizeKB)
            };

            return result;
        } catch (parseError) {
            console.error(`[PDF-PARSER] Kunde inte parsa JSON-svar: ${parseError.message}`);
            // Returnera rå text om JSON-parsing misslyckas
            return {
                metadata: {
                    dokumenttyp: 'okänd',
                    antal_sidor: null
                },
                sammanfattning: 'Kunde inte strukturera svaret',
                innehall: responseText,
                sektioner: [],
                nyckeluppgifter: {},
                kvalitet: {
                    lasbarhet: 'okänd',
                    kommentarer: 'JSON-parsing misslyckades'
                },
                _raw_response: responseText,
                _api_metadata: {
                    model: 'claude-opus-4-5-20251101',
                    input_tokens: message.usage.input_tokens,
                    output_tokens: message.usage.output_tokens,
                    processing_time_seconds: parseFloat(elapsed)
                }
            };
        }

    } catch (error) {
        console.error(`[PDF-PARSER] API-fel: ${error.message}`);
        throw error;
    }
}

/**
 * Extraherar endast text från PDF (enklare format)
 *
 * @param {string} pdfPath - Sökväg till PDF-filen
 * @returns {string} Extraherad text
 */
async function extractTextFromPDF(pdfPath) {
    console.error(`[PDF-PARSER] Extraherar text från: ${pdfPath}`);

    if (!fs.existsSync(pdfPath)) {
        throw new Error(`PDF-filen hittades inte: ${pdfPath}`);
    }

    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');

    const message = await anthropic.messages.create({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 16000,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'document',
                        source: {
                            type: 'base64',
                            media_type: 'application/pdf',
                            data: pdfBase64
                        }
                    },
                    {
                        type: 'text',
                        text: `Extrahera ALL text från detta PDF-dokument.

Inkludera:
- All tryckt text
- Handskriven text (markera osäkra tolkningar med [osäker: ...])
- Tabellinnehåll (formatera läsbart)
- Datum, namn, siffror

Behåll dokumentets struktur och formatering så gott det går.
Om något är oläsligt, markera med [oläsligt].

Svara ENDAST med den extraherade texten, ingen inledning eller avslutning.`
                    }
                ]
            }
        ]
    });

    return message.content[0].text;
}

/**
 * Analyserar ett bolagsstämmoprotokoll specifikt
 *
 * @param {string} pdfPath - Sökväg till protokoll-PDF
 * @returns {Object} Strukturerat protokollinnehåll
 */
async function analyzeProtokoll(pdfPath) {
    console.error(`[PDF-PARSER] Analyserar bolagsstämmoprotokoll: ${pdfPath}`);

    if (!fs.existsSync(pdfPath)) {
        throw new Error(`PDF-filen hittades inte: ${pdfPath}`);
    }

    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const fileSizeKB = (pdfBuffer.length / 1024).toFixed(2);

    const protokollPrompt = `Du analyserar ett BOLAGSSTÄMMOPROTOKOLL från ett svenskt aktiebolag.

Extrahera och strukturera följande information noggrant:

1. GRUNDLÄGGANDE UPPGIFTER
   - Företagsnamn
   - Organisationsnummer
   - Datum för stämman
   - Typ av stämma (ordinarie/extra bolagsstämma)
   - Plats för stämman

2. NÄRVARANDE
   - Aktieägare (namn och antal aktier/röster om angivet)
   - Styrelseledamöter
   - Revisorer
   - Övriga närvarande

3. DAGORDNING OCH BESLUT
   - Varje punkt på dagordningen
   - Beslut som fattades
   - Röstningsresultat om angivet

4. STYRELSE
   - Nuvarande styrelseledamöter
   - Ordförande
   - Eventuella förändringar i styrelsen

5. EKONOMI
   - Fastställd resultaträkning
   - Fastställd balansräkning
   - Disposition av vinst/förlust
   - Utdelning (belopp per aktie om angivet)

6. ÖVRIGT
   - Ansvarsfrihet för styrelse/VD
   - Arvoden
   - Revisorsval
   - Övriga beslut

7. UNDERSKRIFTER
   - Protokollförare
   - Justerare
   - Datum för justering

OUTPUTFORMAT - Returnera JSON:
{
  "grunduppgifter": {
    "foretagsnamn": "string",
    "organisationsnummer": "string",
    "stammodatum": "string",
    "stammatyp": "string",
    "plats": "string"
  },
  "narvarande": {
    "aktieagare": [{"namn": "string", "aktier": "string eller null", "roster": "string eller null"}],
    "styrelse": ["string"],
    "revisorer": ["string"],
    "ovriga": ["string"]
  },
  "dagordning": [
    {
      "punkt": number,
      "rubrik": "string",
      "beslut": "string",
      "rostning": "string eller null"
    }
  ],
  "styrelse": {
    "ledamoter": ["string"],
    "ordforande": "string",
    "suppleanter": ["string"],
    "forandringar": "string eller null"
  },
  "ekonomi": {
    "resultatrakning_faststalld": boolean,
    "balansrakning_faststalld": boolean,
    "vinstdisposition": "string",
    "utdelning_per_aktie": "string eller null"
  },
  "ovrigt": {
    "ansvarsfrihet": boolean,
    "arvoden": "string eller null",
    "revisorsval": "string eller null",
    "ovriga_beslut": ["string"]
  },
  "underskrifter": {
    "protokollfoare": "string",
    "justerare": ["string"],
    "justeringsdatum": "string eller null"
  },
  "fulltext": "Komplett extraherad text från dokumentet",
  "kvalitet": {
    "komplett": boolean,
    "saknade_uppgifter": ["string"],
    "kommentarer": "string"
  }
}

Svara ENDAST med JSON-objektet.`;

    try {
        const startTime = Date.now();

        const message = await anthropic.messages.create({
            model: 'claude-opus-4-5-20251101',
            max_tokens: 16000,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'document',
                            source: {
                                type: 'base64',
                                media_type: 'application/pdf',
                                data: pdfBase64
                            }
                        },
                        {
                            type: 'text',
                            text: protokollPrompt
                        }
                    ]
                }
            ]
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`[PDF-PARSER] Protokollanalys klar efter ${elapsed}s`);

        // Parsa JSON
        let jsonText = message.content[0].text;
        if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7);
        if (jsonText.startsWith('```')) jsonText = jsonText.slice(3);
        if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3);
        jsonText = jsonText.trim();

        const result = JSON.parse(jsonText);

        result._api_metadata = {
            model: 'claude-opus-4-5-20251101',
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
            processing_time_seconds: parseFloat(elapsed),
            source_file: path.basename(pdfPath),
            source_file_size_kb: parseFloat(fileSizeKB)
        };

        return result;

    } catch (error) {
        console.error(`[PDF-PARSER] Fel vid protokollanalys: ${error.message}`);
        throw error;
    }
}

/**
 * Genererar en nyhetsartikel baserat på extraherad PDF-text
 * Använder Claude Opus 4.5 med webb-sökning för kontext
 *
 * @param {string} formattedText - Extraherad och formatterad text från PDF
 * @param {string} source - Källa (t.ex. "Bolagsverket", "Årsredovisning")
 * @param {string} companyName - Företagsnamn om känt
 * @returns {Object} Nyhetsartikel med titel, ingress, brödtext, faktaruta
 */
async function generateNewsArticle(formattedText, source = 'Bolagsverket', companyName = null) {
    console.error(`[PDF-PARSER] Genererar nyhetsartikel...`);

    const now = new Date();
    const dateStr = now.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

    const newsPrompt = `Du är nyhetsbyrån "Impact Loop" och ska agera journalist som bevakar tech-bolag och andra inom start-up branschen i Sverige.

Din uppgift nu är att ta fram en intresseväckande, välformulerad och avslöjande nyhetsartikel baserat på det bifogade underlaget.

VIKTIGA REGLER:
1. Analysera underlaget och ta fram ett utkast på en nyhetstext om relevanta och intressanta delar.
2. Skriv med ett naturligt språk och formulera en intresseväckande rubrik. Om underlaget exempelvis innehåller nya uppgifter som kan användas för värderingar, är en rubrik i stil med "Nya uppgifter – Zpark Energy Systems värderas till över 40 miljoner!" bättre än rubriken "Halva ägandet i Zpark skiftar ägare" osv.
3. Undvik tekniska detaljer, fokusera på att formulera en nyhetstext som är intressant och läsvärd.
4. Avsändaren är "Impact Loop", så du kan exempelvis skriva "Impact Loop har fått tag i ett nytt dokument från ${source} som avslöjar att ..." o.s.v.
5. Tänk på att personnamn ofta är mer intressanta och intresseväckande än bolagsnamn, du kan exempelvis hämta namn på involverade, ex. VD för företaget, och skriva i stil med "Alexander Karlssons miljonsuccé – hans bolag får toppvärdering" eller dylikt.
6. Webbsök för att hitta mer information om företagen, personerna eller dylikt.
7. VIKTIGT: Bädda in relevanta länkar i texten med HTML-format: <a href="URL">länktext</a>. Exempel: länka till företagets hemsida, LinkedIn-profiler, tidigare nyheter, Allabolag.se, etc.

FORMAT:
1. Inled med titel – formulera den så att den blir intresseväckande och fokusera på det intressanta (målgrupp: investerare, riskkapitalister, start-up branschen)
2. Formulera en ingress som undviker tekniskt språk, men som får läsaren att fastna och vilja fortsätta läsa artikeln.
3. Fortsätt därefter med underrubrik följt av stycke text, max en till två stycken brödtext per underrubrik. Bädda in passande länkar i texten.
4. Avsluta med kursiverat datum + klockslag för nyhetsartikeln
5. Lägg till en inforuta med fakta, siffror och statistik från nyheten.

DOKUMENT ATT ANALYSERA:
${formattedText}

OUTPUTFORMAT - Returnera JSON:
{
  "titel": "Intresseväckande rubrik med fokus på det mest spännande",
  "ingress": "Engagerande ingress som får läsaren att vilja läsa vidare, undvik tekniskt språk",
  "sektioner": [
    {
      "underrubrik": "Underrubrik 1",
      "text": "Brödtext med <a href='URL'>inbäddade länkar</a> (max 1-2 stycken)"
    },
    {
      "underrubrik": "Underrubrik 2",
      "text": "Brödtext med <a href='URL'>inbäddade länkar</a> (max 1-2 stycken)"
    }
  ],
  "datum_publicering": "${dateStr}, kl. ${timeStr}",
  "inforuta": {
    "titel": "FAKTA: [Företagsnamn/Ämne]",
    "punkter": [
      "Fakta/siffra 1",
      "Fakta/siffra 2",
      "Fakta/siffra 3",
      "Fakta/siffra 4"
    ]
  },
  "kallor": [
    {
      "namn": "Källans namn",
      "url": "https://...",
      "hamtad": "${now.toISOString()}"
    }
  ],
  "metadata": {
    "kalla": "string",
    "foretag": "string",
    "personer": ["Lista med nyckelpersoner som nämns"]
  }
}

Svara ENDAST med JSON-objektet.`;

    try {
        const startTime = Date.now();

        const message = await anthropic.messages.create({
            model: 'claude-opus-4-5-20251101',
            max_tokens: 4000,
            messages: [
                {
                    role: 'user',
                    content: newsPrompt
                }
            ]
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`[PDF-PARSER] Nyhetsartikel genererad efter ${elapsed}s`);
        console.error(`[PDF-PARSER] Tokens - Input: ${message.usage.input_tokens}, Output: ${message.usage.output_tokens}`);

        // Parsa JSON-svar
        let jsonText = message.content[0].text;
        if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7);
        if (jsonText.startsWith('```')) jsonText = jsonText.slice(3);
        if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3);
        jsonText = jsonText.trim();

        const result = JSON.parse(jsonText);

        result._api_metadata = {
            model: 'claude-opus-4-5-20251101',
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
            processing_time_seconds: parseFloat(elapsed)
        };

        return result;

    } catch (error) {
        console.error(`[PDF-PARSER] Fel vid nyhetsgenereering: ${error.message}`);
        throw error;
    }
}

/**
 * Komplett pipeline: PDF → Extraktion → Nyhetsartikel
 *
 * @param {string} pdfPath - Sökväg till PDF-filen
 * @param {Object} options - Konfiguration
 * @returns {Object} { protokoll, nyhetsartikel }
 */
async function processProtokollToNews(pdfPath, options = {}) {
    const {
        source = 'Bolagsverket',
        companyName = null,
        sendEmail = false
    } = options;

    console.error(`[PDF-PARSER] === KOMPLETT PIPELINE ===`);
    console.error(`[PDF-PARSER] Steg 1: Analyserar protokoll...`);

    // Steg 1: Extrahera och analysera protokollet
    const protokoll = await analyzeProtokoll(pdfPath);

    // Hämta företagsnamn från protokollet om inte angivet
    const foretag = companyName || protokoll.grunduppgifter?.foretagsnamn || 'Okänt företag';

    console.error(`[PDF-PARSER] Steg 2: Genererar nyhetsartikel för ${foretag}...`);

    // Steg 2: Generera nyhetsartikel baserat på fulltext
    const nyhetsartikel = await generateNewsArticle(
        protokoll.fulltext || JSON.stringify(protokoll, null, 2),
        source,
        foretag
    );

    const result = {
        protokoll,
        nyhetsartikel,
        _pipeline_metadata: {
            source_file: path.basename(pdfPath),
            source_path: pdfPath,
            company: foretag,
            source: source,
            processed_at: new Date().toISOString()
        }
    };

    // Steg 3: Skicka e-post om aktiverat
    if (sendEmail) {
        console.error(`[PDF-PARSER] Steg 3: Skickar e-post till ${EMAIL_TO}...`);
        const emailResult = await sendNewsEmail(result, pdfPath);
        result._email_metadata = emailResult;
    }

    console.error(`[PDF-PARSER] === PIPELINE KLAR ===`);

    return result;
}

/**
 * Skickar nyhetsartikel via e-post med PDF-bilaga
 *
 * @param {Object} result - Resultat från processProtokollToNews
 * @param {string} pdfPath - Sökväg till PDF-filen
 * @returns {Object} E-postresultat
 */
async function sendNewsEmail(result, pdfPath) {
    const { nyhetsartikel, protokoll, _pipeline_metadata } = result;

    // Bygg HTML-innehåll för e-post
    const htmlContent = buildEmailHTML(nyhetsartikel, protokoll, _pipeline_metadata);

    // Läs PDF-filen för bilaga
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfFilename = path.basename(pdfPath);

    try {
        const emailResponse = await resend.emails.send({
            from: EMAIL_FROM,
            to: EMAIL_TO,
            subject: `📰 ${nyhetsartikel.titel}`,
            html: htmlContent,
            attachments: [
                {
                    filename: pdfFilename,
                    content: pdfBase64,
                    contentType: 'application/pdf'
                }
            ]
        });

        console.error(`[PDF-PARSER] E-post skickad! ID: ${emailResponse.id || emailResponse.data?.id}`);

        return {
            success: true,
            email_id: emailResponse.id || emailResponse.data?.id,
            sent_to: EMAIL_TO,
            sent_at: new Date().toISOString()
        };

    } catch (error) {
        console.error(`[PDF-PARSER] E-postfel: ${error.message}`);
        return {
            success: false,
            error: error.message,
            sent_at: new Date().toISOString()
        };
    }
}

/**
 * Bygger HTML-innehåll för e-post
 */
function buildEmailHTML(nyhetsartikel, protokoll, metadata) {
    // Formatera sektioner
    const sektionerHTML = (nyhetsartikel.sektioner || []).map(s => `
        <h3 style="color: #1a1a1a; margin-top: 24px; margin-bottom: 8px;">${s.underrubrik}</h3>
        <p style="color: #333; line-height: 1.6;">${s.text}</p>
    `).join('');

    // Formatera inforuta
    const inforutaHTML = nyhetsartikel.inforuta ? `
        <div style="background: #f5f5f5; border-left: 4px solid #0066cc; padding: 16px; margin: 24px 0;">
            <strong style="color: #0066cc;">${nyhetsartikel.inforuta.titel}</strong>
            <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                ${(nyhetsartikel.inforuta.punkter || []).map(p => `<li style="color: #333;">${p}</li>`).join('')}
            </ul>
        </div>
    ` : '';

    // Formatera källförteckning
    const kallorHTML = nyhetsartikel.kallor ? `
        <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <strong style="color: #856404;">📚 KÄLLOR OCH REFERENSER</strong>
            <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                ${(nyhetsartikel.kallor || []).map(k => `
                    <li style="color: #856404; margin-bottom: 4px;">
                        <a href="${k.url}" style="color: #0066cc;">${k.namn}</a>
                        <br><small style="color: #999;">Hämtad: ${new Date(k.hamtad).toLocaleString('sv-SE')}</small>
                    </li>
                `).join('')}
            </ul>
        </div>
    ` : '';

    // Formatera extraherad text från PDF
    const extraherad_text = protokoll.fulltext || JSON.stringify(protokoll, null, 2);

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${nyhetsartikel.titel}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; background: #f9f9f9;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0066cc, #004499); color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 18px; letter-spacing: 2px;">IMPACT LOOP NEWS</h1>
        <p style="margin: 8px 0 0 0; opacity: 0.8; font-size: 12px;">Bevakning av Sveriges startup-scen</p>
    </div>

    <!-- Artikel -->
    <div style="background: white; padding: 32px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">

        <!-- Titel -->
        <h1 style="color: #1a1a1a; font-size: 28px; line-height: 1.3; margin: 0 0 16px 0;">
            ${nyhetsartikel.titel}
        </h1>

        <!-- Ingress -->
        <p style="color: #555; font-size: 18px; line-height: 1.5; font-weight: 500; margin-bottom: 24px; border-left: 3px solid #0066cc; padding-left: 16px;">
            ${nyhetsartikel.ingress}
        </p>

        <!-- Sektioner -->
        ${sektionerHTML}

        <!-- Datum -->
        <p style="color: #999; font-style: italic; margin-top: 24px;">
            ${nyhetsartikel.datum_publicering}
        </p>

        <!-- Inforuta -->
        ${inforutaHTML}

        <!-- Källor -->
        ${kallorHTML}

    </div>

    <!-- Separator -->
    <hr style="border: none; border-top: 2px dashed #ddd; margin: 32px 0;">

    <!-- Extraherad text från PDF -->
    <div style="background: #f0f0f0; padding: 24px; border-radius: 8px;">
        <h2 style="color: #666; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 16px 0;">
            📄 EXTRAHERAD TEXT FRÅN ORIGINALDOKUMENT
        </h2>
        <p style="color: #888; font-size: 12px; margin-bottom: 16px;">
            Källa: ${metadata.source} | Fil: ${metadata.source_file} | Bearbetat: ${new Date(metadata.processed_at).toLocaleString('sv-SE')}
        </p>
        <div style="background: white; padding: 16px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 12px; white-space: pre-wrap; color: #333; max-height: 400px; overflow-y: auto;">
${extraherad_text}
        </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 24px; color: #999; font-size: 12px;">
        <p>© ${new Date().getFullYear()} Impact Loop | Automatiskt genererad nyhetsbevakning</p>
        <p>PDF-bilaga bifogad: ${metadata.source_file}</p>
    </div>

</body>
</html>
    `;
}

// CLI-test - uppdaterad
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Användning:');
        console.log('  node pdf_parser.js <pdf-fil> [--protokoll] [--news] [--email]');
        console.log('');
        console.log('Flaggor:');
        console.log('  --protokoll  Analysera som bolagsstämmoprotokoll');
        console.log('  --news       Generera nyhetsartikel (komplett pipeline)');
        console.log('  --email      Skicka resultat via e-post till isak.skogstad@me.com');
        console.log('');
        console.log('Exempel:');
        console.log('  node pdf_parser.js /tmp/protokoll.pdf');
        console.log('  node pdf_parser.js /tmp/protokoll.pdf --protokoll');
        console.log('  node pdf_parser.js /tmp/protokoll.pdf --news');
        console.log('  node pdf_parser.js /tmp/protokoll.pdf --news --email');
        console.log('');
        console.log('Miljövariabler:');
        console.log('  RESEND_API_KEY  Din Resend API-nyckel för e-post');
        process.exit(1);
    }

    const pdfPath = args[0];
    const isProtokoll = args.includes('--protokoll');
    const generateNews = args.includes('--news');
    const sendEmail = args.includes('--email');

    (async () => {
        try {
            let result;

            if (generateNews) {
                console.log('=== Komplett Pipeline: Protokoll → Nyhetsartikel ===\n');
                result = await processProtokollToNews(pdfPath, { sendEmail });

                // Visa nyhetsartikeln formaterad
                console.log('\n═══════════════════════════════════════════════════════');
                console.log('                    IMPACT LOOP NEWS');
                console.log('═══════════════════════════════════════════════════════\n');

                console.log(`📰 ${result.nyhetsartikel.titel}\n`);
                console.log(`${result.nyhetsartikel.ingress}\n`);

                if (result.nyhetsartikel.sektioner) {
                    for (const sektion of result.nyhetsartikel.sektioner) {
                        console.log(`\n▶ ${sektion.underrubrik}`);
                        // Ta bort HTML-taggar för terminal-output
                        const cleanText = sektion.text.replace(/<a[^>]*>([^<]*)<\/a>/g, '$1');
                        console.log(cleanText);
                    }
                }

                // Datum
                if (result.nyhetsartikel.datum_publicering) {
                    console.log(`\n_${result.nyhetsartikel.datum_publicering}_`);
                }

                // Inforuta
                if (result.nyhetsartikel.inforuta) {
                    console.log(`\n┌─────────────────────────────────────────────────────┐`);
                    console.log(`│ ${result.nyhetsartikel.inforuta.titel}`);
                    console.log(`├─────────────────────────────────────────────────────┤`);
                    for (const punkt of result.nyhetsartikel.inforuta.punkter) {
                        console.log(`│  • ${punkt}`);
                    }
                    console.log(`└─────────────────────────────────────────────────────┘`);
                }

                // Källor
                if (result.nyhetsartikel.kallor && result.nyhetsartikel.kallor.length > 0) {
                    console.log(`\n📚 KÄLLOR:`);
                    for (const kalla of result.nyhetsartikel.kallor) {
                        console.log(`   • ${kalla.namn}: ${kalla.url}`);
                    }
                }

                // E-poststatus
                if (result._email_metadata) {
                    console.log(`\n📧 E-POST:`);
                    if (result._email_metadata.success) {
                        console.log(`   ✅ Skickad till: ${result._email_metadata.sent_to}`);
                        console.log(`   📎 PDF bifogad: ${result._pipeline_metadata.source_file}`);
                    } else {
                        console.log(`   ❌ Fel: ${result._email_metadata.error}`);
                    }
                }

                console.log('\n═══════════════════════════════════════════════════════\n');
                console.log('Fullständig JSON:');
                console.log(JSON.stringify(result, null, 2));

            } else if (isProtokoll) {
                console.log('=== Protokollanalys med Claude Opus 4.5 ===\n');
                result = await analyzeProtokoll(pdfPath);
                console.log(JSON.stringify(result, null, 2));

            } else {
                console.log('=== PDF-analys med Claude Opus 4.5 ===\n');
                result = await analyzePDF(pdfPath);
                console.log(JSON.stringify(result, null, 2));
            }

        } catch (error) {
            console.error('Fel:', error.message);
            process.exit(1);
        }
    })();
}

module.exports = {
    analyzePDF,
    extractTextFromPDF,
    analyzeProtokoll,
    generateNewsArticle,
    processProtokollToNews,
    sendNewsEmail,
    buildEmailHTML
};
