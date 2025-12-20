/* ==========================================================================
   CONFIG - Applikationskonfiguration
   ========================================================================== */

const CONFIG = {
    // Supabase
    supabase: {
        url: 'https://wzkohritxdrstsmwopco.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a29ocml0eGRyc3RzbXdvcGNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMjkzMjUsImV4cCI6MjA4MDgwNTMyNX0.GigaAVp781QF9rv-AslVD_p4ksT8auWHwXU72H1kOqo',
        publishableKey: 'sb_publishable_Bveoa4m3wp8BwLCeXYhP5Q_W4NzfUgT'
    },

    // API endpoints
    api: {
        baseUrl: 'https://loop-auto-api.onrender.com',
        key: '2A6uNO2Z9HKTYLCBMQmGalaIJfNUJNjEJwuq1RpjHUg'
    },

    // Edge Functions (för framtida användning)
    edgeFunctions: {
        rssProxy: '/functions/v1/rss-proxy',
        mynewsdeskProxy: '/functions/v1/mynewsdesk-proxy',
        sendSms: '/functions/v1/send-sms'
    },

    // GitHub Actions integration
    github: {
        owner: 'isakskogstad',
        repo: 'Bevakningsverktyget',
        // Token ska sättas i localStorage: localStorage.setItem('github_token', 'ghp_xxx')
        getToken: () => localStorage.getItem('github_token')
    },

    // Appinställningar
    app: {
        name: 'Bevakningsverktyget',
        version: '2.0.0',
        defaultPageSize: 20,
        maxPageSize: 100,
        refreshInterval: 60000 // 1 minut
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

    // Debug mode
    debug: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
};

// Frys konfigurationen för att förhindra oavsiktliga ändringar
Object.freeze(CONFIG);
Object.freeze(CONFIG.supabase);
Object.freeze(CONFIG.api);
Object.freeze(CONFIG.edgeFunctions);
Object.freeze(CONFIG.github);
Object.freeze(CONFIG.app);
Object.freeze(CONFIG.poitCategories);

// Exportera för ES modules (om det används)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
