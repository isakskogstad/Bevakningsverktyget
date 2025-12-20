/**
 * Bolagsverket VDM (Värdefulla Datamängder) API Client - JavaScript Version
 * Official free API for company data - OAuth 2.0 authenticated
 *
 * API Endpoints (Production):
 * - Token: https://portal.api.bolagsverket.se/oauth2/token
 * - API:   https://gw.api.bolagsverket.se/vardefulla-datamangder/v1
 *
 * Features:
 * - OAuth 2.0 Client Credentials authentication
 * - Automatic token refresh
 * - Free annual reports (årsredovisningar) download
 *
 * NOTE: Requires BOLAGSVERKET_CLIENT_ID and BOLAGSVERKET_CLIENT_SECRET env vars
 * Get credentials at: https://portal.api.bolagsverket.se
 */

const https = require('https');

class BolagsverketVDMClient {
    static TOKEN_URL = 'https://portal.api.bolagsverket.se/oauth2/token';
    static API_BASE_URL = 'https://gw.api.bolagsverket.se/vardefulla-datamangder/v1';
    static TOKEN_MARGIN_MS = 5 * 60 * 1000; // 5 minutes before expiry

    constructor(options = {}) {
        this.clientId = options.clientId || process.env.BOLAGSVERKET_CLIENT_ID;
        this.clientSecret = options.clientSecret || process.env.BOLAGSVERKET_CLIENT_SECRET;
        this.environment = options.environment || 'production';

        // Token management
        this._accessToken = null;
        this._tokenExpiresAt = null;

        // URLs based on environment
        if (this.environment === 'test') {
            this.tokenUrl = 'https://portal.api-test.bolagsverket.se/oauth2/token';
            this.apiBaseUrl = 'https://gw.api-test.bolagsverket.se/vardefulla-datamangder/v1';
        } else {
            this.tokenUrl = BolagsverketVDMClient.TOKEN_URL;
            this.apiBaseUrl = BolagsverketVDMClient.API_BASE_URL;
        }
    }

    get isConfigured() {
        return Boolean(this.clientId && this.clientSecret);
    }

    /**
     * Make HTTPS request
     */
    _request(url, options = {}) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const reqOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: options.headers || {},
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        data: data
                    });
                });
            });

            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (options.body) {
                req.write(options.body);
            }
            req.end();
        });
    }

    /**
     * Get OAuth token
     */
    async _getToken() {
        if (!this.isConfigured) {
            console.error('[VDM] Credentials not configured');
            return null;
        }

        // Return cached token if still valid
        if (this._accessToken && this._tokenExpiresAt) {
            if (Date.now() < this._tokenExpiresAt - BolagsverketVDMClient.TOKEN_MARGIN_MS) {
                return this._accessToken;
            }
        }

        try {
            const body = new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: this.clientId,
                client_secret: this.clientSecret,
                scope: 'vardefulla-datamangder:ping vardefulla-datamangder:read'
            }).toString();

            const response = await this._request(this.tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body
            });

            if (response.status !== 200) {
                console.error('[VDM] Token request failed:', response.status, response.data);
                return null;
            }

            const tokenData = JSON.parse(response.data);
            this._accessToken = tokenData.access_token;
            const expiresIn = tokenData.expires_in || 3600;
            this._tokenExpiresAt = Date.now() + (expiresIn * 1000);

            console.log('[VDM] OAuth token obtained, expires in', expiresIn, 'seconds');
            return this._accessToken;

        } catch (error) {
            console.error('[VDM] Failed to get OAuth token:', error.message);
            return null;
        }
    }

    /**
     * Format organization number
     */
    _formatOrgnr(orgnr) {
        const clean = orgnr.replace(/-/g, '').replace(/ /g, '');
        if (clean.length === 10) {
            return {
                clean,
                formatted: `${clean.slice(0, 6)}-${clean.slice(6)}`
            };
        }
        return { clean, formatted: orgnr };
    }

    /**
     * Make authenticated API request
     */
    async _apiRequest(endpoint, method = 'POST', body = null) {
        const token = await this._getToken();
        if (!token) {
            return null;
        }

        const url = `${this.apiBaseUrl}${endpoint}`;
        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await this._request(url, options);

        if (response.status === 401) {
            // Token expired, retry once
            this._accessToken = null;
            return this._apiRequest(endpoint, method, body);
        }

        if (response.status >= 400) {
            console.error(`[VDM] API error ${response.status}:`, response.data);
            return null;
        }

        return JSON.parse(response.data);
    }

    /**
     * Get company information
     * @param {string} orgnr - Organization number (with or without hyphen)
     * @returns {Object|null} Company data or null if not found
     */
    async getCompany(orgnr) {
        const { formatted } = this._formatOrgnr(orgnr);
        const result = await this._apiRequest('/foretag', 'POST', {
            organisationsnummer: formatted
        });

        if (!result) return null;

        // Standardize response
        return {
            orgnr: result.organisationsnummer,
            namn: result.namn,
            status: result.status,
            foretagsform: result.foretagsform,
            sniKoder: result.sniKoder || [],
            adress: result.adress,
            reklamSparrad: result.reklamSparrad,
            raw: result
        };
    }

    /**
     * Get list of available documents (annual reports)
     * @param {string} orgnr - Organization number
     * @returns {Array} List of available documents
     */
    async getDocumentList(orgnr) {
        const { formatted } = this._formatOrgnr(orgnr);
        const result = await this._apiRequest('/dokument/lista', 'POST', {
            organisationsnummer: formatted
        });

        if (!result || !result.dokument) return [];

        return result.dokument.map(doc => ({
            dokumentId: doc.dokumentId,
            dokumentTyp: doc.dokumentTyp,
            rakenskapsperiod: doc.rakenskapsperiod,
            inlamningstidpunkt: doc.inlamningstidpunkt,
            raw: doc
        }));
    }

    /**
     * Download a document (annual report PDF)
     * @param {string} dokumentId - Document ID from getDocumentList
     * @returns {Buffer|null} PDF data or null if failed
     */
    async downloadDocument(dokumentId) {
        const token = await this._getToken();
        if (!token) return null;

        const url = `${this.apiBaseUrl}/dokument/${dokumentId}`;
        const response = await this._request(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/pdf'
            }
        });

        if (response.status !== 200) {
            console.error(`[VDM] Document download failed: ${response.status}`);
            return null;
        }

        return Buffer.from(response.data, 'binary');
    }

    /**
     * Check if annual report is available for free via VDM API
     * @param {string} orgnr - Organization number
     * @returns {Object} { available: boolean, documents: Array }
     */
    async checkFreeAnnualReports(orgnr) {
        const docs = await this.getDocumentList(orgnr);
        const arsredovisningar = docs.filter(d =>
            d.dokumentTyp === 'ARSREDOVISNING' ||
            d.dokumentTyp?.toLowerCase().includes('årsredovisning')
        );

        return {
            available: arsredovisningar.length > 0,
            documents: arsredovisningar,
            total: docs.length
        };
    }
}

// Export for use in other modules
module.exports = { BolagsverketVDMClient };

// CLI test
if (require.main === module) {
    (async () => {
        const client = new BolagsverketVDMClient();
        console.log('=== Bolagsverket VDM API Test ===');
        console.log('Configured:', client.isConfigured);

        if (!client.isConfigured) {
            console.log('\nMissing credentials. Set:');
            console.log('  BOLAGSVERKET_CLIENT_ID=...');
            console.log('  BOLAGSVERKET_CLIENT_SECRET=...');
            process.exit(1);
        }

        const orgnr = process.argv[2] || '5560165108'; // Default: Klarna
        console.log(`\nTesting with orgnr: ${orgnr}`);

        const company = await client.getCompany(orgnr);
        if (company) {
            console.log('\n--- Company Info ---');
            console.log('Name:', company.namn);
            console.log('Status:', company.status);
            console.log('Form:', company.foretagsform);
        } else {
            console.log('No company data returned');
        }

        const { available, documents } = await client.checkFreeAnnualReports(orgnr);
        console.log('\n--- Free Annual Reports ---');
        console.log('Available:', available);
        console.log('Count:', documents.length);
        documents.slice(0, 3).forEach(d => {
            console.log(`  - ${d.dokumentTyp}: ${d.rakenskapsperiod || 'no period'}`);
        });
    })();
}
