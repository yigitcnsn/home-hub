/**
 * Network Analyzer module (server)
 * Hourly download speed checks + manual run via WebSocket.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_TEST_URL = 'https://speed.cloudflare.com/__down?bytes=2500000';
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const HISTORY_LIMIT = 24;

class NetworkAnalyzer {
    constructor(options = {}) {
        this.logger = options.logger;
        this.onResult = options.onResult || (() => {});
        this.testUrl = options.testUrl || DEFAULT_TEST_URL;
        this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
        this.timer = null;
        this.running = false;
        this.lastResult = null;
        this.history = [];
    }

    start() {
        this.log('info', `Network analyzer started (every ${Math.round(this.intervalMs / 60000)} min)`);

        setTimeout(() => {
            this.runTest('startup').catch(() => {});
        }, 5000);

        this.timer = setInterval(() => {
            this.runTest('scheduled').catch(() => {});
        }, this.intervalMs);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    getState() {
        return {
            lastResult: this.lastResult,
            history: this.history.slice(),
            intervalMs: this.intervalMs,
            running: this.running,
            nextRunHint: 'Every 1 hour'
        };
    }

    async runTest(trigger = 'manual') {
        if (this.running) {
            this.log('warn', 'Speed test already running, skipped');
            return this.lastResult;
        }

        this.running = true;
        this.log('info', `Speed test started (${trigger})`);
        const startedAt = Date.now();

        try {
            const { bytes, elapsedMs } = await this.downloadSample(this.testUrl);
            const seconds = elapsedMs / 1000;
            const mbps = seconds > 0 ? Number(((bytes * 8) / (seconds * 1e6)).toFixed(2)) : 0;
            const result = {
                status: 'ok',
                trigger,
                timestamp: new Date().toISOString(),
                downloadMbps: mbps,
                bytes,
                elapsedMs,
                error: null
            };

            this.lastResult = result;
            this.history.push(result);
            if (this.history.length > HISTORY_LIMIT) {
                this.history.shift();
            }

            this.log('info', `Speed test finished: ${mbps} Mbps (${bytes} bytes in ${elapsedMs}ms)`);
            this.onResult(result);
            return result;
        } catch (err) {
            const result = {
                status: 'error',
                trigger,
                timestamp: new Date().toISOString(),
                downloadMbps: null,
                bytes: 0,
                elapsedMs: Date.now() - startedAt,
                error: err.message || String(err)
            };
            this.lastResult = result;
            this.history.push(result);
            if (this.history.length > HISTORY_LIMIT) {
                this.history.shift();
            }
            this.log('error', `Speed test failed: ${result.error}`);
            this.onResult(result);
            return result;
        } finally {
            this.running = false;
        }
    }

    downloadSample(targetUrl) {
        return new Promise((resolve, reject) => {
            let parsed;
            try {
                parsed = new URL(targetUrl);
            } catch (e) {
                reject(new Error('Invalid speed test URL'));
                return;
            }

            const client = parsed.protocol === 'http:' ? http : https;
            const started = Date.now();
            let bytes = 0;
            let settled = false;

            const req = client.get(targetUrl, {
                timeout: 60000,
                headers: {
                    'User-Agent': 'HomeHub-NetworkAnalyzer/1.0',
                    'Cache-Control': 'no-cache'
                }
            }, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    settled = true;
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }

                res.on('data', (chunk) => {
                    bytes += chunk.length;
                });

                res.on('end', () => {
                    if (settled) return;
                    settled = true;
                    resolve({ bytes, elapsedMs: Date.now() - started });
                });
            });

            req.on('timeout', () => {
                req.destroy(new Error('Speed test timed out'));
            });

            req.on('error', (err) => {
                if (settled) return;
                settled = true;
                reject(err);
            });
        });
    }

    log(level, message) {
        if (this.logger && typeof this.logger[level] === 'function') {
            this.logger[level]('NetworkAnalyzer', message);
        }
    }
}

function register(ctx) {
    const { app, logger, broadcastToAll, onClientConnected, onClientMessage } = ctx;

    const analyzer = new NetworkAnalyzer({
        logger,
        onResult: (result) => {
            broadcastToAll({
                type: 'network_stats',
                data: {
                    lastResult: result,
                    history: analyzer.history.slice(),
                    running: analyzer.running,
                    intervalMs: analyzer.intervalMs
                }
            });
        }
    });

    app.get('/api/network', (req, res) => {
        res.json(analyzer.getState());
    });

    onClientConnected((ws) => {
        ws.send(JSON.stringify({
            type: 'network_state',
            data: analyzer.getState()
        }));
    });

    onClientMessage((ws, data) => {
        if (data.type !== 'run_network_test') return false;

        broadcastToAll({
            type: 'network_stats',
            data: {
                ...analyzer.getState(),
                running: true
            }
        });

        analyzer.runTest('manual').catch(() => {});
        return true;
    });

    analyzer.start();
    logger.info('NetworkAnalyzer', 'Network Analyzer module registered');
}

module.exports = {
    id: 'network',
    name: 'Network Analyzer',
    register,
    NetworkAnalyzer,
    DEFAULT_INTERVAL_MS,
    DEFAULT_TEST_URL
};
