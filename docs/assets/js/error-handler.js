/* ==========================================================================
   ERROR HANDLER - Global felhantering och notifikationer
   ========================================================================== */

const ErrorHandler = (function() {
    'use strict';

    let notificationTimeout = null;

    // --------------------------------------------------------------------------
    // NOTIFIKATION
    // --------------------------------------------------------------------------

    function showNotification(message, type = 'info', duration = 5000) {
        // Ta bort existerande notifikation
        hideNotification();

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <span class="notification-message">${escapeHtml(message)}</span>
            <button class="notification-close" onclick="ErrorHandler.hideNotification()">&times;</button>
        `;

        // Lägg till stilar om de inte finns
        if (!document.getElementById('error-handler-styles')) {
            addStyles();
        }

        document.body.appendChild(notification);

        // Visa med animation
        requestAnimationFrame(() => {
            notification.classList.add('show');
        });

        // Auto-dölj efter duration
        if (duration > 0) {
            notificationTimeout = setTimeout(() => {
                hideNotification();
            }, duration);
        }
    }

    function hideNotification() {
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
            notificationTimeout = null;
        }

        const existing = document.querySelector('.notification');
        if (existing) {
            existing.classList.remove('show');
            setTimeout(() => existing.remove(), 300);
        }
    }

    function showSuccess(message, duration = 4000) {
        showNotification(message, 'success', duration);
    }

    function showError(message, duration = 6000) {
        showNotification(message, 'error', duration);
    }

    function showWarning(message, duration = 5000) {
        showNotification(message, 'warning', duration);
    }

    function showInfo(message, duration = 4000) {
        showNotification(message, 'info', duration);
    }

    // --------------------------------------------------------------------------
    // FEL-HANTERING
    // --------------------------------------------------------------------------

    function handleApiError(error, context = '') {
        console.error(`API Error${context ? ` (${context})` : ''}:`, error);

        let userMessage = 'Ett oväntat fel uppstod';

        if (error.message) {
            if (error.message.includes('network') || error.message.includes('fetch')) {
                userMessage = 'Nätverksfel - kontrollera din internetanslutning';
            } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                userMessage = 'Du är inte inloggad eller din session har gått ut';
            } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
                userMessage = 'Du har inte behörighet att utföra denna åtgärd';
            } else if (error.message.includes('404')) {
                userMessage = 'Resursen kunde inte hittas';
            } else if (error.message.includes('429')) {
                userMessage = 'För många förfrågningar - vänta en stund och försök igen';
            } else if (error.message.includes('500')) {
                userMessage = 'Serverfel - försök igen senare';
            } else if (error.message.includes('timeout')) {
                userMessage = 'Förfrågan tog för lång tid - försök igen';
            }
        }

        showError(userMessage);
        return userMessage;
    }

    function handleFormError(formElement, errors) {
        // Rensa tidigare fel
        formElement.querySelectorAll('.form-error').forEach(el => el.remove());
        formElement.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));

        // Visa nya fel
        Object.entries(errors).forEach(([field, message]) => {
            const input = formElement.querySelector(`[name="${field}"]`);
            if (input) {
                input.classList.add('input-error');

                const errorEl = document.createElement('span');
                errorEl.className = 'form-error';
                errorEl.textContent = message;
                input.parentNode.appendChild(errorEl);
            }
        });
    }

    function clearFormErrors(formElement) {
        formElement.querySelectorAll('.form-error').forEach(el => el.remove());
        formElement.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    }

    // --------------------------------------------------------------------------
    // GLOBAL ERROR HANDLER
    // --------------------------------------------------------------------------

    function setupGlobalHandler() {
        // Fånga ohanterade fel
        window.onerror = function(message, source, lineno, colno, error) {
            console.error('Global error:', { message, source, lineno, colno, error });

            // Visa inte tekniska fel för användaren i produktion
            if (!CONFIG?.debug) {
                // Logga till en extern tjänst här om det behövs
            }

            return false; // Låt webbläsaren också hantera felet
        };

        // Fånga ohanterade promise-fel
        window.onunhandledrejection = function(event) {
            console.error('Unhandled Promise rejection:', event.reason);

            if (event.reason?.message?.includes('Failed to fetch')) {
                showError('Kunde inte ansluta till servern');
            }
        };
    }

    // --------------------------------------------------------------------------
    // LOADING STATE
    // --------------------------------------------------------------------------

    function showLoading(element, text = 'Laddar...') {
        if (!element) return;

        element.dataset.originalContent = element.innerHTML;
        element.disabled = true;
        element.innerHTML = `<span class="loading-spinner"></span> ${escapeHtml(text)}`;
    }

    function hideLoading(element) {
        if (!element || !element.dataset.originalContent) return;

        element.innerHTML = element.dataset.originalContent;
        element.disabled = false;
        delete element.dataset.originalContent;
    }

    // --------------------------------------------------------------------------
    // HELPERS
    // --------------------------------------------------------------------------

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function addStyles() {
        const style = document.createElement('style');
        style.id = 'error-handler-styles';
        style.textContent = `
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 16px 24px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 10000;
                display: flex;
                align-items: center;
                gap: 12px;
                max-width: 400px;
                transform: translateX(120%);
                transition: transform 0.3s ease;
                font-size: 14px;
                font-family: inherit;
            }
            .notification.show {
                transform: translateX(0);
            }
            .notification-success {
                background: #10b981;
                color: white;
            }
            .notification-error {
                background: #ef4444;
                color: white;
            }
            .notification-warning {
                background: #f59e0b;
                color: white;
            }
            .notification-info {
                background: #3b82f6;
                color: white;
            }
            .notification-message {
                flex: 1;
            }
            .notification-close {
                background: none;
                border: none;
                color: inherit;
                font-size: 18px;
                cursor: pointer;
                padding: 0;
                opacity: 0.7;
            }
            .notification-close:hover {
                opacity: 1;
            }
            .form-error {
                display: block;
                color: #ef4444;
                font-size: 12px;
                margin-top: 4px;
            }
            .input-error {
                border-color: #ef4444 !important;
            }
            .loading-spinner {
                display: inline-block;
                width: 14px;
                height: 14px;
                border: 2px solid rgba(255,255,255,0.3);
                border-top-color: currentColor;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    // Initiera global handler när DOM är redo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupGlobalHandler);
    } else {
        setupGlobalHandler();
    }

    // Publikt API
    return {
        // Notifikationer
        showNotification,
        hideNotification,
        showSuccess,
        showError,
        showWarning,
        showInfo,

        // Felhantering
        handleApiError,
        handleFormError,
        clearFormErrors,

        // Loading
        showLoading,
        hideLoading
    };
})();
