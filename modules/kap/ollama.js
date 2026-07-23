const fs = require('fs');
const path = require('path');

const DEFAULT_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_SECONDS || 300) * 1000;

function resolvePromptPath() {
    if (process.env.KAP_PROMPT_PATH) {
        return path.isAbsolute(process.env.KAP_PROMPT_PATH)
            ? process.env.KAP_PROMPT_PATH
            : path.resolve(process.cwd(), process.env.KAP_PROMPT_PATH);
    }
    // Sibling checkout on Pi: /home/ycs/home-hub + /home/ycs/pi-llm
    return path.resolve(__dirname, '..', '..', '..', 'pi-llm', 'prompts', 'kap_sentiment.txt');
}

function loadSystemPrompt() {
    const promptPath = resolvePromptPath();
    if (!fs.existsSync(promptPath)) {
        throw new Error(`KAP prompt not found at ${promptPath}`);
    }
    return fs.readFileSync(promptPath, 'utf8').trim();
}

function chatCompletionsUrl(baseUrl) {
    let root = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    if (root.endsWith('/v1')) root = root.slice(0, -3);
    return `${root}/v1/chat/completions`;
}

function rootUrl(baseUrl) {
    let root = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    if (root.endsWith('/v1')) root = root.slice(0, -3);
    return root;
}

/**
 * Lightweight reachability check (Ollama /api/tags).
 * @returns {Promise<{ online: boolean, checkedAt: string, error?: string }>}
 */
async function checkHealth(opts = {}) {
    const baseUrl = opts.baseUrl || DEFAULT_BASE;
    const timeoutMs = Number(opts.timeoutMs) || 3000;
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(`${rootUrl(baseUrl)}/api/tags`, {
            method: 'GET',
            signal: controller.signal
        });
        if (!res.ok) {
            return {
                online: false,
                checkedAt,
                error: `Ollama HTTP ${res.status}`
            };
        }
        return { online: true, checkedAt };
    } catch (err) {
        const message = err && err.name === 'AbortError'
            ? 'Ollama health check timed out'
            : (err && err.message) || String(err);
        return { online: false, checkedAt, error: message };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Call Ollama OpenAI-compatible chat completions.
 * Returns model fields only: stock, sentiment, confidence, summary, reason
 */
async function classifyKap(opts) {
    const stock = opts.stock;
    const text = (opts.text || '').trim();
    const model = opts.model || DEFAULT_MODEL;
    const baseUrl = opts.baseUrl || DEFAULT_BASE;

    if (!stock) throw new Error('stock is required');
    if (!text) throw new Error('text is required');

    const payload = {
        model,
        temperature: 0,
        stream: false,
        format: 'json',
        messages: [
            { role: 'system', content: loadSystemPrompt() },
            {
                role: 'user',
                content: `Stock code: ${stock}\n\nKAP disclosure (title + summary preferred):\n${text}`
            }
        ]
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res;
    try {
        res = await fetch(chatCompletionsUrl(baseUrl), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : null;
    if (!content) throw new Error('Empty completion from Ollama');

    try {
        const parsed = JSON.parse(content);
        if (!parsed.stock) parsed.stock = stock;
        return {
            stock: parsed.stock || stock,
            sentiment: parsed.sentiment || 'neutral',
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
            summary: parsed.summary || '',
            reason: parsed.reason || ''
        };
    } catch (_) {
        throw new Error('Ollama returned non-JSON content');
    }
}

module.exports = {
    classifyKap,
    checkHealth,
    loadSystemPrompt,
    resolvePromptPath,
    chatCompletionsUrl,
    rootUrl,
    DEFAULT_BASE,
    DEFAULT_MODEL,
    TIMEOUT_MS
};
