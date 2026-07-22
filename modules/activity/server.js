const logger = require('../../lib/logger');

/**
 * Activity Log module (server)
 * - GET /api/logs
 * - POST /api/logs/client
 * - POST /api/logs/clear-info
 * - live log_entry / logs_snapshot over WebSocket
 * - clear_info_logs / client_log via WebSocket
 */
function register(ctx) {
    const { app, broadcastToAll, onClientConnected, onClientMessage } = ctx;

    function broadcastSnapshot(entries) {
        broadcastToAll({
            type: 'logs_snapshot',
            entries: entries || logger.getRecent(200)
        });
    }

    function clearInfo() {
        const remaining = logger.clearInfoLogs();
        logger.warn('Activity', 'Cleared info-level logs');
        broadcastSnapshot(logger.getRecent(200));
        return remaining;
    }

    logger.subscribe((entry) => {
        broadcastToAll({
            type: 'log_entry',
            entry
        });
    });

    app.get('/api/logs', (req, res) => {
        const limit = parseInt(req.query.limit, 10) || 200;
        res.json({
            entries: logger.getRecent(limit),
            file: logger.LOG_FILE
        });
    });

    app.post('/api/logs/client', (req, res) => {
        try {
            const body = req.body || {};
            const level = ['error', 'warn', 'info'].includes(body.level) ? body.level : 'error';
            const source = String(body.source || 'Client').slice(0, 64);
            const message = String(body.message || 'Client log');
            const meta = body.meta && typeof body.meta === 'object' ? body.meta : null;
            logger[level](source, message, meta);
            res.json({ ok: true });
        } catch (err) {
            logger.error('Activity', `Failed to record client log: ${err.message}`, {
                stack: err.stack
            });
            res.status(500).json({ ok: false, error: err.message || String(err) });
        }
    });

    app.post('/api/logs/clear-info', (req, res) => {
        const remaining = clearInfo();
        res.json({
            ok: true,
            removedLevel: 'info',
            remaining: remaining.length
        });
    });

    onClientConnected((ws) => {
        ws.send(JSON.stringify({
            type: 'logs_snapshot',
            entries: logger.getRecent(200)
        }));
    });

    onClientMessage((ws, data) => {
        if (data.type === 'client_log') {
            const level = ['error', 'warn', 'info'].includes(data.level) ? data.level : 'error';
            const source = String(data.source || 'Client').slice(0, 64);
            const message = String(data.message || 'Client log');
            const meta = data.meta && typeof data.meta === 'object' ? data.meta : null;
            logger[level](source, message, meta);
            return true;
        }
        if (data.type !== 'clear_info_logs') return false;
        clearInfo();
        return true;
    });

    logger.info('Activity', 'Activity Log module registered');
}

module.exports = {
    id: 'activity',
    name: 'Activity Log',
    register
};
