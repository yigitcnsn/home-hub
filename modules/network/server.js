/**
 * Network Analyzer module (server)
 * Full diagnostics + hourly speed checks + manual run via WebSocket.
 */
const os = require('os');
const fs = require('fs');
const dns = require('dns').promises;
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { execFile } = require('child_process');

const DEFAULT_DOWNLOAD_URL = 'https://speed.cloudflare.com/__down?bytes=2500000';
const DEFAULT_UPLOAD_URL = 'https://speed.cloudflare.com/__up';
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const SNAPSHOT_INTERVAL_MS = 20 * 1000;
const HISTORY_LIMIT = 48;
const UPLOAD_BYTES = 1_000_000;
const DNS_HOST = 'cloudflare.com';
const PING_TARGETS = [
    { key: 'gateway', label: 'Gateway' },
    { key: 'cloudflare', label: '1.1.1.1', host: '1.1.1.1' },
    { key: 'google', label: '8.8.8.8', host: '8.8.8.8' }
];

function execCmd(cmd, args, timeoutMs = 8000) {
    return new Promise((resolve) => {
        execFile(cmd, args, {
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            env: process.env
        }, (err, stdout) => {
            if (err) {
                resolve(null);
                return;
            }
            resolve(String(stdout || '').trim());
        });
    });
}

function getInterfaces() {
    const ifaces = os.networkInterfaces();
    const result = [];
    for (const [name, addrs] of Object.entries(ifaces || {})) {
        if (!addrs) continue;
        for (const addr of addrs) {
            if (addr.internal) continue;
            result.push({
                name,
                family: addr.family === 'IPv4' || addr.family === 4 ? 'IPv4' : 'IPv6',
                address: addr.address,
                netmask: addr.netmask || null,
                mac: addr.mac && addr.mac !== '00:00:00:00:00:00' ? addr.mac : null,
                cidr: addr.cidr || null
            });
        }
    }
    return result;
}

async function getGateway() {
    let out = await execCmd('ip', ['route', 'show', 'default']);
    if (out) {
        const m = out.match(/default via (\S+)/);
        if (m) return m[1];
    }
    out = await execCmd('route', ['-n', 'get', 'default']);
    if (out) {
        const m = out.match(/gateway:\s+(\S+)/i);
        if (m) return m[1];
    }
    return null;
}

async function getDnsServers() {
    try {
        const out = fs.readFileSync('/etc/resolv.conf', 'utf8');
        return out
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('nameserver'))
            .map((line) => line.replace(/^nameserver\s+/, '').trim())
            .filter(Boolean);
    } catch (e) {
        return [];
    }
}

async function measureDns(host = DNS_HOST) {
    const started = Date.now();
    try {
        const addresses = await dns.lookup(host, { all: true });
        return {
            host,
            ms: Date.now() - started,
            addresses: (addresses || []).map((a) => a.address),
            error: null
        };
    } catch (err) {
        return {
            host,
            ms: Date.now() - started,
            addresses: [],
            error: err.message || String(err)
        };
    }
}

async function pingHost(host, count = 3) {
    if (!host) {
        return { host: null, avgMs: null, minMs: null, maxMs: null, loss: null, error: 'No host' };
    }

    // Linux/BusyBox style first, then macOS
    let out = await execCmd('ping', ['-c', String(count), '-W', '2', host], 10000);
    if (!out) {
        out = await execCmd('ping', ['-c', String(count), '-t', '2', host], 10000);
    }
    if (!out) {
        return { host, avgMs: null, minMs: null, maxMs: null, loss: null, error: 'Ping failed' };
    }

    const lossMatch = out.match(/(\d+(?:\.\d+)?)%\s*packet loss/i);
    const rttMatch = out.match(/rtt [^=]*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/i)
        || out.match(/round-trip [^=]*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/i);

    if (!rttMatch) {
        return {
            host,
            avgMs: null,
            minMs: null,
            maxMs: null,
            loss: lossMatch ? Number(lossMatch[1]) : null,
            error: 'Could not parse ping'
        };
    }

    return {
        host,
        minMs: Number(rttMatch[1]),
        avgMs: Number(rttMatch[2]),
        maxMs: Number(rttMatch[3]),
        loss: lossMatch ? Number(lossMatch[1]) : 0,
        error: null
    };
}

async function getWifiInfo() {
    let ssid = await execCmd('iwgetid', ['-r']);
    if (!ssid) {
        const nm = await execCmd('nmcli', ['-t', '-f', 'ACTIVE,SSID,SIGNAL', 'dev', 'wifi']);
        if (nm) {
            const active = nm.split('\n').find((line) => line.startsWith('yes:'));
            if (active) {
                const parts = active.split(':');
                return {
                    connected: true,
                    ssid: parts[1] || null,
                    signal: parts[2] ? Number(parts[2]) : null,
                    interface: null
                };
            }
        }
    }

    let signal = null;
    let iface = null;
    try {
        const wireless = fs.readFileSync('/proc/net/wireless', 'utf8');
        const lines = wireless.split('\n').slice(2);
        for (const line of lines) {
            const m = line.match(/^\s*(\S+):\s+\S+\s+([\d.]+)/);
            if (m) {
                iface = m[1];
                signal = Math.round(Number(m[2]));
                break;
            }
        }
    } catch (e) {
        // not Linux / no wireless proc
    }

    if (!ssid && !iface) {
        return { connected: false, ssid: null, signal: null, interface: null };
    }

    return {
        connected: Boolean(ssid),
        ssid: ssid || null,
        signal,
        interface: iface
    };
}

async function getLanNeighbors() {
    let out = await execCmd('ip', ['neigh', 'show']);
    if (!out) {
        out = await execCmd('arp', ['-an']);
    }
    if (!out) return [];

    const neighbors = [];
    const lines = out.split('\n').filter(Boolean);
    for (const line of lines) {
        // ip neigh: 192.168.1.1 dev wlan0 lladdr aa:bb:cc REACHABLE
        let m = line.match(/^(\S+)\s+dev\s+(\S+)(?:\s+lladdr\s+(\S+))?\s+(\S+)/i);
        if (m) {
            const state = (m[4] || '').toUpperCase();
            if (state === 'FAILED' || state === 'INCOMPLETE') continue;
            neighbors.push({
                ip: m[1],
                interface: m[2],
                mac: m[3] || null,
                state
            });
            continue;
        }
        // arp -an: ? (192.168.1.1) at aa:bb:cc on en0
        m = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+(\S+)/i);
        if (m && m[2] !== '(incomplete)') {
            neighbors.push({
                ip: m[1],
                interface: null,
                mac: m[2],
                state: 'REACHABLE'
            });
        }
    }
    return neighbors.slice(0, 40);
}

async function getActiveConnections() {
    let out = await execCmd('ss', ['-tn', 'state', 'established']);
    if (!out) {
        out = await execCmd('netstat', ['-tn']);
    }
    if (!out) return [];

    const rows = [];
    const lines = out.split('\n').slice(1);
    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        // ss: Recv-Q Send-Q Local Address:Port Peer Address:Port
        // netstat: Proto Recv-Q Send-Q Local Address Foreign Address State
        let local;
        let peer;
        if (parts[0] === 'tcp' || parts[0] === 'tcp4' || parts[0] === 'tcp6') {
            if ((parts[5] || '').toUpperCase() !== 'ESTABLISHED') continue;
            local = parts[3];
            peer = parts[4];
        } else {
            local = parts[3];
            peer = parts[4];
        }
        if (!local || !peer || peer === '*.*' || peer.startsWith('*:' )) continue;
        rows.push({ local, peer });
        if (rows.length >= 30) break;
    }
    return rows;
}

function httpRequest(targetUrl, options = {}) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (e) {
            reject(new Error('Invalid URL'));
            return;
        }

        const client = parsed.protocol === 'http:' ? http : https;
        const started = Date.now();
        let bytes = 0;
        let settled = false;

        const req = client.request(targetUrl, {
            method: options.method || 'GET',
            timeout: options.timeout || 60000,
            headers: {
                'User-Agent': 'HomeHub-NetworkAnalyzer/2.0',
                'Cache-Control': 'no-cache',
                ...(options.headers || {})
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
                resolve({ bytes, elapsedMs: Date.now() - started, statusCode: res.statusCode });
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('Request timed out'));
        });

        req.on('error', (err) => {
            if (settled) return;
            settled = true;
            reject(err);
        });

        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function toMbps(bytes, elapsedMs) {
    const seconds = elapsedMs / 1000;
    if (seconds <= 0) return 0;
    return Number(((bytes * 8) / (seconds * 1e6)).toFixed(2));
}

class NetworkAnalyzer {
    constructor(options = {}) {
        this.logger = options.logger;
        this.onResult = options.onResult || (() => {});
        this.onSnapshot = options.onSnapshot || (() => {});
        this.downloadUrl = options.downloadUrl || DEFAULT_DOWNLOAD_URL;
        this.uploadUrl = options.uploadUrl || DEFAULT_UPLOAD_URL;
        this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
        this.timer = null;
        this.snapshotTimer = null;
        this.running = false;
        this.lastResult = null;
        this.history = [];
        this.snapshot = {
            interfaces: [],
            gateway: null,
            dnsServers: [],
            wifi: { connected: false, ssid: null, signal: null, interface: null },
            neighbors: [],
            connections: [],
            updatedAt: null
        };
    }

    start() {
        this.log('info', `Network analyzer started (speed every ${Math.round(this.intervalMs / 60000)} min)`);

        this.refreshSnapshot().catch(() => {});
        this.snapshotTimer = setInterval(() => {
            this.refreshSnapshot().catch(() => {});
        }, SNAPSHOT_INTERVAL_MS);

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
        if (this.snapshotTimer) {
            clearInterval(this.snapshotTimer);
            this.snapshotTimer = null;
        }
    }

    getState() {
        return {
            lastResult: this.lastResult,
            history: this.history.slice(),
            intervalMs: this.intervalMs,
            running: this.running,
            nextRunHint: 'Every 1 hour',
            snapshot: this.snapshot
        };
    }

    async refreshSnapshot() {
        const [interfaces, gateway, dnsServers, wifi, neighbors, connections] = await Promise.all([
            Promise.resolve(getInterfaces()),
            getGateway(),
            getDnsServers(),
            getWifiInfo(),
            getLanNeighbors(),
            getActiveConnections()
        ]);

        this.snapshot = {
            interfaces,
            gateway,
            dnsServers,
            wifi,
            neighbors,
            connections,
            updatedAt: new Date().toISOString()
        };
        this.onSnapshot(this.snapshot);
        return this.snapshot;
    }

    async runLatency(gateway) {
        const results = {};
        for (const target of PING_TARGETS) {
            const host = target.key === 'gateway' ? gateway : target.host;
            results[target.key] = {
                label: target.label,
                ...(await pingHost(host))
            };
        }
        return results;
    }

    async runDownload() {
        const { bytes, elapsedMs } = await httpRequest(this.downloadUrl, { method: 'GET' });
        return {
            mbps: toMbps(bytes, elapsedMs),
            bytes,
            elapsedMs
        };
    }

    async runUpload() {
        const body = Buffer.alloc(UPLOAD_BYTES, 0x61);
        const { bytes, elapsedMs } = await httpRequest(this.uploadUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(body.length)
            },
            body
        });
        // Cloudflare may echo less; use sent size for rate
        const measuredBytes = Math.max(bytes, body.length);
        return {
            mbps: toMbps(measuredBytes, elapsedMs),
            bytes: measuredBytes,
            elapsedMs
        };
    }

    async runTest(trigger = 'manual') {
        if (this.running) {
            this.log('warn', 'Network test already running, skipped');
            return this.lastResult;
        }

        this.running = true;
        this.log('info', `Full network test started (${trigger})`);
        const startedAt = Date.now();

        try {
            await this.refreshSnapshot();
            const gateway = this.snapshot.gateway;

            const [latency, dnsResult] = await Promise.all([
                this.runLatency(gateway),
                measureDns(DNS_HOST)
            ]);

            // Sequential so download/upload don't contend for the same link
            const download = await this.runDownload().catch((err) => ({
                error: err.message || String(err),
                mbps: null,
                bytes: 0,
                elapsedMs: 0
            }));
            const upload = await this.runUpload().catch((err) => ({
                error: err.message || String(err),
                mbps: null,
                bytes: 0,
                elapsedMs: 0
            }));

            const downloadOk = typeof download.mbps === 'number';
            const uploadOk = typeof upload.mbps === 'number';
            const status = downloadOk || uploadOk ? 'ok' : 'error';

            const result = {
                status,
                trigger,
                timestamp: new Date().toISOString(),
                elapsedMs: Date.now() - startedAt,
                downloadMbps: downloadOk ? download.mbps : null,
                uploadMbps: uploadOk ? upload.mbps : null,
                downloadBytes: download.bytes || 0,
                uploadBytes: upload.bytes || 0,
                latency,
                dns: dnsResult,
                gateway,
                wifi: this.snapshot.wifi,
                error: [
                    download.error ? `Download: ${download.error}` : null,
                    upload.error ? `Upload: ${upload.error}` : null
                ].filter(Boolean).join('; ') || null
            };

            this.lastResult = result;
            this.history.push({
                timestamp: result.timestamp,
                status: result.status,
                trigger: result.trigger,
                downloadMbps: result.downloadMbps,
                uploadMbps: result.uploadMbps,
                latencyGatewayMs: latency.gateway && latency.gateway.avgMs != null ? latency.gateway.avgMs : null,
                latencyInternetMs: latency.cloudflare && latency.cloudflare.avgMs != null
                    ? latency.cloudflare.avgMs
                    : (latency.google && latency.google.avgMs != null ? latency.google.avgMs : null),
                dnsMs: dnsResult.ms,
                error: result.error
            });
            if (this.history.length > HISTORY_LIMIT) {
                this.history.shift();
            }

            this.running = false;
            this.log(
                'info',
                `Network test finished: down ${result.downloadMbps ?? '—'} / up ${result.uploadMbps ?? '—'} Mbps`
            );
            this.onResult(result);
            return result;
        } catch (err) {
            const result = {
                status: 'error',
                trigger,
                timestamp: new Date().toISOString(),
                elapsedMs: Date.now() - startedAt,
                downloadMbps: null,
                uploadMbps: null,
                downloadBytes: 0,
                uploadBytes: 0,
                latency: {},
                dns: null,
                gateway: this.snapshot.gateway,
                wifi: this.snapshot.wifi,
                error: err.message || String(err)
            };
            this.lastResult = result;
            this.history.push({
                timestamp: result.timestamp,
                status: 'error',
                trigger,
                downloadMbps: null,
                uploadMbps: null,
                latencyGatewayMs: null,
                latencyInternetMs: null,
                dnsMs: null,
                error: result.error
            });
            if (this.history.length > HISTORY_LIMIT) {
                this.history.shift();
            }
            this.running = false;
            this.log('error', `Network test failed: ${result.error}`);
            this.onResult(result);
            return result;
        } finally {
            this.running = false;
        }
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
                    phase: 'finished',
                    lastResult: result,
                    history: analyzer.history.slice(),
                    running: false,
                    intervalMs: analyzer.intervalMs,
                    snapshot: analyzer.snapshot
                }
            });
        },
        onSnapshot: (snapshot) => {
            broadcastToAll({
                type: 'network_snapshot',
                data: {
                    snapshot,
                    running: analyzer.running,
                    lastResult: analyzer.lastResult,
                    history: analyzer.history.slice(),
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
            data: {
                phase: 'finished',
                ...analyzer.getState(),
                running: false
            }
        }));
    });

    onClientMessage((ws, data) => {
        if (data.type === 'refresh_network_snapshot') {
            analyzer.refreshSnapshot().catch((err) => {
                logger.error('NetworkAnalyzer', `Snapshot refresh failed: ${err.message || err}`);
            });
            return true;
        }

        if (data.type !== 'run_network_test') return false;

        logger.info('NetworkAnalyzer', 'Manual Run now requested by client');
        broadcastToAll({
            type: 'network_stats',
            data: {
                phase: 'started',
                lastResult: analyzer.lastResult,
                history: analyzer.history.slice(),
                running: true,
                intervalMs: analyzer.intervalMs,
                snapshot: analyzer.snapshot
            }
        });

        analyzer.runTest('manual').catch((err) => {
            logger.error('NetworkAnalyzer', `Manual run failed: ${err.message || err}`);
            broadcastToAll({
                type: 'network_stats',
                data: {
                    phase: 'finished',
                    ...analyzer.getState(),
                    running: false
                }
            });
        });
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
    DEFAULT_DOWNLOAD_URL,
    DEFAULT_UPLOAD_URL
};
