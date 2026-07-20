/**
 * Network Analyzer module (server)
 * Not registered yet — enable from modules/index.js when ready.
 *
 * Hourly download speed checks; see NetworkAnalyzer class below.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Download-based bandwidth check (no API key).
// Uses Cloudflare speed-test endpoint; size kept modest for Pi networks.
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

        // First run shortly after boot so UI is not empty for an hour
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
            testUrl: this.testUrl
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

module.exports = {
    id: 'network',
    name: 'Network Analyzer',
    NetworkAnalyzer,
    DEFAULT_INTERVAL_MS,
    DEFAULT_TEST_URL
    // register() will be added when this module is enabled
};
