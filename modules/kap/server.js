/**
 * KAP module (server) — scrape watchlist disclosures, queue Ollama classify, persist.
 */
const store = require('./store');
const scrape = require('./scrape');
const ollama = require('./ollama');

const POLL_MS = Number(process.env.KAP_POLL_INTERVAL_MS || 15 * 60 * 1000);
const AUTO_CLASSIFY = String(process.env.KAP_AUTO_CLASSIFY || '1') !== '0';

function register(ctx) {
    const { app, logger, broadcastToAll, onClientConnected, onClientMessage } = ctx;

    const queue = [];
    const jobsById = new Map();
    let running = false;
    let lastError = null;
    let lastScrapeAt = null;

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

        return {
            watchlist: scrape.getWatchlist(),
            disclosures: enriched.slice(0, 100),
            classifications: classifications.slice(0, 100),
            jobs: Array.from(jobsById.values()).slice(0, 30),
            queueLength: queue.length,
            running,
            lastError,
            lastScrapeAt,
            model: ollama.DEFAULT_MODEL,
            ollamaBaseUrl: ollama.DEFAULT_BASE,
            language: scrape.LANGUAGE,
            disclaimer: 'Not investment advice. For personal research only.'
        };
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

    async function scrapeNow({ autoClassify = AUTO_CLASSIFY } = {}) {
        logger.info('KAP', `Scrape started (watchlist: ${scrape.getWatchlist().join(', ') || 'empty'})`);
        const result = await scrape.fetchRecentDisclosures(7);
        lastScrapeAt = new Date().toISOString();
        const beforeIds = new Set(store.getDisclosures().map((d) => String(d.id)));
        const { added, list } = store.upsertDisclosures(result.items);
        logger.info('KAP', `Scrape finished: ${result.scraped || 0} raw, ${result.items.length} watchlist matches, ${added} new`);

        if (autoClassify) {
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
            watchlist: scrape.getWatchlist(),
            disclosures: getState().disclosures
        });
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
            const out = await scrapeNow({ autoClassify: true });
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
        res.status(202).json({ ok: true, job });
    });

    onClientConnected((ws) => {
        ws.send(JSON.stringify({
            type: 'kap_state',
            data: getState()
        }));
    });

    onClientMessage((ws, data) => {
        if (data.type === 'kap_scrape') {
            scrapeNow({ autoClassify: true }).catch((err) => {
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

    // Need JSON body parser for POST routes — ensure express.json is available
    // (server.js should already use it; if not, routes still work via WS)

    if (scrape.getWatchlist().length && POLL_MS > 0) {
        setTimeout(() => {
            scrapeNow({ autoClassify: true }).catch((err) => {
                logger.warn('KAP', `Initial scrape skipped: ${err.message || err}`);
            });
        }, 8000);
        setInterval(() => {
            scrapeNow({ autoClassify: true }).catch((err) => {
                logger.warn('KAP', `Scheduled scrape failed: ${err.message || err}`);
            });
        }, POLL_MS);
    } else {
        logger.info('KAP', 'No KAP_WATCHLIST set — scrape idle until configured');
    }

    logger.info('KAP', `KAP module registered (model=${ollama.DEFAULT_MODEL}, prompt=${ollama.resolvePromptPath()})`);
}

module.exports = {
    id: 'kap',
    name: 'KAP',
    register
};
