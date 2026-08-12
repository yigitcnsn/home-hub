/**
 * Control Panel — hard kill / start for heavy background features.
 * Closed = timers cleared, queues drained, workers not running (not idle).
 */
const store = require('./store');

function register(ctx) {
    const { app, logger, broadcastToAll, onClientConnected, onClientMessage, notify } = ctx;

    /** @type {Map<string, object>} */
    const registry = new Map();

    function isEnabled(id) {
        const saved = store.load().features;
        if (Object.prototype.hasOwnProperty.call(saved, id)) {
            return saved[id] === true;
        }
        const meta = registry.get(id);
        return !meta || meta.defaultEnabled !== false;
    }

    function getFeatureSnapshot(id) {
        const meta = registry.get(id);
        if (!meta) return null;
        const enabled = isEnabled(id);
        let running = false;
        try {
            running = typeof meta.isRunning === 'function' ? !!meta.isRunning() : enabled;
        } catch (_) {
            running = false;
        }
        return {
            id: meta.id,
            label: meta.label || meta.id,
            description: meta.description || '',
            enabled,
            running,
            navViews: Array.isArray(meta.navViews) ? meta.navViews.slice() : []
        };
    }

    function getState() {
        const features = Array.from(registry.keys())
            .sort()
            .map((id) => getFeatureSnapshot(id))
            .filter(Boolean);
        const gates = {};
        features.forEach((f) => {
            gates[f.id] = f.enabled === true;
        });
        return {
            features,
            gates,
            updatedAt: store.load().updatedAt,
            disclaimer: 'Closing a feature kills its timers and queues. Opening starts them again.'
        };
    }

    function broadcastState() {
        broadcastToAll({
            type: 'control_state',
            data: getState()
        });
    }

    function setFeature(id, enabled) {
        const meta = registry.get(id);
        if (!meta) {
            throw new Error(`Unknown feature: ${id}`);
        }

        const want = !!enabled;
        const was = isEnabled(id);
        store.setEnabled(id, want);

        let running = false;
        try {
            running = typeof meta.isRunning === 'function' ? !!meta.isRunning() : false;
        } catch (_) {
            running = false;
        }

        if (want && !running && typeof meta.start === 'function') {
            meta.start();
            if (logger) logger.info('Control', `Started feature ${id}`);
        }
        if (!want && running && typeof meta.stop === 'function') {
            meta.stop();
            if (logger) logger.info('Control', `Killed feature ${id}`);
        }

        if (want !== was && typeof notify === 'function') {
            notify({
                level: 'info',
                source: 'Control',
                title: want ? `${meta.label || id} started` : `${meta.label || id} killed`,
                body: want
                    ? 'Background workers are running again.'
                    : 'Timers cleared and queues drained.'
            });
        }

        if (typeof ctx.emit === 'function') {
            ctx.emit('feature_changed', { id, enabled: want });
        }

        broadcastState();
        return getState();
    }

    ctx.registerFeature = function registerFeature(meta) {
        if (!meta || !meta.id || typeof meta.start !== 'function' || typeof meta.stop !== 'function') {
            throw new Error('registerFeature requires { id, start, stop }');
        }
        const id = String(meta.id);
        const defaultEnabled = meta.defaultEnabled !== false;
        registry.set(id, {
            id,
            label: meta.label || id,
            description: meta.description || '',
            navViews: Array.isArray(meta.navViews) ? meta.navViews.slice() : [],
            defaultEnabled,
            start: meta.start,
            stop: meta.stop,
            isRunning: meta.isRunning || (() => false)
        });
        store.ensureDefault(id, defaultEnabled);

        if (isEnabled(id)) {
            try {
                meta.start();
                if (logger) logger.info('Control', `Feature ${id} running`);
            } catch (err) {
                if (logger) {
                    logger.error('Control', `Failed to start ${id}: ${err.message || err}`);
                }
            }
        } else if (logger) {
            logger.info('Control', `Feature ${id} killed (not started)`);
        }
    };

    ctx.featureEnabled = function featureEnabled(id) {
        return isEnabled(id);
    };

    app.get('/api/control', (req, res) => {
        res.json(getState());
    });

    app.post('/api/control/features/:id', (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            const body = req.body || {};
            if (body.enabled == null) {
                res.status(400).json({ ok: false, error: 'enabled (boolean) required' });
                return;
            }
            const state = setFeature(id, !!body.enabled);
            res.json({ ok: true, ...state });
        } catch (err) {
            res.status(400).json({ ok: false, error: err.message || String(err) });
        }
    });

    onClientConnected((ws) => {
        try {
            ws.send(JSON.stringify({
                type: 'control_state',
                data: getState()
            }));
        } catch (_) {
            /* ignore */
        }
    });

    onClientMessage((ws, data) => {
        if (!data || typeof data.type !== 'string') return false;
        if (data.type === 'control_get') {
            try {
                ws.send(JSON.stringify({ type: 'control_state', data: getState() }));
            } catch (_) {
                /* ignore */
            }
            return true;
        }
        if (data.type === 'control_set_feature') {
            try {
                setFeature(String(data.id || ''), !!data.enabled);
            } catch (err) {
                if (logger) {
                    logger.warn('Control', `WS set failed: ${err.message || err}`);
                }
            }
            return true;
        }
        return false;
    });

    if (logger) {
        logger.info('Control', 'Control panel registered');
    }
}

module.exports = {
    id: 'control',
    name: 'Control',
    register
};
