/**
 * Activity Log module (browser)
 * Loaded before script.js; extends ModuleManager via HomeHubModules.
 */
(function () {
    const INSTANCE_KEY = 'activity_log';

    function getSampleData() {
        return {
            entries: [],
            lastUpdate: null
        };
    }

    function render(data, module) {
        const entries = Array.isArray(data.entries) ? data.entries : [];
        const rows = entries.length === 0
            ? '<div class="no-logs">Waiting for server logs...</div>'
            : entries.slice().reverse().map((entry) => {
                const time = new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                const level = entry.level || 'info';
                return `
                    <div class="activity-row activity-${level}">
                        <span class="activity-time">${time}</span>
                        <span class="activity-level">${level}</span>
                        <span class="activity-source">${entry.source || 'App'}</span>
                        <span class="activity-message">${entry.message || ''}</span>
                    </div>
                `;
            }).join('');

        return `
            <div class="activity-monitor">
                <div class="activity-toolbar">
                    <span class="activity-count">${entries.length} events</span>
                    <span class="activity-hint">Also written to logs/home-hub.log on the host</span>
                </div>
                <div class="activity-list" id="activity-list-${module.id}">
                    ${rows}
                </div>
            </div>
        `;
    }

    function ensure(manager) {
        const existing = manager.modules.find(m =>
            (m.instanceKey || manager.getInstanceKey(m.name, m.type)) === INSTANCE_KEY
        );

        if (!existing) {
            console.log('[Activity] Creating persistent activity log widget');
            const activityModule = {
                id: manager.moduleIdCounter++,
                name: 'Activity Log',
                type: 'activity',
                size: 'large',
                createdAt: new Date().toISOString(),
                instanceKey: INSTANCE_KEY
            };

            if (!manager.moduleInstances[INSTANCE_KEY]) {
                manager.moduleInstances[INSTANCE_KEY] = getSampleData();
            }

            manager.modules.push(activityModule);
            manager.saveModules();
            manager.saveInstances();
        } else if (existing.size !== 'large') {
            existing.size = 'large';
            manager.saveModules();
        }
    }

    function applyLogs(manager, entries, replace) {
        if (!manager.moduleInstances[INSTANCE_KEY]) {
            manager.moduleInstances[INSTANCE_KEY] = getSampleData();
        }

        const current = manager.moduleInstances[INSTANCE_KEY];
        if (replace) {
            current.entries = entries.slice(-200);
        } else {
            current.entries = (current.entries || []).concat(entries);
            if (current.entries.length > 200) {
                current.entries = current.entries.slice(-200);
            }
        }
        current.lastUpdate = new Date().toISOString();
        manager.saveInstances();

        const lists = document.querySelectorAll('.activity-list');
        if (replace || lists.length === 0) {
            manager.renderModules();
            return;
        }

        entries.forEach((entry) => {
            const time = new Date(entry.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const level = entry.level || 'info';
            const rowHtml = `
                <div class="activity-row activity-${level}">
                    <span class="activity-time">${time}</span>
                    <span class="activity-level">${level}</span>
                    <span class="activity-source">${entry.source || 'App'}</span>
                    <span class="activity-message">${entry.message || ''}</span>
                </div>
            `;
            lists.forEach((list) => {
                const empty = list.querySelector('.no-logs');
                if (empty) empty.remove();
                list.insertAdjacentHTML('afterbegin', rowHtml);
                while (list.children.length > 200) {
                    list.removeChild(list.lastChild);
                }
            });
        });

        document.querySelectorAll('.activity-count').forEach((el) => {
            el.textContent = `${current.entries.length} events`;
        });
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
        label: 'Activity Log',
        persistent: true,
        getSampleData,
        render,
        ensure,
        handleMessage
    };
})();
