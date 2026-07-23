/**
 * KAP module (browser) — watchlist editor, daily digest, scrape/classify.
 */
(function () {
    const VIEW = 'kap';
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
        disclaimer: 'Not investment advice. For personal research only.'
    };
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
        return `<span class="kap-badge kap-badge-${esc(label)}">${esc(label)}</span>`;
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

    function watchlistChips(editable) {
        if (!state.watchlist.length) {
            return '<div class="kap-empty">No tickers — add one below</div>';
        }
        return state.watchlist.map((code) => {
            const latest = (state.disclosures || []).find((d) => d.stock === code);
            const sent = latest && latest.classification ? latest.classification.sentiment : null;
            return `
                <div class="kap-chip">
                    <span class="kap-chip-code">${esc(code)}</span>
                    ${badge(sent)}
                    ${editable
        ? `<button type="button" class="kap-chip-remove" data-kap-remove="${esc(code)}" title="Remove ${esc(code)}" aria-label="Remove ${esc(code)}">×</button>`
        : ''}
                </div>
            `;
        }).join('');
    }

    function disclosureRows() {
        const rows = state.disclosures || [];
        if (!rows.length) {
            return '<div class="kap-empty">No disclosures yet — click Scrape or wait for the hourly scan</div>';
        }
        return rows.slice(0, 40).map((d) => {
            const c = d.classification;
            const conf = c && typeof c.confidence === 'number' ? `${Math.round(c.confidence * 100)}%` : '—';
            return `
                <div class="kap-row">
                    <div class="kap-row-main">
                        <div class="kap-row-top">
                            <strong>${esc(d.stock)}</strong>
                            ${badge(c && c.sentiment)}
                            <span class="kap-row-time">${esc(formatWhen(d.date))}</span>
                        </div>
                        <div class="kap-row-subject">${esc(d.subject || '—')}</div>
                        <div class="kap-row-summary">${esc((c && c.summary) || d.summary || '')}</div>
                        ${c && c.reason ? `<details class="kap-reason"><summary>Reason · ${esc(conf)}</summary><p>${esc(c.reason)}</p></details>` : ''}
                    </div>
                    <div class="kap-row-actions">
                        ${d.sourceUrl ? `<a class="kap-link" href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">KAP</a>` : ''}
                        <button type="button" class="kap-mini-btn" data-kap-classify-id="${esc(d.id)}">Classify</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function jobLine() {
        if (state.lastError) {
            return `<div class="kap-banner kap-banner-error">${esc(state.lastError)}</div>`;
        }
        if (state.running || state.queueLength > 0) {
            return `<div class="kap-banner">Queue: ${esc(String(state.queueLength))} pending · ${state.running ? 'running' : 'idle'}</div>`;
        }
        return '';
    }

    function renderPage() {
        const root = document.getElementById('kapViewBody');
        if (!root) return;

        root.innerHTML = `
            <div class="kap-page">
                <div class="kap-top">
                    <div>
                        <div class="kap-kicker">Disclosures</div>
                        <div class="kap-title">KAP</div>
                    </div>
                    <div class="kap-actions">
                        <button type="button" class="network-secondary-btn" id="kapScrapeWatchlistBtn">Scrape watchlist</button>
                        <button type="button" class="network-run-btn" id="kapScrapeGeneralBtn">General scan</button>
                    </div>
                </div>

                ${jobLine()}

                <p class="kap-disclaimer">${esc(state.disclaimer)}</p>
                <div class="kap-digest-banner">${esc(digestLine(state.digest))}</div>

                <section class="kap-section">
                    <h3 class="network-section-title">Watchlist</h3>
                    <div class="kap-watchlist">${watchlistChips(true)}</div>
                    <div class="kap-watchlist-edit">
                        <input type="text" id="kapWatchlistInput" class="kap-input" placeholder="Add ticker e.g. THYAO" maxlength="12" autocomplete="off" />
                        <button type="button" class="network-secondary-btn" id="kapWatchlistAddBtn">Add</button>
                    </div>
                    <div class="kap-meta-line">Last scrape: ${esc(formatWhen(state.lastScrapeAt))} · Auto-scan hourly</div>
                </section>

                <section class="kap-section">
                    <h3 class="network-section-title">Latest</h3>
                    <div class="kap-list">${disclosureRows()}</div>
                </section>

                <section class="kap-section">
                    <h3 class="network-section-title">Paste → classify</h3>
                    <div class="kap-paste">
                        <input type="text" id="kapPasteStock" class="kap-input" placeholder="Stock e.g. THYAO" maxlength="12" />
                        <textarea id="kapPasteText" class="kap-textarea" rows="4" placeholder="Konu: ...&#10;Özet: ..."></textarea>
                        <button type="button" class="network-run-btn" id="kapPasteBtn">Classify text</button>
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

    function addWatchlistCode(manager, code) {
        const ticker = String(code || '').trim().toUpperCase();
        if (!ticker) return;
        if (!send(manager, { type: 'kap_watchlist_add', code: ticker })) {
            fetch('/api/kap/watchlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add', code: ticker })
            })
                .then((r) => r.json())
                .then((data) => {
                    if (data && data.state) applyState(data.state);
                })
                .catch(() => {});
        }
    }

    function removeWatchlistCode(manager, code) {
        const ticker = String(code || '').trim().toUpperCase();
        if (!ticker) return;
        if (!send(manager, { type: 'kap_watchlist_remove', code: ticker })) {
            fetch('/api/kap/watchlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove', code: ticker })
            })
                .then((r) => r.json())
                .then((data) => {
                    if (data && data.state) applyState(data.state);
                })
                .catch(() => {});
        }
    }

    function bindPage(manager) {
        const view = document.getElementById('kapView');
        if (!view || pageBound) return;
        pageBound = true;

        view.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('[data-kap-remove]');
            if (removeBtn) {
                e.preventDefault();
                removeWatchlistCode(manager, removeBtn.getAttribute('data-kap-remove'));
                return;
            }
            if (e.target.closest('#kapWatchlistAddBtn')) {
                const input = document.getElementById('kapWatchlistInput');
                addWatchlistCode(manager, input && input.value);
                if (input) input.value = '';
                return;
            }
            if (e.target.closest('#kapScrapeGeneralBtn')) {
                if (!send(manager, { type: 'kap_scrape', mode: 'general' })) {
                    fetch('/api/kap/scrape', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: 'general' })
                    }).catch(() => {});
                }
                return;
            }
            if (e.target.closest('#kapScrapeWatchlistBtn')) {
                if (!send(manager, { type: 'kap_scrape', mode: 'watchlist' })) {
                    fetch('/api/kap/scrape', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: 'watchlist' })
                    }).catch(() => {});
                }
                return;
            }
            if (e.target.closest('#kapPasteBtn')) {
                const stock = (document.getElementById('kapPasteStock') || {}).value || '';
                const text = (document.getElementById('kapPasteText') || {}).value || '';
                if (!stock.trim() || !text.trim()) {
                    if (manager && typeof manager.showAlert === 'function') {
                        manager.showAlert('Stock and text required', 'KAP');
                    } else {
                        alert('Stock and text required');
                    }
                    return;
                }
                if (!send(manager, { type: 'kap_classify', stock: stock.trim(), text: text.trim() })) {
                    fetch('/api/kap/classify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ stock: stock.trim(), text: text.trim() })
                    }).catch(() => {});
                }
                return;
            }
            const classifyBtn = e.target.closest('[data-kap-classify-id]');
            if (classifyBtn) {
                const disclosureId = classifyBtn.getAttribute('data-kap-classify-id');
                if (!send(manager, { type: 'kap_classify', disclosureId })) {
                    fetch('/api/kap/classify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ disclosureId })
                    }).catch(() => {});
                }
            }
        });

        view.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (e.target && e.target.id === 'kapWatchlistInput') {
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
            const removeBtn = e.target.closest('.kap-widget [data-kap-remove]');
            if (removeBtn) {
                e.preventDefault();
                e.stopPropagation();
                removeWatchlistCode(manager, removeBtn.getAttribute('data-kap-remove'));
                return;
            }
            const addBtn = e.target.closest('[data-kap-add-btn]');
            if (addBtn) {
                e.preventDefault();
                e.stopPropagation();
                const wrap = addBtn.closest('.kap-widget');
                const input = wrap && wrap.querySelector('[data-kap-add-input]');
                addWatchlistCode(manager, input && input.value);
                if (input) input.value = '';
            }
        });

        grid.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (!e.target || !e.target.matches('[data-kap-add-input]')) return;
            e.preventDefault();
            e.stopPropagation();
            addWatchlistCode(manager, e.target.value);
            e.target.value = '';
        });

        grid.addEventListener('mousedown', (e) => {
            if (e.target.closest('.kap-widget input, .kap-widget button')) {
                e.stopPropagation();
            }
        });
    }

    function widgetPayload() {
        return {
            watchlist: state.watchlist,
            disclosures: (state.disclosures || []).slice(0, 5),
            digest: state.digest || { count: 0, good: 0, bad: 0, neutral: 0, pending: 0 },
            lastError: state.lastError,
            lastScrapeAt: state.lastScrapeAt,
            running: state.running,
            queueLength: state.queueLength
        };
    }

    function applyState(incoming) {
        state = { ...state, ...incoming };
        renderPage();
        if (window.moduleManager) {
            Object.keys(window.moduleManager.moduleInstances || {}).forEach((key) => {
                if (key !== 'kap' && !key.startsWith('kap_')) return;
                window.moduleManager.moduleInstances[key] = widgetPayload();
            });
            window.moduleManager.renderModules();
        }
    }

    function ensure(manager) {
        bindPage(manager);
        bindWidget(manager);
        renderPage();
        fetch('/api/kap')
            .then((r) => r.json())
            .then((data) => applyState(data))
            .catch(() => {});
    }

    function handleMessage(manager, message) {
        if (message.type === 'kap_state' && message.data) {
            applyState(message.data);
            return true;
        }
        return false;
    }

    function getSampleData() {
        return {
            watchlist: [],
            disclosures: [],
            digest: { count: 0, good: 0, bad: 0, neutral: 0, pending: 0 },
            lastError: null,
            lastScrapeAt: null,
            running: false,
            queueLength: 0
        };
    }

    function renderWidget(data) {
        const list = (data && data.disclosures) || [];
        const digest = (data && data.digest) || {};
        const chips = ((data && data.watchlist) || []).slice(0, 8).map((code) => {
            const latest = list.find((d) => d.stock === code);
            const sent = latest && latest.classification ? latest.classification.sentiment : null;
            return `
                <span class="kap-chip-inline">
                    <span>${esc(code)}</span>
                    ${badge(sent)}
                    <button type="button" class="kap-chip-remove" data-kap-remove="${esc(code)}" title="Remove ${esc(code)}" aria-label="Remove ${esc(code)}">×</button>
                </span>
            `;
        }).join('') || '<span class="kap-empty">No watchlist</span>';

        const status = (data && data.running) || (data && data.queueLength)
            ? 'Classifying…'
            : (data && data.lastScrapeAt ? `Scanned ${formatWhen(data.lastScrapeAt)}` : 'Hourly scan');

        return `
            <div class="kap-widget">
                <div class="kap-widget-digest">${esc(digestLine(digest))}</div>
                <div class="kap-widget-chips">${chips}</div>
                <div class="kap-widget-add">
                    <input type="text" class="kap-widget-input" data-kap-add-input placeholder="Add" maxlength="12" autocomplete="off" draggable="false" />
                    <button type="button" class="kap-widget-add-btn" data-kap-add-btn>Add</button>
                </div>
                <div class="kap-widget-footer">${esc(status)}</div>
            </div>
        `;
    }

    window.HomeHubModules = window.HomeHubModules || {};
    window.HomeHubModules.kap = {
        id: 'kap',
        type: 'kap',
        label: 'KAP',
        nav: true,
        view: VIEW,
        navLabel: 'KAP',
        persistent: false,
        getSampleData,
        render: renderWidget,
        ensure,
        handleMessage
    };
})();
