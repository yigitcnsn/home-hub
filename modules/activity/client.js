/**
 * Activity Log (browser) — main content view with history + type filters.
 * Live lines append without rebuilding the full list (preserves scroll).
 */
(function () {
    const MAX_ENTRIES = 500;
    let entries = [];
    let filter = 'all';
    let initialized = false;

    function matchesFilter(entry) {
        if (filter === 'all') return true;
        return (entry.level || 'info') === filter;
    }

    function filteredEntries() {
        return entries.filter(matchesFilter);
    }

    function rowHtml(entry) {
        const time = new Date(entry.timestamp).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const level = entry.level || 'info';
        return `
            <div class="log-row log-${level}" data-log-level="${level}" data-log-id="${entry.id || ''}">
                <span class="log-time">${time}</span>
                <span class="log-level">${level}</span>
                <span class="log-source">${entry.source || 'App'}</span>
                <span class="log-message">${entry.message || ''}</span>
            </div>
        `;
    }

    function getList() {
        return document.getElementById('logsList');
    }

    function updateCounts() {
        const totalEl = document.getElementById('logsTotalCount');
        const visibleEl = document.getElementById('logsVisibleCount');
        const navCount = document.getElementById('logsNavCount');
        const visible = filteredEntries().length;

        if (totalEl) totalEl.textContent = `${entries.length} total`;
        if (visibleEl) visibleEl.textContent = `${visible} shown`;
        if (navCount) navCount.textContent = String(entries.length);
    }

    function renderFull() {
        const list = getList();
        if (!list) return;

        const visible = filteredEntries();
        if (visible.length === 0) {
            list.innerHTML = entries.length === 0
                ? '<div class="logs-empty">Waiting for server logs...</div>'
                : `<div class="logs-empty">No ${filter} logs</div>`;
            updateCounts();
            return;
        }

        // Newest first
        list.innerHTML = visible.slice().reverse().map(rowHtml).join('');
        updateCounts();
    }

    function appendEntries(newEntries) {
        const list = getList();
        const visibleNew = newEntries.filter(matchesFilter);

        if (!list || visibleNew.length === 0) {
            updateCounts();
            return;
        }

        const empty = list.querySelector('.logs-empty');
        if (empty) empty.remove();

        const prevScrollTop = list.scrollTop;
        const prevScrollHeight = list.scrollHeight;
        const wasAtTop = prevScrollTop <= 8;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = visibleNew.slice().reverse().map(rowHtml).join('');
        const fragment = document.createDocumentFragment();
        while (wrapper.firstChild) {
            fragment.appendChild(wrapper.firstChild);
        }
        list.insertBefore(fragment, list.firstChild);

        // Trim DOM rows to filtered max
        const maxDom = MAX_ENTRIES;
        while (list.querySelectorAll('.log-row').length > maxDom) {
            list.removeChild(list.lastChild);
        }

        updateCounts();

        if (wasAtTop) {
            list.scrollTop = 0;
        } else {
            list.scrollTop = prevScrollTop + (list.scrollHeight - prevScrollHeight);
        }
    }

    function applyLogs(incoming, replace) {
        if (replace) {
            entries = incoming.slice(-MAX_ENTRIES);
            renderFull();
            return;
        }

        entries = entries.concat(incoming);
        if (entries.length > MAX_ENTRIES) {
            entries = entries.slice(-MAX_ENTRIES);
        }
        appendEntries(incoming);
    }

    function setFilter(next) {
        filter = next || 'all';
        document.querySelectorAll('.logs-filter-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        renderFull();
    }

    function bindFilters() {
        const group = document.getElementById('logsFilters');
        if (!group || group.dataset.bound === '1') return;
        group.dataset.bound = '1';
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('.logs-filter-btn');
            if (!btn) return;
            setFilter(btn.dataset.filter);
        });
    }

    async function loadPreviousLogs() {
        try {
            const res = await fetch('/api/logs?limit=' + MAX_ENTRIES);
            if (!res.ok) return;
            const data = await res.json();
            if (Array.isArray(data.entries) && data.entries.length) {
                // Merge with anything already received over WS
                const byId = new Map();
                entries.concat(data.entries).forEach((entry) => {
                    const key = entry.id || `${entry.timestamp}|${entry.message}`;
                    byId.set(key, entry);
                });
                entries = Array.from(byId.values())
                    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
                    .slice(-MAX_ENTRIES);
                renderFull();
            }
        } catch (e) {
            console.warn('[Logs] Failed to load previous logs:', e.message);
        }
    }

    function removeDashboardWidget(manager) {
        if (!manager || !Array.isArray(manager.modules)) return;

        const before = manager.modules.length;
        manager.modules = manager.modules.filter((m) => m.type !== 'activity');
        if (manager.moduleInstances && manager.moduleInstances.activity_log) {
            delete manager.moduleInstances.activity_log;
        }

        if (manager.modules.length !== before) {
            manager.saveModules();
            manager.saveInstances();
            manager.renderModules();
        }
    }

    function ensure(manager) {
        removeDashboardWidget(manager);

        if (!initialized) {
            initialized = true;
            bindFilters();
            updateCounts();
            loadPreviousLogs();
        }
    }

    function handleMessage(manager, message) {
        if (message.type === 'logs_snapshot' && Array.isArray(message.entries)) {
            applyLogs(message.entries, true);
            return true;
        }
        if (message.type === 'log_entry' && message.entry) {
            applyLogs([message.entry], false);
            return true;
        }
        return false;
    }

    window.HomeHubModules = window.HomeHubModules || {};
    window.HomeHubModules.activity = {
        id: 'activity',
        type: 'activity',
        label: 'Logs',
        persistent: true,
        getSampleData: null,
        render: null,
        ensure,
        handleMessage
    };
})();
