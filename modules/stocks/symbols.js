/**
 * Curated BIST browse list (codes + short names). No prices — prices come from Yahoo.
 */
const BIST_SYMBOLS = [
    { code: 'AEFES', name: 'Anadolu Efes' },
    { code: 'AKBNK', name: 'Akbank' },
    { code: 'AKSEN', name: 'Aksa Enerji' },
    { code: 'ALARK', name: 'Alarko Holding' },
    { code: 'ARCLK', name: 'Arçelik' },
    { code: 'ASELS', name: 'Aselsan' },
    { code: 'ASTOR', name: 'Astor Enerji' },
    { code: 'BIMAS', name: 'BİM' },
    { code: 'BRSAN', name: 'Borusan Mannesmann' },
    { code: 'CIMSA', name: 'Çimsa' },
    { code: 'DOAS', name: 'Doğuş Otomotiv' },
    { code: 'DOHOL', name: 'Doğan Holding' },
    { code: 'EKGYO', name: 'Emlak Konut GYO' },
    { code: 'ENKAI', name: 'Enka İnşaat' },
    { code: 'EREGL', name: 'Ereğli Demir Çelik' },
    { code: 'FROTO', name: 'Ford Otosan' },
    { code: 'GARAN', name: 'Garanti BBVA' },
    { code: 'GUBRF', name: 'Gübre Fabrikaları' },
    { code: 'HEKTS', name: 'Hektaş' },
    { code: 'ISCTR', name: 'İş Bankası (C)' },
    { code: 'KCHOL', name: 'Koç Holding' },
    { code: 'KONTR', name: 'Kontrolmatik' },
    { code: 'KOZAA', name: 'Koza Anadolu' },
    { code: 'KOZAL', name: 'Koza Altın' },
    { code: 'KRDMD', name: 'Kardemir (D)' },
    { code: 'ODAS', name: 'Odaş Elektrik' },
    { code: 'OYAKC', name: 'Oyak Çimento' },
    { code: 'PETKM', name: 'Petkim' },
    { code: 'PGSUS', name: 'Pegasus' },
    { code: 'SAHOL', name: 'Sabancı Holding' },
    { code: 'SASA', name: 'Sasa Polyester' },
    { code: 'SISE', name: 'Şişecam' },
    { code: 'SKBNK', name: 'Şekerbank' },
    { code: 'SMRTG', name: 'Smart Güneş' },
    { code: 'SOKM', name: 'Şok Marketler' },
    { code: 'TAVHL', name: 'TAV Havalimanları' },
    { code: 'TCELL', name: 'Turkcell' },
    { code: 'THYAO', name: 'Türk Hava Yolları' },
    { code: 'TOASO', name: 'Tofaş' },
    { code: 'TSKB', name: 'TSKB' },
    { code: 'TTKOM', name: 'Türk Telekom' },
    { code: 'TUPRS', name: 'Tüpraş' },
    { code: 'ULKER', name: 'Ülker' },
    { code: 'VESTL', name: 'Vestel' },
    { code: 'YKBNK', name: 'Yapı Kredi' },
    { code: 'ZOREN', name: 'Zorlu Enerji' },
    { code: 'XU100', name: 'BIST 100' },
    { code: 'XU030', name: 'BIST 30' }
];

const BIST_SET = new Set(BIST_SYMBOLS.map((s) => s.code));

function isBistCode(raw) {
    const code = String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/\.IS$/, '');
    return BIST_SET.has(code);
}

function getBistSymbols() {
    return BIST_SYMBOLS.slice();
}

function searchBist(query, limit = 40) {
    const q = String(query || '')
        .trim()
        .toUpperCase();
    const max = Math.min(100, Math.max(1, Number(limit) || 40));
    if (!q) {
        return BIST_SYMBOLS.slice(0, max);
    }
    const starts = [];
    const contains = [];
    for (const item of BIST_SYMBOLS) {
        const code = item.code;
        const name = String(item.name || '').toUpperCase();
        if (code.startsWith(q) || name.startsWith(q)) starts.push(item);
        else if (code.includes(q) || name.includes(q)) contains.push(item);
    }
    return starts.concat(contains).slice(0, max);
}

module.exports = {
    BIST_SYMBOLS,
    isBistCode,
    getBistSymbols,
    searchBist
};
