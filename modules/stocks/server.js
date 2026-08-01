/**
 * Stocks module (server) — Yahoo Finance quotes, watchlist, browse, charts.
 * Separate from KAP watchlist.
 */
const store = require('./store');
const yahoo = require('./yahoo');
const symbols = require('./symbols');
const paper = require('./paper/engine');
const strategy = require('./paper/strategy');
const newsPipeline = require('./news/pipeline');

const POLL_MS = Number(process.env.STOCKS_POLL_INTERVAL_MS || 60 * 1000);

const CHART_RANGE_INTERVAL = {
    '1d': '5m',
    '5d': '15m',
    '1mo': '1d',
    '3mo': '1d',
    '1y': '1d'
};

function register(ctx) {
    const { app, logger, broadcastToAll, onClientConnected, onClientMessage, notify } = ctx;

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

    function getPaperState() {
        const state = paper.getState(quotesBySymbol);
        state.news = newsPipeline.getStatus();
        return state;
    }

    function broadcastState() {
        broadcastToAll({
            type: 'stocks_state',
            data: getState()
        });
    }

    function broadcastPaperState() {
        broadcastToAll({
            type: 'stocks_paper_state',
            data: getPaperState()
        });
    }

    function mergeQuotes(list) {
        (list || []).forEach((q) => {
            if (q && q.symbol && q.price != null) quotesBySymbol[q.symbol] = q;
        });
    }

    async function ensurePaperQuotes({ force = false } = {}) {
        const needed = paper.symbolsOfInterest().filter((code) => {
            const q = quotesBySymbol[code];
            return !q || q.price == null;
        });
        if (!needed.length) return;
        const results = await yahoo.getQuotes(needed, { force });
        mergeQuotes(results);
    }

    async function runPaperMatch({ broadcast = true } = {}) {
        try {
            await ensurePaperQuotes({ force: false });
            strategy.flushPendingBuys(quotesBySymbol);
            strategy.evaluateExits(quotesBySymbol);
            const result = paper.runMatch(quotesBySymbol);
            if (broadcast) broadcastPaperState();
            return result;
        } catch (err) {
            logger.warn('Stocks', `Paper match failed: ${err.message || err}`);
            return null;
        }
    }

    function handleKapClassification(record) {
        try {
            const stock = record && record.stock;
            const run = async () => {
                if (stock) {
                    try {
                        const quotes = await yahoo.getQuotes([stock], { force: false });
                        mergeQuotes(quotes);
                    } catch (_) {
                        /* ignore */
                    }
                }
                const out = strategy.onClassification(record, quotesBySymbol);
                if (out && out.order) {
                    logger.info('Stocks', `Paper auto order: ${out.order.side} ${out.order.symbol} (${out.signal && out.signal.detail})`);
                    if (typeof notify === 'function') {
                        notify({
                            level: 'info',
                            source: 'Paper desk',
                            title: `Auto ${out.order.side} ${out.order.symbol}`,
                            body: (out.signal && out.signal.detail) || `Qty ${out.order.qty}`
                        });
                    }
                } else if (out && out.skipped) {
                    logger.info('Stocks', `Paper signal skipped: ${out.skipped}`);
                }
                broadcastPaperState();
            };
            run().catch((err) => {
                logger.warn('Stocks', `Paper KAP hook failed: ${err.message || err}`);
            });
        } catch (err) {
            logger.warn('Stocks', `Paper KAP hook error: ${err.message || err}`);
        }
    }

    function handleNewsClassification(record) {
        handleKapClassification(record);
    }

    if (typeof ctx.on === 'function') {
        ctx.on('stocksai_classified', handleKapClassification);
        ctx.on('kap_classified', handleKapClassification); // legacy
    }

    async function refreshWatchlistQuotes({ force = false, broadcast = true } = {}) {
        if (refreshing) return getState();
        refreshing = true;
        try {
            const watchlist = store.getWatchlist();
            if (watchlist.length) {
                const results = await yahoo.getQuotes(watchlist, { force });
                const next = { ...quotesBySymbol };
                let err = null;
                results.forEach((q) => {
                    if (!q || !q.symbol) return;
                    next[q.symbol] = q;
                    if (q.error) err = q.error;
                });
                quotesBySymbol = next;
                lastError = err;
                if (err) {
                    logger.warn('Stocks', `Quote refresh partial/error: ${err}`);
                } else {
                    logger.info('Stocks', `Refreshed ${results.length} quote(s)`);
                }
            } else {
                lastError = null;
            }
            lastRefreshAt = new Date().toISOString();
            await runPaperMatch({ broadcast: true });
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

    app.get('/api/stocks/paper', (req, res) => {
        res.json(getPaperState());
    });

    app.post('/api/stocks/paper/order', async (req, res) => {
        try {
            const body = req.body || {};
            const order = paper.placeOrder({
                side: body.side,
                symbol: body.symbol || body.code,
                qty: body.qty,
                type: body.type,
                limitPrice: body.limitPrice,
                source: 'manual'
            });
            // Prefetch quote for the symbol so marks / future fills work.
            try {
                const quotes = await yahoo.getQuotes([order.symbol], { force: false });
                mergeQuotes(quotes);
            } catch (_) {
                /* ignore */
            }
            broadcastPaperState();
            res.status(201).json({ ok: true, order, paper: getPaperState() });
        } catch (err) {
            res.status(400).json({ error: err.message || String(err) });
        }
    });

    app.post('/api/stocks/paper/cancel', (req, res) => {
        try {
            const body = req.body || {};
            const order = paper.cancelOrder(body.orderId || body.id);
            broadcastPaperState();
            res.json({ ok: true, order, paper: getPaperState() });
        } catch (err) {
            res.status(400).json({ error: err.message || String(err) });
        }
    });

    app.post('/api/stocks/paper/reset', (req, res) => {
        try {
            const body = req.body || {};
            const cash = body.startingCash != null ? Number(body.startingCash) : undefined;
            paper.reset(cash);
            broadcastPaperState();
            res.json({ ok: true, paper: getPaperState() });
        } catch (err) {
            res.status(400).json({ error: err.message || String(err) });
        }
    });

    app.post('/api/stocks/paper/match', async (req, res) => {
        try {
            const result = await runPaperMatch({ broadcast: true });
            res.json({ ok: true, matched: !!(result && result.changed), fills: (result && result.fills) || [], paper: getPaperState() });
        } catch (err) {
            res.status(500).json({ error: err.message || String(err) });
        }
    });

    app.post('/api/stocks/paper/auto', (req, res) => {
        try {
            const body = req.body || {};
            const enabled = body.enabled != null ? !!body.enabled : body.autoTrade != null ? !!body.autoTrade : true;
            paper.setAutoTrade(enabled);
            broadcastPaperState();
            res.json({ ok: true, autoTrade: enabled, paper: getPaperState() });
        } catch (err) {
            res.status(400).json({ error: err.message || String(err) });
        }
    });

    app.get('/api/stocks/news', (req, res) => {
        res.json(newsPipeline.getStatus());
    });

    app.post('/api/stocks/news/enabled', (req, res) => {
        try {
            const body = req.body || {};
            const enabled = body.enabled != null ? !!body.enabled : true;
            newsPipeline.setEnabled(enabled);
            broadcastPaperState();
            res.json({ ok: true, enabled, news: newsPipeline.getStatus(), paper: getPaperState() });
        } catch (err) {
            res.status(400).json({ error: err.message || String(err) });
        }
    });

    app.post('/api/stocks/news/poll', async (req, res) => {
        try {
            const result = await newsPipeline.pollOnce({
                onClassified: handleNewsClassification,
                quotesBySymbol
            });
            broadcastPaperState();
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message || String(err) });
        }
    });

    onClientConnected((ws) => {
        try {
            ws.send(JSON.stringify({ type: 'stocks_state', data: getState() }));
            ws.send(JSON.stringify({ type: 'stocks_paper_state', data: getPaperState() }));
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
            if (message.type === 'stocks_paper_order') {
                const order = paper.placeOrder({
                    side: message.side,
                    symbol: message.symbol || message.code,
                    qty: message.qty,
                    type: message.type,
                    limitPrice: message.limitPrice,
                    source: 'manual'
                });
                yahoo.getQuotes([order.symbol], { force: false }).then((quotes) => {
                    mergeQuotes(quotes);
                    broadcastPaperState();
                }).catch(() => broadcastPaperState());
                return true;
            }
            if (message.type === 'stocks_paper_cancel') {
                paper.cancelOrder(message.orderId || message.id);
                broadcastPaperState();
                return true;
            }
            if (message.type === 'stocks_paper_reset') {
                const cash = message.startingCash != null ? Number(message.startingCash) : undefined;
                paper.reset(cash);
                broadcastPaperState();
                return true;
            }
            if (message.type === 'stocks_paper_match') {
                runPaperMatch({ broadcast: true }).catch((err) => {
                    logger.warn('Stocks', `WS paper match failed: ${err.message || err}`);
                });
                return true;
            }
            if (message.type === 'stocks_paper_auto') {
                const enabled = message.enabled != null
                    ? !!message.enabled
                    : message.autoTrade != null ? !!message.autoTrade : true;
                paper.setAutoTrade(enabled);
                broadcastPaperState();
                return true;
            }
            if (message.type === 'stocks_news_poll') {
                newsPipeline.pollOnce({
                    onClassified: handleNewsClassification,
                    quotesBySymbol
                }).then(() => broadcastPaperState()).catch((err) => {
                    logger.warn('Stocks', `WS news poll failed: ${err.message || err}`);
                });
                return true;
            }
            if (message.type === 'stocks_news_enabled') {
                const enabled = message.enabled != null ? !!message.enabled : true;
                newsPipeline.setEnabled(enabled);
                broadcastPaperState();
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

    newsPipeline.startScheduler({
        logger,
        onNewsClassified: handleNewsClassification
    });

    logger.info('Stocks', `Registered (poll every ${Math.round(POLL_MS / 1000)}s, Yahoo Finance + paper trading)`);
}

module.exports = {
    id: 'stocks',
    name: 'Stocks',
    register
};
