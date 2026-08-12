/**
 * Control Panel — hard kill / start for LLM-related background features.
 */
(function () {
    const VIEW = 'control';

    let state = {
        features: [],
        gates: {},
        updatedAt: null,
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

    function applyGates(gates) {
        window.HomeHubFeatureGates = gates && typeof gates === 'object' ? { ...gates } : {};
        if (managerRef && typeof managerRef.buildModuleNav === 'function') {
            const current = managerRef.currentView || 'home';
            managerRef.buildModuleNav();
            const gatedViews = new Set();
            (state.features || []).forEach((f) => {
                (f.navViews || []).forEach((v) => gatedViews.add(v));
            });
            if (gatedViews.has(current) && window.HomeHubFeatureGates[featureIdForView(current)] !== true) {
                managerRef.setView('home');
                document.querySelectorAll('.nav-item').forEach((nav) => {
                    nav.classList.toggle('active', nav.dataset.view === 'home');
                });
            } else {
                document.querySelectorAll('.nav-item').forEach((nav) => {
                    nav.classList.toggle('active', nav.dataset.view === current);
                });
            }
        }
        if (typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('homehub:features', {
                detail: { gates: window.HomeHubFeatureGates }
            }));
        }
    }

    function featureIdForView(view) {
        const hit = (state.features || []).find((f) => (f.navViews || []).includes(view));
        return hit ? hit.id : view;
    }

    function applyState(next) {
        state = {
            features: Array.isArray(next && next.features) ? next.features : [],
            gates: (next && next.gates) || {},
            updatedAt: (next && next.updatedAt) || null,
            disclaimer: (next && next.disclaimer) || ''
        };
        applyGates(state.gates);
        render();
    }

    function send(manager, payload) {
        if (manager && manager.ws && manager.ws.readyState === 1) {
            manager.ws.send(JSON.stringify(payload));
            return true;
        }
        return false;
    }

    function setFeature(id, enabled) {
        const manager = managerRef;
        if (!send(manager, { type: 'control_set_feature', id, enabled })) {
            fetch(`/api/control/features/${encodeURIComponent(id)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            })
                .then((r) => r.json())
                .then((data) => {
                    if (data && data.ok === false) {
                        console.warn('[Control]', data.error || 'set failed');
                        return;
                    }
                    applyState(data);
                })
                .catch((err) => console.warn('[Control]', err.message));
        }
    }

    function render() {
        const root = document.getElementById('controlViewBody');
        if (!root) return;

        const rows = (state.features || []).map((f) => {
            const on = f.enabled === true;
            const running = f.running === true;
            const status = on
                ? (running ? 'Running' : 'Starting…')
                : 'Killed';
            return `
                <article class="control-card${on ? ' is-on' : ' is-off'}">
                    <div class="control-card-main">
                        <div class="control-card-title">${esc(f.label || f.id)}</div>
                        <div class="control-card-desc">${esc(f.description || '')}</div>
                        <div class="control-card-status">
                            <span class="control-dot" aria-hidden="true"></span>
                            ${esc(status)}
                        </div>
                    </div>
                    <div class="control-card-actions">
                        <button type="button"
                            class="control-toggle${on ? ' is-on' : ''}"
                            data-control-id="${esc(f.id)}"
                            data-control-enabled="${on ? '0' : '1'}"
                            aria-pressed="${on ? 'true' : 'false'}">
                            ${on ? 'Kill' : 'Start'}
                        </button>
                    </div>
                </article>
            `;
        }).join('') || '<div class="control-empty">No controllable features registered.</div>';

        root.innerHTML = `
            <div class="control-page">
                <header class="control-hero">
                    <div class="control-kicker">Workers</div>
                    <h2 class="control-title">Control</h2>
                    <p class="control-lead">${esc(state.disclaimer || 'Close a feature to kill its timers and queues. Open to start them again.')}</p>
                </header>
                <div class="control-list">${rows}</div>
            </div>
        `;
    }

    function bindUi() {
        const root = document.getElementById('controlViewBody');
        if (!root || root.dataset.bound === '1') return;
        root.dataset.bound = '1';
        root.addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-control-id]');
            if (!btn) return;
            const id = btn.getAttribute('data-control-id');
            const enabled = btn.getAttribute('data-control-enabled') === '1';
            setFeature(id, enabled);
        });
    }

    async function loadInitial() {
        try {
            const res = await fetch('/api/control');
            if (!res.ok) return;
            const data = await res.json();
            applyState(data);
        } catch (e) {
            console.warn('[Control] Failed to load:', e.message);
        }
    }

    function ensure(manager) {
        managerRef = manager;
        if (!initialized) {
            initialized = true;
            bindUi();
            loadInitial();
        }
        render();
    }

    function onViewActivate(manager) {
        ensure(manager);
        if (!send(manager, { type: 'control_get' })) {
            loadInitial();
        }
    }

    function handleMessage(manager, message) {
        if (message.type === 'control_state' && message.data) {
            managerRef = manager;
            applyState(message.data);
            return true;
        }
        return false;
    }

    window.HomeHubModules = window.HomeHubModules || {};
    window.HomeHubModules.control = {
        id: 'control',
        type: 'control',
        label: 'Control',
        nav: true,
        view: VIEW,
        navLabel: 'Control',
        persistent: false,
        getSampleData: null,
        render: null,
        ensure,
        onViewActivate,
        handleMessage
    };
})();
