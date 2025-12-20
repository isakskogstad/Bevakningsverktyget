/**
 * Income Widget - Diskret inkomstknapp för dashboarden
 *
 * Visar inkomstuppgifter inline överallt där personer (VD, styrelse) visas.
 * Använder GitHub Actions för att hämta ny data via Puppeteer.
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
 *     IncomeWidget.init(supabaseClient, githubToken);
 *   </script>
 */

const IncomeWidget = (function() {
    'use strict';

    // Configuration
    const CONFIG = {
        GITHUB_OWNER: 'isakskogstad',
        GITHUB_REPO: 'Bevakningsverktyget',
        POLL_INTERVAL: 2000, // 2 seconds
        MAX_POLL_TIME: 300000 // 5 minutes
    };

    let supabase = null;
    let githubToken = null;

    /**
     * Initialize the widget system
     */
    function init(supabaseClient, token) {
        supabase = supabaseClient;
        githubToken = token;

        // Find all income widgets and render them
        document.querySelectorAll('.income-widget').forEach(renderWidget);

        console.log('[IncomeWidget] Initialized');
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
     * Fetch income data via GitHub Actions
     */
    async function fetchIncome(button, params) {
        const container = button.closest('.income-widget');

        try {
            // Create job in Supabase
            const jobId = crypto.randomUUID();

            const { error: insertError } = await supabase
                .from('income_fetch_jobs')
                .insert({
                    id: jobId,
                    person_name: params.personName,
                    birth_year: params.birthYear ? parseInt(params.birthYear) : null,
                    location: params.location || null,
                    company_orgnr: params.companyOrgnr || null,
                    role_type: params.roleType || null,
                    status: 'pending',
                    progress: 0,
                    current_step: 'Köar begäran...'
                });

            if (insertError) {
                throw new Error('Kunde inte skapa jobb: ' + insertError.message);
            }

            // Show initial progress
            renderProgress(container, { progress: 5, current_step: 'Startar GitHub Action...' });

            // Trigger GitHub Action via repository_dispatch
            const dispatchResponse = await fetch(
                `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/dispatches`,
                {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `token ${githubToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        event_type: 'fetch-income',
                        client_payload: {
                            job_id: jobId,
                            person_name: params.personName,
                            birth_year: params.birthYear || '',
                            location: params.location || '',
                            company_orgnr: params.companyOrgnr || '',
                            company_name: params.companyName || '',
                            role_type: params.roleType || ''
                        }
                    })
                }
            );

            if (!dispatchResponse.ok) {
                const errorText = await dispatchResponse.text();
                throw new Error('GitHub Action trigger failed: ' + errorText);
            }

            // Start polling for updates
            startPolling(container, jobId, params.personName, params.companyOrgnr);

        } catch (error) {
            console.error('[IncomeWidget] Fetch error:', error);
            container.innerHTML = `
                <div class="income-error">
                    <span>❌ ${error.message}</span>
                    <button onclick="IncomeWidget.renderWidget(this.closest('.income-widget'))">Försök igen</button>
                </div>
            `;
        }
    }

    /**
     * Poll for job updates
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

                // Get job status
                const { data: job, error } = await supabase
                    .from('income_fetch_jobs')
                    .select('*')
                    .eq('id', jobId)
                    .single();

                if (error) {
                    console.error('[IncomeWidget] Poll error:', error);
                    return;
                }

                // Update progress
                renderProgress(container, job);

                // Check if completed
                if (job.status === 'completed') {
                    clearInterval(pollInterval);

                    // Fetch and display the new data
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
                            <span>❌ ${job.error_message || 'Hämtning misslyckades'}</span>
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
