/**
 * Stocks module (browser) — watchlist quotes, BIST browse, SVG charts.
 * Separate from KAP.
 */
(function () {
    const VIEW = 'stocks';
    const CHART_RANGES = [
        { id: '1d', label: '1D' },
        { id: '5d', label: '5D' },
        { id: '1mo', label: '1M' },
        { id: '3mo', label: '3M' },
        { id: '1y', label: '1Y' }
    ];

    let state = {
        watchlist: [],
        quotes: [],
        quotesBySymbol: {},
        lastError: null,
        lastRefreshAt: null,
        refreshing: false,
        disclaimer: 'Not investment advice. Quotes from Yahoo Finance (delayed).'
    };

    let selectedSymbol = null;
    let chartRange = '1mo';
    let chartData = null;
    let chartError = null;
    let chartLoading = false;
    let searchQuery = '';
    let searchResults = [];
    let searchTimer = null;
    let pageBound = false;
    let widgetBound = false;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatWhen(timestamp) {
        if (!timestamp) return '—';
        return new Date(timestamp).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatPrice(q, { compact = false } = {}) {
        if (!q || q.price == null || Number.isNaN(Number(q.price))) return '—';
        const n = Number(q.price);
        const formatted = n >= 1000
            ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (compact) return formatted;
        const cur = q.currency || '';
        return cur ? `${formatted} ${cur}` : formatted;
    }

    function formatChange(q) {
        if (!q || q.changePercent == null || Number.isNaN(Number(q.changePercent))) return '';
        const n = Number(q.changePercent);
        const sign = n > 0 ? '+' : '';
        return `${sign}${n.toFixed(2)}%`;
    }

    function changeClass(q) {
        if (!q || q.changePercent == null) return '';
        const n = Number(q.changePercent);
        if (n > 0) return 'is-up';
        if (n < 0) return 'is-down';
        return 'is-flat';
    }

    function changeBadge(q) {
        const chg = formatChange(q);
        if (!chg) return '<span class="stocks-chg stocks-chg-pending">…</span>';
        return `<span class="stocks-chg ${changeClass(q)}">${esc(chg)}</span>`;
    }

    function marketLabel(q) {
        const s = String((q && q.marketState) || '').toUpperCase();
        if (s === 'REGULAR' || s === 'OPEN') return { text: 'Market open', cls: 'is-live' };
        if (s === 'PRE' || s === 'PREPRE') return { text: 'Pre-market', cls: 'is-session' };
        if (s === 'POST' || s === 'POSTPOST') return { text: 'After hours', cls: 'is-session' };
        if (s) return { text: 'Market closed', cls: 'is-closed' };
        return { text: 'Delayed feed', cls: 'is-session' };
    }

    function quoteFor(code) {
        return (state.quotesBySymbol && state.quotesBySymbol[code])
            || (state.quotes || []).find((q) => q.symbol === code)
            || null;
    }

    function send(manager, payload) {
        if (manager && typeof manager.sendMessage === 'function') {
            manager.sendMessage(payload);
            return true;
        }
        if (window.moduleManager && typeof window.moduleManager.sendMessage === 'function') {
            window.moduleManager.sendMessage(payload);
            return true;
        }
        return false;
    }

    function postWatchlist(action, body) {
        return fetch('/api/stocks/watchlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...body })
        }).then((r) => r.json());
    }

    function addCodes(raw) {
        const tickers = String(raw || '')
            .split(/[,;\s]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        if (!tickers.length) return Promise.resolve();
        return tickers.reduce(
            (chain, ticker) => chain.then(() => postWatchlist('add', { code: ticker })),
            Promise.resolve()
        );
    }

    function removeCode(code) {
        return postWatchlist('remove', { code });
    }

    function loadBrowseQuotes(codes) {
        const list = (codes || []).filter(Boolean).slice(0, 30);
        if (!list.length) return Promise.resolve();
        const missing = list.filter((code) => {
            const q = quoteFor(code);
            return !q || q.price == null;
        });
        if (!missing.length) {
            renderPage();
            return Promise.resolve();
        }
        return fetch(`/api/stocks/quote?symbols=${encodeURIComponent(missing.join(','))}`)
            .then((r) => r.json())
            .then((data) => {
                const quotes = data.quotes || [];
                state.quotesBySymbol = state.quotesBySymbol || {};
                quotes.forEach((q) => {
                    if (q && q.symbol) state.quotesBySymbol[q.symbol] = q;
                });
                renderPage();
            })
            .catch(() => {});
    }

    function loadSearch(q) {
        const query = String(q || '').trim();
        searchQuery = query;
        return fetch(`/api/stocks/search?q=${encodeURIComponent(query)}&limit=30`)
            .then((r) => r.json())
            .then((data) => {
                searchResults = data.results || [];
                renderPage();
                return loadBrowseQuotes(searchResults.map((item) => item.code));
            })
            .catch(() => {
                searchResults = [];
                renderPage();
            });
    }

    function selectSymbol(code) {
        selectedSymbol = code;
        chartData = null;
        chartError = null;
        renderPage();
        loadChart(code, chartRange);
    }

    function loadChart(symbol, range) {
        if (!symbol) return;
        chartLoading = true;
        chartError = null;
        renderPage();
        const url = `/api/stocks/chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`;
        fetch(url)
            .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
            .then(({ ok, data }) => {
                chartLoading = false;
                if (!ok || data.error) {
                    chartError = data.error || 'Chart failed';
                    chartData = null;
                } else {
                    chartData = data;
                    chartError = null;
                    if (data.meta && data.meta.symbol) {
                        state.quotesBySymbol = state.quotesBySymbol || {};
                        state.quotesBySymbol[data.meta.symbol] = data.meta;
                    }
                }
                renderPage();
            })
            .catch((err) => {
                chartLoading = false;
                chartError = err.message || String(err);
                chartData = null;
                renderPage();
            });
    }

    function buildSvgChart(history) {
        const bars = (history && history.bars) || [];
        if (bars.length < 2) {
            return '<div class="stocks-empty">Not enough history for a chart</div>';
        }
        const w = 720;
        const h = 260;
        const pad = { t: 16, r: 16, b: 28, l: 52 };
        const prices = bars.map((b) => b.c);
        let min = Math.min(...prices);
        let max = Math.max(...prices);
        const padY = (max - min) * 0.08 || 1;
        min -= padY;
        max += padY;
        const innerW = w - pad.l - pad.r;
        const innerH = h - pad.t - pad.b;
        const coords = bars.map((b, i) => {
            const x = pad.l + (i / (bars.length - 1)) * innerW;
            const y = pad.t + (1 - (b.c - min) / (max - min)) * innerH;
            return { x, y };
        });
        const linePoints = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const first = coords[0];
        const last = coords[coords.length - 1];
        const areaPoints = [
            `${first.x.toFixed(1)},${(pad.t + innerH).toFixed(1)}`,
            linePoints,
            `${last.x.toFixed(1)},${(pad.t + innerH).toFixed(1)}`
        ].join(' ');
        const up = bars[bars.length - 1].c >= bars[0].c;
        const tone = up ? 'up' : 'down';
        const mid = (min + max) / 2;
        const yMid = pad.t + (1 - (mid - min) / (max - min)) * innerH;
        return `
            <svg class="stocks-chart-svg stocks-chart-${tone}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Price chart">
                <defs>
                    <linearGradient id="stocksFill${tone}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" class="stocks-chart-fill-top" />
                        <stop offset="100%" class="stocks-chart-fill-bottom" />
                    </linearGradient>
                </defs>
                <line class="stocks-chart-grid" x1="${pad.l}" y1="${pad.t}" x2="${w - pad.r}" y2="${pad.t}" />
                <line class="stocks-chart-grid" x1="${pad.l}" y1="${yMid.toFixed(1)}" x2="${w - pad.r}" y2="${yMid.toFixed(1)}" />
                <line class="stocks-chart-grid" x1="${pad.l}" y1="${pad.t + innerH}" x2="${w - pad.r}" y2="${pad.t + innerH}" />
                <polygon class="stocks-chart-area" fill="url(#stocksFill${tone})" points="${areaPoints}" />
                <polyline class="stocks-chart-line" fill="none" points="${linePoints}" />
                <circle class="stocks-chart-dot" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4" />
                <text class="stocks-chart-label" x="8" y="${pad.t + 6}">${esc(max.toFixed(2))}</text>
                <text class="stocks-chart-label" x="8" y="${yMid.toFixed(1)}">${esc(mid.toFixed(2))}</text>
                <text class="stocks-chart-label" x="8" y="${pad.t + innerH}">${esc(min.toFixed(2))}</text>
            </svg>
        `;
    }

    function watchlistSection() {
        const codes = state.watchlist || [];
        let up = 0;
        let down = 0;
        codes.forEach((code) => {
            const q = quoteFor(code);
            if (!q || q.changePercent == null) return;
            if (q.changePercent > 0) up += 1;
            else if (q.changePercent < 0) down += 1;
        });

        const rows = codes.map((code) => {
            const q = quoteFor(code);
            const selected = selectedSymbol === code ? ' is-selected' : '';
            return `
                <div class="stocks-row stocks-wl-row${selected}" data-stocks-select="${esc(code)}">
                    <div class="stocks-row-left">
                        <span class="stocks-wl-code">${esc(code)}</span>
                        <span class="stocks-row-sub">${esc((q && q.shortName) || 'BIST')}</span>
                    </div>
                    <div class="stocks-row-right">
                        <span class="stocks-wl-price">${esc(formatPrice(q, { compact: true }))}</span>
                        ${changeBadge(q)}
                        <button type="button" class="stocks-icon-btn" data-stocks-remove="${esc(code)}" title="Remove" aria-label="Remove ${esc(code)}">×</button>
                    </div>
                </div>
            `;
        }).join('') || `
            <div class="stocks-empty-panel">
                <div class="stocks-empty-title">No tickers yet</div>
                <div class="stocks-empty-copy">Add symbols below or pick from Browse.</div>
            </div>
        `;

        return `
            <section class="stocks-section stocks-panel">
                <div class="stocks-section-head">
                    <h3 class="stocks-section-title">Watchlist</h3>
                    <div class="stocks-section-meta">
                        <span>${codes.length} symbol${codes.length === 1 ? '' : 's'}</span>
                        ${codes.length ? `<span class="stocks-mini-up">${up}↑</span><span class="stocks-mini-down">${down}↓</span>` : ''}
                    </div>
                </div>
                <div class="stocks-wl-rows">${rows}</div>
                <div class="stocks-watchlist-edit">
                    <input type="text" id="stocksWatchlistInput" class="stocks-input" placeholder="Add THYAO, ASELS…" maxlength="64" autocomplete="off" />
                    <button type="button" class="stocks-btn" id="stocksWatchlistAddBtn">Add</button>
                    <button type="button" class="stocks-btn stocks-btn-ghost" id="stocksRefreshBtn" title="Refresh quotes">↻</button>
                </div>
                <div class="stocks-meta-line">Updated ${esc(formatWhen(state.lastRefreshAt))}${state.refreshing ? ' · refreshing…' : ''}</div>
            </section>
        `;
    }

    function browseSection() {
        const items = (searchResults || []).map((item) => {
            const watched = (state.watchlist || []).includes(item.code);
            const q = quoteFor(item.code);
            const selected = selectedSymbol === item.code ? ' is-selected' : '';
            return `
                <div class="stocks-row stocks-browse-row${selected}" data-stocks-select="${esc(item.code)}">
                    <div class="stocks-row-left">
                        <span class="stocks-wl-code">${esc(item.code)}</span>
                        <span class="stocks-row-sub">${esc(item.name || '')}</span>
                    </div>
                    <div class="stocks-row-right">
                        <span class="stocks-wl-price">${esc(formatPrice(q, { compact: true }))}</span>
                        ${changeBadge(q)}
                        <button type="button" class="stocks-btn stocks-btn-tiny" data-stocks-add="${esc(item.code)}" ${watched ? 'disabled' : ''}>
                            ${watched ? '✓' : '+'}
                        </button>
                    </div>
                </div>
            `;
        }).join('') || '<div class="stocks-empty">No matches</div>';

        return `
            <section class="stocks-section stocks-panel">
                <div class="stocks-section-head">
                    <h3 class="stocks-section-title">Browse</h3>
                    <div class="stocks-section-meta">BIST</div>
                </div>
                <div class="stocks-search-wrap">
                    <input type="text" id="stocksSearchInput" class="stocks-input" placeholder="Search code or name…" maxlength="48" autocomplete="off" value="${esc(searchQuery)}" />
                </div>
                <div class="stocks-browse-list">${items}</div>
            </section>
        `;
    }

    function detailSection() {
        if (!selectedSymbol) {
            return `
                <section class="stocks-section stocks-panel stocks-detail stocks-detail-empty">
                    <div class="stocks-detail-placeholder">
                        <div class="stocks-detail-placeholder-mark">↗</div>
                        <div class="stocks-empty-title">Pick a symbol</div>
                        <div class="stocks-empty-copy">Select from your watchlist or browse BIST to open the chart.</div>
                    </div>
                </section>
            `;
        }
        const q = quoteFor(selectedSymbol) || (chartData && chartData.meta) || {};
        const watched = (state.watchlist || []).includes(selectedSymbol);
        const market = marketLabel(q);
        const rangeTabs = CHART_RANGES.map((r) => `
            <button type="button" class="stocks-range-btn${chartRange === r.id ? ' is-active' : ''}" data-stocks-range="${esc(r.id)}">${esc(r.label)}</button>
        `).join('');

        let chartBody = '<div class="stocks-chart-loading"><span></span><span></span><span></span></div>';
        if (chartLoading) chartBody = '<div class="stocks-chart-loading"><span></span><span></span><span></span></div>';
        else if (chartError) chartBody = `<div class="stocks-banner stocks-banner-error">${esc(chartError)}</div>`;
        else if (chartData) chartBody = buildSvgChart(chartData);

        const absChange = (q.change != null && !Number.isNaN(Number(q.change)))
            ? `${Number(q.change) > 0 ? '+' : ''}${Number(q.change).toFixed(2)}`
            : '';

        return `
            <section class="stocks-section stocks-panel stocks-detail">
                <div class="stocks-detail-head">
                    <div class="stocks-detail-identity">
                        <div class="stocks-detail-code">${esc(selectedSymbol)}</div>
                        <div class="stocks-detail-name">${esc(q.shortName || itemName(selectedSymbol) || '')}</div>
                        <div class="stocks-session ${esc(market.cls)}"><span class="stocks-session-dot"></span>${esc(market.text)}</div>
                    </div>
                    <div class="stocks-detail-quote ${changeClass(q)}">
                        <div class="stocks-detail-price">${esc(formatPrice(q))}</div>
                        <div class="stocks-detail-delta">
                            ${absChange ? `<span class="stocks-detail-abs">${esc(absChange)}</span>` : ''}
                            ${changeBadge(q)}
                        </div>
                    </div>
                </div>
                <div class="stocks-range-tabs">${rangeTabs}</div>
                <div class="stocks-chart-wrap">${chartBody}</div>
                <div class="stocks-detail-actions">
                    <button type="button" class="stocks-btn" data-stocks-add="${esc(selectedSymbol)}" ${watched ? 'disabled' : ''}>
                        ${watched ? 'On watchlist' : 'Add to watchlist'}
                    </button>
                </div>
            </section>
        `;
    }

    function itemName(code) {
        const hit = (searchResults || []).find((r) => r.code === code);
        return hit ? hit.name : '';
    }

    function renderPage() {
        const root = document.getElementById('stocksViewBody');
        if (!root) return;
        const active = document.activeElement;
        const focusId = active && (active.id === 'stocksSearchInput' || active.id === 'stocksWatchlistInput')
            ? active.id
            : null;
        const selStart = focusId ? active.selectionStart : null;
        const selEnd = focusId ? active.selectionEnd : null;

        const err = state.lastError
            ? `<div class="stocks-banner stocks-banner-error">${esc(state.lastError)}</div>`
            : '';
        root.innerHTML = `
            <div class="stocks-page">
                <header class="stocks-hero">
                    <div class="stocks-hero-copy">
                        <div class="stocks-kicker">Borsa İstanbul · Yahoo delayed</div>
                        <h2 class="stocks-title">Stocks</h2>
                        <p class="stocks-disclaimer">${esc(state.disclaimer || '')}</p>
                    </div>
                    <div class="stocks-hero-status${state.refreshing ? ' is-refreshing' : ''}">
                        <span class="stocks-live-dot"></span>
                        <span>${state.refreshing ? 'Refreshing' : 'Live poll'}</span>
                        <span class="stocks-hero-time">${esc(formatWhen(state.lastRefreshAt))}</span>
                    </div>
                </header>
                ${err}
                <div class="stocks-layout">
                    <div class="stocks-col stocks-col-side">
                        ${watchlistSection()}
                        ${browseSection()}
                    </div>
                    <div class="stocks-col stocks-col-main">
                        ${detailSection()}
                    </div>
                </div>
            </div>
        `;

        if (focusId) {
            const el = document.getElementById(focusId);
            if (el) {
                el.focus();
                if (typeof el.setSelectionRange === 'function' && selStart != null) {
                    try { el.setSelectionRange(selStart, selEnd); } catch (_) { /* ignore */ }
                }
            }
        }
    }

    function bindPage(manager) {
        if (pageBound) return;
        const root = document.getElementById('stocksViewBody');
        if (!root) return;
        pageBound = true;

        root.addEventListener('click', (ev) => {
            const t = ev.target;
            if (!(t instanceof Element)) return;

            const remove = t.closest('[data-stocks-remove]');
            if (remove) {
                ev.preventDefault();
                ev.stopPropagation();
                const code = remove.getAttribute('data-stocks-remove');
                if (!send(manager, { type: 'stocks_watchlist_remove', code })) {
                    removeCode(code).catch(() => {});
                }
                return;
            }

            const add = t.closest('[data-stocks-add]');
            if (add && !add.disabled) {
                ev.preventDefault();
                ev.stopPropagation();
                const code = add.getAttribute('data-stocks-add');
                if (!send(manager, { type: 'stocks_watchlist_add', code })) {
                    addCodes(code).catch(() => {});
                }
                return;
            }

            const rangeBtn = t.closest('[data-stocks-range]');
            if (rangeBtn) {
                ev.preventDefault();
                chartRange = rangeBtn.getAttribute('data-stocks-range') || '1mo';
                if (selectedSymbol) loadChart(selectedSymbol, chartRange);
                else renderPage();
                return;
            }

            const select = t.closest('[data-stocks-select]');
            if (select) {
                const code = select.getAttribute('data-stocks-select');
                if (code) selectSymbol(code);
            }
        });

        root.addEventListener('click', (ev) => {
            const t = ev.target;
            if (!(t instanceof Element)) return;
            if (t.id === 'stocksWatchlistAddBtn') {
                const input = document.getElementById('stocksWatchlistInput');
                const raw = (input && input.value) || '';
                if (!raw.trim()) return;
                addCodes(raw).then(() => {
                    if (input) input.value = '';
                    if (!send(manager, { type: 'stocks_refresh' })) {
                        fetch('/api/stocks/refresh', { method: 'POST' }).catch(() => {});
                    }
                }).catch(() => {});
            }
            if (t.id === 'stocksRefreshBtn') {
                if (!send(manager, { type: 'stocks_refresh' })) {
                    fetch('/api/stocks/refresh', { method: 'POST' }).catch(() => {});
                }
            }
        });

        root.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            const t = ev.target;
            if (!(t instanceof Element)) return;
            if (t.id === 'stocksWatchlistInput') {
                const btn = document.getElementById('stocksWatchlistAddBtn');
                if (btn) btn.click();
            }
        });

        root.addEventListener('input', (ev) => {
            const t = ev.target;
            if (!(t instanceof Element) || t.id !== 'stocksSearchInput') return;
            const q = t.value || '';
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => loadSearch(q), 200);
        });
    }

    function bindWidget(manager) {
        if (widgetBound) return;
        const grid = document.getElementById('modulesGrid');
        if (!grid) return;
        widgetBound = true;

        grid.addEventListener('click', (ev) => {
            const t = ev.target;
            if (!(t instanceof Element)) return;
            const remove = t.closest('[data-stocks-remove]');
            if (remove) {
                ev.preventDefault();
                const code = remove.getAttribute('data-stocks-remove');
                if (!send(manager, { type: 'stocks_watchlist_remove', code })) {
                    removeCode(code).catch(() => {});
                }
                return;
            }
            const addBtn = t.closest('[data-stocks-add-btn]');
            if (addBtn) {
                const wrap = addBtn.closest('.stocks-watchlist-widget');
                const input = wrap && wrap.querySelector('[data-stocks-add-input]');
                const raw = (input && input.value) || '';
                if (!raw.trim()) return;
                addCodes(raw).then(() => {
                    if (input) input.value = '';
                }).catch(() => {});
            }
        });

        grid.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            const t = ev.target;
            if (!(t instanceof Element) || !t.matches('[data-stocks-add-input]')) return;
            const wrap = t.closest('.stocks-watchlist-widget');
            const btn = wrap && wrap.querySelector('[data-stocks-add-btn]');
            if (btn) btn.click();
        });
    }

    function watchlistPayload() {
        return {
            watchlist: state.watchlist || [],
            quotes: state.quotes || [],
            quotesBySymbol: state.quotesBySymbol || {},
            lastRefreshAt: state.lastRefreshAt,
            lastError: state.lastError,
            refreshing: state.refreshing
        };
    }

    function syncWidgets() {
        if (!window.moduleManager) return;
        const instances = window.moduleManager.moduleInstances || {};
        Object.keys(instances).forEach((key) => {
            if (key !== 'stocks_watchlist' && !key.startsWith('stocks_watchlist')) return;
            instances[key] = watchlistPayload();
        });
        window.moduleManager.renderModules();
    }

    function applyState(incoming) {
        const prevQuotes = state.quotesBySymbol || {};
        state = { ...state, ...incoming };
        state.quotesBySymbol = {
            ...prevQuotes,
            ...(incoming.quotesBySymbol || {})
        };
        renderPage();
        syncWidgets();
    }

    function ensure(manager) {
        bindPage(manager);
        bindWidget(manager);
        renderPage();
        fetch('/api/stocks')
            .then((r) => r.json())
            .then((data) => applyState(data))
            .catch((err) => {
                state.lastError = err.message || String(err);
                renderPage();
            });
        if (!searchResults.length) {
            loadSearch('');
        }
    }

    function handleMessage(manager, message) {
        if (message.type === 'stocks_state' && message.data) {
            applyState(message.data);
            return true;
        }
        return false;
    }

    function getWatchlistSampleData() {
        return {
            watchlist: ['THYAO', 'ASELS'],
            quotes: [
                { symbol: 'THYAO', price: 320.5, changePercent: 1.2, currency: 'TRY' },
                { symbol: 'ASELS', price: 85.1, changePercent: -0.4, currency: 'TRY' }
            ],
            quotesBySymbol: {
                THYAO: { symbol: 'THYAO', price: 320.5, changePercent: 1.2, currency: 'TRY' },
                ASELS: { symbol: 'ASELS', price: 85.1, changePercent: -0.4, currency: 'TRY' }
            },
            lastRefreshAt: null,
            lastError: null,
            refreshing: false
        };
    }

    function renderWatchlistWidget(data) {
        const codes = (data && data.watchlist) || [];
        const by = (data && data.quotesBySymbol) || {};
        const list = (data && data.quotes) || [];
        const rows = codes.map((code) => {
            const q = by[code] || list.find((x) => x.symbol === code) || null;
            return `
                <div class="stocks-widget-row">
                    <span class="stocks-wl-code">${esc(code)}</span>
                    <span class="stocks-wl-price">${esc(formatPrice(q, { compact: true }))}</span>
                    ${changeBadge(q)}
                    <button type="button" class="stocks-icon-btn" data-stocks-remove="${esc(code)}" title="Remove ${esc(code)}" aria-label="Remove ${esc(code)}">×</button>
                </div>
            `;
        }).join('') || '<div class="stocks-empty">Add a ticker</div>';

        return `
            <div class="stocks-watchlist-widget">
                <div class="stocks-widget-rows">${rows}</div>
                <div class="stocks-widget-add">
                    <input type="text" class="stocks-input stocks-input-sm" data-stocks-add-input placeholder="THYAO" maxlength="12" autocomplete="off" draggable="false" />
                    <button type="button" class="stocks-btn stocks-btn-tiny" data-stocks-add-btn>+</button>
                </div>
            </div>
        `;
    }

    window.HomeHubModules = window.HomeHubModules || {};
    window.HomeHubModules.stocks = {
        id: 'stocks',
        type: 'stocks',
        label: 'Stocks',
        nav: true,
        view: VIEW,
        navLabel: 'Stocks',
        persistent: false,
        getSampleData: null,
        render: null,
        ensure,
        handleMessage
    };

    window.HomeHubModules.stocks_watchlist = {
        id: 'stocks_watchlist',
        type: 'stocks_watchlist',
        label: 'Stocks Watchlist',
        nav: false,
        persistent: false,
        getSampleData: getWatchlistSampleData,
        render: renderWatchlistWidget,
        ensure: null,
        handleMessage: null
    };
})();
