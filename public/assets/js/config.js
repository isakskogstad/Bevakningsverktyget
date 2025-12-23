/* ==========================================================================
   CONFIG - Applikationskonfiguration
   Med stöd för server-injicerade environment variables (window.ENV)
   ========================================================================== */

/**
 * Hämta miljövariabel från window.ENV (injicerat av server)
 * med fallback-värde om variabeln saknas
 */
const getEnvValue = (key, fallback = '') => {
    if (typeof window !== 'undefined' && window.ENV && window.ENV[key]) {
        return window.ENV[key];
    }
    return fallback;
};

/**
 * Kontrollera om vi kör i development-läge
 */
const isDevelopment = () => {
    if (typeof window === 'undefined') return false;
    return window.location.hostname === 'localhost' ||
           window.location.hostname === '127.0.0.1' ||
           getEnvValue('NODE_ENV') === 'development';
};

const CONFIG = {
    // Supabase - använder env vars med fallback
    supabase: {
        url: getEnvValue('SUPABASE_URL', 'https://wzkohritxdrstsmwopco.supabase.co'),
        anonKey: getEnvValue('SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a29ocml0eGRyc3RzbXdvcGNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMjkzMjUsImV4cCI6MjA4MDgwNTMyNX0.GigaAVp781QF9rv-AslVD_p4ksT8auWHwXU72H1kOqo'),
        publishableKey: 'sb_publishable_Bveoa4m3wp8BwLCeXYhP5Q_W4NzfUgT'
    },

    // API endpoints
    api: {
        baseUrl: getEnvValue('API_BASE_URL', 'https://loop-auto-api.onrender.com'),
        // API-nyckel ska helst komma från server-side proxy i produktion
        key: '2A6uNO2Z9HKTYLCBMQmGalaIJfNUJNjEJwuq1RpjHUg'
    },

    // Edge Functions - relativa paths fungerar med proxy
    edgeFunctions: {
        // Via server proxy
        budget: '/api/budget',
        poitSearch: '/api/poit/search',

        // Direkt till Supabase (för legacy-kod)
        rssProxy: '/functions/v1/rss-proxy',
        mynewsdeskProxy: '/functions/v1/mynewsdesk-proxy',
        sendSms: '/functions/v1/send-sms',
        generateArticle: '/functions/v1/generate-article',
        parsePdf: '/functions/v1/parse-pdf'
    },

    // GitHub Actions integration
    github: {
        owner: 'isakskogstad',
        repo: 'Bevakningsverktyget',
        // Token ska sättas i localStorage: localStorage.setItem('github_token', 'ghp_xxx')
        getToken: () => {
            if (typeof localStorage !== 'undefined') {
                return localStorage.getItem('github_token');
            }
            return null;
        }
    },

    // Appinställningar
    app: {
        name: 'Bevakningsverktyget',
        version: '2.0.0',
        defaultPageSize: 20,
        maxPageSize: 100,
        refreshInterval: 60000, // 1 minut
        environment: getEnvValue('NODE_ENV', 'development')
    },

    // Kategorier för POIT-händelser
    poitCategories: {
        'Konkurs': { class: 'tag-konkurs', icon: '⚠️' },
        'Nyregistrering': { class: 'tag-registrering', icon: '🆕' },
        'Ändring': { class: 'tag-andring', icon: '✏️' },
        'Kallelse': { class: 'tag-kallelse', icon: '📢' },
        'Skuld': { class: 'tag-skuld', icon: '💰' },
        'Fusion': { class: 'tag-fusion', icon: '🔄' },
        'Likvidation': { class: 'tag-likvidation', icon: '📉' }
    },

    // Admin e-postadresser
    adminEmails: ['isak.skogstad@me.com'],

    // Debug mode - aktivt i development eller localhost
    debug: isDevelopment(),

    // Helper för att bygga Supabase Edge Function URL
    getEdgeFunctionUrl: function(functionName) {
        return `${this.supabase.url}/functions/v1/${functionName}`;
    },

    // Helper för att kontrollera om config är korrekt laddad
    isConfigured: function() {
        return !!(this.supabase.url && this.supabase.anonKey);
    }
};

// Frys konfigurationen för att förhindra oavsiktliga ändringar
Object.freeze(CONFIG);
Object.freeze(CONFIG.supabase);
Object.freeze(CONFIG.api);
Object.freeze(CONFIG.edgeFunctions);
Object.freeze(CONFIG.github);
Object.freeze(CONFIG.app);
Object.freeze(CONFIG.poitCategories);

// Logga konfigstatus i development
if (CONFIG.debug) {
    console.log('=== Bevakningsverktyget Config ===');
    console.log('Supabase URL:', CONFIG.supabase.url);
    console.log('API Base URL:', CONFIG.api.baseUrl);
    console.log('Environment:', CONFIG.app.environment);
    console.log('Configured:', CONFIG.isConfigured());
    console.log('window.ENV:', typeof window !== 'undefined' ? window.ENV : 'N/A');
    console.log('==================================');
}

// Exportera för ES modules (om det används)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
