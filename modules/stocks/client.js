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

    function formatPrice(q) {
        if (!q || q.price == null || Number.isNaN(Number(q.price))) return '—';
        const n = Number(q.price);
        const cur = q.currency || '';
        const formatted = n >= 1000
            ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

    function loadSearch(q) {
        const query = String(q || '').trim();
        searchQuery = query;
        return fetch(`/api/stocks/search?q=${encodeURIComponent(query)}&limit=30`)
            .then((r) => r.json())
            .then((data) => {
                searchResults = data.results || [];
                renderPage();
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
        const w = 640;
        const h = 220;
        const pad = { t: 12, r: 12, b: 24, l: 48 };
        const prices = bars.map((b) => b.c);
        let min = Math.min(...prices);
        let max = Math.max(...prices);
        if (min === max) {
            min -= 1;
            max += 1;
        }
        const innerW = w - pad.l - pad.r;
        const innerH = h - pad.t - pad.b;
        const points = bars.map((b, i) => {
            const x = pad.l + (i / (bars.length - 1)) * innerW;
            const y = pad.t + (1 - (b.c - min) / (max - min)) * innerH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        const first = bars[0].c;
        const last = bars[bars.length - 1].c;
        const up = last >= first;
        const stroke = up ? 'var(--success)' : 'var(--danger)';
        return `
            <svg class="stocks-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Price chart">
                <line class="stocks-chart-grid" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h - pad.b}" />
                <line class="stocks-chart-grid" x1="${pad.l}" y1="${h - pad.b}" x2="${w - pad.r}" y2="${h - pad.b}" />
                <text class="stocks-chart-label" x="4" y="${pad.t + 4}">${esc(max.toFixed(2))}</text>
                <text class="stocks-chart-label" x="4" y="${h - pad.b}">${esc(min.toFixed(2))}</text>
                <polyline fill="none" stroke="${stroke}" stroke-width="2" points="${points}" />
            </svg>
        `;
    }

    function watchlistSection() {
        const rows = (state.watchlist || []).map((code) => {
            const q = quoteFor(code);
            const chg = formatChange(q);
            return `
                <div class="stocks-wl-row" data-stocks-select="${esc(code)}">
                    <div class="stocks-wl-main">
                        <span class="stocks-wl-code">${esc(code)}</span>
                        <span class="stocks-wl-price">${esc(formatPrice(q))}</span>
                        <span class="stocks-wl-change ${changeClass(q)}">${esc(chg)}</span>
                    </div>
                    <button type="button" class="kap-mini-btn stocks-wl-remove" data-stocks-remove="${esc(code)}">Remove</button>
                </div>
            `;
        }).join('') || '<div class="stocks-empty">Watchlist is empty — add tickers below or from Browse</div>';

        return `
            <section class="stocks-section">
                <h3 class="stocks-section-title">Watchlist</h3>
                <div class="stocks-wl-rows">${rows}</div>
                <div class="stocks-watchlist-edit">
                    <input type="text" id="stocksWatchlistInput" class="kap-input" placeholder="Add tickers e.g. THYAO, ASELS" maxlength="64" autocomplete="off" />
                    <button type="button" class="network-run-btn" id="stocksWatchlistAddBtn">Add</button>
                    <button type="button" class="network-run-btn stocks-secondary-btn" id="stocksRefreshBtn">Refresh</button>
                </div>
                <div class="stocks-meta-line">Updated ${esc(formatWhen(state.lastRefreshAt))}${state.refreshing ? ' · refreshing…' : ''}</div>
            </section>
        `;
    }

    function browseSection() {
        const items = (searchResults || []).map((item) => {
            const watched = (state.watchlist || []).includes(item.code);
            return `
                <div class="stocks-browse-row" data-stocks-select="${esc(item.code)}">
                    <div class="stocks-browse-main">
                        <span class="stocks-wl-code">${esc(item.code)}</span>
                        <span class="stocks-browse-name">${esc(item.name || '')}</span>
                    </div>
                    <button type="button" class="kap-mini-btn" data-stocks-add="${esc(item.code)}" ${watched ? 'disabled' : ''}>
                        ${watched ? 'Watching' : 'Add'}
                    </button>
                </div>
            `;
        }).join('') || '<div class="stocks-empty">No matches</div>';

        return `
            <section class="stocks-section">
                <h3 class="stocks-section-title">Browse</h3>
                <div class="stocks-watchlist-edit">
                    <input type="text" id="stocksSearchInput" class="kap-input" placeholder="Search BIST e.g. THYAO or Garanti" maxlength="48" autocomplete="off" value="${esc(searchQuery)}" />
                </div>
                <div class="stocks-browse-list">${items}</div>
            </section>
        `;
    }

    function detailSection() {
        if (!selectedSymbol) {
            return `
                <section class="stocks-section stocks-detail">
                    <h3 class="stocks-section-title">Detail</h3>
                    <div class="stocks-empty">Select a symbol from Watchlist or Browse</div>
                </section>
            `;
        }
        const q = quoteFor(selectedSymbol) || (chartData && chartData.meta) || {};
        const watched = (state.watchlist || []).includes(selectedSymbol);
        const rangeTabs = CHART_RANGES.map((r) => `
            <button type="button" class="stocks-range-btn${chartRange === r.id ? ' is-active' : ''}" data-stocks-range="${esc(r.id)}">${esc(r.label)}</button>
        `).join('');

        let chartBody = '<div class="stocks-empty">Loading chart…</div>';
        if (chartLoading) chartBody = '<div class="stocks-empty">Loading chart…</div>';
        else if (chartError) chartBody = `<div class="stocks-banner stocks-banner-error">${esc(chartError)}</div>`;
        else if (chartData) chartBody = buildSvgChart(chartData);

        return `
            <section class="stocks-section stocks-detail">
                <div class="stocks-detail-head">
                    <div>
                        <h3 class="stocks-section-title">${esc(selectedSymbol)}</h3>
                        <div class="stocks-detail-name">${esc(q.shortName || '')}</div>
                    </div>
                    <div class="stocks-detail-quote">
                        <div class="stocks-detail-price">${esc(formatPrice(q))}</div>
                        <div class="stocks-wl-change ${changeClass(q)}">${esc(formatChange(q))}</div>
                    </div>
                </div>
                <div class="stocks-range-tabs">${rangeTabs}</div>
                <div class="stocks-chart-wrap">${chartBody}</div>
                <div class="stocks-detail-actions">
                    <button type="button" class="network-run-btn" data-stocks-add="${esc(selectedSymbol)}" ${watched ? 'disabled' : ''}>
                        ${watched ? 'On watchlist' : 'Add to watchlist'}
                    </button>
                </div>
            </section>
        `;
    }

    function renderPage() {
        const root = document.getElementById('stocksViewBody');
        if (!root) return;
        const err = state.lastError
            ? `<div class="stocks-banner stocks-banner-error">${esc(state.lastError)}</div>`
            : '';
        root.innerHTML = `
            <div class="stocks-page">
                <div class="stocks-top">
                    <div>
                        <div class="stocks-kicker">Yahoo Finance · delayed</div>
                        <h2 class="stocks-title">Stocks</h2>
                    </div>
                </div>
                ${err}
                <p class="stocks-disclaimer">${esc(state.disclaimer || '')}</p>
                <div class="stocks-layout">
                    <div class="stocks-col">
                        ${watchlistSection()}
                        ${browseSection()}
                    </div>
                    <div class="stocks-col">
                        ${detailSection()}
                    </div>
                </div>
            </div>
        `;
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
        state = { ...state, ...incoming };
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
                    <span class="stocks-wl-price">${esc(formatPrice(q))}</span>
                    <span class="stocks-wl-change ${changeClass(q)}">${esc(formatChange(q))}</span>
                    <button type="button" class="kap-chip-remove" data-stocks-remove="${esc(code)}" title="Remove ${esc(code)}" aria-label="Remove ${esc(code)}">×</button>
                </div>
            `;
        }).join('') || '<div class="stocks-empty">Add a ticker</div>';

        return `
            <div class="stocks-watchlist-widget">
                <div class="stocks-widget-rows">${rows}</div>
                <div class="kap-wl-add">
                    <input type="text" class="kap-widget-input" data-stocks-add-input placeholder="THYAO" maxlength="12" autocomplete="off" draggable="false" />
                    <button type="button" class="kap-widget-add-btn" data-stocks-add-btn>Add</button>
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
