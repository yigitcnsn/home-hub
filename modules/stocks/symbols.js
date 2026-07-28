/**
 * BIST 100 constituents (XU100) + index symbols for browse / paper / news matching.
 * Snapshot aligned with public XU100 lists (reviewed periodically by Borsa İstanbul).
 * Prices come from Yahoo (CODE.IS). Not investment advice.
 */
const BIST_SYMBOLS = [
    { code: 'AEFES', name: 'Anadolu Efes' },
    { code: 'AGHOL', name: 'AG Anadolu Grubu' },
    { code: 'AKBNK', name: 'Akbank' },
    { code: 'AKSA', name: 'Aksa Akrilik' },
    { code: 'AKSEN', name: 'Aksa Enerji' },
    { code: 'ALARK', name: 'Alarko Holding' },
    { code: 'ALTNY', name: 'Altınay Savunma' },
    { code: 'ANSGR', name: 'Anadolu Sigorta' },
    { code: 'ARCLK', name: 'Arçelik' },
    { code: 'ASELS', name: 'Aselsan' },
    { code: 'ASTOR', name: 'Astor Enerji' },
    { code: 'BALSU', name: 'Balsu Gıda' },
    { code: 'BIMAS', name: 'BİM' },
    { code: 'BRSAN', name: 'Borusan Mannesmann' },
    { code: 'BRYAT', name: 'Borusan Yatırım' },
    { code: 'BSOKE', name: 'Batısöke' },
    { code: 'BTCIM', name: 'Batıçim' },
    { code: 'CANTE', name: 'Can2 Termik' },
    { code: 'CCOLA', name: 'Coca-Cola İçecek' },
    { code: 'CIMSA', name: 'Çimsa' },
    { code: 'CVKMD', name: 'CVK Maden' },
    { code: 'CWENE', name: 'CW Enerji' },
    { code: 'DAPGM', name: 'DAP Gayrimenkul' },
    { code: 'DOAS', name: 'Doğuş Otomotiv' },
    { code: 'DOHOL', name: 'Doğan Holding' },
    { code: 'DSTKF', name: 'Destek Finans' },
    { code: 'ECILC', name: 'Eczacıbaşı İlaç' },
    { code: 'EFOR', name: 'Efor Yatırım' },
    { code: 'EKGYO', name: 'Emlak Konut GYO' },
    { code: 'ENERY', name: 'Enerya Enerji' },
    { code: 'ENJSA', name: 'Enerjisa' },
    { code: 'ENKAI', name: 'Enka İnşaat' },
    { code: 'EREGL', name: 'Ereğli Demir Çelik' },
    { code: 'EUPWR', name: 'Europower Enerji' },
    { code: 'EUREN', name: 'Europen Endüstri' },
    { code: 'FENER', name: 'Fenerbahçe' },
    { code: 'FROTO', name: 'Ford Otosan' },
    { code: 'GARAN', name: 'Garanti BBVA' },
    { code: 'GENIL', name: 'Gen İlaç' },
    { code: 'GESAN', name: 'Girişim Elektrik' },
    { code: 'GLRMK', name: 'Gülermak' },
    { code: 'GRSEL', name: 'Gür-Sel Turizm' },
    { code: 'GRTHO', name: 'Grainturk Holding' },
    { code: 'GSRAY', name: 'Galatasaray Sportif' },
    { code: 'GUBRF', name: 'Gübre Fabrikaları' },
    { code: 'HALKB', name: 'Halkbank' },
    { code: 'HEKTS', name: 'Hektaş' },
    { code: 'ISCTR', name: 'İş Bankası (C)' },
    { code: 'ISMEN', name: 'İş Yatırım' },
    { code: 'IZENR', name: 'İzdemir Enerji' },
    { code: 'KCHOL', name: 'Koç Holding' },
    { code: 'KLRHO', name: 'Kiler Holding' },
    { code: 'KONTR', name: 'Kontrolmatik' },
    { code: 'KRDMD', name: 'Kardemir (D)' },
    { code: 'KTLEV', name: 'Katılımevim' },
    { code: 'KUYAS', name: 'Kuyaş Yatırım' },
    { code: 'MAGEN', name: 'Margün Enerji' },
    { code: 'MAVI', name: 'Mavi Giyim' },
    { code: 'MGROS', name: 'Migros' },
    { code: 'MIATK', name: 'Mia Teknoloji' },
    { code: 'MPARK', name: 'MLP Sağlık' },
    { code: 'OBAMS', name: 'Oba Makarna' },
    { code: 'ODAS', name: 'Odaş Elektrik' },
    { code: 'OTKAR', name: 'Otokar' },
    { code: 'OYAKC', name: 'Oyak Çimento' },
    { code: 'PAHOL', name: 'Pasifik Holding' },
    { code: 'PASEU', name: 'Pasifik Eurasia' },
    { code: 'PATEK', name: 'Pasifik Teknoloji' },
    { code: 'PETKM', name: 'Petkim' },
    { code: 'PGSUS', name: 'Pegasus' },
    { code: 'PSGYO', name: 'Pasifik GYO' },
    { code: 'QUAGR', name: 'Qua Granite' },
    { code: 'RALYH', name: 'Ral Yatırım' },
    { code: 'REEDR', name: 'Reeder Teknoloji' },
    { code: 'SAHOL', name: 'Sabancı Holding' },
    { code: 'SARKY', name: 'Sarkuysan' },
    { code: 'SASA', name: 'Sasa Polyester' },
    { code: 'SISE', name: 'Şişecam' },
    { code: 'SKBNK', name: 'Şekerbank' },
    { code: 'SOKM', name: 'Şok Marketler' },
    { code: 'TABGD', name: 'Tab Gıda' },
    { code: 'TAVHL', name: 'TAV Havalimanları' },
    { code: 'TCELL', name: 'Turkcell' },
    { code: 'THYAO', name: 'Türk Hava Yolları' },
    { code: 'TKFEN', name: 'Tekfen Holding' },
    { code: 'TOASO', name: 'Tofaş' },
    { code: 'TRALT', name: 'Türk Altın İşletmeleri' },
    { code: 'TRENJ', name: 'Doğal Enerji' },
    { code: 'TRMET', name: 'Anadolu Metal Madencilik' },
    { code: 'TSKB', name: 'TSKB' },
    { code: 'TTKOM', name: 'Türk Telekom' },
    { code: 'TUKAS', name: 'Tukaş' },
    { code: 'TUPRS', name: 'Tüpraş' },
    { code: 'TUREX', name: 'Tureks' },
    { code: 'TURSG', name: 'Türkiye Sigorta' },
    { code: 'ULKER', name: 'Ülker' },
    { code: 'VAKBN', name: 'Vakıfbank' },
    { code: 'VESTL', name: 'Vestel' },
    { code: 'YKBNK', name: 'Yapı Kredi' },
    { code: 'ZOREN', name: 'Zorlu Enerji' },
    // Index symbols (not equity constituents; useful for charts / browse)
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

function searchBist(query, limit = 100) {
    const q = String(query || '')
        .trim()
        .toUpperCase();
    const max = Math.min(120, Math.max(1, Number(limit) || 100));
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
