/**
 * Yahoo Finance chart API client (no API key).
 * Quotes + OHLCV history via /v8/finance/chart/{symbol}
 */
const { isBistCode } = require('./symbols');

const CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'HomeHub-Stocks/1.0';
const FETCH_TIMEOUT_MS = 12000;
const QUOTE_TTL_MS = 45 * 1000;
const CHART_TTL_MS = 5 * 60 * 1000;
const CONCURRENCY = 4;

const quoteCache = new Map(); // displayCode -> { at, data }
const chartCache = new Map(); // key -> { at, data }

function normalizeCode(raw) {
    return String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9.\-=^]/g, '')
        .slice(0, 24);
}

/** Store / display form: bare when known BIST; keep .IS for unlisted BIST. */
function canonicalize(raw) {
    const code = normalizeCode(raw);
    if (!code) return '';
    if (code.endsWith('.IS')) {
        const bare = code.slice(0, -3);
        if (isBistCode(bare)) return bare;
        return code;
    }
    return code;
}

/** Map display/watchlist code → Yahoo symbol. */
function toYahooSymbol(raw) {
    const code = normalizeCode(raw);
    if (!code) return null;
    if (code.endsWith('.IS')) return code;
    if (/[.\-=^]/.test(code)) return code;
    if (isBistCode(code)) return `${code}.IS`;
    return code;
}

function displayLabel(raw) {
    const code = canonicalize(raw) || normalizeCode(raw);
    if (code.endsWith('.IS')) return code.slice(0, -3);
    return code;
}

function cacheGet(map, key, ttl) {
    const hit = map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > ttl) {
        map.delete(key);
        return null;
    }
    return hit.data;
}

function cacheSet(map, key, data) {
    map.set(key, { at: Date.now(), data });
}

async function fetchChart(yahooSymbol, { range = '5d', interval = '1d' } = {}) {
    const url = `${CHART_BASE}/${encodeURIComponent(yahooSymbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: {
                'User-Agent': UA,
                Accept: 'application/json'
            }
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Yahoo HTTP ${res.status}: ${body.slice(0, 120)}`);
        }
        const json = await res.json();
        const err = json && json.chart && json.chart.error;
        if (err) {
            throw new Error(err.description || err.code || 'Yahoo chart error');
        }
        const result = json && json.chart && Array.isArray(json.chart.result) ? json.chart.result[0] : null;
        if (!result) throw new Error('Yahoo returned no chart result');
        return result;
    } finally {
        clearTimeout(timer);
    }
}

function previousCloseFrom(result) {
    const meta = result.meta || {};
    if (typeof meta.chartPreviousClose === 'number') return meta.chartPreviousClose;
    if (typeof meta.previousClose === 'number') return meta.previousClose;
    const closes = result.indicators && result.indicators.quote && result.indicators.quote[0]
        ? result.indicators.quote[0].close
        : null;
    if (Array.isArray(closes)) {
        for (let i = closes.length - 2; i >= 0; i -= 1) {
            if (typeof closes[i] === 'number') return closes[i];
        }
    }
    return null;
}

function parseQuote(displayCode, result) {
    const meta = result.meta || {};
    const price = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null;
    const previousClose = previousCloseFrom(result);
    let change = null;
    let changePercent = null;
    if (price != null && previousClose != null && previousClose !== 0) {
        change = Math.round((price - previousClose) * 10000) / 10000;
        changePercent = Math.round(((price - previousClose) / previousClose) * 10000) / 100;
    }
    return {
        symbol: displayCode,
        yahooSymbol: meta.symbol || toYahooSymbol(displayCode),
        price,
        previousClose,
        change,
        changePercent,
        currency: meta.currency || 'TRY',
        exchange: meta.exchangeName || meta.fullExchangeName || '',
        marketState: meta.marketState || '',
        shortName: meta.shortName || meta.longName || displayCode,
        delayed: true,
        source: 'yahoo',
        updatedAt: new Date().toISOString()
    };
}

function parseHistory(displayCode, result) {
    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const quote = result.indicators && result.indicators.quote && result.indicators.quote[0]
        ? result.indicators.quote[0]
        : {};
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];
    const bars = [];
    for (let i = 0; i < timestamps.length; i += 1) {
        const close = closes[i];
        if (typeof close !== 'number') continue;
        bars.push({
            t: timestamps[i] * 1000,
            o: typeof opens[i] === 'number' ? opens[i] : close,
            h: typeof highs[i] === 'number' ? highs[i] : close,
            l: typeof lows[i] === 'number' ? lows[i] : close,
            c: close,
            v: typeof volumes[i] === 'number' ? volumes[i] : 0
        });
    }
    return {
        symbol: displayCode,
        yahooSymbol: (result.meta && result.meta.symbol) || toYahooSymbol(displayCode),
        currency: (result.meta && result.meta.currency) || 'TRY',
        bars,
        meta: parseQuote(displayCode, result),
        updatedAt: new Date().toISOString()
    };
}

async function getQuote(rawCode, { force = false } = {}) {
    const display = canonicalize(rawCode);
    if (!display) throw new Error('symbol required');
    if (!force) {
        const cached = cacheGet(quoteCache, display, QUOTE_TTL_MS);
        if (cached) return cached;
    }
    const yahooSymbol = toYahooSymbol(display);
    const result = await fetchChart(yahooSymbol, { range: '5d', interval: '1d' });
    const quote = parseQuote(display, result);
    cacheSet(quoteCache, display, quote);
    return quote;
}

async function mapPool(items, limit, fn) {
    const out = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const i = idx;
            idx += 1;
            out[i] = await fn(items[i], i);
        }
    }
    const n = Math.min(limit, Math.max(1, items.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
    return out;
}

async function getQuotes(codes, { force = false } = {}) {
    const list = [...new Set((codes || []).map(canonicalize).filter(Boolean))];
    const results = await mapPool(list, CONCURRENCY, async (code) => {
        try {
            return await getQuote(code, { force });
        } catch (err) {
            const stale = quoteCache.get(code);
            return {
                symbol: code,
                yahooSymbol: toYahooSymbol(code),
                error: err.message || String(err),
                price: stale && stale.data ? stale.data.price : null,
                changePercent: stale && stale.data ? stale.data.changePercent : null,
                currency: stale && stale.data ? stale.data.currency : null,
                delayed: true,
                source: 'yahoo',
                updatedAt: new Date().toISOString()
            };
        }
    });
    return results;
}

async function getHistory(rawCode, { range = '1mo', interval = '1d', force = false } = {}) {
    const display = canonicalize(rawCode);
    if (!display) throw new Error('symbol required');
    const allowedRanges = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y']);
    const allowedIntervals = new Set(['1m', '5m', '15m', '30m', '1h', '1d', '1wk']);
    const r = allowedRanges.has(range) ? range : '1mo';
    const iv = allowedIntervals.has(interval) ? interval : '1d';
    const key = `${display}|${r}|${iv}`;
    if (!force) {
        const cached = cacheGet(chartCache, key, CHART_TTL_MS);
        if (cached) return cached;
    }
    const yahooSymbol = toYahooSymbol(display);
    const result = await fetchChart(yahooSymbol, { range: r, interval: iv });
    const history = parseHistory(display, result);
    history.range = r;
    history.interval = iv;
    cacheSet(chartCache, key, history);
    // Refresh quote cache from chart meta
    if (history.meta && history.meta.price != null) {
        cacheSet(quoteCache, display, history.meta);
    }
    return history;
}

function getCachedQuote(rawCode) {
    const display = canonicalize(rawCode);
    const hit = quoteCache.get(display);
    return hit ? hit.data : null;
}

module.exports = {
    normalizeCode,
    canonicalize,
    toYahooSymbol,
    displayLabel,
    getQuote,
    getQuotes,
    getHistory,
    getCachedQuote,
    QUOTE_TTL_MS,
    CHART_TTL_MS
};
