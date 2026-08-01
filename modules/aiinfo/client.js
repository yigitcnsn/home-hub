/**
 * AI information (browser) — sidebar page + Home widgets for model / tokens.
 */
(function () {
    const VIEW = 'aiinfo';

    let state = {
        online: false,
        baseUrl: '',
        model: '—',
        models: [],
        contextLength: null,
        maxTokens: null,
        parameterSize: null,
        family: null,
        quantization: null,
        format: null,
        checkedAt: null,
        lastError: null,
        refreshing: false,
        disclaimer: ''
    };
    let initialized = false;
    let managerRef = null;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatWhen(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (_) {
            return '—';
        }
    }

    function formatTokens(n) {
        const value = Number(n);
        if (!Number.isFinite(value) || value <= 0) return '—';
        if (value >= 1000) {
            const k = value / 1000;
            return (Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, '')) + 'k';
        }
        return String(value);
    }

    function tokenWindow() {
        const n = state.contextLength != null ? state.contextLength : state.maxTokens;
        return Number(n) > 0 ? Number(n) : null;
    }

    function isAiWidgetKey(key) {
        return key === 'aiinfo_model' || key === 'aiinfo_tokens' ||
            (typeof key === 'string' && key.startsWith('aiinfo_'));
    }

    function modelPayload() {
        return {
            online: state.online,
            model: state.model,
            baseUrl: state.baseUrl,
            parameterSize: state.parameterSize,
            family: state.family,
            quantization: state.quantization,
            lastError: state.lastError,
            checkedAt: state.checkedAt
        };
    }

    function tokensPayload() {
        return {
            online: state.online,
            model: state.model,
            contextLength: tokenWindow(),
            maxTokens: tokenWindow(),
            lastError: state.lastError,
            checkedAt: state.checkedAt
        };
    }

    function syncWidgets(manager) {
        const m = manager || managerRef || window.moduleManager;
        if (!m || !m.moduleInstances) return;
        Object.keys(m.moduleInstances).forEach((key) => {
            if (!isAiWidgetKey(key)) return;
            if (key === 'aiinfo_tokens') {
                m.moduleInstances[key] = tokensPayload();
            } else {
                m.moduleInstances[key] = modelPayload();
            }
        });
        if (typeof m.saveInstances === 'function') m.saveInstances();
        if (typeof m.renderModules === 'function') m.renderModules();
    }

    function renderPage() {
        const body = document.getElementById('aiinfoViewBody');
        if (!body) return;

        const tokens = tokenWindow();
        const statusClass = state.online ? 'is-online' : 'is-offline';
        const statusLabel = state.online ? 'Online' : 'Offline';
        const installed = (state.models || []).slice(0, 12);

        body.innerHTML = `
            <div class="aiinfo-page">
                <div class="aiinfo-hero ${statusClass}">
                    <div class="aiinfo-hero-copy">
                        <p class="aiinfo-kicker">Ollama</p>
                        <h3 class="aiinfo-model-name">${esc(state.model || '—')}</h3>
                        <p class="aiinfo-hero-sub">
                            Configured model for Stocks AI classification
                        </p>
                    </div>
                    <div class="aiinfo-status ${statusClass}">
                        <span class="aiinfo-status-dot"></span>
                        <span>${esc(statusLabel)}</span>
                    </div>
                </div>

                <div class="aiinfo-grid">
                    <div class="aiinfo-stat">
                        <span class="aiinfo-stat-label">Context / tokens</span>
                        <span class="aiinfo-stat-value">${esc(formatTokens(tokens))}</span>
                        <span class="aiinfo-stat-hint">${tokens ? esc(String(tokens)) + ' tokens' : 'Not reported'}</span>
                    </div>
                    <div class="aiinfo-stat">
                        <span class="aiinfo-stat-label">Parameter size</span>
                        <span class="aiinfo-stat-value">${esc(state.parameterSize || '—')}</span>
                        <span class="aiinfo-stat-hint">${esc(state.family || 'Family unknown')}</span>
                    </div>
                    <div class="aiinfo-stat">
                        <span class="aiinfo-stat-label">Quantization</span>
                        <span class="aiinfo-stat-value">${esc(state.quantization || '—')}</span>
                        <span class="aiinfo-stat-hint">${esc(state.format || 'Format unknown')}</span>
                    </div>
                    <div class="aiinfo-stat">
                        <span class="aiinfo-stat-label">Endpoint</span>
                        <span class="aiinfo-stat-value aiinfo-stat-value-sm">${esc(state.baseUrl || '—')}</span>
                        <span class="aiinfo-stat-hint">Checked ${esc(formatWhen(state.checkedAt))}</span>
                    </div>
                </div>

                ${state.lastError ? `<div class="aiinfo-banner">${esc(state.lastError)}</div>` : ''}

                <div class="aiinfo-section">
                    <div class="aiinfo-section-head">
                        <h4>Model picker</h4>
                        <button type="button" class="aiinfo-refresh-btn" id="aiinfoRefreshBtn">
                            ${state.refreshing ? 'Refreshing…' : 'Refresh'}
                        </button>
                    </div>
                    <div class="aiinfo-picker">
                        <label class="aiinfo-picker-label" for="aiinfoModelSelect">Active model</label>
                        <div class="aiinfo-picker-row">
                            <select id="aiinfoModelSelect" class="aiinfo-model-select" ${installed.length ? '' : 'disabled'}>
                                ${installed.length
                                    ? installed.map((name) => `
                                        <option value="${esc(name)}" ${name === state.model ? 'selected' : ''}>${esc(name)}</option>
                                    `).join('')
                                    : `<option value="">No models available</option>`}
                            </select>
                            <button type="button" class="aiinfo-apply-btn" id="aiinfoApplyModelBtn" ${installed.length ? '' : 'disabled'}>
                                Apply
                            </button>
                        </div>
                        <p class="aiinfo-empty">Applies to Stocks AI classify and news sentiment without restart.</p>
                    </div>
                    ${installed.length
                        ? `<ul class="aiinfo-model-list">${installed.map((name) => `
                            <li class="${name === state.model ? 'is-active' : ''}" data-model="${esc(name)}" role="button" tabindex="0">${esc(name)}</li>
                        `).join('')}</ul>`
                        : '<p class="aiinfo-empty">No models reported by Ollama yet.</p>'}
                </div>

                <p class="aiinfo-disclaimer">${esc(state.disclaimer || 'Values reported by Ollama for the configured model.')}</p>
            </div>
        `;

        const btn = document.getElementById('aiinfoRefreshBtn');
        if (btn) {
            btn.disabled = !!state.refreshing;
            btn.addEventListener('click', () => requestRefresh());
        }

        const applyBtn = document.getElementById('aiinfoApplyModelBtn');
        const select = document.getElementById('aiinfoModelSelect');
        if (applyBtn && select) {
            applyBtn.addEventListener('click', () => requestSetModel(select.value));
        }

        document.querySelectorAll('.aiinfo-model-list li[data-model]').forEach((el) => {
            const pick = () => requestSetModel(el.dataset.model);
            el.addEventListener('click', pick);
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pick();
                }
            });
        });
    }

    function requestRefresh() {
        if (managerRef && managerRef.ws && managerRef.ws.readyState === WebSocket.OPEN) {
            managerRef.ws.send(JSON.stringify({ type: 'aiinfo_refresh' }));
            return;
        }
        fetch('/api/aiinfo/refresh', { method: 'POST' })
            .then((r) => r.json())
            .then((data) => {
                if (data && data.ok !== false) applyState(data);
            })
            .catch((err) => {
                console.warn('[AIInfo] Refresh failed:', err.message);
            });
    }

    function requestSetModel(model) {
        const next = String(model || '').trim();
        if (!next || next === state.model) return;

        if (managerRef && managerRef.ws && managerRef.ws.readyState === WebSocket.OPEN) {
            managerRef.ws.send(JSON.stringify({ type: 'aiinfo_set_model', model: next }));
            return;
        }
        fetch('/api/aiinfo/model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: next })
        })
            .then((r) => r.json())
            .then((data) => {
                if (data && data.ok !== false) applyState(data);
                else if (data && data.error) console.warn('[AIInfo] Set model failed:', data.error);
            })
            .catch((err) => {
                console.warn('[AIInfo] Set model failed:', err.message);
            });
    }

    function applyState(incoming) {
        state = { ...state, ...incoming };
        renderPage();
        syncWidgets();
    }

    async function loadInitial() {
        try {
            const res = await fetch('/api/aiinfo');
            if (!res.ok) return;
            const data = await res.json();
            applyState(data);
        } catch (e) {
            console.warn('[AIInfo] Failed to load:', e.message);
        }
    }

    function ensure(manager) {
        managerRef = manager;
        if (!initialized) {
            initialized = true;
            loadInitial();
        }
        syncWidgets(manager);
    }

    function onViewActivate(manager) {
        ensure(manager);
        renderPage();
    }

    function handleMessage(manager, message) {
        if (message.type === 'aiinfo_state' && message.data) {
            managerRef = manager;
            applyState(message.data);
            return true;
        }
        return false;
    }

    function getModelSampleData() {
        return {
            online: false,
            model: 'qwen2.5:3b',
            baseUrl: 'http://127.0.0.1:11434',
            parameterSize: '3B',
            family: 'qwen2',
            quantization: null,
            lastError: null,
            checkedAt: null
        };
    }

    function getTokensSampleData() {
        return {
            online: false,
            model: 'qwen2.5:3b',
            contextLength: 32768,
            maxTokens: 32768,
            lastError: null,
            checkedAt: null
        };
    }

    function renderModelWidget(data) {
        const d = data || {};
        const online = d.online === true;
        return `
            <div class="aiinfo-widget aiinfo-widget-model ${online ? 'is-online' : 'is-offline'}">
                <div class="aiinfo-widget-kicker">Model</div>
                <div class="aiinfo-widget-value">${esc(d.model || '—')}</div>
                <div class="aiinfo-widget-meta">
                    <span class="aiinfo-widget-dot"></span>
                    ${online ? 'Online' : 'Offline'}
                    ${d.parameterSize ? ' · ' + esc(d.parameterSize) : ''}
                </div>
            </div>
        `;
    }

    function renderTokensWidget(data) {
        const d = data || {};
        const tokens = d.contextLength != null ? d.contextLength : d.maxTokens;
        return `
            <div class="aiinfo-widget aiinfo-widget-tokens">
                <div class="aiinfo-widget-kicker">Token window</div>
                <div class="aiinfo-widget-value">${esc(formatTokens(tokens))}</div>
                <div class="aiinfo-widget-meta">
                    ${tokens ? esc(String(tokens)) + ' context tokens' : 'Not reported'}
                    ${d.model ? ' · ' + esc(d.model) : ''}
                </div>
            </div>
        `;
    }

    window.HomeHubModules = window.HomeHubModules || {};

    window.HomeHubModules.aiinfo = {
        id: 'aiinfo',
        type: 'aiinfo',
        label: 'AI Information',
        nav: true,
        view: VIEW,
        navLabel: 'AI Info',
        persistent: false,
        getSampleData: null,
        render: null,
        ensure,
        onViewActivate,
        handleMessage
    };

    window.HomeHubModules.aiinfo_model = {
        id: 'aiinfo_model',
        type: 'aiinfo_model',
        label: 'AI Model',
        nav: false,
        persistent: false,
        getSampleData: getModelSampleData,
        render: renderModelWidget,
        ensure: null,
        handleMessage: null
    };

    window.HomeHubModules.aiinfo_tokens = {
        id: 'aiinfo_tokens',
        type: 'aiinfo_tokens',
        label: 'AI Token Window',
        nav: false,
        persistent: false,
        getSampleData: getTokensSampleData,
        render: renderTokensWidget,
        ensure: null,
        handleMessage: null
    };
})();
