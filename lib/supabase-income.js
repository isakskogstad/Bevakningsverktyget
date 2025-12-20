/**
 * Supabase Income Integration
 *
 * Hanterar sparande av inkomstdata och PDF-filer till Supabase.
 * Används av ratsit-server.js efter att PDF har parsats.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Konfiguration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wzkohritxdrstsmwopco.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const PDF_BUCKET = 'lonekollen-pdfs';

class SupabaseIncomeService {
    constructor() {
        if (!SUPABASE_SERVICE_KEY) {
            console.warn('[SupabaseIncome] Varning: SUPABASE_SERVICE_KEY saknas');
            this.client = null;
        } else {
            this.client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        }
    }

    /**
     * Ladda upp PDF till Supabase Storage
     * @param {string} pdfPath - Lokal sökväg till PDF-filen
     * @param {string} personName - Personens namn (för filnamn)
     * @param {string} companyOrgnr - Organisationsnummer (optional)
     * @returns {Promise<string|null>} - Storage path eller null vid fel
     */
    async uploadPdf(pdfPath, personName, companyOrgnr = null) {
        if (!this.client) {
            console.warn('[SupabaseIncome] Supabase ej konfigurerad, hoppar över PDF-uppladdning');
            return null;
        }

        try {
            // Skapa unikt filnamn
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const safeName = personName.replace(/[^a-zA-ZåäöÅÄÖ0-9]/g, '_');
            const fileName = companyOrgnr
                ? `${companyOrgnr}/${safeName}_${timestamp}.pdf`
                : `persons/${safeName}_${timestamp}.pdf`;

            // Läs PDF-filen
            const fileBuffer = fs.readFileSync(pdfPath);

            // Ladda upp till Supabase Storage
            const { data, error } = await this.client.storage
                .from(PDF_BUCKET)
                .upload(fileName, fileBuffer, {
                    contentType: 'application/pdf',
                    upsert: false
                });

            if (error) {
                console.error('[SupabaseIncome] PDF upload error:', error.message);
                return null;
            }

            console.log(`[SupabaseIncome] PDF uppladdad: ${fileName}`);
            return data.path;

        } catch (error) {
            console.error('[SupabaseIncome] PDF upload exception:', error.message);
            return null;
        }
    }

    /**
     * Spara inkomstdata för en person (flera år)
     * @param {Object} parsedData - Data från parse-lonekollen-pdf.py
     * @param {Object} context - Kontext (companyOrgnr, companyName, roleType, userId)
     * @param {string|null} pdfStoragePath - Sökväg i Supabase Storage
     * @returns {Promise<Object>} - { success, savedIds, errors }
     */
    async saveIncomeData(parsedData, context = {}, pdfStoragePath = null) {
        if (!this.client) {
            return { success: false, error: 'Supabase ej konfigurerad' };
        }

        const { companyOrgnr, companyName, roleType, userId } = context;
        const savedIds = [];
        const errors = [];

        // Spara varje inkomstår
        for (const income of parsedData.inkomster || []) {
            try {
                const { data, error } = await this.client.rpc('upsert_person_income', {
                    p_person_name: parsedData.namn,
                    p_income_year: income.inkomstar,
                    p_taxable_income: income.lon_forvarvsinkomst,
                    p_capital_income: income.kapitalinkomst,
                    p_age: income.alder,
                    p_salary_ranking: income.loneranking,
                    p_has_payment_remarks: income.betalningsanmarkning || false,
                    p_address: parsedData.adress,
                    p_pdf_path: pdfStoragePath,
                    p_company_orgnr: companyOrgnr || null,
                    p_company_name: companyName || null,
                    p_role_type: roleType || null,
                    p_requested_by: userId || null
                });

                if (error) {
                    console.error(`[SupabaseIncome] Fel vid sparande år ${income.inkomstar}:`, error.message);
                    errors.push({ year: income.inkomstar, error: error.message });
                } else {
                    savedIds.push({ year: income.inkomstar, id: data });
                    console.log(`[SupabaseIncome] Sparade år ${income.inkomstar} för ${parsedData.namn}`);
                }

            } catch (err) {
                console.error(`[SupabaseIncome] Exception år ${income.inkomstar}:`, err.message);
                errors.push({ year: income.inkomstar, error: err.message });
            }
        }

        return {
            success: errors.length === 0,
            savedIds,
            errors,
            personName: parsedData.namn,
            yearsProcessed: parsedData.inkomster?.length || 0
        };
    }

    /**
     * Skapa eller uppdatera ett fetch-jobb i databasen
     * @param {string} jobId - Jobb-ID
     * @param {Object} jobData - Jobbdata
     * @returns {Promise<Object|null>}
     */
    async createFetchJob(jobId, jobData) {
        if (!this.client) return null;

        try {
            const { data, error } = await this.client
                .from('income_fetch_jobs')
                .insert({
                    id: jobId,
                    person_name: jobData.personName,
                    birth_year: jobData.birthYear,
                    location: jobData.location,
                    company_orgnr: jobData.companyOrgnr,
                    role_type: jobData.roleType,
                    status: 'pending',
                    progress: 0,
                    current_step: 'Väntar...',
                    requested_by: jobData.userId
                })
                .select()
                .single();

            if (error) {
                console.error('[SupabaseIncome] createFetchJob error:', error.message);
                return null;
            }
            return data;

        } catch (err) {
            console.error('[SupabaseIncome] createFetchJob exception:', err.message);
            return null;
        }
    }

    /**
     * Uppdatera jobbstatus
     * @param {string} jobId - Jobb-ID
     * @param {Object} updates - Fält att uppdatera
     * @returns {Promise<boolean>}
     */
    async updateFetchJob(jobId, updates) {
        if (!this.client) return false;

        try {
            const dbUpdates = {};
            if (updates.status) dbUpdates.status = updates.status;
            if (updates.progress !== undefined) dbUpdates.progress = updates.progress;
            if (updates.currentStep) dbUpdates.current_step = updates.currentStep;
            if (updates.error) dbUpdates.error_message = updates.error;
            if (updates.resultId) dbUpdates.result_id = updates.resultId;
            if (updates.status === 'running' && !updates.startedAt) {
                dbUpdates.started_at = new Date().toISOString();
            }
            if (updates.status === 'completed' || updates.status === 'failed') {
                dbUpdates.completed_at = new Date().toISOString();
            }

            const { error } = await this.client
                .from('income_fetch_jobs')
                .update(dbUpdates)
                .eq('id', jobId);

            if (error) {
                console.error('[SupabaseIncome] updateFetchJob error:', error.message);
                return false;
            }
            return true;

        } catch (err) {
            console.error('[SupabaseIncome] updateFetchJob exception:', err.message);
            return false;
        }
    }

    /**
     * Hämta senaste inkomstdata för en person
     * @param {string} personName - Personens namn
     * @param {string|null} companyOrgnr - Organisationsnummer (optional)
     * @returns {Promise<Object[]>}
     */
    async getPersonIncome(personName, companyOrgnr = null) {
        if (!this.client) return [];

        try {
            let query = this.client
                .from('person_income')
                .select('*')
                .ilike('person_name', personName)
                .order('income_year', { ascending: false });

            if (companyOrgnr) {
                query = query.eq('company_orgnr', companyOrgnr);
            }

            const { data, error } = await query;

            if (error) {
                console.error('[SupabaseIncome] getPersonIncome error:', error.message);
                return [];
            }

            return data || [];

        } catch (err) {
            console.error('[SupabaseIncome] getPersonIncome exception:', err.message);
            return [];
        }
    }

    /**
     * Kontrollera om vi redan har data för en person/år
     * @param {string} personName - Personens namn
     * @param {number} incomeYear - Inkomstår
     * @param {string|null} companyOrgnr - Organisationsnummer
     * @returns {Promise<boolean>}
     */
    async hasExistingData(personName, incomeYear, companyOrgnr = null) {
        if (!this.client) return false;

        try {
            let query = this.client
                .from('person_income')
                .select('id')
                .ilike('person_name', personName)
                .eq('income_year', incomeYear);

            if (companyOrgnr) {
                query = query.eq('company_orgnr', companyOrgnr);
            }

            const { data, error } = await query.limit(1);

            if (error) return false;
            return (data?.length || 0) > 0;

        } catch (err) {
            return false;
        }
    }

    /**
     * Hämta signerad URL för att ladda ner en PDF
     * @param {string} storagePath - Sökväg i Storage
     * @param {number} expiresIn - Sekunder tills URL går ut (default 1 timme)
     * @returns {Promise<string|null>}
     */
    async getPdfDownloadUrl(storagePath, expiresIn = 3600) {
        if (!this.client || !storagePath) return null;

        try {
            const { data, error } = await this.client.storage
                .from(PDF_BUCKET)
                .createSignedUrl(storagePath, expiresIn);

            if (error) {
                console.error('[SupabaseIncome] getPdfDownloadUrl error:', error.message);
                return null;
            }

            return data?.signedUrl || null;

        } catch (err) {
            console.error('[SupabaseIncome] getPdfDownloadUrl exception:', err.message);
            return null;
        }
    }
}

// Singleton-instans
const incomeService = new SupabaseIncomeService();

module.exports = {
    SupabaseIncomeService,
    incomeService
};
