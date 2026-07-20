/**
 * Network Analyzer module (browser)
 * Sidebar page (full tool) — not a Home dashboard widget.
 */
(function () {
    const VIEW = 'network';
    let state = {
        lastResult: null,
        history: [],
        running: false,
        intervalMs: 60 * 60 * 1000
    };
    let lastSeenResultTs = null;
    let bound = false;

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

    function resolveRunning(incoming) {
        if (incoming.phase === 'started') return true;
        if (incoming.phase === 'finished') return false;

        const incomingTs = incoming.lastResult && incoming.lastResult.timestamp;
        if (incoming.running === true && incomingTs && lastSeenResultTs && incomingTs !== lastSeenResultTs) {
            return false;
        }
        return incoming.running === true;
    }

    function historyRows(history) {
        if (!history || history.length === 0) {
            return '<div class="network-history-empty">No speed tests yet</div>';
        }

        return history.slice().reverse().slice(0, 12).map((item) => {
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

    function renderPage() {
        const root = document.getElementById('networkViewBody');
        if (!root) return;

        const last = state.lastResult;
        const running = state.running === true;
        const mbps = last && last.status === 'ok' ? formatMbps(last.downloadMbps) : '—';
        const statusText = running
            ? 'Running test...'
            : (last
                ? (last.status === 'ok' ? 'Last test OK' : 'Last test failed')
                : 'Waiting for first test');

        root.innerHTML = `
            <div class="network-page">
                <div class="network-top">
                    <div class="network-speed">
                        <span class="network-speed-label">Download</span>
                        <span class="network-speed-value">${mbps}</span>
                    </div>
                    <button type="button" class="network-run-btn" id="networkRunBtn" ${running ? 'disabled' : ''}>
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
                        ${historyRows(state.history)}
                    </div>
                </div>
            </div>
        `;
    }

    function applyIncoming(incoming) {
        const running = resolveRunning(incoming);
        const incomingTs = incoming.lastResult && incoming.lastResult.timestamp;
        if (incomingTs) lastSeenResultTs = incomingTs;

        state.running = running;
        state.intervalMs = incoming.intervalMs || state.intervalMs;

        if (incoming.phase === 'started') {
            // keep previous result/history while test runs
        } else {
            if (incoming.lastResult !== undefined) state.lastResult = incoming.lastResult;
            if (Array.isArray(incoming.history)) state.history = incoming.history;
        }

        if (!incoming.phase && incoming.running === true && running === true) {
            // legacy start packet — don't wipe result
        }

        console.log('[NetworkAnalyzer] page update', {
            phase: incoming.phase || null,
            running: state.running,
            mbps: state.lastResult && state.lastResult.downloadMbps
        });

        renderPage();
    }

    function bindRunButton(manager) {
        const view = document.getElementById('networkView');
        if (!view || view.dataset.networkBound === '1') return;
        view.dataset.networkBound = '1';
        view.addEventListener('click', (e) => {
            const btn = e.target.closest('#networkRunBtn, .network-run-btn');
            if (!btn || btn.disabled) return;
            if (!manager.ws || manager.ws.readyState !== WebSocket.OPEN) {
                alert('Not connected to server');
                return;
            }
            console.log('[NetworkAnalyzer] Run now clicked');
            manager.ws.send(JSON.stringify({ type: 'run_network_test' }));
        });
    }

    function removeHomeWidgets(manager) {
        if (!manager || !Array.isArray(manager.modules)) return;
        const before = manager.modules.length;
        manager.modules = manager.modules.filter((m) => m.type !== 'network');
        Object.keys(manager.moduleInstances || {}).forEach((key) => {
            if (key.startsWith('network_')) {
                delete manager.moduleInstances[key];
            }
        });
        if (manager.modules.length !== before) {
            manager.saveModules();
            manager.saveInstances();
            manager.renderModules();
        }
    }

    function ensure(manager) {
        removeHomeWidgets(manager);
        bindRunButton(manager);
        if (!bound) {
            bound = true;
            renderPage();
        }
    }

    function handleMessage(manager, message) {
        if (message.type === 'network_state' && message.data) {
            applyIncoming(message.data);
            return true;
        }
        if (message.type === 'network_stats' && message.data) {
            applyIncoming(message.data);
            return true;
        }
        return false;
    }

    window.HomeHubModules = window.HomeHubModules || {};
    window.HomeHubModules.network = {
        id: 'network',
        type: 'network',
        label: 'Network Analyzer',
        nav: true,
        view: VIEW,
        navLabel: 'Network',
        persistent: true,
        // Not a Home widget
        getSampleData: null,
        render: null,
        ensure,
        handleMessage
    };
})();
