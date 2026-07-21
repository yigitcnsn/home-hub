const logger = require('../../lib/logger');

/**
 * Activity Log module (server)
 * - GET /api/logs
 * - POST /api/logs/clear-info
 * - live log_entry / logs_snapshot over WebSocket
 * - clear_info_logs via WebSocket
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
