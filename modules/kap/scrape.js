/**
 * KAP public disclosure scrape (Turkish site APIs).
 * Filters to watchlist stock codes.
 */
const LANGUAGE = process.env.KAP_LANGUAGE || 'tr';
const BASE = `https://www.kap.org.tr/${LANGUAGE}`;

function getWatchlist() {
    return String(process.env.KAP_WATCHLIST || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
}

function parseKapDate(value) {
    if (!value) return new Date().toISOString();
    // "26.05.2026 09:10:35" or ISO
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

async function fetchRecentDisclosures(days = 7) {
    const watchlist = getWatchlist();
    if (!watchlist.length) {
        return { watchlist, items: [], note: 'KAP_WATCHLIST is empty' };
    }

    const to = new Date();
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const raw = await fetchByCriteria(ymd(from), ymd(to));
    const filtered = raw
        .filter((row) => matchesWatchlist(row, watchlist))
        .map((row) => normalizeItem(row, watchlist))
        .filter(Boolean);

    return { watchlist, items: filtered, scraped: raw.length };
}

module.exports = {
    getWatchlist,
    fetchRecentDisclosures,
    LANGUAGE,
    BASE
};
