/**
 * KAP public disclosure scrape (Turkish site APIs).
 * Modes: watchlist (filter codes) | general (recent market feed)
 */
const store = require('./store');

const LANGUAGE = process.env.KAP_LANGUAGE || 'tr';
const BASE = `https://www.kap.org.tr/${LANGUAGE}`;
const GENERAL_DAYS = Number(process.env.KAP_GENERAL_DAYS || 1);
const GENERAL_LIMIT = Number(process.env.KAP_GENERAL_LIMIT || 150);

function getWatchlist() {
    return store.getWatchlist();
}

function parseKapDate(value) {
    if (!value) return new Date().toISOString();
    const m = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
    if (m) {
        const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
        const d = new Date(iso);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function codesFrom(raw) {
    if (!raw) return [];
    return String(raw)
        .split(/[,;\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
}

function matchesWatchlist(item, watchlist) {
    if (!watchlist.length) return false;
    const related = codesFrom(item.relatedStocks);
    const own = codesFrom(item.stockCodes);
    const all = new Set([...related, ...own]);
    return watchlist.some((code) => all.has(code));
}

function pickStock(item, watchlist) {
    const related = codesFrom(item.relatedStocks);
    const own = codesFrom(item.stockCodes);
    for (const code of watchlist) {
        if (related.includes(code) || own.includes(code)) return code;
    }
    return related[0] || own[0] || 'UNKNOWN';
}

function normalizeItem(raw, watchlist) {
    const id = String(raw.disclosureIndex || raw.disclosureId || raw.id || '');
    if (!id) return null;
    const subject = raw.subject || raw.title || '';
    const summary = raw.summary || '';
    return {
        id,
        date: parseKapDate(raw.publishDate || raw.date),
        stock: pickStock(raw, watchlist),
        company: raw.kapTitle || raw.companyTitle || raw.companyName || '',
        type: raw.disclosureType || raw.disclosureCategory || raw.disclosureClass || '',
        subject,
        summary,
        sourceUrl: `${BASE}/Bildirim/${id}`,
        language: LANGUAGE
    };
}

function ymd(date) {
    return date.toISOString().slice(0, 10);
}

async function fetchByCriteria(fromDate, toDate) {
    const url = `${BASE}/api/disclosure/members/byCriteria`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Referer: `${BASE}/bildirim-sorgu`,
            'User-Agent': 'HomeHub-KAP/1.0'
        },
        body: JSON.stringify({
            fromDate,
            toDate,
            mkkMemberOidList: [],
            subjectList: []
        })
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`KAP byCriteria HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

/**
 * @param {{ mode?: 'watchlist'|'general', days?: number }} opts
 */
async function fetchRecentDisclosures(opts = {}) {
    const watchlist = getWatchlist();
    const mode = opts.mode === 'general' || (!opts.mode && !watchlist.length)
        ? 'general'
        : (opts.mode || 'watchlist');

    const days = Number(opts.days) || (mode === 'general' ? GENERAL_DAYS : 7);
    const to = new Date();
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const raw = await fetchByCriteria(ymd(from), ymd(to));

    if (mode === 'general') {
        const items = raw
            .map((row) => normalizeItem(row, watchlist))
            .filter(Boolean)
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, GENERAL_LIMIT);

        return {
            mode: 'general',
            watchlist,
            items,
            scraped: raw.length,
            days,
            note: `General scan: last ${days} day(s), capped at ${GENERAL_LIMIT}`
        };
    }

    if (!watchlist.length) {
        return {
            mode: 'watchlist',
            watchlist,
            items: [],
            scraped: raw.length,
            days,
            note: 'Watchlist is empty — use general scan or add tickers'
        };
    }

    const filtered = raw
        .filter((row) => matchesWatchlist(row, watchlist))
        .map((row) => normalizeItem(row, watchlist))
        .filter(Boolean);

    return {
        mode: 'watchlist',
        watchlist,
        items: filtered,
        scraped: raw.length,
        days
    };
}

module.exports = {
    getWatchlist,
    fetchRecentDisclosures,
    matchesWatchlist,
    LANGUAGE,
    BASE,
    GENERAL_DAYS,
    GENERAL_LIMIT
};
