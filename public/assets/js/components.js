/* ==========================================================================
   COMPONENTS - Återanvändbara UI-komponenter
   ========================================================================== */

const Components = (function() {
    'use strict';

    // --------------------------------------------------------------------------
    // FEED ITEM - POIT-händelse
    // --------------------------------------------------------------------------

    function createFeedItem(event, options = {}) {
        const { onClick, onInvestigate } = options;
        const categoryInfo = Utils.getPoitCategoryInfo(event.category);

        const item = Utils.createElement('div', { className: 'feed-item' }, [
            Utils.createElement('div', { className: 'feed-item-header' }, [
                Utils.createElement('span', {
                    className: `feed-category ${categoryInfo.class.replace('tag-', '')}`
                }, [categoryInfo.label]),
                Utils.createElement('span', { className: 'feed-time' }, [
                    Utils.formatDate(event.announcement_date, { relative: true })
                ])
            ]),
            Utils.createElement('div', { className: 'feed-company' }, [
                event.company_name || 'Okänt företag'
            ]),
            Utils.createElement('div', { className: 'feed-description' }, [
                Utils.truncate(event.description || event.category || '', 150)
            ]),
            Utils.createElement('div', { className: 'feed-actions' }, [
                Utils.createElement('button', {
                    className: 'btn btn-secondary btn-xs',
                    onClick: () => onClick && onClick(event)
                }, ['Visa detaljer']),
                Utils.createElement('button', {
                    className: 'btn btn-accent btn-xs',
                    onClick: () => onInvestigate && onInvestigate(event)
                }, ['Undersök'])
            ])
        ]);

        return item;
    }

    // --------------------------------------------------------------------------
    // STAT CARD
    // --------------------------------------------------------------------------

    function createStatCard(label, value, options = {}) {
        const { highlight = false, icon = null, onClick = null } = options;

        const card = Utils.createElement('div', {
            className: `stat-card ${highlight ? 'highlight' : ''}`,
            onClick: onClick ? onClick : null
        }, [
            Utils.createElement('div', { className: 'stat-label' }, [
                icon ? `${icon} ` : '',
                label
            ]),
            Utils.createElement('div', { className: 'stat-value' }, [
                typeof value === 'number' ? Utils.formatNumber(value) : value
            ])
        ]);

        return card;
    }

    // --------------------------------------------------------------------------
    // TOOL ITEM
    // --------------------------------------------------------------------------

    function createToolItem(tool) {
        const { name, description, icon, href, onClick } = tool;

        const item = Utils.createElement('a', {
            className: 'tool-item',
            href: href || '#',
            onClick: onClick ? (e) => {
                e.preventDefault();
                onClick();
            } : null
        }, [
            Utils.createElement('div', { className: 'tool-icon' }, [icon || '🔧']),
            Utils.createElement('div', { className: 'tool-info' }, [
                Utils.createElement('div', { className: 'tool-name' }, [name]),
                Utils.createElement('div', { className: 'tool-desc' }, [description || ''])
            ])
        ]);

        return item;
    }

    // --------------------------------------------------------------------------
    // COMPANY CARD
    // --------------------------------------------------------------------------

    function createCompanyCard(company, options = {}) {
        const { onWatch, onDetails, isWatched = false } = options;

        const card = Utils.createElement('div', { className: 'card' }, [
            Utils.createElement('div', { className: 'card-header' }, [
                Utils.createElement('h3', { className: 'card-title' }, [
                    company.foretag || 'Okänt företag'
                ]),
                Utils.createElement('span', { className: 'text-muted text-sm' }, [
                    Utils.formatOrgNr(company.org_nr)
                ])
            ]),
            Utils.createElement('div', { className: 'card-body' }, [
                company.sektor ? Utils.createElement('div', { className: 'mb-2' }, [
                    Utils.createElement('span', { className: 'badge badge-member' }, [company.sektor])
                ]) : null,
                company.beskrivning ? Utils.createElement('p', { className: 'text-muted text-sm' }, [
                    Utils.truncate(company.beskrivning, 100)
                ]) : null
            ].filter(Boolean)),
            Utils.createElement('div', { className: 'card-footer d-flex gap-2' }, [
                Utils.createElement('button', {
                    className: `btn btn-sm ${isWatched ? 'btn-accent' : 'btn-secondary'}`,
                    onClick: () => onWatch && onWatch(company, !isWatched)
                }, [isWatched ? '✓ Bevakad' : 'Bevaka']),
                Utils.createElement('button', {
                    className: 'btn btn-sm btn-secondary',
                    onClick: () => onDetails && onDetails(company)
                }, ['Detaljer'])
            ])
        ]);

        return card;
    }

    // --------------------------------------------------------------------------
    // MODAL
    // --------------------------------------------------------------------------

    function createModal(options = {}) {
        const {
            title = '',
            content = '',
            onClose = null,
            footer = null,
            size = 'md' // sm, md, lg
        } = options;

        const sizeClass = {
            sm: 'max-w-sm',
            md: '',
            lg: 'max-w-lg'
        }[size] || '';

        const modal = Utils.createElement('div', { className: 'modal' }, [
            Utils.createElement('div', { className: `modal-content ${sizeClass}` }, [
                Utils.createElement('div', { className: 'modal-header' }, [
                    Utils.createElement('h3', { className: 'modal-title' }, [title]),
                    Utils.createElement('button', {
                        className: 'modal-close',
                        onClick: () => {
                            modal.classList.remove('show');
                            if (onClose) onClose();
                        }
                    }, ['×'])
                ]),
                Utils.createElement('div', { className: 'modal-body' }, [
                    typeof content === 'string' ? content : ''
                ]),
                footer ? Utils.createElement('div', { className: 'modal-footer' }, [footer]) : null
            ].filter(Boolean))
        ]);

        // Om content är ett element, lägg till det
        if (content instanceof Node) {
            modal.querySelector('.modal-body').appendChild(content);
        }

        // Stäng vid klick utanför
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
                if (onClose) onClose();
            }
        });

        return modal;
    }

    function showModal(modal) {
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('show'));
    }

    function closeModal(modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 200);
    }

    // --------------------------------------------------------------------------
    // ALERT / TOAST
    // --------------------------------------------------------------------------

    function showAlert(container, message, type = 'error') {
        const alert = container.querySelector('.alert') ||
            Utils.createElement('div', { className: 'alert' });

        alert.className = `alert alert-${type} show`;
        alert.textContent = message;

        if (!alert.parentNode) {
            container.insertBefore(alert, container.firstChild);
        }

        // Auto-hide efter 5 sekunder
        setTimeout(() => {
            alert.classList.remove('show');
        }, 5000);
    }

    function showToast(message, type = 'success', duration = 3000) {
        let container = document.querySelector('.toast-container');

        if (!container) {
            container = Utils.createElement('div', {
                className: 'toast-container',
                style: 'position:fixed;top:20px;right:20px;z-index:500;display:flex;flex-direction:column;gap:10px;'
            });
            document.body.appendChild(container);
        }

        const toast = Utils.createElement('div', {
            className: `alert alert-${type} show`,
            style: 'animation:modal-in 0.2s ease-out;'
        }, [message]);

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'modal-in 0.2s ease-out reverse';
            setTimeout(() => toast.remove(), 200);
        }, duration);
    }

    // --------------------------------------------------------------------------
    // LOADER
    // --------------------------------------------------------------------------

    function createLoader(size = 'md') {
        const sizeClass = size === 'lg' ? 'loader-lg' : '';
        return Utils.createElement('div', { className: `loader ${sizeClass}` });
    }

    function showLoading(container, message = 'Laddar...') {
        const loading = Utils.createElement('div', { className: 'empty-state' }, [
            createLoader('lg'),
            Utils.createElement('p', { className: 'mt-4' }, [message])
        ]);
        container.innerHTML = '';
        container.appendChild(loading);
    }

    // --------------------------------------------------------------------------
    // EMPTY STATE
    // --------------------------------------------------------------------------

    function createEmptyState(options = {}) {
        const {
            icon = '📭',
            title = 'Inga resultat',
            message = '',
            action = null
        } = options;

        return Utils.createElement('div', { className: 'empty-state' }, [
            Utils.createElement('div', { className: 'empty-state-icon' }, [icon]),
            Utils.createElement('h3', {}, [title]),
            message ? Utils.createElement('p', {}, [message]) : null,
            action ? Utils.createElement('button', {
                className: 'btn btn-primary mt-4',
                onClick: action.onClick
            }, [action.label]) : null
        ].filter(Boolean));
    }

    // --------------------------------------------------------------------------
    // PAGINATION
    // --------------------------------------------------------------------------

    function createPagination(options = {}) {
        const {
            currentPage = 1,
            totalPages = 1,
            onPageChange = null
        } = options;

        if (totalPages <= 1) return null;

        const buttons = [];

        // Föregående
        if (currentPage > 1) {
            buttons.push(Utils.createElement('button', {
                className: 'btn btn-secondary btn-sm',
                onClick: () => onPageChange && onPageChange(currentPage - 1)
            }, ['← Föregående']));
        }

        // Sidnummer
        buttons.push(Utils.createElement('span', { className: 'text-muted px-4' }, [
            `Sida ${currentPage} av ${totalPages}`
        ]));

        // Nästa
        if (currentPage < totalPages) {
            buttons.push(Utils.createElement('button', {
                className: 'btn btn-secondary btn-sm',
                onClick: () => onPageChange && onPageChange(currentPage + 1)
            }, ['Nästa →']));
        }

        return Utils.createElement('div', {
            className: 'd-flex justify-center items-center gap-4 mt-6'
        }, buttons);
    }

    // Publikt API
    return {
        // Feed
        createFeedItem,

        // Cards
        createStatCard,
        createCompanyCard,
        createToolItem,

        // Modal
        createModal,
        showModal,
        closeModal,

        // Alerts
        showAlert,
        showToast,

        // Loading
        createLoader,
        showLoading,
        createEmptyState,

        // Pagination
        createPagination
    };
})();
