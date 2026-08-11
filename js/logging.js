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

(function installGlobalClientErrorBridge() {
    let managerRef = null;

    function resolveManager() {
        if (managerRef) return managerRef;
        if (typeof window !== 'undefined' && window.moduleManager) {
            managerRef = window.moduleManager;
        }
        return managerRef;
    }

    function report(level, source, message, meta) {
        const manager = resolveManager();
        if (manager && typeof manager.sendClientLog === 'function') {
            manager.sendClientLog(level, source, message, meta);
            return;
        }
        fetch('/api/logs/client', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'client_log',
                level,
                source,
                message: String(message || ''),
                meta: meta || null
            })
        }).catch(() => {});
    }

    window.addEventListener('error', (event) => {
        const err = event.error;
        report('error', 'Window', err && err.message ? err.message : (event.message || 'Unhandled error'), {
            filename: event.filename || null,
            lineno: event.lineno || null,
            colno: event.colno || null,
            stack: err && err.stack ? String(err.stack).slice(0, 2000) : null
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        let message = 'Unhandled promise rejection';
        let stack = null;
        if (reason instanceof Error) {
            message = reason.message || message;
            stack = reason.stack ? String(reason.stack).slice(0, 2000) : null;
        } else if (typeof reason === 'string') {
            message = reason;
        } else if (reason != null) {
            try {
                message = JSON.stringify(reason);
            } catch (_) {
                message = String(reason);
            }
        }
        report('error', 'Promise', message, { stack });
    });
})();
