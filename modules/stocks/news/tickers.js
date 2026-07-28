/**
 * Map RSS headline text → BIST 100 codes.
 * Matches ticker codes, full names, aliases, and partial distinctive names.
 */
const { BIST_SYMBOLS, isBistCode } = require('../symbols');
const yahoo = require('../yahoo');

const SKIP = new Set(['XU100', 'XU030']);

/** Words too generic to count as a company match alone. */
const STOP = new Set([
    'holding', 'holdings', 'bankasi', 'banka', 'enerji', 'elektrik', 'insaat',
    'otomotiv', 'marketler', 'havalimanlari', 'demir', 'celik', 'cimento',
    'polyester', 'fabrikalari', 'konut', 'gyo', 'grup', 'group', 'as', 'a.s',
    'sirketi', 'tirkiye', 'turkiye', 'turkish', 'and', 'the', 'of'
]);

/**
 * Common headline nicknames / English / short forms (normalized, no diacritics).
 * Keep specific — avoid one-letter or ultra-generic aliases.
 */
const ALIASES = {
    AEFES: ['anadolu efes', 'efes'],
    AGHOL: ['anadolu grubu', 'ag anadolu'],
    AKBNK: ['akbank'],
    AKSA: ['aksa akrilik'],
    AKSEN: ['aksa enerji'],
    ALARK: ['alarko'],
    ALTNY: ['altinay', 'altinay savunma'],
    ANSGR: ['anadolu sigorta'],
    ARCLK: ['arcelik'],
    ASELS: ['aselsan'],
    ASTOR: ['astor enerji', 'astor'],
    BALSU: ['balsu'],
    BIMAS: ['bim'],
    BRSAN: ['borusan mannesmann', 'borusan birlesik'],
    BRYAT: ['borusan yatirim'],
    BSOKE: ['batisoke', 'bati soke'],
    BTCIM: ['baticim'],
    CANTE: ['can2', 'can2 termik'],
    CCOLA: ['coca cola', 'coca-cola', 'cci'],
    CIMSA: ['cimsa'],
    CVKMD: ['cvk maden', 'cvk'],
    CWENE: ['cw enerji'],
    DAPGM: ['dap gayrimenkul', 'dap'],
    DOAS: ['dogus otomotiv', 'dogus'],
    DOHOL: ['dogan holding', 'dogan'],
    DSTKF: ['destek finans'],
    ECILC: ['eczacibasi', 'eczacibasi ilac'],
    EFOR: ['efor yatirim'],
    EKGYO: ['emlak konut', 'emlak konut gyo'],
    ENERY: ['enerya'],
    ENJSA: ['enerjisa'],
    ENKAI: ['enka'],
    EREGL: ['eregli', 'erdemir'],
    EUPWR: ['europower'],
    EUREN: ['europen'],
    FENER: ['fenerbahce', 'fb'],
    FROTO: ['ford otosan', 'otosan'],
    GARAN: ['garanti', 'garanti bbva', 'garanti bankasi'],
    GENIL: ['gen ilac'],
    GESAN: ['girisim elektrik'],
    GLRMK: ['gulermak'],
    GRSEL: ['gur-sel', 'gursel'],
    GRTHO: ['grainturk'],
    GSRAY: ['galatasaray', 'gs'],
    GUBRF: ['gubre', 'gubretas'],
    HALKB: ['halkbank', 'halk bankasi', 'turkiye halk bankasi'],
    HEKTS: ['hektas'],
    ISCTR: ['is bankasi', 'isbank', 'turkiye is bankasi'],
    ISMEN: ['is yatirim'],
    IZENR: ['izdemir'],
    KCHOL: ['koc holding', 'koc'],
    KLRHO: ['kiler holding', 'kiler'],
    KONTR: ['kontrolmatik'],
    KRDMD: ['kardemir'],
    KTLEV: ['katilimevim'],
    KUYAS: ['kuyas'],
    MAGEN: ['margun'],
    MAVI: ['mavi giyim', 'mavi'],
    MGROS: ['migros'],
    MIATK: ['mia teknoloji', 'mia'],
    MPARK: ['mlp saglik', 'mlp'],
    OBAMS: ['oba makarna', 'oba'],
    ODAS: ['odas'],
    OTKAR: ['otokar'],
    OYAKC: ['oyak cimento', 'oyak'],
    PAHOL: ['pasifik holding'],
    PASEU: ['pasifik eurasia'],
    PATEK: ['pasifik teknoloji'],
    PETKM: ['petkim'],
    PGSUS: ['pegasus'],
    PSGYO: ['pasifik gyo'],
    QUAGR: ['qua granite', 'qua'],
    RALYH: ['ral yatirim', 'ral'],
    REEDR: ['reeder'],
    SAHOL: ['sabanci', 'sabanci holding'],
    SARKY: ['sarkuysan'],
    SASA: ['sasa'],
    SISE: ['sisecam'],
    SKBNK: ['sekerbank'],
    SOKM: ['sok market', 'sok marketler', 'sok'],
    TABGD: ['tab gida'],
    TAVHL: ['tav havalimanlari', 'tav'],
    TCELL: ['turkcell'],
    THYAO: ['thy', 'turk hava yollari', 'turkish airlines', 'turkish airline'],
    TKFEN: ['tekfen'],
    TOASO: ['tofas'],
    TRALT: ['turk altin', 'koza altin'],
    TRENJ: ['dogal enerji'],
    TRMET: ['anadolu metal'],
    TSKB: ['tskb'],
    TTKOM: ['turk telekom', 'tt'],
    TUKAS: ['tukas'],
    TUPRS: ['tupras'],
    TUREX: ['tureks'],
    TURSG: ['turkiye sigorta'],
    ULKER: ['ulker'],
    VAKBN: ['vakifbank', 'vakif bankasi'],
    VESTL: ['vestel'],
    YKBNK: ['yapi kredi', 'yapikredi'],
    ZOREN: ['zorlu enerji', 'zorlu']
};

function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fold Turkish letters and lowercase for loose matching. */
function normalize(text) {
    return String(text || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .replace(/İ/g, 'i')
        .replace(/[^a-z0-9.\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function wordBoundaryRe(phrase) {
    const p = escapeRe(phrase.trim());
    if (!p) return null;
    return new RegExp(`(^|[^a-z0-9])${p}([^a-z0-9]|$)`, 'i');
}

function nameTokens(nameNorm) {
    return nameNorm
        .split(/[\s/-]+/)
        .map((t) => t.replace(/[^a-z0-9]/g, ''))
        .filter((t) => t.length >= 3 && !STOP.has(t));
}

function scoreMatch(kind) {
    if (kind === 'code') return 100;
    if (kind === 'alias') return 90;
    if (kind === 'full') return 80;
    if (kind === 'partial') return 50;
    return 0;
}

/**
 * @returns {string[]} unique BIST codes, best matches first
 */
function matchTickers(text) {
    const raw = String(text || '');
    const upper = raw.toUpperCase();
    const norm = normalize(raw);
    /** @type {Map<string, number>} */
    const scores = new Map();

    function add(code, kind) {
        if (!code || SKIP.has(code) || !isBistCode(code)) return;
        const next = scoreMatch(kind);
        const prev = scores.get(code) || 0;
        if (next > prev) scores.set(code, next);
    }

    BIST_SYMBOLS.forEach((item) => {
        if (!item || SKIP.has(item.code)) return;
        const code = item.code;

        // 1) Exact ticker in headline
        const codeRe = new RegExp(`(^|[^A-Z0-9])${escapeRe(code)}([^A-Z0-9]|$)`, 'i');
        if (codeRe.test(upper)) {
            add(code, 'code');
            return;
        }

        // 2) Configured aliases / nicknames
        const aliases = ALIASES[code] || [];
        for (const alias of aliases) {
            const a = normalize(alias);
            if (a.length < 2) continue;
            const re = wordBoundaryRe(a);
            if (re && re.test(norm)) {
                add(code, 'alias');
                return;
            }
        }

        // 3) Full curated name
        const nameNorm = normalize(item.name || '');
        if (nameNorm.length >= 3) {
            const fullRe = wordBoundaryRe(nameNorm);
            if (fullRe && fullRe.test(norm)) {
                add(code, 'full');
                return;
            }
        }

        // 4) Partial: all distinctive tokens present, or one long unique token (≥5)
        const tokens = nameTokens(nameNorm);
        if (tokens.length >= 2) {
            const allPresent = tokens.every((tok) => {
                const re = wordBoundaryRe(tok);
                return re && re.test(norm);
            });
            if (allPresent) {
                add(code, 'partial');
                return;
            }
        }
        if (tokens.length === 1 && tokens[0].length >= 5) {
            const re = wordBoundaryRe(tokens[0]);
            if (re && re.test(norm)) add(code, 'partial');
        } else if (tokens.length >= 2) {
            // Strongest token alone if ≥6 chars (e.g. "aselsan", "pegasus")
            const strong = tokens.filter((t) => t.length >= 6);
            for (const tok of strong) {
                const re = wordBoundaryRe(tok);
                if (re && re.test(norm)) {
                    add(code, 'partial');
                    break;
                }
            }
        }
    });

    return Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([code]) => yahoo.canonicalize(code));
}

module.exports = {
    matchTickers,
    normalize,
    ALIASES
};
