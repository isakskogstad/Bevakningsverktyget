/* ==========================================================================
   AUTH - Autentiseringsmodul
   ========================================================================== */

const Auth = (function() {
    'use strict';

    let supabaseClient = null;
    let currentUser = null;
    let userRole = null;

    // Initiera Supabase-klienten
    function init() {
        if (typeof supabase === 'undefined') {
            console.error('Supabase SDK ej laddad');
            return false;
        }

        supabaseClient = supabase.createClient(
            CONFIG.supabase.url,
            CONFIG.supabase.anonKey
        );

        return true;
    }

    // Hämta aktuell användare
    async function getUser() {
        if (!supabaseClient) init();

        const { data: { user }, error } = await supabaseClient.auth.getUser();

        if (error) {
            console.error('getUser error:', error);
            return null;
        }

        currentUser = user;
        return user;
    }

    // Hämta användarroll
    async function getUserRole() {
        if (!currentUser) {
            await getUser();
        }

        if (!currentUser) return null;

        // Kolla admin-listan först
        if (CONFIG.adminEmails.includes(currentUser.email)) {
            userRole = 'admin';
            return 'admin';
        }

        // Kolla user_profiles-tabellen
        try {
            const { data: profile, error } = await supabaseClient
                .from('user_profiles')
                .select('role')
                .eq('id', currentUser.id)
                .single();

            if (error) {
                console.warn('Kunde inte hämta profil:', error);
                userRole = 'member';
                return 'member';
            }

            userRole = profile?.role || 'member';
            return userRole;
        } catch (err) {
            console.error('getUserRole error:', err);
            userRole = 'member';
            return 'member';
        }
    }

    // Logga in
    async function login(email, password) {
        if (!supabaseClient) init();

        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            throw error;
        }

        currentUser = data.user;
        await getUserRole();

        return data.user;
    }

    // Logga ut
    async function logout() {
        if (!supabaseClient) return;

        const { error } = await supabaseClient.auth.signOut();

        if (error) {
            console.error('Logout error:', error);
            throw error;
        }

        currentUser = null;
        userRole = null;
    }

    // Kolla om användaren är inloggad
    function isAuthenticated() {
        return currentUser !== null;
    }

    // Kolla om användaren är admin
    function isAdmin() {
        return userRole === 'admin';
    }

    // Hämta initialer från e-post
    function getInitials(email) {
        if (!email) return '??';

        const parts = email.split('@')[0].split('.');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return email.substring(0, 2).toUpperCase();
    }

    // Lyssna på auth-ändringar
    function onAuthStateChange(callback) {
        if (!supabaseClient) init();

        return supabaseClient.auth.onAuthStateChange((event, session) => {
            currentUser = session?.user || null;
            callback(event, session);
        });
    }

    // Hämta Supabase-klienten
    function getClient() {
        if (!supabaseClient) init();
        return supabaseClient;
    }

    // Publikt API
    return {
        init,
        getUser,
        getUserRole,
        login,
        logout,
        isAuthenticated,
        isAdmin,
        getInitials,
        onAuthStateChange,
        getClient,
        get currentUser() { return currentUser; },
        get userRole() { return userRole; }
    };
})();

// Auto-initiera om CONFIG finns
if (typeof CONFIG !== 'undefined') {
    Auth.init();
}
