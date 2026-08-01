const ollama = require('../stocksai/ollama');

const REFRESH_MS = Number(process.env.AIINFO_POLL_MS || 30000);

/**
 * AI information — configured Ollama model + context / token window.
 */
function register(ctx) {
    const { app, logger, broadcastToAll, onClientConnected, onClientMessage, notify, emit } = ctx;

    let state = {
        online: false,
        baseUrl: ollama.DEFAULT_BASE,
        model: ollama.getActiveModel(),
        models: [],
        contextLength: null,
        parameterSize: null,
        family: null,
        quantization: null,
        format: null,
        checkedAt: null,
        lastError: null,
        refreshing: false
    };

    function getState() {
        return {
            ...state,
            maxTokens: state.contextLength,
            disclaimer: 'Values reported by Ollama for the configured model. Not investment advice.'
        };
    }

    function broadcastState() {
        broadcastToAll({
            type: 'aiinfo_state',
            data: getState()
        });
    }

    async function refresh({ broadcast = true } = {}) {
        if (state.refreshing) return getState();
        state.refreshing = true;
        try {
            const health = await ollama.checkHealth({ baseUrl: state.baseUrl });
            state.online = health.online === true;
            state.checkedAt = health.checkedAt || new Date().toISOString();
            state.models = Array.isArray(health.models) ? health.models : [];

            if (!state.online) {
                state.lastError = health.error || 'Ollama unreachable';
                state.contextLength = null;
                state.parameterSize = null;
                state.family = null;
                state.quantization = null;
                state.format = null;
            } else {
                state.model = ollama.getActiveModel();
                const info = await ollama.getModelInfo({
                    baseUrl: state.baseUrl,
                    model: state.model
                });
                state.checkedAt = info.checkedAt || state.checkedAt;
                if (info.ok) {
                    state.lastError = null;
                    state.contextLength = info.contextLength;
                    state.parameterSize = info.parameterSize;
                    state.family = Array.isArray(info.family)
                        ? info.family.join(', ')
                        : (info.family || null);
                    state.quantization = info.quantization;
                    state.format = info.format;
                } else {
                    state.lastError = info.error || 'Failed to load model info';
                    state.contextLength = null;
                }
            }
        } catch (err) {
            state.online = false;
            state.lastError = err.message || String(err);
            state.checkedAt = new Date().toISOString();
            if (logger) {
                logger.warn('AIInfo', `Refresh failed: ${state.lastError}`);
            }
        } finally {
            state.refreshing = false;
        }

        if (broadcast) broadcastState();
        return getState();
    }

    app.get('/api/aiinfo', (req, res) => {
        res.json(getState());
    });

    app.post('/api/aiinfo/refresh', async (req, res) => {
        try {
            const data = await refresh({ broadcast: true });
            res.json({ ok: true, ...data });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message || String(err) });
        }
    });

    async function selectModel(name) {
        const result = ollama.setActiveModel(name);
        state.model = result.model;
        if (result.changed && typeof emit === 'function') {
            emit('ollama_model_changed', { model: result.model });
        }
        if (result.changed && typeof notify === 'function') {
            notify({
                level: 'info',
                source: 'AI Info',
                title: 'Ollama model updated',
                body: `Now using ${result.model}`
            });
        }
        return refresh({ broadcast: true });
    }

    app.post('/api/aiinfo/model', async (req, res) => {
        try {
            const model = String((req.body && req.body.model) || '').trim();
            if (!model) {
                res.status(400).json({ ok: false, error: 'model required' });
                return;
            }
            const data = await selectModel(model);
            res.json({ ok: true, ...data });
        } catch (err) {
            res.status(400).json({ ok: false, error: err.message || String(err) });
        }
    });

    onClientConnected((ws) => {
        try {
            ws.send(JSON.stringify({
                type: 'aiinfo_state',
                data: getState()
            }));
        } catch (_) {
            /* ignore */
        }
    });

    onClientMessage((ws, data) => {
        if (!data || typeof data.type !== 'string') return false;
        if (data.type === 'aiinfo_refresh') {
            refresh({ broadcast: true }).catch((err) => {
                if (logger) {
                    logger.warn('AIInfo', `Manual refresh failed: ${err.message || err}`);
                }
            });
            return true;
        }
        if (data.type === 'aiinfo_set_model') {
            selectModel(data.model).catch((err) => {
                if (logger) {
                    logger.warn('AIInfo', `Set model failed: ${err.message || err}`);
                }
            });
            return true;
        }
        return false;
    });

    setTimeout(() => {
        refresh({ broadcast: true }).catch(() => {});
    }, 1200);
    setInterval(() => {
        refresh({ broadcast: true }).catch(() => {});
    }, REFRESH_MS);

    if (logger) {
        logger.info('AIInfo', `AI information module registered (model ${state.model})`);
    }
}

module.exports = {
    id: 'aiinfo',
    name: 'AI Information',
    register
};
