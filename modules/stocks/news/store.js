/**
 * News headline persistence (RSS metadata only — no full articles).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data', 'stocks');
const HEADLINES_FILE = path.join(DATA_DIR, 'news-headlines.json');
const SEEN_FILE = path.join(DATA_DIR, 'news-seen.json');

const MAX_HEADLINES = Number(process.env.NEWS_RSS_MAX_HEADLINES || 200);
const MAX_SEEN = Number(process.env.NEWS_RSS_MAX_SEEN || 1000);

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function readJson(file, fallback) {
    try {
        ensureDir();
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function writeJson(file, data) {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getHeadlines() {
    const list = readJson(HEADLINES_FILE, []);
    return Array.isArray(list) ? list : [];
}

function saveHeadlines(list) {
    writeJson(HEADLINES_FILE, (list || []).slice(0, MAX_HEADLINES));
}

function upsertHeadlines(items) {
    const byId = new Map();
    getHeadlines().forEach((h) => {
        if (h && h.id) byId.set(String(h.id), h);
    });
    (items || []).forEach((item) => {
        if (!item || !item.id) return;
        const prev = byId.get(String(item.id)) || {};
        byId.set(String(item.id), {
            ...prev,
            ...item,
            id: String(item.id),
            updatedAt: new Date().toISOString()
        });
    });
    const next = Array.from(byId.values()).sort((a, b) => {
        return new Date(b.publishedAt || b.updatedAt || 0) - new Date(a.publishedAt || a.updatedAt || 0);
    });
    saveHeadlines(next);
    return next;
}

function getSeen() {
    const list = readJson(SEEN_FILE, []);
    return Array.isArray(list) ? list.map(String) : [];
}

function markSeen(ids) {
    const set = new Set(getSeen());
    (ids || []).forEach((id) => {
        if (id) set.add(String(id));
    });
    const next = Array.from(set);
    writeJson(SEEN_FILE, next.slice(-MAX_SEEN));
    return next;
}

function isSeen(id) {
    return getSeen().includes(String(id));
}

module.exports = {
    getHeadlines,
    upsertHeadlines,
    getSeen,
    markSeen,
    isSeen
};
