/**
 * Income Widget - Diskret inkomstknapp för dashboarden
 *
 * Visar inkomstuppgifter inline överallt där personer (VD, styrelse) visas.
 * Använder Render-deployad service för att hämta data via Puppeteer med Cloudflare bypass.
 *
 * Usage:
 *   <div class="income-widget"
 *        data-person-name="Anna Andersson"
 *        data-birth-year="1985"
 *        data-company-orgnr="5591234567"
 *        data-company-name="Företaget AB"
 *        data-role-type="VD">
 *   </div>
 *
 *   <script>
 *     IncomeWidget.init(supabaseClient, apiKey);
 *   </script>
 */

const IncomeWidget = (function() {
    'use strict';

    // Configuration
    const CONFIG = {
        // Render-deployad Ratsit Income Service
        INCOME_SERVICE_URL: 'https://loop-auto.onrender.com',
        INCOME_SERVICE_API_KEY: '2A6uNO2Z9HKTYLCBMQmGalaIJfNUJNjEJwuq1RpjHUg',
        POLL_INTERVAL: 3000, // 3 seconds (service behöver tid för scraping)
        MAX_POLL_TIME: 180000 // 3 minutes
    };

    let supabase = null;
    let apiKey = null;

    /**
     * Initialize the widget system
     * @param {Object} supabaseClient - Supabase client for data storage
     * @param {string} serviceApiKey - API key for income service (optional, uses default)
     */
    function init(supabaseClient, serviceApiKey) {
        supabase = supabaseClient;
        apiKey = serviceApiKey || CONFIG.INCOME_SERVICE_API_KEY;

        // Find all income widgets and render them
        document.querySelectorAll('.income-widget').forEach(renderWidget);

        console.log('[IncomeWidget] Initialized with Render service');
    }

    /**
     * Render a single income widget
     */
    async function renderWidget(container) {
        const personName = container.dataset.personName;
        const birthYear = container.dataset.birthYear;
        const companyOrgnr = container.dataset.companyOrgnr;
        const companyName = container.dataset.companyName;
        const roleType = container.dataset.roleType;

        if (!personName) {
            console.warn('[IncomeWidget] Missing person-name attribute');
            return;
        }

        // Show loading state
        container.innerHTML = '<span class="income-loading">Laddar...</span>';

        try {
            // Check if we have existing data
            const existingData = await getExistingIncome(personName, companyOrgnr);

            if (existingData && existingData.length > 0) {
                renderIncomeData(container, existingData);
            } else {
                // Check for pending/running job
                const pendingJob = await getPendingJob(personName, companyOrgnr);

                if (pendingJob) {
                    renderProgress(container, pendingJob);
                    startPolling(container, pendingJob.id, personName, companyOrgnr);
                } else {
                    renderFetchButton(container, {
                        personName,
                        birthYear,
                        companyOrgnr,
                        companyName,
                        roleType
                    });
                }
            }
        } catch (error) {
            console.error('[IncomeWidget] Error:', error);
            container.innerHTML = '<span class="income-error">Kunde inte ladda</span>';
        }
    }

    /**
     * Get existing income data from database
     */
    async function getExistingIncome(personName, companyOrgnr) {
        let query = supabase
            .from('person_income')
            .select('*')
            .ilike('person_name', personName)
            .order('income_year', { ascending: false });

        if (companyOrgnr) {
            query = query.eq('company_orgnr', companyOrgnr);
        }

        const { data, error } = await query.limit(3);

        if (error) {
            console.error('[IncomeWidget] DB error:', error);
            return null;
        }

        return data;
    }

    /**
     * Get pending or running job
     */
    async function getPendingJob(personName, companyOrgnr) {
        let query = supabase
            .from('income_fetch_jobs')
            .select('*')
            .ilike('person_name', personName)
            .in('status', ['pending', 'running'])
            .order('created_at', { ascending: false });

        if (companyOrgnr) {
            query = query.eq('company_orgnr', companyOrgnr);
        }

        const { data, error } = await query.limit(1);

        if (error || !data || data.length === 0) {
            return null;
        }

        return data[0];
    }

    /**
     * Render income data inline
     */
    function renderIncomeData(container, incomes) {
        const latest = incomes[0];
        const taxable = formatCurrency(latest.taxable_income);
        const capital = formatCurrency(latest.capital_income);
        const year = latest.income_year;

        container.innerHTML = `
            <div class="income-data">
                <button class="income-toggle" onclick="IncomeWidget.toggleDetails(this)">
                    <span class="income-icon">💰</span>
                    <span class="income-summary">${taxable} (${year})</span>
                    <span class="income-arrow">▼</span>
                </button>
                <div class="income-details" style="display: none;">
                    <div class="income-row">
                        <span class="income-label">Förvärvsinkomst</span>
                        <span class="income-value">${taxable}</span>
                    </div>
                    ${latest.capital_income ? `
                    <div class="income-row">
                        <span class="income-label">Kapitalinkomst</span>
                        <span class="income-value">${capital}</span>
                    </div>
                    ` : ''}
                    ${latest.salary_ranking ? `
                    <div class="income-row">
                        <span class="income-label">Löneranking</span>
                        <span class="income-value">#${latest.salary_ranking.toLocaleString('sv-SE')}</span>
                    </div>
                    ` : ''}
                    ${latest.has_payment_remarks ? `
                    <div class="income-row income-warning">
                        <span class="income-label">⚠️ Betalningsanmärkning</span>
                    </div>
                    ` : ''}
                    <div class="income-meta">
                        Hämtad: ${formatDate(latest.scraped_at)}
                    </div>
                    ${incomes.length > 1 ? renderYearTabs(incomes) : ''}
                </div>
            </div>
        `;

        container.classList.add('income-loaded');
    }

    /**
     * Render year tabs for multiple years
     */
    function renderYearTabs(incomes) {
        const tabs = incomes.map((inc, i) => `
            <button class="income-year-tab ${i === 0 ? 'active' : ''}"
                    onclick="IncomeWidget.showYear(this, ${JSON.stringify(inc).replace(/"/g, '&quot;')})">
                ${inc.income_year}
            </button>
        `).join('');

        return `<div class="income-year-tabs">${tabs}</div>`;
    }

    /**
     * Render fetch button
     */
    function renderFetchButton(container, params) {
        container.innerHTML = `
            <button class="income-fetch-btn" onclick="IncomeWidget.fetchIncome(this, ${JSON.stringify(params).replace(/"/g, '&quot;')})">
                <span class="income-icon">📊</span>
                Hämta inkomst
            </button>
        `;
    }

    /**
     * Render progress bar
     */
    function renderProgress(container, job) {
        const progress = job.progress || 0;
        const step = job.current_step || 'Väntar...';

        container.innerHTML = `
            <div class="income-progress">
                <div class="income-progress-bar">
                    <div class="income-progress-fill" style="width: ${progress}%"></div>
                </div>
                <div class="income-progress-text">${step}</div>
            </div>
        `;
    }

    /**
     * Fetch income data via Render-deployad service
     *
     * Anropar loop-auto.onrender.com som kör Puppeteer med Cloudflare bypass.
     * Servicen sparar data direkt i Supabase och returnerar job-status.
     */
    async function fetchIncome(button, params) {
        const container = button.closest('.income-widget');

        try {
            // Show loading state
            container.innerHTML = `
                <div class="income-progress">
                    <div class="income-progress-bar">
                        <div class="income-progress-fill" style="width: 10%"></div>
                    </div>
                    <div class="income-progress-text">Startar hämtning...</div>
                </div>
            `;

            // Call Render service to start income fetch
            const response = await fetch(`${CONFIG.INCOME_SERVICE_URL}/api/fetch-income`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey || CONFIG.INCOME_SERVICE_API_KEY
                },
                body: JSON.stringify({
                    person_name: params.personName,
                    birth_year: params.birthYear ? parseInt(params.birthYear) : null,
                    location: params.location || null,
                    company_orgnr: params.companyOrgnr || null,
                    company_name: params.companyName || null,
                    role_type: params.roleType || null
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Service error: ${response.status}`);
            }

            const result = await response.json();
            const jobId = result.jobId;

            console.log('[IncomeWidget] Job started:', jobId);

            // Start polling for job completion
            startPolling(container, jobId, params.personName, params.companyOrgnr);

        } catch (error) {
            console.error('[IncomeWidget] Fetch error:', error);

            // Check if service is sleeping (cold start)
            const isColdStart = error.message.includes('Failed to fetch') ||
                               error.message.includes('NetworkError');

            container.innerHTML = `
                <div class="income-error">
                    <span>❌ ${isColdStart ? 'Service startar upp, försök igen om 30 sek' : error.message}</span>
                    <button onclick="IncomeWidget.renderWidget(this.closest('.income-widget'))">Försök igen</button>
                </div>
            `;
        }
    }

    /**
     * Poll for job updates via Render service
     */
    function startPolling(container, jobId, personName, companyOrgnr) {
        const startTime = Date.now();

        const pollInterval = setInterval(async () => {
            try {
                // Check timeout
                if (Date.now() - startTime > CONFIG.MAX_POLL_TIME) {
                    clearInterval(pollInterval);
                    container.innerHTML = `
                        <div class="income-error">
                            <span>⏱️ Timeout - försök igen senare</span>
                            <button onclick="IncomeWidget.renderWidget(this.closest('.income-widget'))">Försök igen</button>
                        </div>
                    `;
                    return;
                }

                // Get job status from Render service
                const response = await fetch(`${CONFIG.INCOME_SERVICE_URL}/api/jobs/${jobId}`, {
                    headers: {
                        'X-API-Key': apiKey || CONFIG.INCOME_SERVICE_API_KEY
                    }
                });

                if (!response.ok) {
                    console.error('[IncomeWidget] Poll error:', response.status);
                    return;
                }

                const job = await response.json();

                // Update progress
                renderProgress(container, job);

                // Check if completed
                if (job.status === 'completed') {
                    clearInterval(pollInterval);

                    // Fetch and display the new data from Supabase
                    const incomeData = await getExistingIncome(personName, companyOrgnr);
                    if (incomeData && incomeData.length > 0) {
                        renderIncomeData(container, incomeData);
                    } else {
                        container.innerHTML = '<span class="income-error">Data hämtad men kunde inte visas</span>';
                    }
                }

                // Check if failed
                if (job.status === 'failed') {
                    clearInterval(pollInterval);
                    container.innerHTML = `
                        <div class="income-error">
                            <span>❌ ${job.error || 'Hämtning misslyckades'}</span>
                            <button onclick="IncomeWidget.renderWidget(this.closest('.income-widget'))">Försök igen</button>
                        </div>
                    `;
                }

            } catch (error) {
                console.error('[IncomeWidget] Poll error:', error);
            }
        }, CONFIG.POLL_INTERVAL);

        // Store interval ID on container for cleanup
        container._pollInterval = pollInterval;
    }

    /**
     * Toggle details visibility
     */
    function toggleDetails(button) {
        const details = button.nextElementSibling;
        const arrow = button.querySelector('.income-arrow');

        if (details.style.display === 'none') {
            details.style.display = 'block';
            arrow.textContent = '▲';
        } else {
            details.style.display = 'none';
            arrow.textContent = '▼';
        }
    }

    /**
     * Show specific year's data
     */
    function showYear(tab, incomeData) {
        // Update active tab
        tab.parentElement.querySelectorAll('.income-year-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update displayed values
        const container = tab.closest('.income-data');
        const rows = container.querySelectorAll('.income-row');

        rows.forEach(row => {
            const label = row.querySelector('.income-label').textContent;
            if (label === 'Förvärvsinkomst') {
                row.querySelector('.income-value').textContent = formatCurrency(incomeData.taxable_income);
            } else if (label === 'Kapitalinkomst') {
                row.querySelector('.income-value').textContent = formatCurrency(incomeData.capital_income);
            } else if (label === 'Löneranking') {
                row.querySelector('.income-value').textContent = '#' + (incomeData.salary_ranking || 'N/A').toLocaleString('sv-SE');
            }
        });
    }

    /**
     * Create widget programmatically
     */
    function createWidget(options) {
        const div = document.createElement('div');
        div.className = 'income-widget';
        div.dataset.personName = options.personName;

        if (options.birthYear) div.dataset.birthYear = options.birthYear;
        if (options.companyOrgnr) div.dataset.companyOrgnr = options.companyOrgnr;
        if (options.companyName) div.dataset.companyName = options.companyName;
        if (options.roleType) div.dataset.roleType = options.roleType;

        renderWidget(div);
        return div;
    }

    // Utility functions
    function formatCurrency(value) {
        if (!value && value !== 0) return 'N/A';
        return value.toLocaleString('sv-SE') + ' kr';
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('sv-SE');
    }

    // Public API
    return {
        init,
        renderWidget,
        fetchIncome,
        toggleDetails,
        showYear,
        createWidget,
        getExistingIncome
    };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IncomeWidget;
}
