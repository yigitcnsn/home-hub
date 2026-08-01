const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'notifications');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const MAX_ITEMS = 200;
const LEVELS = new Set(['info', 'warn', 'error']);

/**
 * Global notifications — user-facing alerts, not a mirror of Logs.
 * Other modules push via ctx.notify({ level, title, body, source }).
 */
function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function readItems() {
    try {
        ensureDir();
        if (!fs.existsSync(ITEMS_FILE)) return [];
        const raw = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8'));
        return Array.isArray(raw) ? raw : [];
    } catch (_) {
        return [];
    }
}

function writeItems(items) {
    ensureDir();
    fs.writeFileSync(ITEMS_FILE, JSON.stringify(items.slice(-MAX_ITEMS), null, 2), 'utf8');
}

function normalizeLevel(value) {
    const level = String(value || 'info').toLowerCase();
    return LEVELS.has(level) ? level : 'info';
}

function makeId() {
    return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function register(ctx) {
    const { app, logger, broadcastToAll, onClientConnected, onClientMessage } = ctx;
    let items = readItems();

    function snapshot() {
        const unread = items.filter((n) => !n.read && !n.dismissed).length;
        const warn = items.filter((n) => n.level === 'warn' && !n.dismissed).length;
        const error = items.filter((n) => n.level === 'error' && !n.dismissed).length;
        return {
            items: items.filter((n) => !n.dismissed).slice(-MAX_ITEMS),
            unread,
            warn,
            error,
            total: items.filter((n) => !n.dismissed).length
        };
    }

    function broadcastState() {
        broadcastToAll({
            type: 'notifications_state',
            data: snapshot()
        });
    }

    function persist() {
        writeItems(items);
    }

    /**
     * Push a global notification. Does not write to the Logs stream.
     * @returns {object|null} created notification
     */
    function notify(input) {
        const payload = input && typeof input === 'object' ? input : {};
        const title = String(payload.title || '').trim().slice(0, 120);
        const body = String(payload.body || payload.message || '').trim().slice(0, 500);
        if (!title && !body) return null;

        const entry = {
            id: makeId(),
            level: normalizeLevel(payload.level),
            title: title || normalizeLevel(payload.level).toUpperCase(),
            body,
            source: String(payload.source || 'Home Hub').trim().slice(0, 64),
            createdAt: new Date().toISOString(),
            read: false,
            dismissed: false
        };

        items.push(entry);
        if (items.length > MAX_ITEMS * 2) {
            items = items.filter((n) => !n.dismissed).slice(-MAX_ITEMS);
        }
        persist();

        broadcastToAll({
            type: 'notification_entry',
            entry
        });
        broadcastState();
        return entry;
    }

    function dismiss(id) {
        const target = items.find((n) => n.id === id);
        if (!target) return false;
        target.dismissed = true;
        target.read = true;
        persist();
        broadcastState();
        return true;
    }

    function markRead(id) {
        const target = items.find((n) => n.id === id);
        if (!target || target.dismissed) return false;
        target.read = true;
        persist();
        broadcastState();
        return true;
    }

    function markAllRead() {
        let changed = false;
        items.forEach((n) => {
            if (!n.dismissed && !n.read) {
                n.read = true;
                changed = true;
            }
        });
        if (changed) {
            persist();
            broadcastState();
        }
        return snapshot();
    }

    function clearAll() {
        items.forEach((n) => {
            n.dismissed = true;
            n.read = true;
        });
        items = items.filter((n) => !n.dismissed).slice(-MAX_ITEMS);
        persist();
        broadcastState();
        return snapshot();
    }

    // Global helper for every module — register this first in modules/index.js
    ctx.notify = notify;

    app.get('/api/notifications', (req, res) => {
        res.json(snapshot());
    });

    app.post('/api/notifications', (req, res) => {
        const entry = notify(req.body || {});
        if (!entry) {
            res.status(400).json({ ok: false, error: 'title or body required' });
            return;
        }
        res.json({ ok: true, entry });
    });

    app.post('/api/notifications/read-all', (req, res) => {
        res.json({ ok: true, ...markAllRead() });
    });

    app.post('/api/notifications/clear', (req, res) => {
        res.json({ ok: true, ...clearAll() });
    });

    app.post('/api/notifications/:id/read', (req, res) => {
        const ok = markRead(String(req.params.id || ''));
        if (!ok) {
            res.status(404).json({ ok: false, error: 'not found' });
            return;
        }
        res.json({ ok: true, ...snapshot() });
    });

    app.delete('/api/notifications/:id', (req, res) => {
        const ok = dismiss(String(req.params.id || ''));
        if (!ok) {
            res.status(404).json({ ok: false, error: 'not found' });
            return;
        }
        res.json({ ok: true, ...snapshot() });
    });

    onClientConnected((ws) => {
        try {
            ws.send(JSON.stringify({
                type: 'notifications_state',
                data: snapshot()
            }));
        } catch (_) {
            /* ignore */
        }
    });

    onClientMessage((ws, data) => {
        if (!data || typeof data.type !== 'string') return false;

        if (data.type === 'notification_create') {
            notify(data);
            return true;
        }
        if (data.type === 'notification_dismiss') {
            dismiss(String(data.id || ''));
            return true;
        }
        if (data.type === 'notifications_read_all') {
            markAllRead();
            return true;
        }
        if (data.type === 'notifications_clear') {
            clearAll();
            return true;
        }
        if (data.type === 'notification_read') {
            markRead(String(data.id || ''));
            return true;
        }
        return false;
    });

    if (logger) {
        logger.info('Notifications', 'Global notifications module registered');
    }
}

module.exports = {
    id: 'notifications',
    name: 'Notifications',
    register
};
