/**
 * PrismDesk (browser) — sidebar debug UI for live annotated camera feed + telemetry.
 */
(function () {
    const VIEW = 'prismdesk';
    const OVERLAY_KEYS = ['mat', 'object', 'hands'];

    let state = {
        fps: null,
        track_fps: null,
        mat_locked: false,
        hands: 0,
        object: null,
        capture: null,
        overlays: [],
        updatedAt: null,
        hasFrame: false,
        frameBytes: 0,
        frameUpdatedAt: null,
        config: {
            overlays: { mat: true, object: true, hands: true }
        }
    };
    let initialized = false;
    let pageBuilt = false;
    let managerRef = null;
    let lastFrameStamp = '';

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatNum(n, digits) {
        const value = Number(n);
        if (!Number.isFinite(value)) return '—';
        return value.toFixed(digits == null ? 1 : digits);
    }

    function formatBytes(n) {
        const value = Number(n);
        if (!Number.isFinite(value) || value <= 0) return '—';
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    }

    function formatWhen(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch (_) {
            return '—';
        }
    }

    function objectText() {
        return state.object && String(state.object).trim()
            ? String(state.object)
            : '—';
    }

    function refreshFrame() {
        const img = document.getElementById('prismdeskFrame');
        const empty = document.getElementById('prismdeskFrameEmpty');
        if (!state.hasFrame) {
            if (img) {
                img.hidden = true;
                img.removeAttribute('src');
            }
            if (empty) empty.hidden = false;
            lastFrameStamp = '';
            return;
        }

        const stamp = state.frameUpdatedAt || String(Date.now());
        if (empty) empty.hidden = true;
        if (img) img.hidden = false;

        if (stamp === lastFrameStamp && img && img.getAttribute('src')) return;
        lastFrameStamp = stamp;
        if (img) {
            img.src = `/api/prismdesk/latest.jpg?t=${encodeURIComponent(stamp)}`;
        }
    }

    function saveConfig(config) {
        fetch('/api/prismdesk/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                if (data && data.config) {
                    state.config = data.config;
                    updatePage();
                }
            })
            .catch((err) => {
                console.warn('[PrismDesk] Config save failed:', err.message);
            });
    }

    function bindOverlayToggles() {
        OVERLAY_KEYS.forEach((key) => {
            const el = document.getElementById(`prismdeskOverlay_${key}`);
            if (!el || el._prismBound) return;
            el._prismBound = true;
            el.addEventListener('change', () => {
                const overlays = {
                    mat: !!(state.config && state.config.overlays && state.config.overlays.mat),
                    object: !!(state.config && state.config.overlays && state.config.overlays.object),
                    hands: !!(state.config && state.config.overlays && state.config.overlays.hands)
                };
                overlays[key] = !!el.checked;
                saveConfig({ overlays });
            });
        });
    }

    function buildPage() {
        const body = document.getElementById('prismdeskViewBody');
        if (!body) return;

        body.innerHTML = `
            <div class="prismdesk-page">
                <div class="prismdesk-hero">
                    <div class="prismdesk-hero-copy">
                        <p class="prismdesk-kicker">Spatial AR</p>
                        <h3 class="prismdesk-title">PrismDesk</h3>
                        <p class="prismdesk-hero-sub" id="prismdeskHeroSub"></p>
                    </div>
                    <div class="prismdesk-status" id="prismdeskStatus">
                        <span class="prismdesk-status-dot"></span>
                        <span id="prismdeskStatusText">No frame</span>
                    </div>
                </div>

                <div class="prismdesk-chips">
                    <div class="prismdesk-chip" id="prismdeskChipMat">
                        <span class="prismdesk-chip-label">Mat</span>
                        <span class="prismdesk-chip-value" id="prismdeskValMat">—</span>
                    </div>
                    <div class="prismdesk-chip">
                        <span class="prismdesk-chip-label">Hands</span>
                        <span class="prismdesk-chip-value" id="prismdeskValHands">—</span>
                    </div>
                    <div class="prismdesk-chip">
                        <span class="prismdesk-chip-label">FPS</span>
                        <span class="prismdesk-chip-value" id="prismdeskValFps">—</span>
                    </div>
                    <div class="prismdesk-chip">
                        <span class="prismdesk-chip-label">Track FPS</span>
                        <span class="prismdesk-chip-value" id="prismdeskValTrackFps">—</span>
                    </div>
                    <div class="prismdesk-chip">
                        <span class="prismdesk-chip-label">Object</span>
                        <span class="prismdesk-chip-value" id="prismdeskValObject">—</span>
                    </div>
                    <div class="prismdesk-chip">
                        <span class="prismdesk-chip-label">Frame</span>
                        <span class="prismdesk-chip-value" id="prismdeskValBytes">—</span>
                    </div>
                </div>

                <div class="prismdesk-feed">
                    <div class="prismdesk-feed-empty" id="prismdeskFrameEmpty">
                        Waiting for PrismDesk to POST frames…
                    </div>
                    <img
                        id="prismdeskFrame"
                        class="prismdesk-frame"
                        alt="PrismDesk annotated camera feed"
                        hidden
                    />
                </div>

                <div class="prismdesk-section">
                    <div class="prismdesk-section-head">
                        <h4>Overlays (hub → desk)</h4>
                        <span class="prismdesk-meta">PrismDesk polls GET /api/prismdesk/config</span>
                    </div>
                    <div class="prismdesk-toggles">
                        ${OVERLAY_KEYS.map((key) => `
                            <label class="prismdesk-toggle">
                                <input type="checkbox" id="prismdeskOverlay_${key}" checked />
                                <span>${esc(key)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>

                <div class="prismdesk-meta-row">
                    <span id="prismdeskMetaState">State —</span>
                    <span id="prismdeskMetaFrame">Frame —</span>
                </div>
            </div>
        `;

        pageBuilt = true;
        bindOverlayToggles();
        updatePage();
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function updatePage() {
        if (!pageBuilt || !document.getElementById('prismdeskViewBody')) {
            buildPage();
            return;
        }

        const locked = state.mat_locked === true;
        const overlays = (state.config && state.config.overlays) || {};

        setText(
            'prismdeskHeroSub',
            state.capture
                ? `Live annotated feed · capture ${state.capture}`
                : 'Live annotated feed from the desk pipeline. Waiting for publisher.'
        );

        const status = document.getElementById('prismdeskStatus');
        if (status) {
            status.classList.toggle('is-live', !!state.hasFrame);
            status.classList.toggle('is-idle', !state.hasFrame);
        }
        setText('prismdeskStatusText', state.hasFrame ? 'Live' : 'No frame');

        const matChip = document.getElementById('prismdeskChipMat');
        if (matChip) {
            matChip.classList.toggle('prismdesk-chip-ok', locked);
            matChip.classList.toggle('prismdesk-chip-warn', !locked);
        }
        setText('prismdeskValMat', locked ? 'Locked' : 'Searching');
        setText('prismdeskValHands', String(state.hands != null ? state.hands : 0));
        setText('prismdeskValFps', formatNum(state.fps));
        setText('prismdeskValTrackFps', formatNum(state.track_fps));
        setText('prismdeskValObject', objectText());
        setText('prismdeskValBytes', formatBytes(state.frameBytes));
        setText('prismdeskMetaState', `State ${formatWhen(state.updatedAt)}`);
        setText('prismdeskMetaFrame', `Frame ${formatWhen(state.frameUpdatedAt)}`);

        OVERLAY_KEYS.forEach((key) => {
            const el = document.getElementById(`prismdeskOverlay_${key}`);
            if (el && document.activeElement !== el) {
                el.checked = overlays[key] !== false;
            }
        });

        refreshFrame();
    }

    function applyState(incoming) {
        if (!incoming || typeof incoming !== 'object') return;
        state = {
            ...state,
            ...incoming,
            config: incoming.config
                ? {
                    overlays: {
                        mat: true,
                        object: true,
                        hands: true,
                        ...(incoming.config.overlays || {})
                    }
                }
                : state.config
        };
        updatePage();
    }

    async function loadInitial() {
        try {
            const res = await fetch('/api/prismdesk/state');
            if (!res.ok) return;
            const data = await res.json();
            applyState(data);
        } catch (err) {
            console.warn('[PrismDesk] Failed to load state:', err.message);
        }
    }

    function ensure(manager) {
        managerRef = manager;
        if (!initialized) {
            initialized = true;
            loadInitial();
        }
    }

    function onViewActivate(manager) {
        ensure(manager);
        if (!pageBuilt) buildPage();
        else updatePage();
    }

    function handleMessage(manager, message) {
        if (message.type === 'prismdesk_update' && message.state) {
            managerRef = manager;
            applyState(message.state);
            return true;
        }
        return false;
    }

    window.HomeHubModules = window.HomeHubModules || {};
    window.HomeHubModules.prismdesk = {
        id: 'prismdesk',
        type: 'prismdesk',
        label: 'PrismDesk',
        nav: true,
        view: VIEW,
        navLabel: 'PrismDesk',
        persistent: false,
        getSampleData: null,
        render: null,
        ensure,
        onViewActivate,
        handleMessage
    };
})();
