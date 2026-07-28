/**
 * Investing RSS → Ollama classify → paper strategy (headlines only).
 * Disabled unless NEWS_RSS_ENABLED=1 (personal RSS use / ToS awareness).
 */
const kapOllama = require('../../kap/ollama');
const { config: paperConfig } = require('../paper/config');
const strategy = require('../paper/strategy');
const rss = require('./rss');
const newsStore = require('./store');
const { matchTickers } = require('./tickers');

const ENABLED = String(process.env.NEWS_RSS_ENABLED || '0') === '1';
const POLL_MS = Number(process.env.NEWS_RSS_POLL_MS || 15 * 60 * 1000);
const MAX_PER_POLL = Number(process.env.NEWS_RSS_MAX_PER_POLL || 8);

let lastPollAt = null;
let lastError = null;
let polling = false;
let classifying = false;
const classifyQueue = [];

function isEnabled() {
    return ENABLED;
}

function getStatus() {
    return {
        enabled: ENABLED,
        feeds: rss.DEFAULT_FEEDS,
        lastPollAt,
        lastError,
        polling,
        classifyQueue: classifyQueue.length,
        headlines: newsStore.getHeadlines().slice(0, 40),
        disclaimer: ENABLED
            ? 'RSS headlines only (no full-article scrape). Personal research. Not investment advice.'
            : 'News RSS disabled. Set NEWS_RSS_ENABLED=1 to poll Investing.com official RSS feeds.'
    };
}

function buildClassifyText(item, stock) {
    return [
        `Hisse: ${stock}`,
        `Kaynak: Investing.com RSS (başlık/özet)`,
        item.title ? `Başlık: ${item.title}` : '',
        item.description ? `Özet: ${item.description}` : '',
        item.link ? `Link: ${item.link}` : ''
    ].filter(Boolean).join('\n');
}

function enqueueClassify(job) {
    classifyQueue.push(job);
    pumpClassify();
}

async function pumpClassify() {
    if (classifying) return;
    const next = classifyQueue.shift();
    if (!next) return;
    classifying = true;
    try {
        const health = await kapOllama.checkHealth();
        if (!health.online) {
            lastError = health.error || 'Ollama offline — news classify skipped';
            newsStore.upsertHeadlines([{
                ...next.item,
                stocks: next.stocks,
                classifyError: lastError,
                classifiedAt: null
            }]);
            return;
        }

        for (const stock of next.stocks) {
            let modelOut;
            try {
                modelOut = await kapOllama.classifyKap({
                    stock,
                    text: buildClassifyText(next.item, stock)
                });
            } catch (err) {
                try {
                    modelOut = await kapOllama.classifyKap({
                        stock,
                        text: buildClassifyText(next.item, stock)
                    });
                } catch (err2) {
                    lastError = err2.message || String(err2);
                    newsStore.upsertHeadlines([{
                        ...next.item,
                        stocks: next.stocks,
                        classifyError: lastError
                    }]);
                    continue;
                }
            }

            const record = {
                id: `news:${next.item.id}:${stock}`,
                stock: modelOut.stock || stock,
                sentiment: modelOut.sentiment,
                confidence: modelOut.confidence,
                summary: modelOut.summary,
                reason: modelOut.reason,
                date: next.item.publishedAt || new Date().toISOString(),
                sourceUrl: next.item.link || null,
                language: 'tr',
                model: kapOllama.DEFAULT_MODEL,
                classifiedAt: new Date().toISOString(),
                source: 'investing_rss',
                headline: next.item.title
            };

            newsStore.upsertHeadlines([{
                ...next.item,
                stocks: next.stocks,
                lastClassification: {
                    stock: record.stock,
                    sentiment: record.sentiment,
                    confidence: record.confidence,
                    summary: record.summary
                },
                classifiedAt: record.classifiedAt,
                classifyError: null
            }]);

            if (typeof next.onClassified === 'function') {
                next.onClassified(record);
            } else {
                strategy.onClassification(record, next.quotesBySymbol || {});
            }
        }
        lastError = null;
    } finally {
        classifying = false;
        if (classifyQueue.length) {
            setImmediate(() => pumpClassify());
        }
    }
}

/**
 * Poll RSS feeds, persist new headlines, enqueue classify for BIST matches.
 */
async function pollOnce({ onClassified, quotesBySymbol } = {}) {
    if (!ENABLED) {
        return { ok: false, skipped: 'disabled', status: getStatus() };
    }
    if (polling) {
        return { ok: false, skipped: 'already_polling', status: getStatus() };
    }
    polling = true;
    try {
        const { items, errors, feeds } = await rss.fetchAllFeeds();
        lastPollAt = new Date().toISOString();
        if (errors.length) {
            lastError = errors.map((e) => `${e.url}: ${e.error}`).join('; ');
        }

        const enriched = items.map((item) => {
            const stocks = matchTickers(`${item.title} ${item.description}`);
            return { ...item, stocks };
        });
        newsStore.upsertHeadlines(enriched);

        const fresh = enriched.filter((item) => {
            if (newsStore.isSeen(item.id)) return false;
            return Array.isArray(item.stocks) && item.stocks.length > 0;
        }).slice(0, MAX_PER_POLL);

        fresh.forEach((item) => {
            newsStore.markSeen([item.id]);
            enqueueClassify({
                item,
                stocks: item.stocks,
                onClassified,
                quotesBySymbol
            });
        });

        return {
            ok: true,
            feeds,
            fetched: items.length,
            matched: fresh.length,
            errors,
            status: getStatus()
        };
    } catch (err) {
        lastError = err.message || String(err);
        return { ok: false, error: lastError, status: getStatus() };
    } finally {
        polling = false;
    }
}

function startScheduler(ctx) {
    if (!ENABLED) {
        if (ctx && ctx.logger) {
            ctx.logger.info('News', 'RSS disabled (NEWS_RSS_ENABLED!=1)');
        }
        return null;
    }
    if (POLL_MS <= 0) return null;
    if (ctx && ctx.logger) {
        ctx.logger.info('News', `RSS enabled — poll every ${Math.round(POLL_MS / 1000)}s`);
    }
    // First poll shortly after boot
    setTimeout(() => {
        pollOnce({
            onClassified: ctx && ctx.onNewsClassified
        }).catch(() => {});
    }, 8000);
    return setInterval(() => {
        pollOnce({
            onClassified: ctx && ctx.onNewsClassified
        }).catch(() => {});
    }, POLL_MS);
}

module.exports = {
    isEnabled,
    getStatus,
    pollOnce,
    startScheduler,
    matchTickers: require('./tickers').matchTickers
};
