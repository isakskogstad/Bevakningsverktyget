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
