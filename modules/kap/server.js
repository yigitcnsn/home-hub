/**
 * KAP module (server) — scrape watchlist disclosures, queue Ollama classify, persist.
 */
const store = require('./store');
const scrape = require('./scrape');
const ollama = require('./ollama');

const POLL_MS = Number(process.env.KAP_POLL_INTERVAL_MS || 60 * 60 * 1000);
const AUTO_CLASSIFY = String(process.env.KAP_AUTO_CLASSIFY || '1') !== '0';

function buildDailyDigest(disclosures, watchlist) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    const watch = Array.isArray(watchlist) ? new Set(watchlist) : null;

    let count = 0;
    let good = 0;
    let bad = 0;
    let neutral = 0;
    let pending = 0;

    (disclosures || []).forEach((d) => {
        if (watch && watch.size && !watch.has(d.stock)) return;
        const t = new Date(d.date || 0).getTime();
        if (Number.isNaN(t) || t < startMs) return;
        count += 1;
        const sentiment = d.classification && String(d.classification.sentiment || '').toLowerCase();
        if (sentiment === 'good') good += 1;
        else if (sentiment === 'bad') bad += 1;
        else if (sentiment === 'neutral') neutral += 1;
        else pending += 1;
    });

    return { count, good, bad, neutral, pending };
}

function register(ctx) {
    const { app, logger, broadcastToAll, onClientConnected, onClientMessage } = ctx;

    const queue = [];
    const jobsById = new Map();
    let running = false;
    let lastError = null;
    let lastScrapeAt = null;
    let oracleOnline = false;
    let oracleCheckedAt = null;
    let oracleError = null;

    // Restore recent jobs into memory map (display only)
    store.getJobs().forEach((job) => {
        jobsById.set(job.id, job);
    });

    function persistJobs() {
        store.saveJobs(Array.from(jobsById.values()).sort((a, b) => {
            return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        }));
    }

    function getState() {
        const disclosures = store.getDisclosures();
        const classifications = store.getClassifications();
        const byId = new Map(classifications.map((c) => [String(c.id), c]));
        const enriched = disclosures.map((d) => ({
            ...d,
            classification: byId.get(String(d.id)) || null
        }));

        const watchlist = store.getWatchlist();
        return {
            watchlist,
            disclosures: enriched.slice(0, 100),
            classifications: classifications.slice(0, 100),
            jobs: Array.from(jobsById.values()).slice(0, 30),
            queueLength: queue.length,
            running,
            lastError,
            lastScrapeAt,
            digest: buildDailyDigest(enriched, watchlist),
            pollIntervalMs: POLL_MS,
            oracleOnline,
            oracleCheckedAt,
            oracleError,
            eclipse: oracleOnline !== true,
            model: ollama.DEFAULT_MODEL,
            ollamaBaseUrl: ollama.DEFAULT_BASE,
            language: scrape.LANGUAGE,
            disclaimer: 'Not investment advice. For personal research only.'
        };
    }

    async function refreshOracle(broadcast = true) {
        const prev = oracleOnline;
        const health = await ollama.checkHealth();
        oracleOnline = health.online === true;
        oracleCheckedAt = health.checkedAt;
        oracleError = health.online ? null : (health.error || 'Ollama unreachable');
        if (broadcast && prev !== oracleOnline) {
            if (!oracleOnline) {
                logger.warn('KAP', `Eclipse: oracle offline (${oracleError})`);
            } else {
                logger.info('KAP', 'Eclipse lifted: oracle online');
            }
            broadcastState();
        }
        return oracleOnline;
    }

    function updateWatchlist(mutator) {
        const next = mutator();
        broadcastState();
        return next;
    }

    function broadcastState() {
        broadcastToAll({
            type: 'kap_state',
            data: getState()
        });
    }

    function classifyTextForDisclosure(disclosure) {
        const subject = disclosure.subject || disclosure.title || '';
        const summary = disclosure.summary || '';
        return `Konu: ${subject}\nÖzet: ${summary}`.trim();
    }

    function enqueueClassify(payload) {
        if (!oracleOnline) {
            lastError = 'Oracle offline — classify paused until Ollama is back';
            broadcastState();
            return null;
        }
        const id = payload.jobId || `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const job = {
            id,
            status: 'pending',
            stock: payload.stock,
            disclosureId: payload.disclosureId || null,
            text: payload.text,
            createdAt: new Date().toISOString(),
            startedAt: null,
            finishedAt: null,
            error: null,
            result: null
        };
        jobsById.set(id, job);
        queue.push(job);
        persistJobs();
        broadcastState();
        pumpQueue();
        return job;
    }

    async function runJob(job) {
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        persistJobs();
        broadcastState();
        logger.info('KAP', `Classify job ${job.id} started for ${job.stock}`);

        try {
            let modelOut;
            try {
                modelOut = await ollama.classifyKap({
                    stock: job.stock,
                    text: job.text
                });
            } catch (err) {
                // One silent retry per contract
                logger.warn('KAP', `Classify retry after: ${err.message || err}`);
                modelOut = await ollama.classifyKap({
                    stock: job.stock,
                    text: job.text
                });
            }

            const disclosure = job.disclosureId
                ? store.getDisclosures().find((d) => String(d.id) === String(job.disclosureId))
                : null;

            const record = {
                id: job.disclosureId || job.id,
                stock: modelOut.stock || job.stock,
                sentiment: modelOut.sentiment,
                confidence: modelOut.confidence,
                summary: modelOut.summary,
                reason: modelOut.reason,
                date: (disclosure && disclosure.date) || new Date().toISOString(),
                sourceUrl: (disclosure && disclosure.sourceUrl) || null,
                language: (disclosure && disclosure.language) || scrape.LANGUAGE,
                model: ollama.DEFAULT_MODEL,
                classifiedAt: new Date().toISOString()
            };

            store.upsertClassification(record);
            job.status = 'done';
            job.result = record;
            job.finishedAt = new Date().toISOString();
            job.error = null;
            lastError = null;
            logger.info('KAP', `Classify job ${job.id} done: ${record.sentiment}`);
        } catch (err) {
            job.status = 'error';
            job.error = err.message || String(err);
            job.finishedAt = new Date().toISOString();
            lastError = job.error;
            logger.error('KAP', `Classify job ${job.id} failed: ${job.error}`);
            // Likely connectivity — flip Eclipse if Ollama is gone
            refreshOracle(true).catch(() => {});
        }

        persistJobs();
        broadcastState();
    }

    async function pumpQueue() {
        if (running) return;
        const next = queue.shift();
        if (!next) return;
        running = true;
        try {
            await runJob(next);
        } finally {
            running = false;
            if (queue.length) {
                setImmediate(() => pumpQueue());
            }
        }
    }

    async function scrapeNow({ mode = 'watchlist', autoClassify = AUTO_CLASSIFY } = {}) {
        const watchlist = store.getWatchlist();
        // Empty watchlist → general scan so the UI still does something useful
        const effectiveMode = (mode === 'watchlist' && !watchlist.length) ? 'general' : mode;

        logger.info(
            'KAP',
            `Scrape started mode=${effectiveMode} (watchlist: ${watchlist.join(', ') || 'empty'})`
        );

        const result = await scrape.fetchRecentDisclosures({ mode: effectiveMode });
        lastScrapeAt = new Date().toISOString();
        const beforeIds = new Set(store.getDisclosures().map((d) => String(d.id)));
        const { added, list } = store.upsertDisclosures(result.items);
        logger.info(
            'KAP',
            `Scrape finished (${result.mode}): ${result.scraped || 0} raw, ${result.items.length} kept, ${added} new` +
            (result.note ? ` — ${result.note}` : '')
        );

        // Auto-classify only watchlist hits (never flood Ollama on a general scan)
        if (autoClassify && result.mode === 'watchlist' && watchlist.length) {
            result.items.forEach((d) => {
                const isNew = !beforeIds.has(String(d.id));
                const already = store.getClassificationById(d.id);
                if (!isNew || already) return;
                enqueueClassify({
                    stock: d.stock,
                    disclosureId: d.id,
                    text: classifyTextForDisclosure(d)
                });
            });
        }

        broadcastState();
        return { ...result, added, total: list.length };
    }

    app.get('/api/kap', (req, res) => {
        res.json(getState());
    });

    app.get('/api/kap/disclosures', (req, res) => {
        res.json({
            watchlist: store.getWatchlist(),
            disclosures: getState().disclosures
        });
    });

    app.post('/api/kap/watchlist', (req, res) => {
        try {
            const body = req.body || {};
            const action = String(body.action || '').toLowerCase();
            let watchlist;
            if (action === 'add') {
                watchlist = updateWatchlist(() => store.addWatchlistCode(body.code));
            } else if (action === 'remove') {
                watchlist = updateWatchlist(() => store.removeWatchlistCode(body.code));
            } else if (action === 'set' && Array.isArray(body.codes)) {
                watchlist = updateWatchlist(() => store.setWatchlist(body.codes));
            } else {
                res.status(400).json({ ok: false, error: 'action must be add, remove, or set' });
                return;
            }
            res.json({ ok: true, watchlist, state: getState() });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message || String(err) });
        }
    });

    app.get('/api/kap/jobs/:id', (req, res) => {
        const job = jobsById.get(req.params.id);
        if (!job) {
            res.status(404).json({ error: 'Job not found' });
            return;
        }
        res.json(job);
    });

    app.post('/api/kap/scrape', async (req, res) => {
        try {
            const mode = (req.body && req.body.mode) === 'general' ? 'general' : 'watchlist';
            const out = await scrapeNow({
                mode,
                autoClassify: mode === 'watchlist'
            });
            res.json({ ok: true, ...out, state: getState() });
        } catch (err) {
            lastError = err.message || String(err);
            logger.error('KAP', `Scrape failed: ${lastError}`);
            broadcastState();
            res.status(500).json({ ok: false, error: lastError });
        }
    });

    app.post('/api/kap/classify', (req, res) => {
        const body = req.body || {};
        const stock = String(body.stock || '').trim().toUpperCase();
        const text = String(body.text || '').trim();
        const disclosureId = body.disclosureId ? String(body.disclosureId) : null;

        let finalStock = stock;
        let finalText = text;

        if (disclosureId) {
            const d = store.getDisclosures().find((x) => String(x.id) === disclosureId);
            if (!d) {
                res.status(404).json({ error: 'Disclosure not found' });
                return;
            }
            finalStock = d.stock;
            finalText = text || classifyTextForDisclosure(d);
        }

        if (!finalStock || !finalText) {
            res.status(400).json({ error: 'stock and text (or disclosureId) required' });
            return;
        }

        const job = enqueueClassify({
            stock: finalStock,
            disclosureId,
            text: finalText
        });
        if (!job) {
            res.status(503).json({
                ok: false,
                error: 'Oracle offline — classify paused until Ollama is back',
                state: getState()
            });
            return;
        }
        res.status(202).json({ ok: true, job });
    });

    onClientConnected((ws) => {
        ws.send(JSON.stringify({
            type: 'kap_state',
            data: getState()
        }));
    });

    onClientMessage((ws, data) => {
        if (data.type === 'kap_watchlist_add') {
            updateWatchlist(() => store.addWatchlistCode(data.code));
            return true;
        }
        if (data.type === 'kap_watchlist_remove') {
            updateWatchlist(() => store.removeWatchlistCode(data.code));
            return true;
        }
        if (data.type === 'kap_scrape') {
            const mode = data.mode === 'general' ? 'general' : 'watchlist';
            scrapeNow({
                mode,
                autoClassify: mode === 'watchlist'
            }).catch((err) => {
                lastError = err.message || String(err);
                logger.error('KAP', `WS scrape failed: ${lastError}`);
                broadcastState();
            });
            return true;
        }
        if (data.type === 'kap_classify') {
            const stock = String(data.stock || '').trim().toUpperCase();
            const text = String(data.text || '').trim();
            const disclosureId = data.disclosureId ? String(data.disclosureId) : null;
            if (disclosureId) {
                const d = store.getDisclosures().find((x) => String(x.id) === disclosureId);
                if (d) {
                    enqueueClassify({
                        stock: d.stock,
                        disclosureId: d.id,
                        text: text || classifyTextForDisclosure(d)
                    });
                    return true;
                }
            }
            if (stock && text) {
                enqueueClassify({ stock, text, disclosureId: null });
            }
            return true;
        }
        return false;
    });

    function scheduleScrape() {
        if (!(POLL_MS > 0)) {
            logger.info('KAP', 'Scheduled scrape disabled (KAP_POLL_INTERVAL_MS <= 0)');
            return;
        }

        const run = () => {
            const mode = store.getWatchlist().length ? 'watchlist' : 'general';
            scrapeNow({ mode, autoClassify: mode === 'watchlist' }).catch((err) => {
                logger.warn('KAP', `Scheduled scrape failed: ${err.message || err}`);
            });
        };

        setTimeout(() => {
            run();
        }, 8000);
        setInterval(run, POLL_MS);
        logger.info('KAP', `Scheduled scrape every ${Math.round(POLL_MS / 60000)} min`);
    }

    scheduleScrape();

    function scheduleOracleWatch() {
        const tick = () => {
            refreshOracle(true).catch((err) => {
                logger.warn('KAP', `Oracle health check failed: ${err.message || err}`);
            });
        };
        // Immediate probe so widgets know eclipse state on boot
        setTimeout(tick, 1500);
        setInterval(tick, 30000);
    }

    scheduleOracleWatch();

    logger.info('KAP', `KAP module registered (model=${ollama.DEFAULT_MODEL}, prompt=${ollama.resolvePromptPath()})`);
}

module.exports = {
    id: 'kap',
    name: 'KAP',
    register
};
