/**
 * Stocks module (server) — Yahoo Finance quotes, watchlist, browse, charts.
 * Separate from KAP watchlist.
 */
const store = require('./store');
const yahoo = require('./yahoo');
const symbols = require('./symbols');

const POLL_MS = Number(process.env.STOCKS_POLL_INTERVAL_MS || 60 * 1000);

const CHART_RANGE_INTERVAL = {
    '1d': '5m',
    '5d': '15m',
    '1mo': '1d',
    '3mo': '1d',
    '1y': '1d'
};

function register(ctx) {
    const { app, logger, broadcastToAll, onClientConnected, onClientMessage } = ctx;

    let lastError = null;
    let lastRefreshAt = null;
    let refreshing = false;
    /** @type {Record<string, object>} */
    let quotesBySymbol = {};

    function getState() {
        const watchlist = store.getWatchlist();
        const quotes = watchlist.map((code) => {
            return quotesBySymbol[code] || yahoo.getCachedQuote(code) || {
                symbol: code,
                price: null,
                changePercent: null,
                pending: true
            };
        });
        return {
            watchlist,
            quotes,
            quotesBySymbol: { ...quotesBySymbol },
            lastError,
            lastRefreshAt,
            refreshing,
            pollIntervalMs: POLL_MS,
            disclaimer: 'Not investment advice. Quotes from Yahoo Finance (delayed). For personal research only.'
        };
    }

    function broadcastState() {
        broadcastToAll({
            type: 'stocks_state',
            data: getState()
        });
    }

    async function refreshWatchlistQuotes({ force = false, broadcast = true } = {}) {
        if (refreshing) return getState();
        refreshing = true;
        try {
            const watchlist = store.getWatchlist();
            if (!watchlist.length) {
                quotesBySymbol = {};
                lastRefreshAt = new Date().toISOString();
                lastError = null;
                if (broadcast) broadcastState();
                return getState();
            }
            const results = await yahoo.getQuotes(watchlist, { force });
            const next = { ...quotesBySymbol };
            let err = null;
            results.forEach((q) => {
                if (!q || !q.symbol) return;
                next[q.symbol] = q;
                if (q.error) err = q.error;
            });
            quotesBySymbol = next;
            lastRefreshAt = new Date().toISOString();
            lastError = err;
            if (err) {
                logger.warn('Stocks', `Quote refresh partial/error: ${err}`);
            } else {
                logger.info('Stocks', `Refreshed ${results.length} quote(s)`);
            }
            if (broadcast) broadcastState();
            return getState();
        } catch (err) {
            lastError = err.message || String(err);
            logger.error('Stocks', `Quote refresh failed: ${lastError}`);
            if (broadcast) broadcastState();
            return getState();
        } finally {
            refreshing = false;
        }
    }

    function updateWatchlist(mutator) {
        const next = mutator();
        broadcastState();
        refreshWatchlistQuotes({ force: true }).catch(() => {});
        return next;
    }

    app.get('/api/stocks', (req, res) => {
        res.json(getState());
    });

    app.post('/api/stocks/watchlist', (req, res) => {
        try {
            const body = req.body || {};
            const action = String(body.action || '').toLowerCase();
            let watchlist;
            if (action === 'add') {
                watchlist = updateWatchlist(() => store.addWatchlistCode(body.code || body.symbol));
            } else if (action === 'remove') {
                watchlist = updateWatchlist(() => store.removeWatchlistCode(body.code || body.symbol));
            } else if (action === 'set') {
                const codes = Array.isArray(body.codes) ? body.codes : String(body.codes || body.code || '').split(/[,;\s]+/);
                watchlist = updateWatchlist(() => store.setWatchlist(codes));
            } else {
                return res.status(400).json({ error: 'action must be add, remove, or set' });
            }
            res.json({ ok: true, watchlist });
        } catch (err) {
            res.status(500).json({ error: err.message || String(err) });
        }
    });

    app.get('/api/stocks/quote', async (req, res) => {
        try {
            const raw = String(req.query.symbols || req.query.symbol || '');
            const codes = store.normalizeCodes(raw.split(/[,;\s]+/));
            if (!codes.length) {
                return res.status(400).json({ error: 'symbols required' });
            }
            const force = String(req.query.force || '') === '1';
            const quotes = await yahoo.getQuotes(codes, { force });
            quotes.forEach((q) => {
                if (q && q.symbol && q.price != null) quotesBySymbol[q.symbol] = q;
            });
            res.json({ quotes });
        } catch (err) {
            res.status(502).json({ error: err.message || String(err) });
        }
    });

    app.get('/api/stocks/search', (req, res) => {
        try {
            const q = String(req.query.q || '');
            const limit = Number(req.query.limit) || 40;
            const results = symbols.searchBist(q, limit).map((item) => ({
                code: item.code,
                name: item.name,
                yahooSymbol: yahoo.toYahooSymbol(item.code)
            }));

            // Allow direct Yahoo-style symbol even if not in curated list
            const direct = yahoo.canonicalize(q);
            if (direct && !results.some((r) => r.code === direct || r.code === yahoo.displayLabel(direct))) {
                const looksLikeSymbol = /^[A-Z0-9.\-=^]{1,24}$/.test(direct);
                if (looksLikeSymbol && q.trim().length >= 1) {
                    results.unshift({
                        code: direct,
                        name: direct,
                        yahooSymbol: yahoo.toYahooSymbol(direct),
                        external: true
                    });
                }
            }
            res.json({ results });
        } catch (err) {
            res.status(500).json({ error: err.message || String(err) });
        }
    });

    app.get('/api/stocks/chart', async (req, res) => {
        try {
            const symbol = String(req.query.symbol || '').trim();
            if (!symbol) return res.status(400).json({ error: 'symbol required' });
            let range = String(req.query.range || '1mo');
            let interval = String(req.query.interval || '');
            if (!interval) {
                interval = CHART_RANGE_INTERVAL[range] || '1d';
            }
            const force = String(req.query.force || '') === '1';
            const history = await yahoo.getHistory(symbol, { range, interval, force });
            if (history.meta && history.meta.symbol && history.meta.price != null) {
                quotesBySymbol[history.meta.symbol] = history.meta;
            }
            res.json(history);
        } catch (err) {
            res.status(502).json({ error: err.message || String(err) });
        }
    });

    app.post('/api/stocks/refresh', async (req, res) => {
        const state = await refreshWatchlistQuotes({ force: true });
        res.json(state);
    });

    onClientConnected((ws) => {
        try {
            ws.send(JSON.stringify({ type: 'stocks_state', data: getState() }));
        } catch (_) {
            /* ignore */
        }
    });

    onClientMessage((ws, message) => {
        if (!message || !message.type) return false;
        try {
            if (message.type === 'stocks_watchlist_add') {
                updateWatchlist(() => store.addWatchlistCode(message.code || message.symbol));
                return true;
            }
            if (message.type === 'stocks_watchlist_remove') {
                updateWatchlist(() => store.removeWatchlistCode(message.code || message.symbol));
                return true;
            }
            if (message.type === 'stocks_refresh') {
                refreshWatchlistQuotes({ force: true }).catch((err) => {
                    lastError = err.message || String(err);
                    logger.warn('Stocks', `WS refresh failed: ${lastError}`);
                    broadcastState();
                });
                return true;
            }
        } catch (err) {
            logger.warn('Stocks', `WS handler error: ${err.message || err}`);
            return true;
        }
        return false;
    });

    // Initial + scheduled poll
    refreshWatchlistQuotes({ force: true, broadcast: false }).catch((err) => {
        logger.warn('Stocks', `Initial refresh failed: ${err.message || err}`);
    });

    setInterval(() => {
        refreshWatchlistQuotes({ force: false }).catch(() => {});
    }, POLL_MS);

    logger.info('Stocks', `Registered (poll every ${Math.round(POLL_MS / 1000)}s, Yahoo Finance)`);
}

module.exports = {
    id: 'stocks',
    name: 'Stocks',
    register
};
