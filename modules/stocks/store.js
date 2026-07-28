/**
 * Stocks persistence — watchlist under data/stocks/ (separate from KAP).
 */
const fs = require('fs');
const path = require('path');
const yahoo = require('./yahoo');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'stocks');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');

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

function normalizeCodes(codes) {
    const seen = new Set();
    const out = [];
    (Array.isArray(codes) ? codes : []).forEach((raw) => {
        const code = yahoo.canonicalize(raw);
        if (!code || seen.has(code)) return;
        seen.add(code);
        out.push(code);
    });
    return out;
}

function envWatchlist() {
    return normalizeCodes(String(process.env.STOCKS_WATCHLIST || '').split(/[,;\s]+/));
}

function getWatchlist() {
    const saved = readJson(WATCHLIST_FILE, null);
    if (Array.isArray(saved)) {
        return normalizeCodes(saved);
    }
    const fromEnv = envWatchlist();
    writeJson(WATCHLIST_FILE, fromEnv);
    return fromEnv;
}

function setWatchlist(codes) {
    const next = normalizeCodes(codes);
    writeJson(WATCHLIST_FILE, next);
    return next;
}

function addWatchlistCode(code) {
    const next = normalizeCodes(getWatchlist().concat([code]));
    writeJson(WATCHLIST_FILE, next);
    return next;
}

function removeWatchlistCode(code) {
    const target = yahoo.canonicalize(code);
    const next = getWatchlist().filter((c) => c !== target);
    writeJson(WATCHLIST_FILE, next);
    return next;
}

module.exports = {
    DATA_DIR,
    getWatchlist,
    setWatchlist,
    addWatchlistCode,
    removeWatchlistCode,
    normalizeCodes
};
