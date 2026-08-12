/**
 * Stocks AI module (browser) — watchlist editor, daily digest, scrape/classify.
 */
(function () {
    const VIEW = 'stocksai';
    let state = {
        watchlist: [],
        disclosures: [],
        classifications: [],
        jobs: [],
        queueLength: 0,
        running: false,
        lastError: null,
        lastScrapeAt: null,
        digest: { count: 0, good: 0, bad: 0, neutral: 0, pending: 0 },
        oracleOnline: true,
        eclipse: false,
        disclaimer: 'Not investment advice. For personal research only.'
    };
    let newsState = {
        enabled: false,
        lastPollAt: null,
        lastError: null,
        polling: false,
        classifyQueue: 0,
        headlines: [],
        disclaimer: ''
    };
    let aiSignals = [];
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

    function badge(sentiment) {
        const s = (sentiment || 'pending').toLowerCase();
        const label = s === 'good' || s === 'bad' || s === 'neutral' ? s : 'pending';
        return `<span class="stocksai-badge stocksai-badge-${esc(label)}">${esc(label)}</span>`;
    }

    function digestLine(digest) {
        const d = digest || state.digest || {};
        const count = Number(d.count) || 0;
        if (!count) {
            return 'Today: no filings yet';
        }
        const parts = [`Today: ${count} filing${count === 1 ? '' : 's'}`];
        if (d.good) parts.push(`${d.good} good`);
        if (d.bad) parts.push(`${d.bad} bad`);
        if (d.neutral) parts.push(`${d.neutral} neutral`);
        if (d.pending) parts.push(`${d.pending} pending`);
        return parts.join(' · ');
    }

    function watchlistEditor() {
        const rows = (state.watchlist || []).map((code) => {
            const latest = (state.disclosures || []).find((d) => d.stock === code);
            const sent = latest && latest.classification ? latest.classification.sentiment : null;
            return `
                <div class="stocksai-wl-row">
                    <div class="stocksai-wl-row-main">
                        <span class="stocksai-wl-row-code">${esc(code)}</span>
                        ${badge(sent)}
                    </div>
                    <button type="button" class="stocksai-mini-btn stocksai-wl-remove-btn" data-stocksai-remove="${esc(code)}">Remove</button>
                </div>
            `;
        }).join('') || '<div class="stocksai-empty">Watchlist is empty</div>';

        return `
            <div class="stocksai-wl-editor">
                <div class="stocksai-wl-rows">${rows}</div>
                <div class="stocksai-watchlist-edit">
                    <input type="text" id="stocksaiWatchlistInput" class="stocksai-input" placeholder="Add tickers e.g. THYAO, ASELS" maxlength="64" autocomplete="off" />
                    <button type="button" class="network-run-btn" id="stocksaiWatchlistAddBtn">Add</button>
                </div>
                <div class="stocksai-meta-line">Saved on the Pi · comma or space separated · last scrape ${esc(formatWhen(state.lastScrapeAt))}</div>
            </div>
        `;
    }

    function disclosureRows() {
        const rows = state.disclosures || [];
        if (!rows.length) {
            return '<div class="stocksai-empty">No disclosures yet — click Scrape or wait for the hourly scan</div>';
        }
        return rows.slice(0, 40).map((d) => {
            const c = d.classification;
            const conf = c && typeof c.confidence === 'number' ? `${Math.round(c.confidence * 100)}%` : '—';
            return `
                <div class="stocksai-row">
                    <div class="stocksai-row-main">
                        <div class="stocksai-row-top">
                            <strong>${esc(d.stock)}</strong>
                            ${badge(c && c.sentiment)}
                            <span class="stocksai-row-time">${esc(formatWhen(d.date))}</span>
                        </div>
                        <div class="stocksai-row-subject">${esc(d.subject || '—')}</div>
                        <div class="stocksai-row-summary">${esc((c && c.summary) || d.summary || '')}</div>
                        ${c && c.reason ? `<details class="stocksai-reason"><summary>Reason · ${esc(conf)}</summary><p>${esc(c.reason)}</p></details>` : ''}
                    </div>
                    <div class="stocksai-row-actions">
                        ${d.sourceUrl ? `<a class="stocksai-link" href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">KAP</a>` : ''}
                        <button type="button" class="stocksai-mini-btn" data-stocksai-classify-id="${esc(d.id)}" ${state.eclipse ? 'disabled' : ''}>${state.eclipse ? 'Offline' : 'Classify'}</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function jobLine() {
        if (state.eclipse) {
            return '<div class="stocksai-banner stocksai-banner-eclipse">Eclipse · oracle offline</div>';
        }
        if (state.lastError) {
            return `<div class="stocksai-banner stocksai-banner-error">${esc(state.lastError)}</div>`;
        }
        if (state.running || state.queueLength > 0) {
            return `<div class="stocksai-banner">Queue: ${esc(String(state.queueLength))} pending · ${state.running ? 'running' : 'idle'}</div>`;
        }
        return '';
    }

    function newsSection() {
        const enabled = !!newsState.enabled;
        const headlines = (newsState.headlines || []).slice(0, 12);
        const rows = headlines.map((h) => {
            const stocks = (h.stocks || []).join(', ') || '—';
            const c = h.lastClassification;
            return `
                <div class="stocksai-row stocksai-news-row">
                    <div class="stocksai-row-main">
                        <div class="stocksai-row-top">
                            <strong>${esc(stocks)}</strong>
                            ${c ? badge(c.sentiment) : badge('pending')}
                            <span class="stocksai-row-time">${esc(formatWhen(h.publishedAt || h.updatedAt))}</span>
                        </div>
                        <div class="stocksai-row-subject">${esc(h.title || '—')}</div>
                        <div class="stocksai-row-summary">${esc((c && c.summary) || h.description || '')}</div>
                    </div>
                    <div class="stocksai-row-actions">
                        ${h.link ? `<a class="stocksai-link" href="${esc(h.link)}" target="_blank" rel="noopener">Open</a>` : ''}
                    </div>
                </div>
            `;
        }).join('') || '<div class="stocksai-empty">No headlines yet — turn News RSS on, then Poll now</div>';

        return `
            <section class="stocksai-section stocksai-panel">
                <div class="stocksai-section-head">
                    <h3 class="network-section-title">News RSS</h3>
                    <div class="stocksai-section-actions">
                        <button type="button" class="stocksai-mini-btn${enabled ? ' is-on' : ''}" id="stocksAiNewsToggle">
                            ${enabled ? 'On' : 'Off'}
                        </button>
                        <button type="button" class="network-secondary-btn" id="stocksAiNewsPollBtn" ${enabled ? '' : 'disabled'}>Poll now</button>
                    </div>
                </div>
                <div class="stocksai-meta-line">
                    Investing.com headlines only · last poll ${esc(formatWhen(newsState.lastPollAt))}
                    ${newsState.polling ? ' · polling…' : ''}
                    ${newsState.classifyQueue ? ` · classify queue ${esc(String(newsState.classifyQueue))}` : ''}
                </div>
                ${newsState.lastError ? `<div class="stocksai-banner stocksai-banner-error">${esc(newsState.lastError)}</div>` : ''}
                <p class="stocksai-disclaimer">${esc(newsState.disclaimer || '')}</p>
                <div class="stocksai-list">${rows}</div>
            </section>
        `;
    }

    function signalsSection() {
        const rows = (aiSignals || []).slice(0, 20).map((s) => {
            const action = s.action || 'none';
            return `
                <div class="stocksai-row">
                    <div class="stocksai-row-main">
                        <div class="stocksai-row-top">
                            <strong>${esc(s.stock || '—')}</strong>
                            ${badge(s.sentiment || action)}
                            <span class="stocksai-source">${esc(s.source || '')}</span>
                            <span class="stocksai-row-time">${esc(formatWhen(s.at))}</span>
                        </div>
                        <div class="stocksai-row-summary">${esc(s.detail || s.summary || s.reason || '')}</div>
                    </div>
                </div>
            `;
        }).join('') || '<div class="stocksai-empty">No AI trade signals yet — classify a filing or enable News RSS</div>';

        return `
            <section class="stocksai-section stocksai-panel">
                <h3 class="network-section-title">AI → paper signals</h3>
                <div class="stocksai-meta-line">What the model decided for the paper desk (buys / sells / skips)</div>
                <div class="stocksai-list">${rows}</div>
            </section>
        `;
    }

    function renderPage() {
        const root = document.getElementById('stocksaiViewBody');
        if (!root) return;

        root.innerHTML = `
            <div class="stocksai-page">
                <div class="stocksai-top">
                    <div>
                        <div class="stocksai-kicker">Ollama · KAP · News</div>
                        <div class="stocksai-title">Stocks AI</div>
                    </div>
                    <div class="stocksai-actions">
                        <button type="button" class="network-secondary-btn" id="stocksaiScrapeWatchlistBtn">Scrape KAP watchlist</button>
                        <button type="button" class="network-run-btn" id="stocksaiScrapeGeneralBtn">KAP general scan</button>
                    </div>
                </div>

                ${jobLine()}

                <p class="stocksai-disclaimer">${esc(state.disclaimer)}</p>
                <div class="stocksai-digest-banner">${esc(digestLine(state.digest))}</div>

                ${newsSection()}
                ${signalsSection()}

                <section class="stocksai-section">
                    <h3 class="network-section-title">KAP watchlist</h3>
                    ${watchlistEditor()}
                </section>

                <section class="stocksai-section">
                    <h3 class="network-section-title">Latest KAP filings</h3>
                    <div class="stocksai-list">${disclosureRows()}</div>
                </section>

                <section class="stocksai-section">
                    <h3 class="network-section-title">Paste → classify</h3>
                    <div class="stocksai-paste">
                        <input type="text" id="stocksaiPasteStock" class="stocksai-input" placeholder="Stock e.g. THYAO" maxlength="12" ${state.eclipse ? 'disabled' : ''} />
                        <textarea id="stocksaiPasteText" class="stocksai-textarea" rows="4" placeholder="Konu: ...&#10;Özet: ..." ${state.eclipse ? 'disabled' : ''}></textarea>
                        <button type="button" class="network-run-btn" id="stocksaiPasteBtn" ${state.eclipse ? 'disabled' : ''}>${state.eclipse ? 'Oracle offline' : 'Classify text'}</button>
                    </div>
                </section>
            </div>
        `;
    }

    function send(manager, payload) {
        if (manager && manager.ws && manager.ws.readyState === WebSocket.OPEN) {
            manager.ws.send(JSON.stringify(payload));
            return true;
        }
        return false;
    }

    function postWatchlist(action, payload) {
        return fetch('/api/stocksai/watchlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload })
        })
            .then(async (r) => {
                const data = await r.json().catch(() => ({}));
                if (!r.ok) {
                    throw new Error((data && data.error) || `Watchlist ${action} failed (${r.status})`);
                }
                if (data && data.state) applyState(data.state);
                return data;
            });
    }

    function addWatchlistCode(manager, code) {
        const raw = String(code || '');
        const tickers = raw
            .split(/[,;\s]+/)
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);
        if (!tickers.length) return;

        // Prefer HTTP so edits work even when WS handlers are stale / missing
        tickers.reduce(
            (chain, ticker) => chain.then(() => postWatchlist('add', { code: ticker })),
            Promise.resolve()
        ).catch((err) => {
            if (manager && typeof manager.showAlert === 'function') {
                manager.showAlert(err.message || String(err), 'Watchlist');
            }
        });
    }

    function removeWatchlistCode(manager, code) {
        const ticker = String(code || '').trim().toUpperCase();
        if (!ticker) return;

        postWatchlist('remove', { code: ticker }).catch((err) => {
            if (manager && typeof manager.showAlert === 'function') {
                manager.showAlert(err.message || String(err), 'Watchlist');
            }
        });
    }

    function bindPage(manager) {
        const view = document.getElementById('stocksaiView');
        if (!view || pageBound) return;
        pageBound = true;

        view.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('[data-stocksai-remove]');
            if (removeBtn) {
                e.preventDefault();
                removeWatchlistCode(manager, removeBtn.getAttribute('data-stocksai-remove'));
                return;
            }
            if (e.target.closest('#stocksaiWatchlistAddBtn')) {
                const input = document.getElementById('stocksaiWatchlistInput');
                addWatchlistCode(manager, input && input.value);
                if (input) input.value = '';
                return;
            }
            if (e.target.closest('#stocksaiScrapeGeneralBtn')) {
                if (!send(manager, { type: 'stocksai_scrape', mode: 'general' })) {
                    fetch('/api/stocksai/scrape', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: 'general' })
                    }).catch(() => {});
                }
                return;
            }
            if (e.target.closest('#stocksaiScrapeWatchlistBtn')) {
                if (!send(manager, { type: 'stocksai_scrape', mode: 'watchlist' })) {
                    fetch('/api/stocksai/scrape', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: 'watchlist' })
                    }).catch(() => {});
                }
                return;
            }
            if (e.target.closest('#stocksaiPasteBtn')) {
                const stock = (document.getElementById('stocksaiPasteStock') || {}).value || '';
                const text = (document.getElementById('stocksaiPasteText') || {}).value || '';
                if (!stock.trim() || !text.trim()) {
                    if (manager && typeof manager.showAlert === 'function') {
                        manager.showAlert('Stock and text required', 'Stocks AI');
                    } else {
                        alert('Stock and text required');
                    }
                    return;
                }
                if (!send(manager, { type: 'stocksai_classify', stock: stock.trim(), text: text.trim() })) {
                    fetch('/api/stocksai/classify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ stock: stock.trim(), text: text.trim() })
                    }).catch(() => {});
                }
                return;
            }
            const classifyBtn = e.target.closest('[data-stocksai-classify-id]');
            if (classifyBtn) {
                const disclosureId = classifyBtn.getAttribute('data-stocksai-classify-id');
                if (!send(manager, { type: 'stocksai_classify', disclosureId })) {
                    fetch('/api/stocksai/classify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ disclosureId })
                    }).catch(() => {});
                }
                return;
            }
            if (e.target.closest('#stocksAiNewsToggle')) {
                const next = !newsState.enabled;
                if (!send(manager, { type: 'stocks_news_enabled', enabled: next })) {
                    fetch('/api/stocks/news/enabled', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enabled: next })
                    }).then((r) => r.json()).then((data) => {
                        if (data.news) applyNewsState(data.news);
                        else if (data.paper && data.paper.news) applyNewsState(data.paper.news);
                    }).catch(() => {});
                }
                return;
            }
            if (e.target.closest('#stocksAiNewsPollBtn')) {
                if (!send(manager, { type: 'stocks_news_poll' })) {
                    fetch('/api/stocks/news/poll', { method: 'POST' })
                        .then((r) => r.json())
                        .then((data) => {
                            if (data.status) applyNewsState(data.status);
                            fetchAiActivity();
                        })
                        .catch(() => {});
                }
            }
        });

        view.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (e.target && e.target.id === 'stocksaiWatchlistInput') {
                e.preventDefault();
                addWatchlistCode(manager, e.target.value);
                e.target.value = '';
            }
        });
    }

    function bindWidget(manager) {
        const grid = document.getElementById('modulesGrid');
        if (!grid || widgetBound) return;
        widgetBound = true;

        grid.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.stocksai-watchlist-widget [data-stocksai-remove]');
            if (removeBtn) {
                e.preventDefault();
                e.stopPropagation();
                removeWatchlistCode(manager, removeBtn.getAttribute('data-stocksai-remove'));
                return;
            }
            const addBtn = e.target.closest('[data-stocksai-add-btn]');
            if (addBtn) {
                e.preventDefault();
                e.stopPropagation();
                const wrap = addBtn.closest('.stocksai-watchlist-widget');
                const input = wrap && wrap.querySelector('[data-stocksai-add-input]');
                addWatchlistCode(manager, input && input.value);
                if (input) input.value = '';
            }
        });

        grid.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (!e.target || !e.target.matches('[data-stocksai-add-input]')) return;
            e.preventDefault();
            e.stopPropagation();
            addWatchlistCode(manager, e.target.value);
            e.target.value = '';
        });

        grid.addEventListener('mousedown', (e) => {
            if (e.target.closest('.stocksai-watchlist-widget input, .stocksai-watchlist-widget button')) {
                e.stopPropagation();
            }
        });
    }

    function isKapWidgetKey(key) {
        return key === 'stocksai' || key === 'kap' ||
            key === 'stocksai_digest' || key === 'kap_digest' ||
            key === 'stocksai_watchlist' || key === 'kap_watchlist' ||
            key.startsWith('stocksai_') || key.startsWith('kap_');
    }

    function digestPayload() {
        return {
            digest: state.digest || { count: 0, good: 0, bad: 0, neutral: 0, pending: 0 },
            lastError: state.lastError,
            lastScrapeAt: state.lastScrapeAt,
            running: state.running,
            queueLength: state.queueLength,
            eclipse: state.eclipse === true,
            oracleOnline: state.oracleOnline !== false
        };
    }

    function watchlistPayload() {
        return {
            watchlist: state.watchlist,
            disclosures: (state.disclosures || []).slice(0, 12),
            lastScrapeAt: state.lastScrapeAt,
            running: state.running,
            queueLength: state.queueLength,
            eclipse: state.eclipse === true,
            oracleOnline: state.oracleOnline !== false
        };
    }

    function syncKapWidgets() {
        if (!window.moduleManager) return;
        const instances = window.moduleManager.moduleInstances || {};
        Object.keys(instances).forEach((key) => {
            if (!isKapWidgetKey(key)) return;
            if (key === 'stocksai_watchlist' || key.startsWith('stocksai_watchlist') || key === 'kap_watchlist' || key.startsWith('kap_watchlist')) {
                instances[key] = watchlistPayload();
            } else {
                // stocksai_digest, legacy kap_* keys
                instances[key] = digestPayload();
            }
        });
        window.moduleManager.renderModules();
    }

    function migrateLegacyWidgets(manager) {
        if (!manager || !Array.isArray(manager.modules)) return;
        let changed = false;
        const mapType = {
            kap: 'stocksai_digest',
            kap_digest: 'stocksai_digest',
            kap_watchlist: 'stocksai_watchlist',
            stocksai: 'stocksai_digest'
        };

        manager.modules.forEach((m) => {
            if (!m || !mapType[m.type]) return;
            const nextType = mapType[m.type];
            if (m.type === nextType) return;
            m.type = nextType;
            const oldKey = m.instanceKey;
            m.instanceKey = manager.getInstanceKey(nextType);
            if (oldKey && manager.moduleInstances[oldKey] && !manager.moduleInstances[m.instanceKey]) {
                manager.moduleInstances[m.instanceKey] = manager.moduleInstances[oldKey];
                delete manager.moduleInstances[oldKey];
            }
            changed = true;
        });

        if (changed) {
            manager.saveModules();
            manager.saveInstances();
        }
    }

    function applyState(incoming) {
        state = { ...state, ...incoming };
        renderPage();
        syncKapWidgets();
    }

    function applyNewsState(incoming) {
        if (!incoming || typeof incoming !== 'object') return;
        newsState = { ...newsState, ...incoming };
        renderPage();
    }

    function applyPaperSignals(incoming) {
        if (!incoming || typeof incoming !== 'object') return;
        if (Array.isArray(incoming.signals)) {
            aiSignals = incoming.signals;
        }
        if (incoming.news) {
            newsState = { ...newsState, ...incoming.news };
        }
        renderPage();
    }

    function fetchAiActivity() {
        fetch('/api/stocks/news')
            .then((r) => r.json())
            .then((data) => applyNewsState(data))
            .catch(() => {});
        fetch('/api/stocks/paper')
            .then((r) => r.json())
            .then((data) => applyPaperSignals(data))
            .catch(() => {});
    }

    function ensure(manager) {
        migrateLegacyWidgets(manager);
        bindPage(manager);
        bindWidget(manager);
        renderPage();
        fetch('/api/stocksai')
            .then((r) => r.json())
            .then((data) => applyState(data))
            .catch(() => {});
        fetchAiActivity();
    }

    function handleMessage(manager, message) {
        if (message.type === 'stocksai_state' && message.data) {
            applyState(message.data);
            return true;
        }
        if (message.type === 'stocks_paper_state' && message.data) {
            applyPaperSignals(message.data);
            return true;
        }
        return false;
    }

    function getDigestSampleData() {
        return {
            digest: { count: 0, good: 0, bad: 0, neutral: 0, pending: 0 },
            lastError: null,
            lastScrapeAt: null,
            running: false,
            queueLength: 0,
            eclipse: false,
            oracleOnline: true
        };
    }

    function getWatchlistSampleData() {
        return {
            watchlist: [],
            disclosures: [],
            lastScrapeAt: null,
            running: false,
            queueLength: 0,
            eclipse: false,
            oracleOnline: true
        };
    }

    function renderDigestWidget(data) {
        const eclipse = data && data.eclipse === true;
        const digest = (data && data.digest) || {};
        const count = Number(digest.count) || 0;
        const good = Number(digest.good) || 0;
        const bad = Number(digest.bad) || 0;
        const neutral = Number(digest.neutral) || 0;
        const pending = Number(digest.pending) || 0;
        const busy = (data && data.running) || (data && data.queueLength);
        const footer = eclipse
            ? 'Oracle offline'
            : (data && data.lastError
                ? 'Error'
                : (busy ? 'Classifying…' : (data && data.lastScrapeAt ? formatWhen(data.lastScrapeAt) : 'Hourly scan')));

        return `
            <div class="stocksai-digest-widget${eclipse ? ' stocksai-eclipse' : ''}">
                ${eclipse ? '<div class="stocksai-eclipse-label">Oracle offline</div>' : ''}
                <div class="stocksai-digest-hero">
                    <span class="stocksai-digest-count">${esc(String(count))}</span>
                    <span class="stocksai-digest-label">today</span>
                </div>
                <div class="stocksai-digest-stats">
                    <div class="stocksai-digest-stat is-good">
                        <span class="stocksai-digest-stat-value">${esc(String(good))}</span>
                        <span class="stocksai-digest-stat-label">Good</span>
                    </div>
                    <div class="stocksai-digest-stat is-bad">
                        <span class="stocksai-digest-stat-value">${esc(String(bad))}</span>
                        <span class="stocksai-digest-stat-label">Bad</span>
                    </div>
                    <div class="stocksai-digest-stat is-neutral">
                        <span class="stocksai-digest-stat-value">${esc(String(neutral + pending))}</span>
                        <span class="stocksai-digest-stat-label">${pending && !neutral ? 'Pending' : 'Other'}</span>
                    </div>
                </div>
                <div class="stocksai-digest-footer">${esc(footer)}</div>
            </div>
        `;
    }

    function renderWatchlistWidget(data) {
        const eclipse = data && data.eclipse === true;
        const list = (data && data.disclosures) || [];
        const codes = (data && data.watchlist) || [];
        const chips = codes.map((code) => {
            const latest = list.find((d) => d.stock === code);
            const sent = latest && latest.classification ? latest.classification.sentiment : null;
            return `
                <div class="stocksai-wl-chip">
                    <span class="stocksai-wl-code">${esc(code)}</span>
                    ${badge(sent)}
                    <button type="button" class="stocksai-chip-remove" data-stocksai-remove="${esc(code)}" title="Remove ${esc(code)}" aria-label="Remove ${esc(code)}">×</button>
                </div>
            `;
        }).join('') || '<div class="stocksai-empty">Add a ticker</div>';

        return `
            <div class="stocksai-watchlist-widget${eclipse ? ' stocksai-eclipse' : ''}">
                ${eclipse ? '<div class="stocksai-eclipse-label">Oracle offline</div>' : ''}
                <div class="stocksai-wl-chips">${chips}</div>
                <div class="stocksai-wl-add">
                    <input type="text" class="stocksai-widget-input" data-stocksai-add-input placeholder="THYAO" maxlength="12" autocomplete="off" draggable="false" />
                    <button type="button" class="stocksai-widget-add-btn" data-stocksai-add-btn>Add</button>
                </div>
            </div>
        `;
    }

    window.HomeHubModules = window.HomeHubModules || {};
    window.HomeHubModules.stocksai = {
        id: 'stocksai',
        type: 'stocksai',
        label: 'Stocks AI',
        nav: true,
        view: VIEW,
        navLabel: 'Stocks AI',
        featureGate: 'stocksai',
        persistent: false,
        getSampleData: null,
        render: null,
        ensure,
        handleMessage
    };

    window.HomeHubModules.stocksai_digest = {
        id: 'stocksai_digest',
        type: 'stocksai_digest',
        label: 'Stocks AI Digest',
        nav: false,
        persistent: false,
        getSampleData: getDigestSampleData,
        render: renderDigestWidget,
        ensure: null,
        handleMessage: null
    };

    window.HomeHubModules.stocksai_watchlist = {
        id: 'stocksai_watchlist',
        type: 'stocksai_watchlist',
        label: 'Stocks AI Watchlist',
        nav: false,
        persistent: false,
        getSampleData: getWatchlistSampleData,
        render: renderWatchlistWidget,
        ensure: null,
        handleMessage: null
    };
})();
