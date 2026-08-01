const fs = require('fs');
const path = require('path');

const DEFAULT_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_SECONDS || 300) * 1000;
const MODEL_FILE = path.join(__dirname, '..', '..', 'data', 'aiinfo', 'selected-model.json');

let activeModel = null;

function normalizeModelName(value) {
    return String(value || '')
        .trim()
        .slice(0, 128);
}

function readPersistedModel() {
    try {
        if (!fs.existsSync(MODEL_FILE)) return null;
        const raw = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
        const name = normalizeModelName(raw && raw.model);
        return name || null;
    } catch (_) {
        return null;
    }
}

function writePersistedModel(model) {
    const dir = path.dirname(MODEL_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
        MODEL_FILE,
        JSON.stringify({ model, updatedAt: new Date().toISOString() }, null, 2),
        'utf8'
    );
}

/**
 * Active Ollama model (UI selection, else env default).
 */
function getActiveModel() {
    if (activeModel) return activeModel;
    activeModel = readPersistedModel() || DEFAULT_MODEL;
    return activeModel;
}

/**
 * Persist and activate a model name for classify + AI Info.
 * @returns {{ model: string, changed: boolean }}
 */
function setActiveModel(name) {
    const next = normalizeModelName(name);
    if (!next) {
        throw new Error('model name required');
    }
    const prev = getActiveModel();
    activeModel = next;
    writePersistedModel(next);
    return { model: next, changed: prev !== next };
}

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
 * @returns {Promise<{ online: boolean, checkedAt: string, models?: string[], error?: string }>}
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
        const data = await res.json().catch(() => ({}));
        const models = Array.isArray(data.models)
            ? data.models.map((m) => m && (m.name || m.model)).filter(Boolean)
            : [];
        return { online: true, checkedAt, models };
    } catch (err) {
        const message = err && err.name === 'AbortError'
            ? 'Ollama health check timed out'
            : (err && err.message) || String(err);
        return { online: false, checkedAt, error: message };
    } finally {
        clearTimeout(timer);
    }
}

function parseNumCtxFromParameters(parameters) {
    if (!parameters || typeof parameters !== 'string') return null;
    const match = parameters.match(/(?:^|\n)\s*num_ctx\s+(\d+)/i);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function parseContextFromModelInfo(modelInfo) {
    if (!modelInfo || typeof modelInfo !== 'object') return null;
    const preferred = [
        'llama.context_length',
        'qwen2.context_length',
        'qwen3.context_length',
        'gemma.context_length',
        'mistral.context_length',
        'general.context_length'
    ];
    for (const key of preferred) {
        const n = Number(modelInfo[key]);
        if (Number.isFinite(n) && n > 0) return n;
    }
    for (const [key, value] of Object.entries(modelInfo)) {
        if (!/context_length$/i.test(key)) continue;
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
}

/**
 * Fetch model metadata from Ollama /api/show (context / token window).
 * @returns {Promise<object>}
 */
async function getModelInfo(opts = {}) {
    const baseUrl = opts.baseUrl || DEFAULT_BASE;
    const model = opts.model || DEFAULT_MODEL;
    const timeoutMs = Number(opts.timeoutMs) || 8000;
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(`${rootUrl(baseUrl)}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: model }),
            signal: controller.signal
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return {
                ok: false,
                model,
                checkedAt,
                error: `Ollama HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`
            };
        }
        const data = await res.json();
        const details = data.details || {};
        const modelInfo = data.model_info || data.modelinfo || {};
        const contextFromInfo = parseContextFromModelInfo(modelInfo);
        const contextFromParams = parseNumCtxFromParameters(data.parameters);
        const contextLength = contextFromInfo || contextFromParams || null;

        return {
            ok: true,
            model,
            checkedAt,
            contextLength,
            parameterSize: details.parameter_size || null,
            family: details.family || details.families || null,
            quantization: details.quantization_level || null,
            format: details.format || null,
            parameters: typeof data.parameters === 'string' ? data.parameters : null,
            error: null
        };
    } catch (err) {
        const message = err && err.name === 'AbortError'
            ? 'Ollama model info timed out'
            : (err && err.message) || String(err);
        return {
            ok: false,
            model,
            checkedAt,
            contextLength: null,
            error: message
        };
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
    getModelInfo,
    loadSystemPrompt,
    resolvePromptPath,
    chatCompletionsUrl,
    rootUrl,
    DEFAULT_BASE,
    DEFAULT_MODEL,
    TIMEOUT_MS
};
