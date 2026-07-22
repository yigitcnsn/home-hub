/**
 * KAP module (browser) — watchlist + sentiment badges; paste-classify secondary.
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
        disclaimer: 'Not investment advice. For personal research only.'
    };
    let pageBound = false;

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

    function watchlistChips() {
        if (!state.watchlist.length) {
            return '<div class="kap-empty">Set KAP_WATCHLIST on the server (e.g. THYAO,ASELS)</div>';
        }
        return state.watchlist.map((code) => {
            const latest = (state.disclosures || []).find((d) => d.stock === code);
            const sent = latest && latest.classification ? latest.classification.sentiment : null;
            return `
                <div class="kap-chip">
                    <span class="kap-chip-code">${esc(code)}</span>
                    ${badge(sent)}
                </div>
            `;
        }).join('');
    }

    function disclosureRows() {
        const rows = state.disclosures || [];
        if (!rows.length) {
            return '<div class="kap-empty">No disclosures yet — click Scrape or wait for the schedule</div>';
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

                <section class="kap-section">
                    <h3 class="network-section-title">Watchlist</h3>
                    <div class="kap-watchlist">${watchlistChips()}</div>
                    <div class="kap-meta-line">Last scrape: ${esc(formatWhen(state.lastScrapeAt))}</div>
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
        if (manager.ws && manager.ws.readyState === WebSocket.OPEN) {
            manager.ws.send(JSON.stringify(payload));
            return true;
        }
        return false;
    }

    function bindPage(manager) {
        const view = document.getElementById('kapView');
        if (!view || pageBound) return;
        pageBound = true;

        view.addEventListener('click', (e) => {
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
                    alert('Stock and text required');
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
    }

    function applyState(incoming) {
        state = { ...state, ...incoming };
        renderPage();
        // Refresh widget instances if present
        if (window.moduleManager) {
            Object.keys(window.moduleManager.moduleInstances || {}).forEach((key) => {
                if (!key.startsWith('kap_')) return;
                window.moduleManager.moduleInstances[key] = {
                    watchlist: state.watchlist,
                    disclosures: state.disclosures.slice(0, 5),
                    lastError: state.lastError,
                    running: state.running,
                    queueLength: state.queueLength
                };
            });
            window.moduleManager.renderModules();
        }
    }

    function ensure(manager) {
        bindPage(manager);
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
            lastError: null,
            running: false,
            queueLength: 0
        };
    }

    function renderWidget(data) {
        const list = (data && data.disclosures) || [];
        const chips = ((data && data.watchlist) || []).slice(0, 6).map((code) => {
            const latest = list.find((d) => d.stock === code);
            const sent = latest && latest.classification ? latest.classification.sentiment : null;
            return `<span class="kap-chip-inline"><span>${esc(code)}</span>${badge(sent)}</span>`;
        }).join('') || '<span class="kap-empty">No watchlist</span>';

        return `
            <div class="kap-widget">
                <div class="kap-widget-chips">${chips}</div>
                <div class="kap-widget-footer">
                    ${(data && data.running) || (data && data.queueLength) ? 'Classifying…' : 'Watchlist'}
                </div>
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
