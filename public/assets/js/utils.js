/* ==========================================================================
   UTILS - Hjälpfunktioner
   ========================================================================== */

const Utils = (function() {
    'use strict';

    // --------------------------------------------------------------------------
    // DATUMHANTERING
    // --------------------------------------------------------------------------

    function formatDate(dateString, options = {}) {
        if (!dateString) return '';

        const date = new Date(dateString);
        const {
            includeTime = false,
            relative = false
        } = options;

        if (relative) {
            return getRelativeTime(date);
        }

        const dateOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        };

        if (includeTime) {
            dateOptions.hour = '2-digit';
            dateOptions.minute = '2-digit';
        }

        return date.toLocaleDateString('sv-SE', dateOptions);
    }

    function getRelativeTime(date) {
        const now = new Date();
        const diff = now - date;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) return 'Just nu';
        if (minutes < 60) return `${minutes} min sedan`;
        if (hours < 24) return `${hours} tim sedan`;
        if (days === 1) return 'Igår';
        if (days < 7) return `${days} dagar sedan`;

        return formatDate(date);
    }

    function isToday(dateString) {
        const date = new Date(dateString);
        const today = new Date();
        return date.toDateString() === today.toDateString();
    }

    // --------------------------------------------------------------------------
    // TEXTFORMATERING
    // --------------------------------------------------------------------------

    function truncate(text, maxLength = 100) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength).trim() + '...';
    }

    function slugify(text) {
        return text
            .toLowerCase()
            .replace(/å/g, 'a')
            .replace(/ä/g, 'a')
            .replace(/ö/g, 'o')
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }

    function capitalize(text) {
        if (!text) return '';
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    }

    function formatOrgNr(orgNr) {
        if (!orgNr) return '';
        const clean = orgNr.replace(/\D/g, '');
        if (clean.length === 10) {
            return clean.slice(0, 6) + '-' + clean.slice(6);
        }
        return orgNr;
    }

    function formatCurrency(amount, currency = 'SEK') {
        if (amount === null || amount === undefined) return '';
        return new Intl.NumberFormat('sv-SE', {
            style: 'currency',
            currency
        }).format(amount);
    }

    function formatNumber(num) {
        if (num === null || num === undefined) return '';
        return new Intl.NumberFormat('sv-SE').format(num);
    }

    // --------------------------------------------------------------------------
    // DOM-HJÄLPARE
    // --------------------------------------------------------------------------

    function $(selector, context = document) {
        return context.querySelector(selector);
    }

    function $$(selector, context = document) {
        return Array.from(context.querySelectorAll(selector));
    }

    function createElement(tag, attributes = {}, children = []) {
        const el = document.createElement(tag);

        Object.entries(attributes).forEach(([key, value]) => {
            if (key === 'className') {
                el.className = value;
            } else if (key === 'dataset') {
                Object.entries(value).forEach(([dataKey, dataValue]) => {
                    el.dataset[dataKey] = dataValue;
                });
            } else if (key.startsWith('on')) {
                el.addEventListener(key.slice(2).toLowerCase(), value);
            } else {
                el.setAttribute(key, value);
            }
        });

        children.forEach(child => {
            if (typeof child === 'string') {
                el.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                el.appendChild(child);
            }
        });

        return el;
    }

    function show(element) {
        if (element) element.classList.add('show');
    }

    function hide(element) {
        if (element) element.classList.remove('show');
    }

    function toggle(element, condition) {
        if (element) {
            if (condition) {
                element.classList.add('show');
            } else {
                element.classList.remove('show');
            }
        }
    }

    // --------------------------------------------------------------------------
    // DEBOUNCE & THROTTLE
    // --------------------------------------------------------------------------

    function debounce(fn, delay = 300) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function throttle(fn, limit = 300) {
        let inThrottle;
        return function (...args) {
            if (!inThrottle) {
                fn.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // --------------------------------------------------------------------------
    // STORAGE
    // --------------------------------------------------------------------------

    function setStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.error('Storage error:', e);
            return false;
        }
    }

    function getStorage(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            console.error('Storage error:', e);
            return defaultValue;
        }
    }

    function removeStorage(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.error('Storage error:', e);
            return false;
        }
    }

    // --------------------------------------------------------------------------
    // CACHE MANAGER - Intelligent caching med TTL
    // --------------------------------------------------------------------------

    const CacheManager = {
        // Time-To-Live i millisekunder (aggressiv caching)
        TTL: {
            POIT_EVENTS: 2 * 60 * 1000,       // 2 min
            COMPANIES: 10 * 60 * 1000,         // 10 min
            RSS_ARTICLES: 2 * 60 * 1000,       // 2 min
            COMPANY_DETAILS: 10 * 60 * 1000,   // 10 min
            STATS: 1 * 60 * 1000,              // 1 min
            PRESS_RELEASES: 2 * 60 * 1000      // 2 min
        },

        PREFIX: 'bv_cache_',

        /**
         * Spara data med tidsstämpel
         */
        set(key, data) {
            try {
                const cacheEntry = {
                    data,
                    timestamp: Date.now(),
                    version: '1.0'
                };
                localStorage.setItem(this.PREFIX + key, JSON.stringify(cacheEntry));
                return true;
            } catch (e) {
                console.warn('Cache set error:', e);
                // Försök rensa gammal cache om storage är full
                this.cleanup();
                return false;
            }
        },

        /**
         * Hämta cachad data om den inte har expirerat
         */
        get(key, ttl) {
            try {
                const cached = localStorage.getItem(this.PREFIX + key);
                if (!cached) return null;

                const { data, timestamp } = JSON.parse(cached);
                const age = Date.now() - timestamp;

                if (age > ttl) {
                    localStorage.removeItem(this.PREFIX + key);
                    return null;
                }

                return data;
            } catch (e) {
                console.warn('Cache get error:', e);
                return null;
            }
        },

        /**
         * Hämta cachad data och dess ålder
         */
        getWithMeta(key, ttl) {
            try {
                const cached = localStorage.getItem(this.PREFIX + key);
                if (!cached) return { data: null, age: null, isStale: true };

                const { data, timestamp } = JSON.parse(cached);
                const age = Date.now() - timestamp;
                const isStale = age > ttl;

                return { data, age, isStale, timestamp };
            } catch (e) {
                return { data: null, age: null, isStale: true };
            }
        },

        /**
         * Invalidera alla cache-nycklar som matchar ett mönster
         */
        invalidate(pattern) {
            const prefix = this.PREFIX;
            Object.keys(localStorage)
                .filter(k => k.startsWith(prefix) && k.includes(pattern))
                .forEach(k => localStorage.removeItem(k));
        },

        /**
         * Rensa all cache
         */
        clear() {
            const prefix = this.PREFIX;
            Object.keys(localStorage)
                .filter(k => k.startsWith(prefix))
                .forEach(k => localStorage.removeItem(k));
        },

        /**
         * Rensa gammal cache (äldre än 24 timmar)
         */
        cleanup() {
            const prefix = this.PREFIX;
            const maxAge = 24 * 60 * 60 * 1000; // 24 timmar

            Object.keys(localStorage)
                .filter(k => k.startsWith(prefix))
                .forEach(k => {
                    try {
                        const { timestamp } = JSON.parse(localStorage.getItem(k));
                        if (Date.now() - timestamp > maxAge) {
                            localStorage.removeItem(k);
                        }
                    } catch (e) {
                        localStorage.removeItem(k);
                    }
                });
        },

        /**
         * Formatera cache-ålder för visning
         */
        formatAge(ageMs) {
            if (!ageMs) return '';
            const seconds = Math.floor(ageMs / 1000);
            const minutes = Math.floor(seconds / 60);

            if (seconds < 60) return `${seconds} sek sedan`;
            if (minutes < 60) return `${minutes} min sedan`;
            return 'Över en timme sedan';
        }
    };

    // --------------------------------------------------------------------------
    // SMART DATA FETCHER - Visa cache, uppdatera i bakgrunden
    // --------------------------------------------------------------------------

    const SmartFetcher = {
        /**
         * Hämta data med smart caching
         * @param {string} cacheKey - Nyckel för cache
         * @param {Function} fetchFn - Async funktion som hämtar data
         * @param {number} ttl - Time-to-live i millisekunder
         * @param {Object} options - Extra options
         */
        async fetch(cacheKey, fetchFn, ttl, options = {}) {
            const { onCached, onFresh, forceRefresh = false } = options;

            // Kolla cache först (om inte force refresh)
            if (!forceRefresh) {
                const { data: cachedData, isStale, age } = CacheManager.getWithMeta(cacheKey, ttl);

                if (cachedData && !isStale) {
                    // Cache är färsk - använd den
                    if (onCached) onCached(cachedData, age);
                    return cachedData;
                }

                if (cachedData && isStale) {
                    // Cache finns men är gammal - visa den medan vi hämtar ny
                    if (onCached) onCached(cachedData, age);
                    // Fortsätt till att hämta ny data i bakgrunden
                }
            }

            // Hämta ny data
            try {
                const freshData = await fetchFn();
                CacheManager.set(cacheKey, freshData);

                if (onFresh) onFresh(freshData);
                return freshData;
            } catch (error) {
                console.error('SmartFetcher error:', error);
                // Returnera gammal cache om fetch misslyckas
                const { data: fallbackData } = CacheManager.getWithMeta(cacheKey, Infinity);
                return fallbackData || null;
            }
        },

        /**
         * Hämta med stale-while-revalidate mönster
         * Visar cachad data direkt, uppdaterar i bakgrunden
         */
        async fetchWithSWR(cacheKey, fetchFn, ttl, options = {}) {
            const { onData, onUpdate } = options;
            const { data: cachedData, age, isStale } = CacheManager.getWithMeta(cacheKey, ttl);

            // Visa cachad data direkt om den finns
            if (cachedData) {
                if (onData) onData(cachedData, { fromCache: true, age });
            }

            // Om cache är stale eller tom, hämta ny data
            if (isStale || !cachedData) {
                try {
                    const freshData = await fetchFn();
                    CacheManager.set(cacheKey, freshData);

                    // Kolla om data har ändrats
                    const hasChanged = JSON.stringify(freshData) !== JSON.stringify(cachedData);

                    if (onData && !cachedData) {
                        // Första laddningen
                        onData(freshData, { fromCache: false, age: 0 });
                    } else if (hasChanged && onUpdate) {
                        // Data har uppdaterats
                        onUpdate(freshData, cachedData);
                    }

                    return freshData;
                } catch (error) {
                    console.error('SWR fetch error:', error);
                    return cachedData;
                }
            }

            return cachedData;
        }
    };

    // --------------------------------------------------------------------------
    // VALIDERING
    // --------------------------------------------------------------------------

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function isValidOrgNr(orgNr) {
        const clean = orgNr.replace(/\D/g, '');
        return clean.length === 10;
    }

    function isValidPhone(phone) {
        const clean = phone.replace(/\D/g, '');
        return clean.length >= 10 && clean.length <= 15;
    }

    // --------------------------------------------------------------------------
    // EVENTS
    // --------------------------------------------------------------------------

    function emit(eventName, detail = {}) {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
    }

    function on(eventName, callback) {
        window.addEventListener(eventName, callback);
        return () => window.removeEventListener(eventName, callback);
    }

    // --------------------------------------------------------------------------
    // POIT-KATEGORI
    // --------------------------------------------------------------------------

    function getPoitCategoryInfo(category) {
        if (!category) return { class: 'tag-skuld', icon: '📋', label: 'Övrigt' };

        const lowerCategory = category.toLowerCase();

        if (lowerCategory.includes('konkurs')) {
            return { class: 'tag-konkurs', icon: '⚠️', label: 'Konkurs' };
        }
        if (lowerCategory.includes('registrer') || lowerCategory.includes('nybildning')) {
            return { class: 'tag-registrering', icon: '🆕', label: 'Registrering' };
        }
        if (lowerCategory.includes('ändring') || lowerCategory.includes('byte')) {
            return { class: 'tag-andring', icon: '✏️', label: 'Ändring' };
        }
        if (lowerCategory.includes('kallelse')) {
            return { class: 'tag-kallelse', icon: '📢', label: 'Kallelse' };
        }
        if (lowerCategory.includes('skuld')) {
            return { class: 'tag-skuld', icon: '💰', label: 'Skuld' };
        }
        if (lowerCategory.includes('fusion')) {
            return { class: 'tag-fusion', icon: '🔄', label: 'Fusion' };
        }
        if (lowerCategory.includes('likvidation')) {
            return { class: 'tag-likvidation', icon: '📉', label: 'Likvidation' };
        }

        return { class: 'tag-skuld', icon: '📋', label: category };
    }

    // --------------------------------------------------------------------------
    // COPY TO CLIPBOARD
    // --------------------------------------------------------------------------

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            console.error('Clipboard error:', e);
            return false;
        }
    }

    // Publikt API
    return {
        // Datum
        formatDate,
        getRelativeTime,
        isToday,

        // Text
        truncate,
        slugify,
        capitalize,
        formatOrgNr,
        formatCurrency,
        formatNumber,

        // DOM
        $,
        $$,
        createElement,
        show,
        hide,
        toggle,

        // Timing
        debounce,
        throttle,

        // Storage
        setStorage,
        getStorage,
        removeStorage,

        // Cache (nytt)
        CacheManager,
        SmartFetcher,

        // Validering
        isValidEmail,
        isValidOrgNr,
        isValidPhone,

        // Events
        emit,
        on,

        // POIT
        getPoitCategoryInfo,

        // Misc
        copyToClipboard
    };
})();

// Exponera CacheManager globalt för enkel åtkomst
window.CacheManager = Utils.CacheManager;
window.SmartFetcher = Utils.SmartFetcher;
