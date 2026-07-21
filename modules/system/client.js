/**
 * Activity Monitor (browser)
 * Sidebar page with full host metrics; Home keeps the compact System Monitor widget.
 */
(function () {
    const VIEW = 'monitor';
    let state = null;
    let pageBound = false;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function pct(value) {
        return typeof value === 'number' ? `${value}%` : '—';
    }

    function temp(value) {
        return typeof value === 'number' ? `${value}°C` : '—';
    }

    function usageClass(value) {
        if (typeof value !== 'number') return 'level-error';
        if (value >= 85) return 'level-high';
        if (value >= 65) return 'level-warm';
        return 'level-ok';
    }

    function tempClass(value) {
        if (typeof value !== 'number') return 'level-error';
        if (value >= 70) return 'level-high';
        if (value >= 55) return 'level-warm';
        return 'level-ok';
    }

    function barWidth(value) {
        return typeof value === 'number' ? Math.max(0, Math.min(100, value)) : 0;
    }

    function tempBarWidth(value) {
        return typeof value === 'number' ? Math.max(0, Math.min(100, (value / 80) * 100)) : 0;
    }

    function formatWhen(timestamp) {
        if (!timestamp) return '—';
        return new Date(timestamp).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function formatAgo(timestamp) {
        if (!timestamp) return '—';
        const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    }

    function sparkline(values, color) {
        const nums = (values || []).filter((v) => typeof v === 'number');
        if (nums.length < 2) {
            return '<div class="monitor-chart-empty">Waiting for history…</div>';
        }
        const w = 640;
        const h = 120;
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const span = max - min || 1;
        const points = nums.map((v, i) => {
            const x = (i / (nums.length - 1)) * w;
            const y = h - ((v - min) / span) * (h - 8) - 4;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');

        return `
            <svg viewBox="0 0 ${w} ${h}" class="monitor-chart-svg" preserveAspectRatio="none">
                <polyline fill="none" stroke="${color}" stroke-width="2.5" points="${points}" />
            </svg>
            <div class="monitor-chart-range">${esc(String(min))} – ${esc(String(max))}</div>
        `;
    }

    function historyRows(history) {
        const stamps = (history && history.timestamps) || [];
        if (!stamps.length) {
            return '<div class="network-history-empty">No metrics history yet</div>';
        }

        const rows = [];
        const start = Math.max(0, stamps.length - 40);
        for (let i = stamps.length - 1; i >= start; i--) {
            rows.push(`
                <div class="monitor-history-row">
                    <span>${esc(formatWhen(stamps[i]))}</span>
                    <span>${esc(pct(history.cpu && history.cpu[i]))}</span>
                    <span>${esc(temp(history.temperature && history.temperature[i]))}</span>
                    <span>${esc(pct(history.memory && history.memory[i]))}</span>
                    <span>${esc(pct(history.disk && history.disk[i]))}</span>
                </div>
            `);
        }
        return rows.join('');
    }

    function renderPage() {
        const root = document.getElementById('monitorViewBody');
        if (!root) return;

        if (!state || state.error) {
            root.innerHTML = `
                <div class="monitor-page">
                    <div class="network-history-empty">
                        ${state && state.error ? esc(state.error) : 'Waiting for system metrics…'}
                    </div>
                </div>
            `;
            return;
        }

        const history = state.history || {};
        const networkStatus = (state.networkStatus || 'unknown').toLowerCase();
        const loadParts = String(state.loadAverage || '—').split(',').map((p) => p.trim());

        root.innerHTML = `
            <div class="monitor-page">
                <div class="monitor-top">
                    <div>
                        <div class="monitor-kicker">Host</div>
                        <div class="monitor-title">Activity Monitor</div>
                    </div>
                    <div class="monitor-updated">Updated ${esc(formatAgo(state.lastUpdate))}</div>
                </div>

                <div class="monitor-hero">
                    <div class="monitor-hero-card ${usageClass(state.cpuUsage)}">
                        <span class="network-meta-label">CPU</span>
                        <span class="monitor-hero-value">${esc(pct(state.cpuUsage))}</span>
                        <span class="monitor-hero-sub">Usage</span>
                    </div>
                    <div class="monitor-hero-card ${tempClass(state.cpuTemp)}">
                        <span class="network-meta-label">Temp</span>
                        <span class="monitor-hero-value">${esc(temp(state.cpuTemp))}</span>
                        <span class="monitor-hero-sub">Safe under 70°C</span>
                    </div>
                    <div class="monitor-hero-card ${usageClass(state.memoryUsage)}">
                        <span class="network-meta-label">Memory</span>
                        <span class="monitor-hero-value">${esc(pct(state.memoryUsage))}</span>
                        <span class="monitor-hero-sub">${esc(state.memoryUsed || '—')} / ${esc(state.memoryTotal || '—')}</span>
                    </div>
                    <div class="monitor-hero-card ${usageClass(state.diskUsage)}">
                        <span class="network-meta-label">Disk</span>
                        <span class="monitor-hero-value">${esc(pct(state.diskUsage))}</span>
                        <span class="monitor-hero-sub">${esc(state.diskUsed || '—')} / ${esc(state.diskTotal || '—')}</span>
                    </div>
                </div>

                <div class="monitor-meta-grid">
                    <div class="network-meta-item">
                        <span class="network-meta-label">Uptime</span>
                        <span class="network-meta-value">${esc(state.uptime || '—')}</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">Network</span>
                        <span class="network-meta-value network-${esc(networkStatus)}">${esc(networkStatus)}</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">Load 1m</span>
                        <span class="network-meta-value">${esc(loadParts[0] || '—')}</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">Load 5m</span>
                        <span class="network-meta-value">${esc(loadParts[1] || '—')}</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">Load 15m</span>
                        <span class="network-meta-value">${esc(loadParts[2] || '—')}</span>
                    </div>
                    <div class="network-meta-item">
                        <span class="network-meta-label">Samples</span>
                        <span class="network-meta-value">${esc(String((history.timestamps || []).length))} in history</span>
                    </div>
                </div>

                <div class="monitor-charts">
                    <section class="monitor-chart-card">
                        <h3 class="network-section-title">CPU history</h3>
                        <div class="metric-bar"><span class="metric-bar-fill" style="width:${barWidth(state.cpuUsage)}%"></span></div>
                        ${sparkline(history.cpu, 'var(--primary-color)')}
                    </section>
                    <section class="monitor-chart-card">
                        <h3 class="network-section-title">Temperature history</h3>
                        <div class="metric-bar"><span class="metric-bar-fill" style="width:${tempBarWidth(state.cpuTemp)}%"></span></div>
                        ${sparkline(history.temperature, 'var(--warning)')}
                    </section>
                    <section class="monitor-chart-card">
                        <h3 class="network-section-title">Memory history</h3>
                        <div class="metric-bar"><span class="metric-bar-fill" style="width:${barWidth(state.memoryUsage)}%"></span></div>
                        ${sparkline(history.memory, 'var(--success)')}
                    </section>
                    <section class="monitor-chart-card">
                        <h3 class="network-section-title">Disk history</h3>
                        <div class="metric-bar"><span class="metric-bar-fill" style="width:${barWidth(state.diskUsage)}%"></span></div>
                        ${sparkline(history.disk, '#f59e0b')}
                    </section>
                </div>

                <section class="network-section network-section-wide">
                    <h3 class="network-section-title">Metrics log (from system-metrics.log)</h3>
                    <div class="monitor-history-list">
                        <div class="monitor-history-row monitor-history-head">
                            <span>When</span>
                            <span>CPU</span>
                            <span>Temp</span>
                            <span>Mem</span>
                            <span>Disk</span>
                        </div>
                        ${historyRows(history)}
                    </div>
                </section>
            </div>
        `;
    }

    function onStats(data) {
        if (!data) return;
        state = data;
        renderPage();
    }

    function ensure(manager) {
        if (pageBound) return;
        pageBound = true;

        // Seed from current widget instance if available
        if (manager && manager.moduleInstances && manager.moduleInstances.system_monitoring) {
            state = manager.moduleInstances.system_monitoring;
        }
        renderPage();
    }

    function handleMessage(manager, message) {
        if (message.type === 'system_stats' && message.data) {
            onStats(message.data);
            return true;
        }
        return false;
    }

    window.HomeHubModules = window.HomeHubModules || {};
    window.HomeHubModules.system_monitor_page = {
        id: 'system_monitor_page',
        type: 'system_monitor_page',
        label: 'Activity Monitor',
        nav: true,
        view: VIEW,
        navLabel: 'Monitor',
        persistent: false,
        getSampleData: null,
        render: null,
        ensure,
        handleMessage,
        onStats
    };
})();
