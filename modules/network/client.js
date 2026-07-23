/**
 * Network Analyzer module (browser)
 * - Sidebar page: full analyzer
 * - Home widget (speed_test): download/upload speed only
 */
(function () {
    const VIEW = 'network';
    let state = {
        lastResult: null,
        history: [],
        running: false,
        intervalMs: 60 * 60 * 1000,
        snapshot: {
            interfaces: [],
            gateway: null,
            dnsServers: [],
            wifi: { connected: false, ssid: null, signal: null, interface: null },
            neighbors: [],
            connections: [],
            updatedAt: null
        }
    };
    let lastSeenResultTs = null;
    let pageBound = false;
    let widgetBound = false;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatMbps(value) {
        if (typeof value !== 'number') return '—';
        return `${value.toFixed(2)} Mbps`;
    }

    function formatMs(value) {
        if (typeof value !== 'number') return '—';
        return `${value.toFixed(1)} ms`;
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

    function latencyCell(entry) {
        if (!entry) return '—';
        if (entry.error && entry.avgMs == null) return esc(entry.error);
        return formatMs(entry.avgMs);
    }

    function sparklinePoints(values, width, height) {
        const nums = values.filter((v) => typeof v === 'number');
        if (nums.length < 2) return '';
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const span = max - min || 1;
        return values.map((v, i) => {
            const x = (i / (values.length - 1)) * width;
            const y = typeof v === 'number'
                ? height - ((v - min) / span) * (height - 4) - 2
                : height / 2;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
    }

    function renderTrendChart(history) {
        const items = (history || []).slice(-24);
        if (items.length < 2) {
            return '<div class="network-history-empty">Not enough history for trends yet</div>';
        }

        const w = 520;
        const h = 72;
        const down = items.map((i) => i.downloadMbps);
        const up = items.map((i) => i.uploadMbps);
        const lat = items.map((i) => i.latencyInternetMs);

        return `
            <div class="network-trends">
                <div class="network-trend">
                    <div class="network-trend-label">Download</div>
                    <svg viewBox="0 0 ${w} ${h}" class="network-trend-svg" preserveAspectRatio="none">
                        <polyline fill="none" stroke="var(--primary-color)" stroke-width="2"
                            points="${sparklinePoints(down, w, h)}" />
                    </svg>
                </div>
                <div class="network-trend">
                    <div class="network-trend-label">Upload</div>
                    <svg viewBox="0 0 ${w} ${h}" class="network-trend-svg" preserveAspectRatio="none">
                        <polyline fill="none" stroke="var(--success)" stroke-width="2"
                            points="${sparklinePoints(up, w, h)}" />
                    </svg>
                </div>
                <div class="network-trend">
                    <div class="network-trend-label">Latency</div>
                    <svg viewBox="0 0 ${w} ${h}" class="network-trend-svg" preserveAspectRatio="none">
                        <polyline fill="none" stroke="var(--warning)" stroke-width="2"
                            points="${sparklinePoints(lat, w, h)}" />
                    </svg>
                </div>
            </div>
        `;
    }

    function historyRows(history) {
        if (!history || history.length === 0) {
            return '<div class="network-history-empty">No tests yet</div>';
        }

        return history.slice().reverse().slice(0, 16).map((item) => {
            const ok = item.status === 'ok';
            const down = ok ? formatMbps(item.downloadMbps) : (item.error || 'Failed');
            const up = typeof item.uploadMbps === 'number' ? formatMbps(item.uploadMbps) : '—';
            const lat = typeof item.latencyInternetMs === 'number' ? formatMs(item.latencyInternetMs) : '—';
            return `
                <div class="network-history-row ${ok ? 'ok' : 'err'}">
                    <span class="network-history-time">${esc(formatWhen(item.timestamp))}</span>
                    <span class="network-history-value">↓ ${esc(down)}</span>
                    <span class="network-history-value">↑ ${esc(up)}</span>
                    <span class="network-history-value">${esc(lat)}</span>
                    <span class="network-history-trigger">${esc(item.trigger || '')}</span>
                </div>
            `;
        }).join('');
    }

    function interfaceRows(interfaces) {
        if (!interfaces || interfaces.length === 0) {
            return '<div class="network-history-empty">No interfaces found</div>';
        }
        return interfaces.map((iface) => `
            <div class="network-kv-row">
                <span class="network-kv-key">${esc(iface.name)} · ${esc(iface.family)}</span>
                <span class="network-kv-val">${esc(iface.address)}${iface.mac ? ` · ${esc(iface.mac)}` : ''}</span>
            </div>
        `).join('');
    }

    function neighborRows(neighbors) {
        if (!neighbors || neighbors.length === 0) {
            return '<div class="network-history-empty">No LAN neighbors seen</div>';
        }
        return neighbors.slice(0, 20).map((n) => `
            <div class="network-kv-row">
                <span class="network-kv-key">${esc(n.ip)}</span>
                <span class="network-kv-val">${esc(n.mac || '—')}${n.state ? ` · ${esc(n.state)}` : ''}</span>
            </div>
        `).join('');
    }

    function connectionRows(connections) {
        if (!connections || connections.length === 0) {
            return '<div class="network-history-empty">No established connections</div>';
        }
        return connections.slice(0, 20).map((c) => `
            <div class="network-kv-row">
                <span class="network-kv-key">${esc(c.local)}</span>
                <span class="network-kv-val">→ ${esc(c.peer)}</span>
            </div>
        `).join('');
    }

    function renderPage() {
        const root = document.getElementById('networkViewBody');
        if (!root) return;

        const last = state.lastResult;
        const snap = state.snapshot || {};
        const running = state.running === true;
        const wifi = snap.wifi || {};
        const latency = (last && last.latency) || {};
        const dnsInfo = (last && last.dns) || null;

        const statusText = running
            ? 'Running full analysis...'
            : (last
                ? (last.status === 'ok' ? 'Last analysis OK' : 'Last analysis had errors')
                : 'Waiting for first analysis');

        root.innerHTML = `
            <div class="network-page">
                <div class="network-top">
                    <div class="network-speed-pair">
                        <div class="network-speed">
                            <span class="network-speed-label">Download</span>
                            <span class="network-speed-value">${esc(formatMbps(last && last.downloadMbps))}</span>
                        </div>
                        <div class="network-speed">
                            <span class="network-speed-label">Upload</span>
                            <span class="network-speed-value">${esc(formatMbps(last && last.uploadMbps))}</span>
                        </div>
                    </div>
                    <div class="network-actions">
                        <button type="button" class="network-run-btn" id="networkRunBtn" ${running ? 'disabled' : ''}>
                            ${running ? 'Testing...' : 'Run full test'}
                        </button>
                        <button type="button" class="network-secondary-btn" id="networkRefreshBtn" ${running ? 'disabled' : ''}>
                            Refresh snapshot
                        </button>
                    </div>
                </div>

                <div class="network-meta">
                    <div class="network-meta-item">
                        <span class="network-meta-label">Status</span>
                        <span class="network-meta-value">${esc(statusText)}</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">Last run</span>
                        <span class="network-meta-value">${esc(formatWhen(last && last.timestamp))}</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">Schedule</span>
                        <span class="network-meta-value">Every 1 hour</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">Gateway</span>
                        <span class="network-meta-value">${esc(snap.gateway || '—')}</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">DNS</span>
                        <span class="network-meta-value">${esc((snap.dnsServers || []).join(', ') || '—')}</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">Snapshot</span>
                        <span class="network-meta-value">${esc(formatWhen(snap.updatedAt))}</span>
                    </div>
                </div>

                <div class="network-sections">
                    <section class="network-section">
                        <h3 class="network-section-title">Latency</h3>
                        <div class="network-metric-grid">
                            <div class="network-metric">
                                <span class="network-meta-label">Gateway</span>
                                <span class="network-meta-value">${latencyCell(latency.gateway)}</span>
                            </div>
                            <div class="network-metric">
                                <span class="network-meta-label">1.1.1.1</span>
                                <span class="network-meta-value">${latencyCell(latency.cloudflare)}</span>
                            </div>
                            <div class="network-metric">
                                <span class="network-meta-label">8.8.8.8</span>
                                <span class="network-meta-value">${latencyCell(latency.google)}</span>
                            </div>
                            <div class="network-metric">
                                <span class="network-meta-label">DNS (${esc((dnsInfo && dnsInfo.host) || 'cloudflare.com')})</span>
                                <span class="network-meta-value">${dnsInfo ? (dnsInfo.error ? esc(dnsInfo.error) : formatMs(dnsInfo.ms)) : '—'}</span>
                            </div>
                        </div>
                    </section>

                    <section class="network-section">
                        <h3 class="network-section-title">Wi‑Fi</h3>
                        <div class="network-metric-grid">
                            <div class="network-metric">
                                <span class="network-meta-label">Status</span>
                                <span class="network-meta-value">${wifi.connected ? 'Connected' : 'Not connected / unknown'}</span>
                            </div>
                            <div class="network-metric">
                                <span class="network-meta-label">SSID</span>
                                <span class="network-meta-value">${esc(wifi.ssid || '—')}</span>
                            </div>
                            <div class="network-metric">
                                <span class="network-meta-label">Signal</span>
                                <span class="network-meta-value">${typeof wifi.signal === 'number' ? `${wifi.signal}%` : '—'}</span>
                            </div>
                            <div class="network-metric">
                                <span class="network-meta-label">Interface</span>
                                <span class="network-meta-value">${esc(wifi.interface || '—')}</span>
                            </div>
                        </div>
                    </section>

                    <section class="network-section">
                        <h3 class="network-section-title">Interfaces</h3>
                        <div class="network-kv-list">${interfaceRows(snap.interfaces)}</div>
                    </section>

                    <section class="network-section">
                        <h3 class="network-section-title">LAN neighbors</h3>
                        <div class="network-kv-list">${neighborRows(snap.neighbors)}</div>
                    </section>

                    <section class="network-section network-section-wide">
                        <h3 class="network-section-title">Active connections</h3>
                        <div class="network-kv-list">${connectionRows(snap.connections)}</div>
                    </section>

                    <section class="network-section network-section-wide">
                        <h3 class="network-section-title">Trends</h3>
                        ${renderTrendChart(state.history)}
                    </section>

                    <section class="network-section network-section-wide">
                        <h3 class="network-section-title">Recent tests</h3>
                        <div class="network-history-list network-history-list-wide">
                            <div class="network-history-row network-history-head">
                                <span>When</span>
                                <span>Down</span>
                                <span>Up</span>
                                <span>Latency</span>
                                <span>Trigger</span>
                            </div>
                            ${historyRows(state.history)}
                        </div>
                    </section>
                </div>
            </div>
        `;
    }

    function syncSpeedWidgets(manager) {
        if (!manager || !manager.moduleInstances) return;
        const payload = {
            downloadMbps: state.lastResult ? state.lastResult.downloadMbps : null,
            uploadMbps: state.lastResult ? state.lastResult.uploadMbps : null,
            status: state.lastResult ? state.lastResult.status : null,
            running: state.running === true,
            lastRun: state.lastResult ? state.lastResult.timestamp : null,
            error: state.lastResult ? state.lastResult.error : null
        };

        let changed = false;
        Object.keys(manager.moduleInstances).forEach((key) => {
            // Type-only key is `speed_test`; keep `speed_test_*` for legacy layouts
            if (key !== 'speed_test' && !key.startsWith('speed_test_')) return;
            const prev = manager.moduleInstances[key] || {};
            if (
                prev.downloadMbps === payload.downloadMbps &&
                prev.uploadMbps === payload.uploadMbps &&
                prev.status === payload.status &&
                prev.running === payload.running &&
                prev.lastRun === payload.lastRun
            ) {
                return;
            }
            manager.moduleInstances[key] = { ...prev, ...payload };
            changed = true;
        });

        if (changed) {
            manager.saveInstances();
            manager.renderModules();
        }
    }

    function applyIncoming(manager, incoming, options = {}) {
        const syncWidgets = options.syncWidgets !== false;
        const prevRunning = state.running === true;
        const running = resolveRunning(incoming);
        const incomingTs = incoming.lastResult && incoming.lastResult.timestamp;
        if (incomingTs) lastSeenResultTs = incomingTs;

        state.running = running;
        state.intervalMs = incoming.intervalMs || state.intervalMs;

        if (incoming.snapshot) {
            state.snapshot = incoming.snapshot;
        }

        if (incoming.phase === 'started') {
            // keep previous result/history while test runs
        } else {
            if (incoming.lastResult !== undefined) state.lastResult = incoming.lastResult;
            if (Array.isArray(incoming.history)) state.history = incoming.history;
        }

        renderPage();
        if (syncWidgets || prevRunning !== running) {
            syncSpeedWidgets(manager);
        }
    }

    function requestRun(manager) {
        if (!manager.ws || manager.ws.readyState !== WebSocket.OPEN) {
            alert('Not connected to server');
            return;
        }
        manager.ws.send(JSON.stringify({ type: 'run_network_test' }));
    }

    function requestSnapshot(manager) {
        if (!manager.ws || manager.ws.readyState !== WebSocket.OPEN) {
            alert('Not connected to server');
            return;
        }
        manager.ws.send(JSON.stringify({ type: 'refresh_network_snapshot' }));
    }

    function bindPage(manager) {
        const view = document.getElementById('networkView');
        if (!view || pageBound) return;
        pageBound = true;
        view.addEventListener('click', (e) => {
            if (e.target.closest('#networkRunBtn')) {
                requestRun(manager);
                return;
            }
            if (e.target.closest('#networkRefreshBtn')) {
                requestSnapshot(manager);
            }
        });
    }

    function bindWidgets(manager) {
        if (widgetBound) return;
        widgetBound = true;
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.speed-test-run-btn');
            if (!btn) return;
            e.preventDefault();
            requestRun(manager);
        });
    }

    function migrateLegacyWidgets(manager) {
        if (!manager || !Array.isArray(manager.modules)) return;
        let changed = false;

        manager.modules.forEach((m) => {
            if (m.type !== 'network') return;
            m.type = 'speed_test';
            delete m.name;
            const oldKey = m.instanceKey;
            m.instanceKey = manager.getInstanceKey('speed_test');
            if (oldKey && manager.moduleInstances[oldKey] && !manager.moduleInstances[m.instanceKey]) {
                manager.moduleInstances[m.instanceKey] = manager.moduleInstances[oldKey];
                delete manager.moduleInstances[oldKey];
            }
            changed = true;
        });

        Object.keys(manager.moduleInstances || {}).forEach((key) => {
            if (key.startsWith('network_') && !manager.modules.some((m) => m.instanceKey === key)) {
                delete manager.moduleInstances[key];
                changed = true;
            }
        });

        if (changed) {
            manager.saveModules();
            manager.saveInstances();
        }
    }

    function ensure(manager) {
        migrateLegacyWidgets(manager);
        bindPage(manager);
        bindWidgets(manager);
        renderPage();
        syncSpeedWidgets(manager);
    }

    function handleMessage(manager, message) {
        if (message.type === 'network_state' && message.data) {
            applyIncoming(manager, message.data, { syncWidgets: true });
            return true;
        }
        if (message.type === 'network_stats' && message.data) {
            applyIncoming(manager, message.data, { syncWidgets: true });
            return true;
        }
        if (message.type === 'network_snapshot' && message.data) {
            // Snapshot updates the page; only touch widgets if running flipped
            applyIncoming(manager, message.data, { syncWidgets: false });
            return true;
        }
        return false;
    }

    function getSpeedSampleData() {
        return {
            downloadMbps: null,
            uploadMbps: null,
            status: null,
            running: false,
            lastRun: null,
            error: null
        };
    }

    function formatMbpsParts(value) {
        if (typeof value !== 'number') return { num: '—', unit: '' };
        return { num: value.toFixed(2), unit: 'Mbps' };
    }

    function renderSpeedWidget(data) {
        const running = data && data.running === true;
        const down = formatMbpsParts(data && data.downloadMbps);
        const up = formatMbpsParts(data && data.uploadMbps);
        const when = formatWhen(data && data.lastRun);
        return `
            <div class="speed-test-widget">
                <div class="speed-test-metrics">
                    <div class="speed-test-metric">
                        <span class="network-speed-label">Down</span>
                        <span class="speed-test-value">${esc(down.num)}<span class="speed-test-unit">${esc(down.unit)}</span></span>
                    </div>
                    <div class="speed-test-metric">
                        <span class="network-speed-label">Up</span>
                        <span class="speed-test-value">${esc(up.num)}<span class="speed-test-unit">${esc(up.unit)}</span></span>
                    </div>
                </div>
                <div class="speed-test-footer">
                    <span class="speed-test-when">${running ? 'Testing…' : esc(when)}</span>
                    <button type="button" class="network-run-btn speed-test-run-btn" ${running ? 'disabled' : ''}>
                        ${running ? '…' : 'Run'}
                    </button>
                </div>
            </div>
        `;
    }

    window.HomeHubModules = window.HomeHubModules || {};

    window.HomeHubModules.network = {
        id: 'network',
        type: 'network',
        label: 'Network Analyzer',
        nav: true,
        view: VIEW,
        navLabel: 'Network',
        persistent: false,
        getSampleData: null,
        render: null,
        ensure,
        handleMessage
    };

    window.HomeHubModules.speed_test = {
        id: 'speed_test',
        type: 'speed_test',
        label: 'Speed Test',
        nav: false,
        persistent: false,
        getSampleData: getSpeedSampleData,
        render: renderSpeedWidget,
        ensure: null,
        handleMessage: null
    };
})();
