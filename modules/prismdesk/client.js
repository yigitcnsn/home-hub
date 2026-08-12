/**
 * PrismDesk (browser) — sidebar debug UI for live multi-layer camera feeds + telemetry.
 */
(function () {
    const VIEW = 'prismdesk';
    const OVERLAY_KEYS = ['mat', 'object', 'hands'];
    const LAYER_IDS = ['final', 'raw', 'mat', 'hands', 'object'];
    const LAYER_LABELS = {
        final: 'Final',
        raw: 'Raw',
        mat: 'Mat',
        hands: 'Hands',
        object: 'Object'
    };

    function emptyLayersMeta() {
        const meta = {};
        LAYER_IDS.forEach((id) => {
            meta[id] = { hasFrame: false, bytes: 0, updatedAt: null };
        });
        return meta;
    }

    let state = {
        fps: null,
        track_fps: null,
        mat_locked: false,
        hands: 0,
        object: null,
        capture: null,
        overlays: [],
        layers: [],
        rotate: null,
        updatedAt: null,
        hasFrame: false,
        frameBytes: 0,
        frameUpdatedAt: null,
        layersMeta: emptyLayersMeta(),
        config: {
            overlays: { mat: true, object: true, hands: true },
            projector: { mat: true, object: true, hands: true },
            browser: { mat: true, object: true, hands: true }
        }
    };
    let initialized = false;
    let pageBuilt = false;
    let managerRef = null;
    const lastFrameStamps = Object.create(null);

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

    function layerMeta(layer) {
        const meta = state.layersMeta && state.layersMeta[layer];
        if (meta && typeof meta === 'object') return meta;
        if (layer === 'final') {
            return {
                hasFrame: !!state.hasFrame,
                bytes: state.frameBytes || 0,
                updatedAt: state.frameUpdatedAt || null
            };
        }
        return { hasFrame: false, bytes: 0, updatedAt: null };
    }

    function anyLayerLive() {
        return LAYER_IDS.some((id) => layerMeta(id).hasFrame);
    }

    function refreshLayer(layer) {
        const panel = document.getElementById(`prismdeskPanel_${layer}`);
        const img = document.getElementById(`prismdeskFrame_${layer}`);
        const empty = document.getElementById(`prismdeskEmpty_${layer}`);
        const meta = layerMeta(layer);
        const has = !!meta.hasFrame;

        if (panel) panel.classList.toggle('is-live', has);

        if (!has) {
            if (img) {
                img.hidden = true;
                img.removeAttribute('src');
            }
            if (empty) empty.hidden = false;
            lastFrameStamps[layer] = '';
            return;
        }

        const stamp = meta.updatedAt || String(Date.now());
        if (empty) empty.hidden = true;
        if (img) img.hidden = false;

        if (stamp === lastFrameStamps[layer] && img && img.getAttribute('src')) return;
        lastFrameStamps[layer] = stamp;
        if (img) {
            img.src = `/api/prismdesk/latest.jpg/${encodeURIComponent(layer)}?t=${encodeURIComponent(stamp)}`;
        }
    }

    function refreshFrames() {
        LAYER_IDS.forEach(refreshLayer);
    }

    function currentSurfaceFlags(surface) {
        const cfg = state.config || {};
        const block = (cfg[surface] && typeof cfg[surface] === 'object')
            ? cfg[surface]
            : (cfg.overlays || {});
        return {
            mat: block.mat !== false,
            object: block.object !== false,
            hands: block.hands !== false
        };
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
        ['projector', 'browser'].forEach((surface) => {
            OVERLAY_KEYS.forEach((key) => {
                const el = document.getElementById(`prismdeskOverlay_${surface}_${key}`);
                if (!el || el._prismBound) return;
                el._prismBound = true;
                el.addEventListener('change', () => {
                    const projector = currentSurfaceFlags('projector');
                    const browser = currentSurfaceFlags('browser');
                    const target = surface === 'projector' ? projector : browser;
                    target[key] = !!el.checked;
                    // Keep legacy overlays = projector for older desks.
                    saveConfig({
                        projector,
                        browser,
                        overlays: { ...projector }
                    });
                });
            });
        });
    }

    function toggleGroupMarkup(surface, title, hint) {
        return `
            <div class="prismdesk-toggle-group" data-surface="${esc(surface)}">
                <div class="prismdesk-toggle-group-head">
                    <strong>${esc(title)}</strong>
                    <span class="prismdesk-meta">${esc(hint)}</span>
                </div>
                <div class="prismdesk-toggles">
                    ${OVERLAY_KEYS.map((key) => `
                        <label class="prismdesk-toggle">
                            <input type="checkbox" id="prismdeskOverlay_${esc(surface)}_${esc(key)}" checked />
                            <span>${esc(key)}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function panelMarkup(layer) {
        const isPrimary = layer === 'final';
        const label = LAYER_LABELS[layer] || layer;
        return `
            <div
                class="prismdesk-panel${isPrimary ? ' prismdesk-panel-primary' : ''}"
                id="prismdeskPanel_${esc(layer)}"
                data-layer="${esc(layer)}"
            >
                <div class="prismdesk-panel-head">
                    <span class="prismdesk-panel-title">${esc(label)}</span>
                    <span class="prismdesk-panel-meta" id="prismdeskPanelMeta_${esc(layer)}">—</span>
                </div>
                <div class="prismdesk-feed">
                    <div class="prismdesk-feed-empty" id="prismdeskEmpty_${esc(layer)}">
                        <p class="prismdesk-feed-empty-title">No ${esc(label.toLowerCase())} frame</p>
                        <p class="prismdesk-feed-empty-hint">
                            ${isPrimary
                                ? 'Start the desk pipeline with home-hub publish enabled. Layer JPEGs will appear here.'
                                : `Waiting for desk to post the ${esc(layer)} layer.`}
                        </p>
                    </div>
                    <img
                        id="prismdeskFrame_${esc(layer)}"
                        class="prismdesk-frame"
                        alt="PrismDesk ${esc(label)} layer"
                        hidden
                    />
                </div>
            </div>
        `;
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

                <div class="prismdesk-layers">
                    ${panelMarkup('final')}
                    <div class="prismdesk-layers-grid">
                        ${['raw', 'mat', 'hands', 'object'].map(panelMarkup).join('')}
                    </div>
                </div>

                <div class="prismdesk-section">
                    <div class="prismdesk-section-head">
                        <h4>Overlay controls</h4>
                        <span class="prismdesk-meta">separate projector HUD vs browser debug</span>
                    </div>
                    ${toggleGroupMarkup('projector', 'Projector HUD', 'drawn on HY300')}
                    ${toggleGroupMarkup('browser', 'Browser final', 'composed into Final panel')}
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
        const projector = currentSurfaceFlags('projector');
        const browser = currentSurfaceFlags('browser');
        const live = anyLayerLive() || !!state.hasFrame;

        setText(
            'prismdeskHeroSub',
            state.capture
                ? `Multi-layer debug feeds · capture ${state.capture}`
                : 'Operator console for the desk pipeline. Waiting for layer publishers.'
        );

        const status = document.getElementById('prismdeskStatus');
        if (status) {
            status.classList.toggle('is-live', live);
            status.classList.toggle('is-idle', !live);
        }
        setText('prismdeskStatusText', live ? 'Live' : 'Idle');

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
        setText('prismdeskMetaFrame', `Final ${formatWhen(state.frameUpdatedAt)}`);

        LAYER_IDS.forEach((layer) => {
            const meta = layerMeta(layer);
            setText(
                `prismdeskPanelMeta_${layer}`,
                meta.hasFrame ? formatBytes(meta.bytes) : 'empty'
            );
        });

        OVERLAY_KEYS.forEach((key) => {
            const projEl = document.getElementById(`prismdeskOverlay_projector_${key}`);
            if (projEl && document.activeElement !== projEl) {
                projEl.checked = projector[key] !== false;
            }
            const browserEl = document.getElementById(`prismdeskOverlay_browser_${key}`);
            if (browserEl && document.activeElement !== browserEl) {
                browserEl.checked = browser[key] !== false;
            }
            const layerPanel = document.getElementById(`prismdeskPanel_${key}`);
            if (layerPanel) {
                layerPanel.classList.toggle('is-muted', browser[key] === false);
            }
        });

        refreshFrames();
    }

    function normalizeLayersMeta(incoming) {
        const next = emptyLayersMeta();
        const src = (incoming && incoming.layersMeta && typeof incoming.layersMeta === 'object')
            ? incoming.layersMeta
            : {};
        LAYER_IDS.forEach((id) => {
            const item = src[id];
            if (item && typeof item === 'object') {
                next[id] = {
                    hasFrame: !!item.hasFrame,
                    bytes: Number.isFinite(Number(item.bytes)) ? Number(item.bytes) : 0,
                    updatedAt: item.updatedAt || null
                };
            }
        });
        // Backward compat: if layersMeta.final missing but legacy hasFrame is set, mirror onto final.
        if (!src.final && incoming && incoming.hasFrame) {
            next.final = {
                hasFrame: true,
                bytes: Number.isFinite(Number(incoming.frameBytes)) ? Number(incoming.frameBytes) : 0,
                updatedAt: incoming.frameUpdatedAt || null
            };
        }
        return next;
    }

    function flagsFromList(list) {
        const set = new Set(Array.isArray(list) ? list : []);
        return {
            mat: set.has('mat'),
            object: set.has('object'),
            hands: set.has('hands')
        };
    }

    function applyState(incoming) {
        if (!incoming || typeof incoming !== 'object') return;

        let nextConfig = state.config;
        if (incoming.config && typeof incoming.config === 'object') {
            nextConfig = {
                overlays: {
                    mat: true,
                    object: true,
                    hands: true,
                    ...((incoming.config.overlays) || {})
                },
                projector: {
                    mat: true,
                    object: true,
                    hands: true,
                    ...((incoming.config.projector) || (incoming.config.overlays) || {})
                },
                browser: {
                    mat: true,
                    object: true,
                    hands: true,
                    ...((incoming.config.browser) || (incoming.config.overlays) || {})
                }
            };
        } else if (
            Array.isArray(incoming.projector_overlays)
            || Array.isArray(incoming.browser_overlays)
            || Array.isArray(incoming.overlays)
        ) {
            // Desk pinch toggles often arrive as lists on state without a config block.
            const projector = flagsFromList(
                incoming.projector_overlays || incoming.overlays || []
            );
            const browser = flagsFromList(
                incoming.browser_overlays || incoming.projector_overlays || incoming.overlays || []
            );
            nextConfig = {
                overlays: { ...projector },
                projector,
                browser
            };
        }

        state = {
            ...state,
            ...incoming,
            layersMeta: normalizeLayersMeta(incoming),
            config: nextConfig
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
