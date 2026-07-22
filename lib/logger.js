const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'home-hub.log');
const METRICS_LOG_FILE = path.join(LOG_DIR, 'system-metrics.log');
const MAX_MEMORY_ENTRIES = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB soft rotate
const MAX_METRICS_FILE_BYTES = 10 * 1024 * 1024; // 10MB soft rotate
const LINE_RE = /^(\S+)\s+\[(INFO|WARN|ERROR)\]\s+([^:]+):\s+(.*)$/i;

const memory = [];
const subscribers = new Set();
let hydrated = false;

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
    let line = `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.source}: ${entry.message}`;
    if (entry.meta) {
        try {
            line += ` | ${JSON.stringify(entry.meta)}`;
        } catch (_) {
            line += ' | [meta:unserializable]';
        }
    }
    return line;
}

function parseLine(line, index) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return null;
    const match = trimmed.match(LINE_RE);
    if (!match) return null;

    return {
        id: `file-${index}-${match[1]}`,
        timestamp: match[1],
        level: match[2].toLowerCase(),
        source: match[3].trim(),
        message: match[4],
        meta: null
    };
}

function hydrateFromFile() {
    if (hydrated) return;
    hydrated = true;

    try {
        ensureLogDir();
        if (!fs.existsSync(LOG_FILE)) return;

        const content = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = content.split('\n');
        const loaded = [];

        // Read from the end so we keep the newest MAX_MEMORY_ENTRIES
        for (let i = lines.length - 1; i >= 0 && loaded.length < MAX_MEMORY_ENTRIES; i--) {
            const entry = parseLine(lines[i], i);
            if (entry) loaded.push(entry);
        }

        loaded.reverse().forEach((entry) => memory.push(entry));
    } catch (err) {
        console.error('[Logger] Failed to hydrate from log file:', err.message);
    }
}

function write(level, source, message, meta) {
    hydrateFromFile();

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
    hydrateFromFile();
    const n = Math.max(1, Math.min(MAX_MEMORY_ENTRIES, Number(limit) || 100));
    return memory.slice(-n);
}

function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}

/**
 * Remove info-level entries from memory and rewrite home-hub.log without INFO lines.
 * Returns remaining entries (newest window).
 */
function clearInfoLogs() {
    hydrateFromFile();

    for (let i = memory.length - 1; i >= 0; i--) {
        if ((memory[i].level || 'info') === 'info') {
            memory.splice(i, 1);
        }
    }

    try {
        ensureLogDir();
        if (fs.existsSync(LOG_FILE)) {
            const content = fs.readFileSync(LOG_FILE, 'utf8');
            const kept = content
                .split('\n')
                .filter((line) => {
                    const trimmed = line.trim();
                    if (!trimmed) return false;
                    return !/\[INFO\]/i.test(trimmed);
                });
            fs.writeFileSync(LOG_FILE, kept.length ? kept.join('\n') + '\n' : '', 'utf8');
        }
    } catch (err) {
        console.error('[Logger] Failed to clear info logs from file:', err.message);
    }

    return memory.slice();
}

/**
 * Append one System Monitor sample to logs/system-metrics.log
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
        console.error('[Logger] Failed to write metrics log:', err.message, err.stack);
    }
}

function parseMetricsLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    const tsMatch = trimmed.match(/^(\S+)/);
    if (!tsMatch) return null;

    const get = (key, unit) => {
        const re = new RegExp(`\\b${key}=([^\\s]+)`);
        const m = trimmed.match(re);
        if (!m) return null;
        const raw = m[1].replace(unit || '', '');
        const num = Number(raw);
        return Number.isFinite(num) ? num : null;
    };

    const cpu = get('cpu', '%');
    const temp = get('temp', 'C');
    const mem = get('mem', '%');
    const disk = get('disk', '%');
    if (cpu == null && temp == null && mem == null && disk == null) return null;

    return {
        timestamp: tsMatch[1],
        cpu,
        temp,
        mem,
        disk
    };
}

/**
 * Read recent samples from system-metrics.log for graphs.
 * Returns { cpu, memory, disk, temperature, timestamps }
 */
function getSystemMetricsHistory(limit = 60) {
    const n = Math.max(2, Math.min(500, Number(limit) || 60));
    const history = {
        cpu: [],
        memory: [],
        disk: [],
        temperature: [],
        timestamps: []
    };

    try {
        ensureLogDir();
        if (!fs.existsSync(METRICS_LOG_FILE)) return history;

        const content = fs.readFileSync(METRICS_LOG_FILE, 'utf8');
        const lines = content.split('\n');
        const samples = [];

        for (let i = lines.length - 1; i >= 0 && samples.length < n; i--) {
            const sample = parseMetricsLine(lines[i]);
            if (sample) samples.push(sample);
        }

        samples.reverse().forEach((sample) => {
            history.timestamps.push(sample.timestamp);
            if (typeof sample.cpu === 'number') history.cpu.push(sample.cpu);
            if (typeof sample.mem === 'number') history.memory.push(sample.mem);
            if (typeof sample.disk === 'number') history.disk.push(sample.disk);
            if (typeof sample.temp === 'number') history.temperature.push(sample.temp);
        });
    } catch (err) {
        console.error('[Logger] Failed to read metrics history:', err.message, err.stack);
    }

    return history;
}

// Load existing file history as soon as the logger is required
hydrateFromFile();

module.exports = {
    info: (source, message, meta) => write('info', source, message, meta),
    warn: (source, message, meta) => write('warn', source, message, meta),
    error: (source, message, meta) => write('error', source, message, meta),
    logSystemMetrics,
    getSystemMetricsHistory,
    clearInfoLogs,
    getRecent,
    subscribe,
    LOG_FILE,
    METRICS_LOG_FILE,
    LOG_DIR
};
