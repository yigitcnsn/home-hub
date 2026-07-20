/**
 * Network Analyzer module (browser) — dashboard widget.
 */
(function () {
    const TYPE = 'network';
    const INSTANCE_KEY = 'network_analyzer';
    let lastSeenResultTs = null;

    function getSampleData() {
        return {
            lastResult: null,
            history: [],
            running: false,
            intervalMs: 60 * 60 * 1000,
            lastUpdate: null
        };
    }

    function formatMbps(value) {
        if (typeof value !== 'number') return '—';
        return `${value.toFixed(2)} Mbps`;
    }

    function formatWhen(timestamp) {
        if (!timestamp) return 'Never';
        return new Date(timestamp).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function historyRows(history) {
        if (!history || history.length === 0) {
            return '<div class="network-history-empty">No speed tests yet</div>';
        }

        return history.slice().reverse().slice(0, 8).map((item) => {
            const ok = item.status === 'ok';
            const value = ok ? formatMbps(item.downloadMbps) : (item.error || 'Failed');
            return `
                <div class="network-history-row ${ok ? 'ok' : 'err'}">
                    <span class="network-history-time">${formatWhen(item.timestamp)}</span>
                    <span class="network-history-value">${value}</span>
                    <span class="network-history-trigger">${item.trigger || ''}</span>
                </div>
            `;
        }).join('');
    }

    function resolveRunning(state) {
        if (state.phase === 'started') return true;
        if (state.phase === 'finished') return false;

        const incomingTs = state.lastResult && state.lastResult.timestamp;
        // Old buggy servers sent finished results with running:true.
        // A new lastResult timestamp while "running" means the test completed.
        if (state.running === true && incomingTs && lastSeenResultTs && incomingTs !== lastSeenResultTs) {
            return false;
        }
        return state.running === true;
    }

    function render(data, module) {
        const last = data.lastResult;
        const running = data.running === true;
        const mbps = last && last.status === 'ok' ? formatMbps(last.downloadMbps) : '—';
        const statusText = running
            ? 'Running test...'
            : (last
                ? (last.status === 'ok' ? 'Last test OK' : 'Last test failed')
                : 'Waiting for first test');

        return `
            <div class="network-analyzer">
                <div class="network-top">
                    <div class="network-speed">
                        <span class="network-speed-label">Download</span>
                        <span class="network-speed-value">${mbps}</span>
                    </div>
                    <button type="button" class="network-run-btn" data-network-run="1" ${running ? 'disabled' : ''}>
                        ${running ? 'Testing...' : 'Run now'}
                    </button>
                </div>
                <div class="network-meta">
                    <div class="network-meta-item">
                        <span class="network-meta-label">Status</span>
                        <span class="network-meta-value">${statusText}</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">Last run</span>
                        <span class="network-meta-value">${formatWhen(last && last.timestamp)}</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">Schedule</span>
                        <span class="network-meta-value">Every 1 hour</span>
                    </div>
                </div>
                <div class="network-history">
                    <div class="network-history-title">Recent tests</div>
                    <div class="network-history-list">
                        ${historyRows(data.history)}
                    </div>
                </div>
            </div>
        `;
    }

    function networkKeys(manager) {
        const keys = new Set();
        (manager.modules || []).forEach((m) => {
            if (m.type !== TYPE) return;
            keys.add(m.instanceKey || manager.getInstanceKey(m.name, m.type));
        });
        keys.add(INSTANCE_KEY);
        return keys;
    }

    function applyState(manager, state) {
        const running = resolveRunning(state);
        const incomingTs = state.lastResult && state.lastResult.timestamp;
        if (incomingTs) {
            lastSeenResultTs = incomingTs;
        }

        const patch = {
            running,
            intervalMs: state.intervalMs || 60 * 60 * 1000,
            lastUpdate: new Date().toISOString()
        };

        // Don't wipe previous result on a "started" packet
        if (state.phase === 'started') {
            // keep existing lastResult/history
        } else {
            if (state.lastResult !== undefined) patch.lastResult = state.lastResult;
            if (Array.isArray(state.history)) patch.history = state.history;
        }

        // Legacy start packets include old lastResult + running:true
        if (!state.phase && state.running === true && running === true) {
            delete patch.lastResult;
            delete patch.history;
        }

        networkKeys(manager).forEach((key) => {
            if (!manager.moduleInstances[key]) {
                manager.moduleInstances[key] = getSampleData();
            }
            Object.assign(manager.moduleInstances[key], patch);
        });

        // Persist without sticky running flag (old bug left Testing... in localStorage)
        const snapshot = JSON.parse(JSON.stringify(manager.moduleInstances));
        Object.keys(snapshot).forEach((key) => {
            if (snapshot[key] && Object.prototype.hasOwnProperty.call(snapshot[key], 'running')) {
                snapshot[key].running = false;
            }
        });
        localStorage.setItem('homeHubModuleInstances', JSON.stringify(snapshot));

        console.log('[NetworkAnalyzer] UI update', {
            phase: state.phase || null,
            running,
            mbps: (patch.lastResult && patch.lastResult.downloadMbps) ||
                (manager.moduleInstances[INSTANCE_KEY] &&
                    manager.moduleInstances[INSTANCE_KEY].lastResult &&
                    manager.moduleInstances[INSTANCE_KEY].lastResult.downloadMbps) ||
                null
        });

        manager.renderModules();
    }

    function ensure(manager) {
        // Clear any sticky Testing... state from older buggy saves
        networkKeys(manager).forEach((key) => {
            if (manager.moduleInstances[key]) {
                manager.moduleInstances[key].running = false;
            }
        });

        const grid = document.getElementById('modulesGrid');
        if (grid && grid.dataset.networkBound !== '1') {
            grid.dataset.networkBound = '1';
            grid.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-network-run]');
                if (!btn || btn.disabled) return;
                if (!manager.ws || manager.ws.readyState !== WebSocket.OPEN) {
                    alert('Not connected to server');
                    return;
                }
                console.log('[NetworkAnalyzer] Run now clicked');
                manager.ws.send(JSON.stringify({ type: 'run_network_test' }));
            });
        }
    }

    function handleMessage(manager, message) {
        if (message.type === 'network_state' && message.data) {
            applyState(manager, message.data);
            return true;
        }
        if (message.type === 'network_stats' && message.data) {
            applyState(manager, message.data);
            return true;
        }
        return false;
    }

    window.HomeHubModules = window.HomeHubModules || {};
    window.HomeHubModules.network = {
        id: 'network',
        type: TYPE,
        label: 'Network Analyzer',
        persistent: false,
        category: 'analyzers',
        getSampleData,
        render,
        ensure,
        handleMessage,
        defaultName: 'Network Analyzer',
        defaultSize: 'medium'
    };
})();
