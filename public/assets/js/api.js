/* ==========================================================================
   API - Databasoperationer och API-anrop
   ========================================================================== */

const API = (function() {
    'use strict';

    // Hämta Supabase-klienten
    function getClient() {
        return Auth.getClient();
    }

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
            ascending = true
        } = options;

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

        return { data, count, page, pageSize };
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
            onlyWatched = false
        } = options;

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

        return { data, count, page, pageSize };
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

    async function getDashboardStats() {
        const [companyCount, poitTodayCount, poitTotalCount] = await Promise.all([
            getCompanyCount(),
            getPoitEventCount(true),
            getPoitEventCount(false)
        ]);

        return {
            companies: companyCount,
            poitToday: poitTodayCount,
            poitTotal: poitTotalCount,
            drafts: 0, // Framtida: artikelutkast
            published: 0 // Framtida: publicerade artiklar
        };
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
        sendSms
    };
})();
