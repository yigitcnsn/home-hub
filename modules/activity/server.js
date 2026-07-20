const logger = require('../../lib/logger');

/**
 * Activity Log module (server)
 * - GET /api/logs
 * - live log_entry / logs_snapshot over WebSocket
 */
function register(ctx) {
    const { app, broadcastToAll, onClientConnected } = ctx;

    logger.subscribe((entry) => {
        broadcastToAll({
            type: 'log_entry',
            entry
        });
    });

    app.get('/api/logs', (req, res) => {
        const limit = parseInt(req.query.limit, 10) || 100;
        res.json({
            entries: logger.getRecent(limit),
            file: logger.LOG_FILE
        });
    });

    onClientConnected((ws) => {
        ws.send(JSON.stringify({
            type: 'logs_snapshot',
            entries: logger.getRecent(100)
        }));
    });

    logger.info('Activity', 'Activity Log module registered');
}

module.exports = {
    id: 'activity',
    name: 'Activity Log',
    register
};
