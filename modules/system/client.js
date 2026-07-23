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

    function sparkline(values, color, opts = {}) {
        const nums = (values || []).filter((v) => typeof v === 'number');
        if (nums.length < 2) {
            return '<div class="monitor-chart-empty">Waiting for history…</div>';
        }

        const w = 640;
        const h = 120;
        const min = typeof opts.min === 'number' ? opts.min : 0;
        const max = typeof opts.max === 'number' ? opts.max : 100;
        const span = max - min || 1;
        const unit = opts.unit || '';
        const mid = min + span / 2;
        const times = Array.isArray(opts.timestamps) ? opts.timestamps.slice(-nums.length) : [];

        const yFor = (v) => {
            const clamped = Math.max(min, Math.min(max, v));
            return h - ((clamped - min) / span) * (h - 8) - 4;
        };

        const poly = nums.map((v, i) => {
            const x = (i / (nums.length - 1)) * w;
            return `${x.toFixed(1)},${yFor(v).toFixed(1)}`;
        }).join(' ');

        const midY = yFor(mid);
        const formatAxis = (v) => (unit === '%' ? String(Math.round(v)) : String(Math.round(v))) + unit;

        return `
            <div class="monitor-chart"
                data-min="${min}"
                data-max="${max}"
                data-unit="${esc(unit)}"
                data-values="${esc(JSON.stringify(nums))}"
                data-times="${esc(JSON.stringify(times))}">
                <div class="monitor-chart-y" aria-hidden="true">
                    <span>${esc(formatAxis(max))}</span>
                    <span>${esc(formatAxis(mid))}</span>
                    <span>${esc(formatAxis(min))}</span>
                </div>
                <div class="monitor-chart-plot">
                    <svg viewBox="0 0 ${w} ${h}" class="monitor-chart-svg" preserveAspectRatio="none">
                        <line x1="0" y1="${midY.toFixed(1)}" x2="${w}" y2="${midY.toFixed(1)}"
                            class="monitor-chart-midline" />
                        <polyline fill="none" stroke="${color}" stroke-width="2.5" points="${poly}" />
                    </svg>
                    <div class="monitor-chart-cursor" hidden></div>
                    <div class="monitor-chart-tip" hidden></div>
                </div>
            </div>
        `;
    }

    let hoveringChart = false;

    function updateHeroOnly() {
        const root = document.getElementById('monitorViewBody');
        if (!root || !state || state.error) return;

        const cards = root.querySelectorAll('.monitor-hero-card');
        if (cards.length >= 4) {
            const specs = [
                { cls: usageClass(state.cpuUsage), value: pct(state.cpuUsage), sub: 'Usage' },
                { cls: tempClass(state.cpuTemp), value: temp(state.cpuTemp), sub: 'Safe under 70°C' },
                {
                    cls: usageClass(state.memoryUsage),
                    value: pct(state.memoryUsage),
                    sub: `${state.memoryUsed || '—'} / ${state.memoryTotal || '—'}`
                },
                {
                    cls: usageClass(state.diskUsage),
                    value: pct(state.diskUsage),
                    sub: `${state.diskUsed || '—'} / ${state.diskTotal || '—'}`
                }
            ];
            specs.forEach((spec, i) => {
                const el = cards[i];
                el.className = `monitor-hero-card ${spec.cls}`;
                const value = el.querySelector('.monitor-hero-value');
                const sub = el.querySelector('.monitor-hero-sub');
                if (value) value.textContent = spec.value;
                if (sub) sub.textContent = spec.sub;
            });
        }

        const updated = root.querySelector('.monitor-updated');
        if (updated) updated.textContent = `Updated ${formatAgo(state.lastUpdate)}`;
    }

    function bindChartHovers(root) {
        if (!root) return;
        root.querySelectorAll('.monitor-chart').forEach((chart) => {
            const plot = chart.querySelector('.monitor-chart-plot');
            const tip = chart.querySelector('.monitor-chart-tip');
            const cursor = chart.querySelector('.monitor-chart-cursor');
            if (!plot || !tip || !cursor) return;

            let values = [];
            let times = [];
            try {
                values = JSON.parse(chart.dataset.values || '[]');
                times = JSON.parse(chart.dataset.times || '[]');
            } catch (_) {
                return;
            }
            if (values.length < 2) return;

            const unit = chart.dataset.unit || '';
            const min = Number(chart.dataset.min);
            const max = Number(chart.dataset.max);

            const hide = () => {
                tip.hidden = true;
                cursor.hidden = true;
                hoveringChart = false;
            };

            plot.addEventListener('mouseenter', () => {
                hoveringChart = true;
            });
            plot.addEventListener('mouseleave', hide);
            plot.addEventListener('mousemove', (e) => {
                hoveringChart = true;
                const rect = plot.getBoundingClientRect();
                if (rect.width <= 0) return;
                const xRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const index = Math.round(xRatio * (values.length - 1));
                const value = values[index];
                if (typeof value !== 'number') {
                    hide();
                    return;
                }

                const label = unit === '°C'
                    ? `${value.toFixed(0)}${unit}`
                    : `${Math.round(value)}${unit}`;
                const when = times[index] ? formatWhen(times[index]) : '';

                tip.hidden = false;
                cursor.hidden = false;
                tip.textContent = when ? `${label} · ${when}` : label;

                const leftPct = (index / (values.length - 1)) * 100;
                cursor.style.left = `${leftPct}%`;

                const tipWidth = tip.offsetWidth || 80;
                const tipLeft = Math.max(
                    8,
                    Math.min(rect.width - tipWidth - 8, (leftPct / 100) * rect.width - tipWidth / 2)
                );
                tip.style.left = `${tipLeft}px`;

                const span = (max - min) || 1;
                const yRatio = 1 - (Math.max(min, Math.min(max, value)) - min) / span;
                tip.style.top = `${Math.max(8, Math.min(rect.height - 28, yRatio * rect.height - 28))}px`;
            });
        });
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
                        ${sparkline(history.cpu, 'var(--primary-color)', {
                            min: 0, max: 100, unit: '%', timestamps: history.timestamps
                        })}
                    </section>
                    <section class="monitor-chart-card">
                        <h3 class="network-section-title">Temperature history</h3>
                        <div class="metric-bar"><span class="metric-bar-fill" style="width:${tempBarWidth(state.cpuTemp)}%"></span></div>
                        ${sparkline(history.temperature, 'var(--warning)', {
                            min: 20, max: 90, unit: '°C', timestamps: history.timestamps
                        })}
                    </section>
                    <section class="monitor-chart-card">
                        <h3 class="network-section-title">Memory history</h3>
                        <div class="metric-bar"><span class="metric-bar-fill" style="width:${barWidth(state.memoryUsage)}%"></span></div>
                        ${sparkline(history.memory, 'var(--success)', {
                            min: 0, max: 100, unit: '%', timestamps: history.timestamps
                        })}
                    </section>
                    <section class="monitor-chart-card">
                        <h3 class="network-section-title">Disk history</h3>
                        <div class="metric-bar"><span class="metric-bar-fill" style="width:${barWidth(state.diskUsage)}%"></span></div>
                        ${sparkline(history.disk, '#f59e0b', {
                            min: 0, max: 100, unit: '%', timestamps: history.timestamps
                        })}
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

        bindChartHovers(root);
    }

    function isMonitorVisible() {
        const panel = document.getElementById('monitorView');
        return Boolean(panel && !panel.hidden);
    }

    function onStats(data) {
        if (!data) return;
        state = data;
        // Skip expensive full-page rebuild while Monitor is not the active view
        if (!isMonitorVisible()) return;
        if (hoveringChart) {
            updateHeroOnly();
            return;
        }
        renderPage();
    }

    function ensure(manager) {
        if (pageBound) return;
        pageBound = true;

        // Seed from current widget instance if available
        if (manager && manager.moduleInstances && manager.moduleInstances.system_monitoring) {
            state = manager.moduleInstances.system_monitoring;
        }
        if (isMonitorVisible()) renderPage();
    }

    function onViewActivate(manager) {
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
        onViewActivate,
        handleMessage,
        onStats
    };
})();
