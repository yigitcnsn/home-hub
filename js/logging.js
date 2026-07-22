/**
 * Client → server logging (WebSocket + HTTP fallback).
 * Extends ModuleManager.prototype — load after module-manager.js
 */
Object.assign(ModuleManager.prototype, {
    logError(source, message, meta) {
        console.error(`[${source}] ${message}`, meta || '');
        this.sendClientLog('error', source, message, meta);
    },

    logWarn(source, message, meta) {
        console.warn(`[${source}] ${message}`, meta || '');
        this.sendClientLog('warn', source, message, meta);
    },

    sendClientLog(level, source, message, meta) {
        const payload = {
            type: 'client_log',
            level: level || 'error',
            source: source || 'Client',
            message: String(message || ''),
            meta: meta || null
        };

        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(payload));
            }
        } catch (err) {
            console.error('[ClientLog] WebSocket send failed:', err.message || err);
        }

        fetch('/api/logs/client', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch((err) => {
            console.error('[ClientLog] HTTP send failed:', err.message || err);
        });
    }
});
