/**
 * PrismDesk bridge (server)
 *
 * Ingest annotated JPEG layers + telemetry from the Pi desk pipeline.
 * Expose latest frame/state to the dashboard; keep only the newest JPEG per layer.
 *
 * POST /api/prismdesk/frame          — JPEG → layer "final" (legacy)
 * POST /api/prismdesk/frame/:layer   — JPEG for raw|mat|hands|object|final
 * POST /api/prismdesk/state          — JSON telemetry
 * GET  /api/prismdesk/latest.jpg     — final layer
 * GET  /api/prismdesk/latest.jpg/:layer
 * GET  /api/prismdesk/state
 * GET  /api/prismdesk/config         — overlay toggles for PrismDesk to poll
 * PUT  /api/prismdesk/config
 * GET  /api/prismdesk/debug          — ingest counters / last error (no frame bytes)
 */

const MAX_FRAME_BYTES = 800 * 1024;
const OVERLAY_KEYS = ['mat', 'object', 'hands'];
const LAYER_IDS = ['raw', 'mat', 'hands', 'object', 'final'];

function defaultOverlayFlags() {
    return {
        mat: true,
        object: true,
        hands: true
    };
}

function defaultConfig() {
    const overlays = defaultOverlayFlags();
    return {
        // Legacy flat key — kept in sync with projector for older desks.
        overlays: { ...overlays },
        projector: { ...overlays },
        browser: { ...overlays }
    };
}

function emptyLayerSlots() {
    const layers = Object.create(null);
    LAYER_IDS.forEach((id) => {
        layers[id] = { frame: null, updatedAt: null };
    });
    return layers;
}

function defaultState() {
    return {
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
        frameUpdatedAt: null
    };
}

function isValidLayer(layer) {
    return typeof layer === 'string' && LAYER_IDS.includes(layer);
}

function isJpeg(buf) {
    return Buffer.isBuffer(buf) && buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let tooLarge = false;
        let settled = false;

        function fail(err, status) {
            if (settled) return;
            settled = true;
            const error = err instanceof Error ? err : new Error(String(err));
            if (status) error.status = status;
            reject(error);
        }

        req.on('data', (chunk) => {
            if (tooLarge) return;
            size += chunk.length;
            if (size > limit) {
                tooLarge = true;
                chunks.length = 0;
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (settled) return;
            if (tooLarge) {
                fail(new Error(`Payload exceeds ${limit} bytes`), 413);
                return;
            }
            settled = true;
            resolve(Buffer.concat(chunks));
        });
        req.on('error', (err) => fail(err, 400));
    });
}

function multipartBoundary(contentType) {
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType || ''));
    if (!match) return null;
    return (match[1] || match[2] || '').trim();
}

/**
 * Minimal multipart/form-data parser for fields named `frame` (file) and `state` (text).
 */
function parseMultipart(buffer, boundary) {
    const delim = Buffer.from(`--${boundary}`);
    const parts = { frame: null, stateText: null };
    let start = buffer.indexOf(delim);
    if (start < 0) return parts;

    while (start >= 0) {
        const afterDelim = start + delim.length;
        if (buffer[afterDelim] === 0x2d && buffer[afterDelim + 1] === 0x2d) break; // --

        let headerStart = afterDelim;
        if (buffer[headerStart] === 0x0d && buffer[headerStart + 1] === 0x0a) {
            headerStart += 2;
        }

        const headerEnd = buffer.indexOf('\r\n\r\n', headerStart);
        if (headerEnd < 0) break;

        const headers = buffer.slice(headerStart, headerEnd).toString('utf8');
        const bodyStart = headerEnd + 4;
        const next = buffer.indexOf(delim, bodyStart);
        if (next < 0) break;

        let bodyEnd = next;
        if (bodyEnd >= 2 && buffer[bodyEnd - 2] === 0x0d && buffer[bodyEnd - 1] === 0x0a) {
            bodyEnd -= 2;
        }

        const nameMatch = /name="([^"]+)"/i.exec(headers);
        const name = nameMatch ? nameMatch[1] : '';
        const body = buffer.slice(bodyStart, bodyEnd);

        if (name === 'frame') {
            parts.frame = body;
        } else if (name === 'state') {
            parts.stateText = body.toString('utf8');
        }

        start = next;
    }

    return parts;
}

function sanitizeState(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const out = {};

    if (input.fps != null && Number.isFinite(Number(input.fps))) {
        out.fps = Number(input.fps);
    }
    if (input.track_fps != null && Number.isFinite(Number(input.track_fps))) {
        out.track_fps = Number(input.track_fps);
    }
    if (typeof input.mat_locked === 'boolean') {
        out.mat_locked = input.mat_locked;
    }
    if (input.hands != null && Number.isFinite(Number(input.hands))) {
        out.hands = Math.max(0, Math.floor(Number(input.hands)));
    }
    if (typeof input.object === 'string') {
        out.object = input.object.slice(0, 256);
    } else if (input.object === null) {
        out.object = null;
    }
    if (typeof input.capture === 'string') {
        out.capture = input.capture.slice(0, 64);
    }
    if (Array.isArray(input.overlays)) {
        out.overlays = input.overlays
            .filter((v) => typeof v === 'string')
            .map((v) => v.slice(0, 32))
            .slice(0, 16);
    }
    if (Array.isArray(input.layers)) {
        out.layers = input.layers
            .filter((v) => typeof v === 'string' && LAYER_IDS.includes(v))
            .slice(0, LAYER_IDS.length);
    }
    if (input.rotate != null && Number.isFinite(Number(input.rotate))) {
        out.rotate = Number(input.rotate);
    }

    return out;
}

function applyOverlayFlags(target, source) {
    if (!source || typeof source !== 'object') return;
    OVERLAY_KEYS.forEach((key) => {
        if (typeof source[key] === 'boolean') {
            target[key] = source[key];
        }
    });
}

function sanitizeConfig(input) {
    const next = defaultConfig();
    if (!input || typeof input !== 'object') return next;

    const hasProjector = input.projector && typeof input.projector === 'object';
    const hasBrowser = input.browser && typeof input.browser === 'object';
    const hasLegacy = input.overlays && typeof input.overlays === 'object';

    if (!hasProjector && !hasBrowser && hasLegacy) {
        // Old clients: one toggle set controls both surfaces.
        applyOverlayFlags(next.overlays, input.overlays);
        applyOverlayFlags(next.projector, input.overlays);
        applyOverlayFlags(next.browser, input.overlays);
        return next;
    }

    if (hasLegacy) {
        applyOverlayFlags(next.overlays, input.overlays);
    }
    if (hasProjector) {
        applyOverlayFlags(next.projector, input.projector);
    } else if (hasLegacy) {
        applyOverlayFlags(next.projector, input.overlays);
    }
    if (hasBrowser) {
        applyOverlayFlags(next.browser, input.browser);
    } else if (hasLegacy) {
        applyOverlayFlags(next.browser, input.overlays);
    }

    // Keep legacy overlays mirrored to projector for older PrismDesk builds.
    next.overlays = { ...next.projector };
    return next;
}

function layerMeta(slot) {
    const has = Buffer.isBuffer(slot && slot.frame) && slot.frame.length > 0;
    return {
        hasFrame: has,
        bytes: has ? slot.frame.length : 0,
        updatedAt: (slot && slot.updatedAt) || null
    };
}

function buildLayersMeta(store) {
    const meta = {};
    LAYER_IDS.forEach((id) => {
        meta[id] = layerMeta(store.layers[id]);
    });
    return meta;
}

function finalSlot(store) {
    return store.layers.final;
}

function publicState(store) {
    const final = finalSlot(store);
    const finalMeta = layerMeta(final);
    return {
        ...store.state,
        hasFrame: finalMeta.hasFrame,
        frameBytes: finalMeta.bytes,
        frameUpdatedAt: finalMeta.updatedAt,
        layersMeta: buildLayersMeta(store),
        config: {
            ...store.config,
            overlays: { ...store.config.overlays },
            projector: { ...store.config.projector },
            browser: { ...store.config.browser }
        }
    };
}

function sendJpeg(res, slot) {
    if (!slot || !Buffer.isBuffer(slot.frame) || !slot.frame.length) {
        return false;
    }
    res.set({
        'Content-Type': 'image/jpeg',
        'Content-Length': String(slot.frame.length),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
    });
    if (slot.updatedAt) {
        res.set('Last-Modified', new Date(slot.updatedAt).toUTCString());
    }
    res.send(slot.frame);
    return true;
}

let statusProvider = () => ({
    registered: false,
    hasFrame: false,
    frameBytes: 0,
    frameUpdatedAt: null,
    stateUpdatedAt: null,
    framesReceived: 0,
    statePosts: 0,
    lastIngestError: null,
    overlays: defaultConfig().overlays,
    layers: LAYER_IDS.reduce((acc, id) => {
        acc[id] = { hasFrame: false, bytes: 0, updatedAt: null };
        return acc;
    }, {})
});

function getStatus() {
    return statusProvider();
}

function register(ctx) {
    const { app, logger, broadcastToAll, onClientConnected } = ctx;

    const store = {
        layers: emptyLayerSlots(),
        state: defaultState(),
        config: defaultConfig()
    };

    const stats = {
        framesReceived: 0,
        statePosts: 0,
        lastIngestError: null
    };

    statusProvider = () => {
        const final = finalSlot(store);
        const finalMeta = layerMeta(final);
        return {
            registered: true,
            hasFrame: finalMeta.hasFrame,
            frameBytes: finalMeta.bytes,
            frameUpdatedAt: finalMeta.updatedAt,
            stateUpdatedAt: store.state.updatedAt || null,
            framesReceived: stats.framesReceived,
            statePosts: stats.statePosts,
            lastIngestError: stats.lastIngestError,
            overlays: { ...store.config.overlays },
            projector: { ...store.config.projector },
            browser: { ...store.config.browser },
            layers: buildLayersMeta(store)
        };
    };

    function broadcastUpdate() {
        broadcastToAll({
            type: 'prismdesk_update',
            state: publicState(store)
        });
    }

    function applyStatePatch(patch) {
        const clean = sanitizeState(patch);
        store.state = {
            ...store.state,
            ...clean,
            updatedAt: new Date().toISOString()
        };
    }

    function setLayerFrame(layer, buf) {
        if (!isValidLayer(layer)) {
            const err = new Error(`Unknown layer "${layer}"`);
            err.status = 400;
            throw err;
        }
        if (!isJpeg(buf)) {
            const err = new Error('Body is not a JPEG image');
            err.status = 400;
            throw err;
        }
        if (buf.length > MAX_FRAME_BYTES) {
            const err = new Error(`JPEG exceeds ${MAX_FRAME_BYTES} bytes`);
            err.status = 413;
            throw err;
        }

        const updatedAt = new Date().toISOString();
        store.layers[layer] = { frame: buf, updatedAt };

        if (layer === 'final') {
            store.state.hasFrame = true;
            store.state.frameBytes = buf.length;
            store.state.frameUpdatedAt = updatedAt;
        }
        if (!store.state.updatedAt) {
            store.state.updatedAt = updatedAt;
        }

        return updatedAt;
    }

    async function ingestFrameBody(req) {
        const ct = String(req.headers['content-type'] || '');
        let jpeg = null;
        let statePatch = null;

        if (ct.includes('multipart/form-data')) {
            const boundary = multipartBoundary(ct);
            if (!boundary) {
                const err = new Error('Missing multipart boundary');
                err.status = 400;
                throw err;
            }
            const raw = await readBody(req, MAX_FRAME_BYTES + 64 * 1024);
            const parts = parseMultipart(raw, boundary);
            if (!parts.frame || !parts.frame.length) {
                const err = new Error('multipart field "frame" is required');
                err.status = 400;
                throw err;
            }
            jpeg = parts.frame;
            if (parts.stateText) {
                try {
                    statePatch = JSON.parse(parts.stateText);
                } catch (_) {
                    const err = new Error('multipart field "state" must be JSON');
                    err.status = 400;
                    throw err;
                }
            }
        } else if (ct.includes('image/jpeg') || ct.includes('application/octet-stream')) {
            jpeg = await readBody(req, MAX_FRAME_BYTES);
        } else {
            const err = new Error('Expected Content-Type image/jpeg or multipart/form-data');
            err.status = 415;
            throw err;
        }

        return { jpeg, statePatch };
    }

    async function handleFrameIngest(req, res, layer) {
        try {
            if (!isValidLayer(layer)) {
                return res.status(400).json({
                    ok: false,
                    error: `Unknown layer "${layer}". Expected one of: ${LAYER_IDS.join(', ')}`
                });
            }

            const { jpeg, statePatch } = await ingestFrameBody(req);
            const updatedAt = setLayerFrame(layer, jpeg);

            if (statePatch) applyStatePatch(statePatch);
            else if (layer === 'final') {
                store.state.hasFrame = true;
                store.state.frameBytes = jpeg.length;
                store.state.frameUpdatedAt = updatedAt;
            }

            stats.framesReceived += 1;
            stats.lastIngestError = null;
            broadcastUpdate();
            res.json({
                ok: true,
                layer,
                bytes: jpeg.length,
                updatedAt
            });
        } catch (err) {
            const status = err.status || 500;
            stats.lastIngestError = {
                at: new Date().toISOString(),
                status,
                message: err.message || String(err)
            };
            if (status >= 500) {
                logger.error('PrismDesk', `Frame ingest failed: ${err.message}`, { stack: err.stack });
            } else {
                logger.warn('PrismDesk', `Frame ingest rejected: ${err.message}`);
            }
            res.status(status).json({ ok: false, error: err.message || String(err) });
        }
    }

    app.post('/api/prismdesk/frame/:layer', async (req, res) => {
        await handleFrameIngest(req, res, req.params.layer);
    });

    app.post('/api/prismdesk/frame', async (req, res) => {
        await handleFrameIngest(req, res, 'final');
    });

    app.post('/api/prismdesk/state', (req, res) => {
        try {
            applyStatePatch(req.body || {});
            stats.statePosts += 1;
            stats.lastIngestError = null;
            broadcastUpdate();
            res.json({ ok: true, state: publicState(store) });
        } catch (err) {
            stats.lastIngestError = {
                at: new Date().toISOString(),
                status: 500,
                message: err.message || String(err)
            };
            logger.error('PrismDesk', `State ingest failed: ${err.message}`, { stack: err.stack });
            res.status(500).json({ ok: false, error: err.message || String(err) });
        }
    });

    app.get('/api/prismdesk/latest.jpg/:layer', (req, res) => {
        const layer = req.params.layer;
        if (!isValidLayer(layer)) {
            return res.status(400).json({
                ok: false,
                error: `Unknown layer "${layer}". Expected one of: ${LAYER_IDS.join(', ')}`
            });
        }
        if (!sendJpeg(res, store.layers[layer])) {
            return res.status(404).json({ ok: false, error: `No ${layer} frame yet` });
        }
    });

    app.get('/api/prismdesk/latest.jpg', (req, res) => {
        if (!sendJpeg(res, finalSlot(store))) {
            return res.status(404).json({ ok: false, error: 'No frame yet' });
        }
    });

    app.get('/api/prismdesk/state', (req, res) => {
        res.json(publicState(store));
    });

    app.get('/api/prismdesk/config', (req, res) => {
        res.json(store.config);
    });

    app.get('/api/prismdesk/debug', (req, res) => {
        res.json({ ok: true, ...getStatus() });
    });

    app.put('/api/prismdesk/config', (req, res) => {
        try {
            store.config = sanitizeConfig(req.body || {});
            broadcastUpdate();
            res.json({ ok: true, config: store.config });
        } catch (err) {
            logger.error('PrismDesk', `Config update failed: ${err.message}`, { stack: err.stack });
            res.status(500).json({ ok: false, error: err.message || String(err) });
        }
    });

    onClientConnected((ws) => {
        try {
            ws.send(JSON.stringify({
                type: 'prismdesk_update',
                state: publicState(store)
            }));
        } catch (err) {
            logger.warn('PrismDesk', `Failed to push state on connect: ${err.message}`);
        }
    });

    logger.info('PrismDesk', `Module registered (max frame ${MAX_FRAME_BYTES} bytes, layers: ${LAYER_IDS.join(', ')})`);
}

module.exports = {
    id: 'prismdesk',
    name: 'PrismDesk',
    register,
    getStatus,
    LAYER_IDS
};
