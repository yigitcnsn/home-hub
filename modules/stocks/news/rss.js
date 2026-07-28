/**
 * Official RSS fetch/parse only (title, link, description).
 * No HTML article scrape — personal use; enable via NEWS_RSS_ENABLED=1.
 */
const DEFAULT_FEEDS = String(process.env.NEWS_RSS_FEEDS || [
    'https://tr.investing.com/rss/stock.rss',
    'https://tr.investing.com/rss/news.rss'
].join(',')).split(/[,;\s]+/).filter(Boolean);

const UA = 'HomeHub-NewsRSS/1.0 (personal research; RSS reader)';
const FETCH_TIMEOUT_MS = Number(process.env.NEWS_RSS_TIMEOUT_MS || 15000);

function decodeXml(text) {
    return String(text || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tagValue(block, tag) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = String(block || '').match(re);
    return m ? decodeXml(m[1]) : '';
}

function parseRssItems(xml) {
    const items = [];
    const re = /<item[\s\S]*?<\/item>/gi;
    let match;
    while ((match = re.exec(xml))) {
        const block = match[0];
        const title = tagValue(block, 'title');
        const link = tagValue(block, 'link');
        const description = tagValue(block, 'description');
        const guid = tagValue(block, 'guid') || link || title;
        const pubDate = tagValue(block, 'pubDate');
        if (!title && !description) continue;
        items.push({
            id: guid.slice(0, 240),
            title,
            link,
            description: description.slice(0, 800),
            publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
            source: 'investing_rss'
        });
    }
    return items;
}

async function fetchFeed(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: {
                'User-Agent': UA,
                Accept: 'application/rss+xml, application/xml, text/xml, */*'
            }
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`RSS HTTP ${res.status}: ${body.slice(0, 120)}`);
        }
        const xml = await res.text();
        return parseRssItems(xml).map((item) => ({ ...item, feedUrl: url }));
    } finally {
        clearTimeout(timer);
    }
}

async function fetchAllFeeds(feedUrls = DEFAULT_FEEDS) {
    const urls = (feedUrls || []).filter(Boolean);
    const out = [];
    const errors = [];
    for (const url of urls) {
        try {
            const items = await fetchFeed(url);
            out.push(...items);
        } catch (err) {
            errors.push({ url, error: err.message || String(err) });
        }
    }
    return { items: out, errors, feeds: urls };
}

module.exports = {
    DEFAULT_FEEDS,
    fetchFeed,
    fetchAllFeeds,
    parseRssItems
};
