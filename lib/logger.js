const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'home-hub.log');
const MAX_MEMORY_ENTRIES = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB soft rotate

const memory = [];
const subscribers = new Set();

function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

function rotateIfNeeded() {
    try {
        if (!fs.existsSync(LOG_FILE)) return;
        const size = fs.statSync(LOG_FILE).size;
        if (size < MAX_FILE_BYTES) return;
        const rotated = `${LOG_FILE}.${Date.now()}`;
        fs.renameSync(LOG_FILE, rotated);
    } catch (_) {
        // ignore rotate failures
    }
}

function formatLine(entry) {
    return `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.source}: ${entry.message}`;
}

function write(level, source, message, meta) {
    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        level,
        source,
        message: String(message),
        meta: meta || null
    };

    memory.push(entry);
    if (memory.length > MAX_MEMORY_ENTRIES) {
        memory.shift();
    }

    try {
        ensureLogDir();
        rotateIfNeeded();
        fs.appendFileSync(LOG_FILE, formatLine(entry) + '\n', 'utf8');
    } catch (err) {
        console.error('[Logger] Failed to write log file:', err.message);
    }

    // Always mirror to console for SSH visibility
    const consoleLine = formatLine(entry);
    if (level === 'error') console.error(consoleLine);
    else if (level === 'warn') console.warn(consoleLine);
    else console.log(consoleLine);

    subscribers.forEach((fn) => {
        try {
            fn(entry);
        } catch (_) {
            // ignore subscriber errors
        }
    });

    return entry;
}

function getRecent(limit = 100) {
    const n = Math.max(1, Math.min(MAX_MEMORY_ENTRIES, Number(limit) || 100));
    return memory.slice(-n);
}

function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}

module.exports = {
    info: (source, message, meta) => write('info', source, message, meta),
    warn: (source, message, meta) => write('warn', source, message, meta),
    error: (source, message, meta) => write('error', source, message, meta),
    getRecent,
    subscribe,
    LOG_FILE,
    LOG_DIR
};
