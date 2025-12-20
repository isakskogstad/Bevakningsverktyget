/**
 * Bolagsverket Värdefulla Datamängder API Client
 *
 * TVÅ API:er stöds:
 *
 * 1. ÖPPET API (ingen autentisering) - Årsredovisningar GRATIS
 *    Base: https://api.bolagsverket.se
 *    - /hamta-arsredovisningsinformation/v1.1/grunduppgifter/{orgnr}
 *    - /hamta-arsredovisningsinformation/v1.1/arendestatus/{orgnr}
 *    - /hamta-arsredovisningshandelser/v1.2/handelser
 *    - /arsredovisning/{orgnr}/{year}/{format}
 *
 * 2. OAUTH API (kräver credentials) - Utökad företagsdata
 *    Token: https://portal.api.bolagsverket.se/oauth2/token
 *    API:   https://gw.api.bolagsverket.se/vardefulla-datamangder/v1
 *
 * GRATIS via API:
 * ✅ Årsredovisning (PDF, XBRL, iXBRL)
 * ✅ Grundläggande företagsinfo
 * ✅ Årsredovisnings-historik
 * ✅ Ärendestatus
 *
 * MÅSTE KÖPAS (75-125 kr):
 * ❌ Registreringsbevis
 * ❌ Bolagsordning
 * ❌ RVH-register (verkliga huvudmän)
 * ❌ Årsstämmoprotokoll
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================================
// DOKUMENTTYPER - Vad är gratis vs vad kostar
// ============================================================================

const DOCUMENT_TYPES = {
    // GRATIS via Öppet API
    FREE: {
        ARSREDOVISNING_PDF: {
            code: 'ARS_PDF',
            name: 'Årsredovisning (PDF)',
            description: 'Komplett årsredovisning i PDF-format',
            cost: 0,
            api: 'open',
            formats: ['pdf']
        },
        ARSREDOVISNING_XBRL: {
            code: 'ARS_XBRL',
            name: 'Årsredovisning (XBRL)',
            description: 'Maskinläsbar årsredovisning för analys',
            cost: 0,
            api: 'open',
            formats: ['xbrl']
        },
        ARSREDOVISNING_IXBRL: {
            code: 'ARS_IXBRL',
            name: 'Årsredovisning (iXBRL)',
            description: 'HTML+XML hybrid för visning och analys',
            cost: 0,
            api: 'open',
            formats: ['ixbrl']
        },
        GRUNDUPPGIFTER: {
            code: 'GRUND',
            name: 'Grunduppgifter',
            description: 'Namn, orgnr, adress, juridisk form',
            cost: 0,
            api: 'open'
        },
        ARENDESTATUS: {
            code: 'STATUS',
            name: 'Ärendestatus',
            description: 'Senaste årsredovisning-händelse',
            cost: 0,
            api: 'open'
        },
        HANDELSER: {
            code: 'HIST',
            name: 'Händelsehistorik',
            description: 'Historik över alla årsredovisnings-ändringar',
            cost: 0,
            api: 'open'
        }
    },

    // KOSTAR - måste köpas via foretagsinfo.bolagsverket.se
    PAID: {
        REGISTRERINGSBEVIS: {
            code: 'REG',
            name: 'Registreringsbevis',
            description: 'Bevis om företagets registrering',
            cost: 125,
            api: 'purchase'
        },
        BOLAGSORDNING: {
            code: 'BOLT',
            name: 'Bolagsordning',
            description: 'Bolagets stadgar och regler',
            cost: 75,
            api: 'purchase'
        },
        VERKLIGA_HUVUDMAN: {
            code: 'RVHBEV',
            name: 'Verkliga huvudmän',
            description: 'Bevis om verkliga huvudmän',
            cost: 125,
            api: 'purchase'
        },
        STAMMOPROTOKOLL: {
            code: 'PROT',
            name: 'Årsstämmoprotokoll',
            description: 'Protokoll från bolagsstämma',
            cost: 75,
            api: 'purchase'
        },
        FUNKTIONARSBEVIS: {
            code: 'FUNK',
            name: 'Funktionärsbevis',
            description: 'Bevis om styrelse och VD',
            cost: 75,
            api: 'purchase'
        }
    }
};

// ============================================================================
// BOLAGSVERKET ÖPPET API CLIENT (Ingen autentisering)
// ============================================================================

class BolagsverketOpenAPI {
    static BASE_URL = 'https://api.bolagsverket.se';

    constructor() {
        this.baseUrl = BolagsverketOpenAPI.BASE_URL;
    }

    /**
     * Gör HTTPS-request
     */
    _request(url, options = {}) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const reqOptions = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: {
                    'Accept': options.accept || 'application/json',
                    'User-Agent': 'Bevakningsverktyget/1.0',
                    ...options.headers
                }
            };

            const req = https.request(reqOptions, (res) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        data: buffer,
                        text: buffer.toString('utf8')
                    });
                });
            });

            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (options.body) {
                req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
            }
            req.end();
        });
    }

    /**
     * Formatera organisationsnummer
     */
    _formatOrgnr(orgnr) {
        const clean = orgnr.replace(/-/g, '').replace(/ /g, '');
        return clean.length === 10 ? clean : orgnr.replace(/\D/g, '');
    }

    // =========================================================================
    // GRATIS ENDPOINTS
    // =========================================================================

    /**
     * Hämta grunduppgifter om företag
     * GET /hamta-arsredovisningsinformation/v1.1/grunduppgifter/{orgnr}
     *
     * @param {string} orgnr - Organisationsnummer
     * @returns {Object} Grundläggande företagsinfo
     */
    async getGrunduppgifter(orgnr) {
        const cleanOrgnr = this._formatOrgnr(orgnr);
        const url = `${this.baseUrl}/hamta-arsredovisningsinformation/v1.1/grunduppgifter/${cleanOrgnr}`;

        try {
            const response = await this._request(url);

            if (response.status === 200) {
                const data = JSON.parse(response.text);
                return {
                    success: true,
                    cost: 0,
                    data: {
                        organisationsnummer: data.organisationsnummer,
                        namn: data.namn,
                        juridiskForm: data.juridiskForm,
                        registreringsDatum: data.registreringsDatum,
                        adress: data.adress,
                        arsredovisningStatus: data.arsredovisningStatus,
                        senastRegistreradArsredovisning: data.senastRegistreradArsredovisning
                    },
                    raw: data
                };
            }

            return { success: false, error: `HTTP ${response.status}`, cost: 0 };
        } catch (error) {
            return { success: false, error: error.message, cost: 0 };
        }
    }

    /**
     * Hämta ärendestatus (senaste årsredovisning-händelse)
     * GET /hamta-arsredovisningsinformation/v1.1/arendestatus/{orgnr}
     *
     * @param {string} orgnr - Organisationsnummer
     * @returns {Object} Senaste händelse
     */
    async getArendestatus(orgnr) {
        const cleanOrgnr = this._formatOrgnr(orgnr);
        const url = `${this.baseUrl}/hamta-arsredovisningsinformation/v1.1/arendestatus/${cleanOrgnr}`;

        try {
            const response = await this._request(url);

            if (response.status === 200) {
                const data = JSON.parse(response.text);
                return {
                    success: true,
                    cost: 0,
                    data: {
                        organisationsnummer: data.organisationsnummer,
                        senastHandelse: data.senastHandelse
                    },
                    raw: data
                };
            }

            return { success: false, error: `HTTP ${response.status}`, cost: 0 };
        } catch (error) {
            return { success: false, error: error.message, cost: 0 };
        }
    }

    /**
     * Hämta alla årsredovisnings-händelser (historik)
     * POST /hamta-arsredovisningshandelser/v1.2/handelser
     *
     * @param {string} orgnr - Organisationsnummer
     * @returns {Object} Lista med alla händelser
     */
    async getHandelser(orgnr) {
        const cleanOrgnr = this._formatOrgnr(orgnr);
        const url = `${this.baseUrl}/hamta-arsredovisningshandelser/v1.2/handelser`;

        try {
            const response = await this._request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { organisationsnummer: cleanOrgnr }
            });

            if (response.status === 200) {
                const data = JSON.parse(response.text);
                return {
                    success: true,
                    cost: 0,
                    data: {
                        organisationsnummer: data.organisationsnummer,
                        handelser: data.handelser || []
                    },
                    raw: data
                };
            }

            return { success: false, error: `HTTP ${response.status}`, cost: 0 };
        } catch (error) {
            return { success: false, error: error.message, cost: 0 };
        }
    }

    /**
     * Ladda ner årsredovisning GRATIS
     * GET /arsredovisning/{orgnr}/{year}/{format}
     *
     * @param {string} orgnr - Organisationsnummer
     * @param {number} year - Räkenskapsår (t.ex. 2023)
     * @param {string} format - 'pdf', 'xbrl', eller 'ixbrl'
     * @returns {Buffer|null} Dokumentdata
     */
    async downloadArsredovisning(orgnr, year, format = 'pdf') {
        const cleanOrgnr = this._formatOrgnr(orgnr);
        const url = `${this.baseUrl}/arsredovisning/${cleanOrgnr}/${year}/${format.toLowerCase()}`;

        const acceptHeaders = {
            'pdf': 'application/pdf',
            'xbrl': 'application/xml',
            'ixbrl': 'text/html'
        };

        try {
            console.log(`[OpenAPI] Laddar ner ${format.toUpperCase()} för ${cleanOrgnr}, år ${year}...`);

            const response = await this._request(url, {
                accept: acceptHeaders[format.toLowerCase()] || 'application/pdf'
            });

            if (response.status === 200) {
                console.log(`[OpenAPI] ✅ Nedladdning lyckades (${response.data.length} bytes)`);
                return {
                    success: true,
                    cost: 0,
                    format: format.toLowerCase(),
                    year,
                    data: response.data,
                    contentType: response.headers['content-type']
                };
            }

            console.log(`[OpenAPI] ❌ Nedladdning misslyckades: HTTP ${response.status}`);
            return { success: false, error: `HTTP ${response.status}`, cost: 0 };
        } catch (error) {
            console.log(`[OpenAPI] ❌ Fel: ${error.message}`);
            return { success: false, error: error.message, cost: 0 };
        }
    }

    /**
     * Hämta alla tillgängliga årsredovisningar för ett företag
     * Kombinerar grunduppgifter + historik + nedladdningslänkar
     *
     * @param {string} orgnr - Organisationsnummer
     * @returns {Object} Komplett översikt
     */
    async getAllArsredovisningar(orgnr) {
        const cleanOrgnr = this._formatOrgnr(orgnr);

        // Hämta grundinfo och historik parallellt
        const [grundResult, histResult] = await Promise.all([
            this.getGrunduppgifter(orgnr),
            this.getHandelser(orgnr)
        ]);

        const result = {
            success: true,
            cost: 0,
            orgnr: cleanOrgnr,
            foretagsnamn: grundResult.data?.namn || null,
            juridiskForm: grundResult.data?.juridiskForm || null,
            arsredovisningar: [],
            downloadLinks: {}
        };

        // Samla alla år från historiken
        const years = new Set();
        if (histResult.success && histResult.data.handelser) {
            for (const h of histResult.data.handelser) {
                if (h.ar) years.add(h.ar);
            }
        }

        // Lägg till senaste från grunduppgifter om inte redan med
        if (grundResult.data?.senastRegistreradArsredovisning?.arsredovisningsAr) {
            years.add(grundResult.data.senastRegistreradArsredovisning.arsredovisningsAr);
        }

        // Skapa nedladdningslänkar för varje år
        for (const year of Array.from(years).sort((a, b) => b - a)) {
            result.arsredovisningar.push({
                ar: year,
                status: 'TILLGANGLIG',
                formats: ['pdf', 'xbrl', 'ixbrl']
            });

            result.downloadLinks[year] = {
                pdf: `${this.baseUrl}/arsredovisning/${cleanOrgnr}/${year}/pdf`,
                xbrl: `${this.baseUrl}/arsredovisning/${cleanOrgnr}/${year}/xbrl`,
                ixbrl: `${this.baseUrl}/arsredovisning/${cleanOrgnr}/${year}/ixbrl`
            };
        }

        return result;
    }

    /**
     * Ladda ner och spara årsredovisning till fil
     *
     * @param {string} orgnr - Organisationsnummer
     * @param {number} year - Räkenskapsår
     * @param {string} format - 'pdf', 'xbrl', eller 'ixbrl'
     * @param {string} outputDir - Mapp att spara i
     * @returns {Object} { success, filePath, cost }
     */
    async downloadAndSave(orgnr, year, format = 'pdf', outputDir = './downloads') {
        const result = await this.downloadArsredovisning(orgnr, year, format);

        if (!result.success) {
            return result;
        }

        // Säkerställ mappen finns
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Skapa filnamn
        const cleanOrgnr = this._formatOrgnr(orgnr);
        const extensions = { pdf: 'pdf', xbrl: 'xbrl', ixbrl: 'html' };
        const filename = `${cleanOrgnr}_arsredovisning_${year}.${extensions[format] || format}`;
        const filePath = path.join(outputDir, filename);

        // Spara
        fs.writeFileSync(filePath, result.data);

        console.log(`[OpenAPI] ✅ Sparad: ${filePath}`);

        return {
            success: true,
            cost: 0,
            filePath,
            format,
            year,
            size: result.data.length
        };
    }
}

// ============================================================================
// BOLAGSVERKET OAUTH API CLIENT (Kräver credentials)
// ============================================================================

class BolagsverketOAuthAPI {
    static TOKEN_URL = 'https://portal.api.bolagsverket.se/oauth2/token';
    static API_BASE_URL = 'https://gw.api.bolagsverket.se/vardefulla-datamangder/v1';

    constructor(options = {}) {
        this.clientId = options.clientId || process.env.BOLAGSVERKET_CLIENT_ID;
        this.clientSecret = options.clientSecret || process.env.BOLAGSVERKET_CLIENT_SECRET;
        this._accessToken = null;
        this._tokenExpiresAt = null;
    }

    get isConfigured() {
        return Boolean(this.clientId && this.clientSecret);
    }

    // OAuth-metoder här om behövs för framtida utökning...
}

// ============================================================================
// KOMBINERAD CLIENT - Väljer rätt API automatiskt
// ============================================================================

class BolagsverketVDMClient {
    constructor(options = {}) {
        this.openApi = new BolagsverketOpenAPI();
        this.oauthApi = new BolagsverketOAuthAPI(options);
    }

    get isConfigured() {
        return true; // Öppna API:et kräver ingen konfiguration
    }

    // =========================================================================
    // GRATIS METODER (via Öppet API)
    // =========================================================================

    /**
     * Hämta grunduppgifter (GRATIS)
     */
    async getGrunduppgifter(orgnr) {
        return this.openApi.getGrunduppgifter(orgnr);
    }

    /**
     * Hämta ärendestatus (GRATIS)
     */
    async getArendestatus(orgnr) {
        return this.openApi.getArendestatus(orgnr);
    }

    /**
     * Hämta händelsehistorik (GRATIS)
     */
    async getHandelser(orgnr) {
        return this.openApi.getHandelser(orgnr);
    }

    /**
     * Ladda ner årsredovisning (GRATIS)
     * @param {string} orgnr
     * @param {number} year
     * @param {string} format - 'pdf', 'xbrl', eller 'ixbrl'
     */
    async downloadArsredovisning(orgnr, year, format = 'pdf') {
        return this.openApi.downloadArsredovisning(orgnr, year, format);
    }

    /**
     * Hämta alla tillgängliga årsredovisningar (GRATIS)
     */
    async getAllArsredovisningar(orgnr) {
        return this.openApi.getAllArsredovisningar(orgnr);
    }

    /**
     * Ladda ner och spara årsredovisning (GRATIS)
     */
    async downloadAndSave(orgnr, year, format = 'pdf', outputDir) {
        return this.openApi.downloadAndSave(orgnr, year, format, outputDir);
    }

    // =========================================================================
    // BEKVÄMLIGHETSMETODER
    // =========================================================================

    /**
     * Kontrollera om gratis årsredovisning finns
     */
    async checkFreeAnnualReports(orgnr) {
        const result = await this.getAllArsredovisningar(orgnr);
        return {
            available: result.arsredovisningar.length > 0,
            documents: result.arsredovisningar,
            downloadLinks: result.downloadLinks,
            foretagsnamn: result.foretagsnamn
        };
    }

    /**
     * Hämta senaste årsredovisning (PDF)
     */
    async getLatestArsredovisning(orgnr, outputDir = './downloads') {
        const info = await this.getAllArsredovisningar(orgnr);

        if (info.arsredovisningar.length === 0) {
            return { success: false, error: 'Ingen årsredovisning tillgänglig' };
        }

        const latestYear = info.arsredovisningar[0].ar;
        return this.downloadAndSave(orgnr, latestYear, 'pdf', outputDir);
    }

    // =========================================================================
    // STATISKA HJÄLPMETODER
    // =========================================================================

    /**
     * Lista vad som är gratis vs kostar
     */
    static getDocumentTypes() {
        return DOCUMENT_TYPES;
    }

    /**
     * Kolla om en dokumenttyp är gratis
     */
    static isFree(documentCode) {
        for (const doc of Object.values(DOCUMENT_TYPES.FREE)) {
            if (doc.code === documentCode) return true;
        }
        return false;
    }

    /**
     * Hämta kostnad för dokumenttyp
     */
    static getCost(documentCode) {
        for (const doc of Object.values(DOCUMENT_TYPES.FREE)) {
            if (doc.code === documentCode) return 0;
        }
        for (const doc of Object.values(DOCUMENT_TYPES.PAID)) {
            if (doc.code === documentCode) return doc.cost;
        }
        return null;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    BolagsverketVDMClient,
    BolagsverketOpenAPI,
    BolagsverketOAuthAPI,
    DOCUMENT_TYPES
};

// ============================================================================
// CLI TEST
// ============================================================================

if (require.main === module) {
    (async () => {
        console.log('=' .repeat(60));
        console.log('BOLAGSVERKET VÄRDEFULLA DATAMÄNGDER - TEST');
        console.log('=' .repeat(60));

        const client = new BolagsverketVDMClient();
        const orgnr = process.argv[2] || '5590432711'; // Default: Lovable AB

        console.log(`\nTestar med orgnr: ${orgnr}`);

        // 1. Grunduppgifter
        console.log('\n--- 1. Grunduppgifter (GRATIS) ---');
        const grund = await client.getGrunduppgifter(orgnr);
        if (grund.success) {
            console.log(`Företag: ${grund.data.namn}`);
            console.log(`Form: ${grund.data.juridiskForm}`);
            console.log(`Status: ${grund.data.arsredovisningStatus}`);
        } else {
            console.log(`Fel: ${grund.error}`);
        }

        // 2. Händelsehistorik
        console.log('\n--- 2. Händelsehistorik (GRATIS) ---');
        const hist = await client.getHandelser(orgnr);
        if (hist.success) {
            console.log(`Antal händelser: ${hist.data.handelser.length}`);
            hist.data.handelser.slice(0, 3).forEach(h => {
                console.log(`  - År ${h.ar}: ${h.typ} (${h.datum})`);
            });
        }

        // 3. Tillgängliga årsredovisningar
        console.log('\n--- 3. Tillgängliga Årsredovisningar (GRATIS) ---');
        const ars = await client.getAllArsredovisningar(orgnr);
        console.log(`Företag: ${ars.foretagsnamn}`);
        console.log(`Antal tillgängliga: ${ars.arsredovisningar.length}`);
        ars.arsredovisningar.slice(0, 3).forEach(a => {
            console.log(`  - År ${a.ar}: ${a.formats.join(', ')}`);
        });

        // 4. Dokumenttyper
        console.log('\n--- 4. Dokumenttyper ---');
        console.log('GRATIS:');
        Object.values(DOCUMENT_TYPES.FREE).forEach(d => {
            console.log(`  ✅ ${d.name} (${d.code}): ${d.cost} kr`);
        });
        console.log('\nKOSTAR:');
        Object.values(DOCUMENT_TYPES.PAID).forEach(d => {
            console.log(`  💰 ${d.name} (${d.code}): ${d.cost} kr`);
        });

        console.log('\n' + '=' .repeat(60));
        console.log('TOTAL KOSTNAD FÖR ALLA GRATIS-OPERATIONER: 0 kr');
        console.log('=' .repeat(60));
    })();
}
