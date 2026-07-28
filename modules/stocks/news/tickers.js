/**
 * Map RSS headline text → curated BIST codes (code or company name hit).
 */
const { BIST_SYMBOLS, isBistCode } = require('../symbols');
const yahoo = require('../yahoo');

const SKIP = new Set(['XU100', 'XU030']);

function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchTickers(text) {
    const raw = String(text || '');
    const upper = raw.toUpperCase();
    const hits = new Set();

    BIST_SYMBOLS.forEach((item) => {
        if (!item || SKIP.has(item.code)) return;
        const code = item.code;
        const codeRe = new RegExp(`(^|[^A-Z0-9])${escapeRe(code)}([^A-Z0-9]|$)`, 'i');
        if (codeRe.test(upper)) {
            hits.add(code);
            return;
        }
        const name = String(item.name || '').trim();
        if (name.length >= 4) {
            const nameRe = new RegExp(escapeRe(name), 'i');
            if (nameRe.test(raw)) hits.add(code);
        }
    });

    return Array.from(hits).filter((c) => isBistCode(c)).map((c) => yahoo.canonicalize(c));
}

module.exports = { matchTickers };
