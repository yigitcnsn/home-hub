/**
 * Activity Log (browser) — sidebar panel, not a dashboard widget.
 * Appends live lines without rebuilding the list (preserves scroll).
 */
(function () {
    const MAX_ENTRIES = 200;
    let entries = [];
    let initialized = false;

    function rowHtml(entry) {
        const time = new Date(entry.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const level = entry.level || 'info';
        return `
            <div class="sidebar-log-row sidebar-log-${level}" data-log-id="${entry.id || ''}">
                <div class="sidebar-log-meta">
                    <span class="sidebar-log-time">${time}</span>
                    <span class="sidebar-log-level">${level}</span>
                </div>
                <div class="sidebar-log-source">${entry.source || 'App'}</div>
                <div class="sidebar-log-message">${entry.message || ''}</div>
            </div>
        `;
    }

    function getList() {
        return document.getElementById('sidebarLogsList');
    }

    function getCount() {
        return document.getElementById('sidebarLogsCount');
    }

    function updateCount() {
        const el = getCount();
        if (el) el.textContent = String(entries.length);
    }

    function renderFull() {
        const list = getList();
        if (!list) return;

        if (entries.length === 0) {
            list.innerHTML = '<div class="sidebar-logs-empty">Waiting for server logs...</div>';
            updateCount();
            return;
        }

        // Newest first
        list.innerHTML = entries.slice().reverse().map(rowHtml).join('');
        updateCount();
    }

    function appendEntries(newEntries) {
        const list = getList();
        if (!list) {
            renderFull();
            return;
        }

        const empty = list.querySelector('.sidebar-logs-empty');
        if (empty) empty.remove();

        const prevScrollTop = list.scrollTop;
        const prevScrollHeight = list.scrollHeight;
        const wasAtTop = prevScrollTop <= 8;

        // Insert newest at top, in chronological order within the batch
        const fragment = document.createDocumentFragment();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = newEntries.slice().reverse().map(rowHtml).join('');
        while (wrapper.firstChild) {
            fragment.appendChild(wrapper.firstChild);
        }
        list.insertBefore(fragment, list.firstChild);

        while (list.children.length > MAX_ENTRIES) {
            list.removeChild(list.lastChild);
        }

        updateCount();

        if (wasAtTop) {
            list.scrollTop = 0;
        } else {
            // Keep the same content under the viewport
            list.scrollTop = prevScrollTop + (list.scrollHeight - prevScrollHeight);
        }
    }

    function applyLogs(manager, incoming, replace) {
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
        // Logs live in the sidebar — remove any old dashboard Activity Log widgets
        removeDashboardWidget(manager);

        if (!initialized) {
            initialized = true;
            const list = getList();
            if (list && !list.children.length) {
                list.innerHTML = '<div class="sidebar-logs-empty">Waiting for server logs...</div>';
            }
            updateCount();
        }
    }

    function handleMessage(manager, message) {
        if (message.type === 'logs_snapshot' && Array.isArray(message.entries)) {
            applyLogs(manager, message.entries, true);
            return true;
        }
        if (message.type === 'log_entry' && message.entry) {
            applyLogs(manager, [message.entry], false);
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
        sidebar: true,
        // No dashboard widget
        getSampleData: null,
        render: null,
        ensure,
        handleMessage
    };
})();
