const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'home-hub.log');
const METRICS_LOG_FILE = path.join(LOG_DIR, 'system-metrics.log');
const MAX_MEMORY_ENTRIES = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB soft rotate
const MAX_METRICS_FILE_BYTES = 10 * 1024 * 1024; // 10MB soft rotate

const memory = [];
const subscribers = new Set();

function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

function rotateIfNeeded(filePath, maxBytes) {
    try {
        if (!fs.existsSync(filePath)) return;
        const size = fs.statSync(filePath).size;
        if (size < maxBytes) return;
        const rotated = `${filePath}.${Date.now()}`;
        fs.renameSync(filePath, rotated);
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
        rotateIfNeeded(LOG_FILE, MAX_FILE_BYTES);
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

/**
 * Append one System Monitor sample to logs/system-metrics.log
 * Example:
 * 2026-07-21T09:00:00.000Z cpu=12% temp=48C mem=41% memUsed=1.6GB/3.9GB disk=55% diskUsed=17.2GB/31.2GB load=0.15,0.22,0.18 uptime=2d 4h
 */
function logSystemMetrics(stats) {
    if (!stats || stats.error) return;

    const line = [
        stats.lastUpdate || new Date().toISOString(),
        `cpu=${stats.cpuUsage}%`,
        `temp=${stats.cpuTemp}C`,
        `mem=${stats.memoryUsage}%`,
        `memUsed=${stats.memoryUsed}/${stats.memoryTotal}`,
        `disk=${stats.diskUsage}%`,
        `diskUsed=${stats.diskUsed}/${stats.diskTotal}`,
        `load=${stats.loadAverage}`,
        `uptime=${stats.uptime}`,
        `net=${stats.networkStatus}`
    ].join(' ');

    try {
        ensureLogDir();
        rotateIfNeeded(METRICS_LOG_FILE, MAX_METRICS_FILE_BYTES);
        fs.appendFileSync(METRICS_LOG_FILE, line + '\n', 'utf8');
    } catch (err) {
        console.error('[Logger] Failed to write metrics log:', err.message);
    }
}

module.exports = {
    info: (source, message, meta) => write('info', source, message, meta),
    warn: (source, message, meta) => write('warn', source, message, meta),
    error: (source, message, meta) => write('error', source, message, meta),
    logSystemMetrics,
    getRecent,
    subscribe,
    LOG_FILE,
    METRICS_LOG_FILE,
    LOG_DIR
};
