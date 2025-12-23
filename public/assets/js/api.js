/* ==========================================================================
   API - Databasoperationer och API-anrop
   Med intelligent caching och real-time subscriptions
   ========================================================================== */

const API = (function() {
    'use strict';

    // Hämta Supabase-klienten
    function getClient() {
        return Auth.getClient();
    }

    // --------------------------------------------------------------------------
    // REALTIME SUBSCRIPTIONS
    // --------------------------------------------------------------------------

    // Aktiva subscriptions
    const activeSubscriptions = new Map();

    /**
     * Prenumerera på nya POIT-händelser via Supabase Realtime
     * @param {Function} onInsert - Callback när ny händelse läggs till
     * @param {Function} onUpdate - Callback vid uppdatering (optional)
     * @param {Function} onDelete - Callback vid radering (optional)
     * @returns {Object} - Subscription objekt med unsubscribe()
     */
    function subscribeToPoitEvents(onInsert, onUpdate = null, onDelete = null) {
        const sb = getClient();
        const channelName = 'poit_events_realtime';

        // Avsluta befintlig subscription om sådan finns
        if (activeSubscriptions.has(channelName)) {
            activeSubscriptions.get(channelName).unsubscribe();
        }

        const channel = sb
            .channel(channelName)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'poit_announcements'
                },
                (payload) => {
                    console.log('[Realtime] Ny POIT-händelse:', payload.new);
                    // Invalidera cache vid nya händelser
                    if (window.CacheManager) {
                        window.CacheManager.invalidate('poit');
                    }
                    if (onInsert) onInsert(payload.new);
                }
            );

        if (onUpdate) {
            channel.on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'poit_announcements'
                },
                (payload) => {
                    console.log('[Realtime] POIT-uppdatering:', payload.new);
                    if (window.CacheManager) {
                        window.CacheManager.invalidate('poit');
                    }
                    onUpdate(payload.new, payload.old);
                }
            );
        }

        if (onDelete) {
            channel.on(
                'postgres_changes',
                {
                    event: 'DELETE',
                    schema: 'public',
                    table: 'poit_announcements'
                },
                (payload) => {
                    console.log('[Realtime] POIT-radering:', payload.old);
                    if (window.CacheManager) {
                        window.CacheManager.invalidate('poit');
                    }
                    onDelete(payload.old);
                }
            );
        }

        const subscription = channel.subscribe((status) => {
            console.log('[Realtime] POIT subscription status:', status);
        });

        activeSubscriptions.set(channelName, subscription);

        return {
            unsubscribe: () => {
                subscription.unsubscribe();
                activeSubscriptions.delete(channelName);
            }
        };
    }

    /**
     * Prenumerera på ändringar i företagsdata
     */
    function subscribeToCompanyChanges(onUpdate) {
        const sb = getClient();
        const channelName = 'companies_realtime';

        if (activeSubscriptions.has(channelName)) {
            activeSubscriptions.get(channelName).unsubscribe();
        }

        const subscription = sb
            .channel(channelName)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'loop_table'
                },
                (payload) => {
                    console.log('[Realtime] Företagsändring:', payload);
                    if (window.CacheManager) {
                        window.CacheManager.invalidate('companies');
                    }
                    if (onUpdate) onUpdate(payload);
                }
            )
            .subscribe((status) => {
                console.log('[Realtime] Companies subscription status:', status);
            });

        activeSubscriptions.set(channelName, subscription);

        return {
            unsubscribe: () => {
                subscription.unsubscribe();
                activeSubscriptions.delete(channelName);
            }
        };
    }

    /**
     * Avsluta alla aktiva subscriptions
     */
    function unsubscribeAll() {
        activeSubscriptions.forEach((sub, name) => {
            console.log('[Realtime] Avslutar subscription:', name);
            sub.unsubscribe();
        });
        activeSubscriptions.clear();
    }

    // --------------------------------------------------------------------------
    // CACHED FETCH HELPERS
    // --------------------------------------------------------------------------

    const TTL = window.CacheManager?.TTL || {
        POIT_EVENTS: 2 * 60 * 1000,
        COMPANIES: 10 * 60 * 1000,
        RSS_ARTICLES: 2 * 60 * 1000,
        COMPANY_DETAILS: 10 * 60 * 1000,
        STATS: 1 * 60 * 1000,
        PRESS_RELEASES: 2 * 60 * 1000
    };

    // --------------------------------------------------------------------------
    // FÖRETAG (Loop Table)
    // --------------------------------------------------------------------------

    async function getCompanies(options = {}) {
        const {
            page = 1,
            pageSize = CONFIG.app.defaultPageSize,
            sector = null,
            search = null,
            orderBy = 'foretag',
            ascending = true,
            useCache = true
        } = options;

        // Skapa cache-nyckel baserad på alla parametrar
        const cacheKey = `companies_${page}_${pageSize}_${sector || 'all'}_${search || 'none'}_${orderBy}_${ascending}`;

        // Försök hämta från cache först
        if (useCache && window.CacheManager) {
            const cached = window.CacheManager.get(cacheKey, TTL.COMPANIES);
            if (cached) {
                console.log('[Cache] Företagsdata från cache');
                return cached;
            }
        }

        const sb = getClient();
        let query = sb
            .from('loop_table')
            .select('*', { count: 'exact' });

        if (sector) {
            query = query.eq('sektor', sector);
        }

        if (search) {
            query = query.or(`foretag.ilike.%${search}%,org_nr.ilike.%${search}%`);
        }

        query = query.order(orderBy, { ascending });

        // Pagination
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;

        if (error) throw error;

        const result = { data, count, page, pageSize };

        // Spara i cache
        if (window.CacheManager) {
            window.CacheManager.set(cacheKey, result);
        }

        return result;
    }

    async function getCompanyById(id) {
        const sb = getClient();
        const { data, error } = await sb
            .from('loop_table')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        return data;
    }

    async function getCompanyByOrgNr(orgNr) {
        const sb = getClient();
        const { data, error } = await sb
            .from('loop_table')
            .select('*')
            .eq('org_nr', orgNr)
            .single();

        if (error) throw error;
        return data;
    }

    async function getSectors() {
        const sb = getClient();
        const { data, error } = await sb
            .from('loop_table')
            .select('sektor')
            .not('sektor', 'is', null);

        if (error) throw error;

        // Unika sektorer
        const sectors = [...new Set(data.map(d => d.sektor))].filter(Boolean).sort();
        return sectors;
    }

    async function getCompanyCount() {
        const sb = getClient();
        const { count, error } = await sb
            .from('loop_table')
            .select('*', { count: 'exact', head: true });

        if (error) throw error;
        return count;
    }

    // --------------------------------------------------------------------------
    // POIT-HÄNDELSER
    // --------------------------------------------------------------------------

    async function getPoitEvents(options = {}) {
        const {
            page = 1,
            pageSize = CONFIG.app.defaultPageSize,
            category = null,
            startDate = null,
            endDate = null,
            onlyWatched = false,
            useCache = true
        } = options;

        // Cache-nyckel baserad på parametrar
        const cacheKey = `poit_${page}_${pageSize}_${category || 'all'}_${startDate || 'none'}_${endDate || 'none'}`;

        // Försök hämta från cache
        if (useCache && window.CacheManager) {
            const cached = window.CacheManager.get(cacheKey, TTL.POIT_EVENTS);
            if (cached) {
                console.log('[Cache] POIT-händelser från cache');
                return cached;
            }
        }

        const sb = getClient();
        // Använd loop_poit_events view för endast Loop's bevakade företag
        let query = sb
            .from('loop_poit_events')
            .select('*', { count: 'exact' });

        if (category) {
            query = query.ilike('category', `%${category}%`);
        }

        if (startDate) {
            query = query.gte('announcement_date', startDate);
        }

        if (endDate) {
            query = query.lte('announcement_date', endDate);
        }

        // Sortera nyast först
        query = query.order('announcement_date', { ascending: false });

        // Pagination
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;

        if (error) throw error;

        const result = { data, count, page, pageSize };

        // Spara i cache
        if (window.CacheManager) {
            window.CacheManager.set(cacheKey, result);
        }

        return result;
    }

    async function getPoitEventCount(today = false) {
        const sb = getClient();
        // Använd loop_poit_events view för endast Loop's bevakade företag
        let query = sb
            .from('loop_poit_events')
            .select('*', { count: 'exact', head: true });

        if (today) {
            const todayStr = new Date().toISOString().split('T')[0];
            query = query.gte('announcement_date', todayStr);
        }

        const { count, error } = await query;

        if (error) throw error;
        return count;
    }

    // --------------------------------------------------------------------------
    // BEVAKADE FÖRETAG
    // --------------------------------------------------------------------------

    async function getWatchedCompanies(userId) {
        const sb = getClient();
        const { data, error } = await sb
            .from('watched_companies')
            .select('*')
            .eq('user_id', userId);

        if (error) throw error;
        return data;
    }

    async function addWatchedCompany(userId, companyId, orgNr) {
        const sb = getClient();
        const { data, error } = await sb
            .from('watched_companies')
            .insert({
                user_id: userId,
                company_id: companyId,
                org_nr: orgNr
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    async function removeWatchedCompany(userId, companyId) {
        const sb = getClient();
        const { error } = await sb
            .from('watched_companies')
            .delete()
            .eq('user_id', userId)
            .eq('company_id', companyId);

        if (error) throw error;
        return true;
    }

    // --------------------------------------------------------------------------
    // STATISTIK
    // --------------------------------------------------------------------------

    async function getDashboardStats(useCache = true) {
        const cacheKey = 'dashboard_stats';

        // Försök hämta från cache
        if (useCache && window.CacheManager) {
            const cached = window.CacheManager.get(cacheKey, TTL.STATS);
            if (cached) {
                console.log('[Cache] Dashboard-statistik från cache');
                return cached;
            }
        }

        const [companyCount, poitTodayCount, poitTotalCount] = await Promise.all([
            getCompanyCount(),
            getPoitEventCount(true),
            getPoitEventCount(false)
        ]);

        const result = {
            companies: companyCount,
            poitToday: poitTodayCount,
            poitTotal: poitTotalCount,
            drafts: 0, // Framtida: artikelutkast
            published: 0 // Framtida: publicerade artiklar
        };

        // Spara i cache
        if (window.CacheManager) {
            window.CacheManager.set(cacheKey, result);
        }

        return result;
    }

    // --------------------------------------------------------------------------
    // RSS FEEDS (via Edge Function)
    // --------------------------------------------------------------------------

    async function fetchRssFeeds(feedUrls) {
        const sb = getClient();
        const { data, error } = await sb.functions.invoke('rss-proxy', {
            body: { feeds: feedUrls }
        });

        if (error) throw error;
        return data;
    }

    // --------------------------------------------------------------------------
    // MYNEWSDESK (via Edge Function)
    // --------------------------------------------------------------------------

    async function fetchPressReleases(pressroomUrl) {
        const sb = getClient();
        const { data, error } = await sb.functions.invoke('mynewsdesk-proxy', {
            body: { url: pressroomUrl }
        });

        if (error) throw error;
        return data;
    }

    // --------------------------------------------------------------------------
    // SMS (via Edge Function)
    // --------------------------------------------------------------------------

    async function sendSms(to, message) {
        const sb = getClient();
        const { data, error } = await sb.functions.invoke('send-sms', {
            body: { to, message }
        });

        if (error) throw error;
        return data;
    }

    // Publikt API
    return {
        // Företag
        getCompanies,
        getCompanyById,
        getCompanyByOrgNr,
        getSectors,
        getCompanyCount,

        // POIT
        getPoitEvents,
        getPoitEventCount,

        // Bevakningar
        getWatchedCompanies,
        addWatchedCompany,
        removeWatchedCompany,

        // Stats
        getDashboardStats,

        // Externa tjänster
        fetchRssFeeds,
        fetchPressReleases,
        sendSms,

        // Realtime subscriptions
        subscribeToPoitEvents,
        subscribeToCompanyChanges,
        unsubscribeAll,

        // Cache helpers
        TTL,
        invalidateCache: (pattern) => {
            if (window.CacheManager) {
                window.CacheManager.invalidate(pattern);
            }
        },
        clearAllCache: () => {
            if (window.CacheManager) {
                window.CacheManager.clear();
            }
        }
    };
})();
