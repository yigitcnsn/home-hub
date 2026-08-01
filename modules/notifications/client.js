/**
 * Global notifications (browser) — info / warn / error.
 * Separate from Logs: own store, toasts, and sidebar page.
 */
(function () {
    const MAX_TOASTS = 4;
    const TOAST_MS = 6000;
    const VIEW = 'notifications';

    let items = [];
    let filter = 'all';
    let initialized = false;
    let managerRef = null;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function safeLevel(value) {
        const level = String(value || 'info').toLowerCase();
        if (level === 'warn' || level === 'error' || level === 'info') return level;
        return 'info';
    }

    function activeItems() {
        return items.filter((n) => !n.dismissed);
    }

    function matchesFilter(entry) {
        if (filter === 'all') return true;
        return safeLevel(entry.level) === filter;
    }

    function filteredItems() {
        return activeItems().filter(matchesFilter);
    }

    function counts() {
        const active = activeItems();
        return {
            total: active.length,
            unread: active.filter((n) => !n.read).length,
            warn: active.filter((n) => n.level === 'warn').length,
            error: active.filter((n) => n.level === 'error').length
        };
    }

    function ensureToastHost() {
        let host = document.getElementById('notificationToasts');
        if (host) return host;
        host = document.createElement('div');
        host.id = 'notificationToasts';
        host.className = 'notif-toasts';
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
        return host;
    }

    function showToast(entry) {
        const host = ensureToastHost();
        while (host.children.length >= MAX_TOASTS) {
            host.removeChild(host.firstChild);
        }

        const level = safeLevel(entry.level);
        const el = document.createElement('div');
        el.className = `notif-toast notif-toast-${level}`;
        el.dataset.id = entry.id || '';
        el.innerHTML = `
            <div class="notif-toast-top">
                <span class="notif-toast-level">${esc(level)}</span>
                <button type="button" class="notif-toast-close" aria-label="Dismiss">&times;</button>
            </div>
            <div class="notif-toast-title">${esc(entry.title || '')}</div>
            ${entry.body ? `<div class="notif-toast-body">${esc(entry.body)}</div>` : ''}
            <div class="notif-toast-meta">${esc(entry.source || 'Home Hub')}</div>
        `;

        const close = () => {
            if (el.parentNode) el.parentNode.removeChild(el);
        };

        el.querySelector('.notif-toast-close').addEventListener('click', (e) => {
            e.stopPropagation();
            close();
        });
        el.addEventListener('click', () => {
            if (managerRef) managerRef.setView(VIEW);
            document.querySelectorAll('.nav-item').forEach((nav) => {
                nav.classList.toggle('active', nav.dataset.view === VIEW);
            });
            close();
        });

        host.appendChild(el);
        setTimeout(close, TOAST_MS);
    }

    function updateNavBadges() {
        const c = counts();
        const unreadEl = document.getElementById('notifNavUnread');
        const warnEl = document.getElementById('notifNavWarn');
        const errorEl = document.getElementById('notifNavError');

        if (unreadEl) {
            unreadEl.textContent = String(c.unread);
            unreadEl.hidden = c.unread === 0;
        }
        if (warnEl) {
            warnEl.textContent = String(c.warn);
            warnEl.hidden = c.warn === 0;
        }
        if (errorEl) {
            errorEl.textContent = String(c.error);
            errorEl.hidden = c.error === 0;
        }
    }

    function updateToolbar() {
        const visibleEl = document.getElementById('notifVisibleCount');
        const totalEl = document.getElementById('notifTotalCount');
        const unreadEl = document.getElementById('notifUnreadCount');
        const visible = filteredItems().length;
        const c = counts();

        if (visibleEl) visibleEl.textContent = `${visible} shown`;
        if (totalEl) totalEl.textContent = `${c.total} total`;
        if (unreadEl) unreadEl.textContent = `${c.unread} unread`;
        updateNavBadges();
    }

    function formatWhen(iso) {
        try {
            return new Date(iso).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (_) {
            return '';
        }
    }

    function rowHtml(entry) {
        const level = safeLevel(entry.level);
        const unread = entry.read ? '' : ' is-unread';
        return `
            <article class="notif-row notif-${level}${unread}" data-notif-id="${esc(entry.id || '')}">
                <div class="notif-row-main">
                    <span class="notif-level">${esc(level)}</span>
                    <h3 class="notif-title">${esc(entry.title || '')}</h3>
                    ${entry.body ? `<p class="notif-body">${esc(entry.body)}</p>` : ''}
                    <div class="notif-meta">
                        <span>${esc(entry.source || 'Home Hub')}</span>
                        <span>${esc(formatWhen(entry.createdAt))}</span>
                    </div>
                </div>
                <div class="notif-row-actions">
                    ${entry.read ? '' : '<button type="button" class="notif-action-btn" data-action="read">Mark read</button>'}
                    <button type="button" class="notif-action-btn notif-action-dismiss" data-action="dismiss">Dismiss</button>
                </div>
            </article>
        `;
    }

    function renderList() {
        const list = document.getElementById('notifList');
        if (!list) return;

        const visible = filteredItems().slice().reverse();
        if (visible.length === 0) {
            list.innerHTML = activeItems().length === 0
                ? '<div class="notif-empty">No notifications yet</div>'
                : `<div class="notif-empty">No ${esc(filter)} notifications</div>`;
            updateToolbar();
            return;
        }

        list.innerHTML = visible.map(rowHtml).join('');
        updateToolbar();
    }

    function applySnapshot(data, opts) {
        const options = opts || {};
        const next = (data && Array.isArray(data.items)) ? data.items : [];
        const prevIds = new Set(items.map((n) => n.id));
        items = next.map((n) => ({ ...n, dismissed: !!n.dismissed }));

        if (options.toastNew) {
            items.forEach((entry) => {
                if (!prevIds.has(entry.id) && !entry.read && !entry.dismissed) {
                    showToast(entry);
                }
            });
        }

        renderList();
    }

    function applyEntry(entry) {
        if (!entry || !entry.id) return;
        const idx = items.findIndex((n) => n.id === entry.id);
        if (idx >= 0) {
            items[idx] = { ...items[idx], ...entry };
        } else {
            items.push(entry);
            if (!entry.read && !entry.dismissed) showToast(entry);
        }
        renderList();
    }

    function send(type, payload) {
        const body = { type, ...(payload || {}) };
        if (managerRef && managerRef.ws && managerRef.ws.readyState === WebSocket.OPEN) {
            managerRef.ws.send(JSON.stringify(body));
            return;
        }
        if (type === 'notification_dismiss' && payload && payload.id) {
            fetch(`/api/notifications/${encodeURIComponent(payload.id)}`, { method: 'DELETE' })
                .then((r) => r.json())
                .then((data) => applySnapshot(data))
                .catch(() => {});
            return;
        }
        if (type === 'notification_read' && payload && payload.id) {
            fetch(`/api/notifications/${encodeURIComponent(payload.id)}/read`, { method: 'POST' })
                .then((r) => r.json())
                .then((data) => applySnapshot(data))
                .catch(() => {});
            return;
        }
        if (type === 'notifications_read_all') {
            fetch('/api/notifications/read-all', { method: 'POST' })
                .then((r) => r.json())
                .then((data) => applySnapshot(data))
                .catch(() => {});
            return;
        }
        if (type === 'notifications_clear') {
            fetch('/api/notifications/clear', { method: 'POST' })
                .then((r) => r.json())
                .then((data) => applySnapshot(data))
                .catch(() => {});
        }
    }

    function setFilter(next) {
        filter = next || 'all';
        document.querySelectorAll('.notif-filter-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        renderList();
    }

    function bindUi(manager) {
        const filters = document.getElementById('notifFilters');
        if (filters && filters.dataset.bound !== '1') {
            filters.dataset.bound = '1';
            filters.addEventListener('click', (e) => {
                const btn = e.target.closest('.notif-filter-btn');
                if (!btn) return;
                setFilter(btn.dataset.filter);
            });
        }

        const readAll = document.getElementById('notifReadAllBtn');
        if (readAll && readAll.dataset.bound !== '1') {
            readAll.dataset.bound = '1';
            readAll.addEventListener('click', () => send('notifications_read_all'));
        }

        const clearBtn = document.getElementById('notifClearBtn');
        if (clearBtn && clearBtn.dataset.bound !== '1') {
            clearBtn.dataset.bound = '1';
            clearBtn.addEventListener('click', () => {
                const ask = manager.showConfirm
                    ? manager.showConfirm('Dismiss all notifications?', 'Clear notifications')
                    : Promise.resolve(confirm('Dismiss all notifications?'));
                Promise.resolve(ask).then((ok) => {
                    if (ok) send('notifications_clear');
                });
            });
        }

        const list = document.getElementById('notifList');
        if (list && list.dataset.bound !== '1') {
            list.dataset.bound = '1';
            list.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                const row = e.target.closest('.notif-row');
                if (!btn || !row) return;
                const id = row.dataset.notifId;
                if (!id) return;
                if (btn.dataset.action === 'dismiss') send('notification_dismiss', { id });
                if (btn.dataset.action === 'read') send('notification_read', { id });
            });
        }
    }

    async function loadInitial() {
        try {
            const res = await fetch('/api/notifications');
            if (!res.ok) return;
            const data = await res.json();
            applySnapshot(data, { toastNew: false });
        } catch (e) {
            console.warn('[Notifications] Failed to load:', e.message);
        }
    }

    function ensure(manager) {
        managerRef = manager;
        ensureToastHost();
        if (!initialized) {
            initialized = true;
            bindUi(manager);
            loadInitial();
        }
        updateNavBadges();
    }

    function onViewActivate(manager) {
        ensure(manager);
        send('notifications_read_all');
    }

    function handleMessage(manager, message) {
        if (message.type === 'notifications_state' && message.data) {
            applySnapshot(message.data, { toastNew: false });
            return true;
        }
        if (message.type === 'notification_entry' && message.entry) {
            applyEntry(message.entry);
            return true;
        }
        return false;
    }

    window.HomeHubModules = window.HomeHubModules || {};
    window.HomeHubModules.notifications = {
        id: 'notifications',
        type: 'notifications',
        label: 'Notifications',
        nav: true,
        view: VIEW,
        navLabel: 'Notifications',
        persistent: false,
        getSampleData: null,
        render: null,
        ensure,
        onViewActivate,
        handleMessage
    };
})();
