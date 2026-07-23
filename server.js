const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const logger = require('./lib/logger');
const hubModules = require('./modules');
const { getBuildInfo } = require('./lib/build-id');

const app = express();
const server = http.createServer(app);
app.use(express.json({ limit: '1mb' }));

const buildInfo = getBuildInfo();
buildInfo.startedAt = new Date().toISOString();

app.get('/api/version', (req, res) => {
    res.json(buildInfo);
});

app.post('/api/update/now', (req, res) => {
    try {
        const flagPath = path.join(__dirname, 'data', 'pull-now.flag');
        fs.mkdirSync(path.dirname(flagPath), { recursive: true });
        fs.writeFileSync(flagPath, new Date().toISOString() + '\n', 'utf8');
        logger.info('Update', 'Pull-now requested from UI (watch mode will wake within ~1s)');
        res.json({
            ok: true,
            message: 'Update requested. If ./start.sh --watch is running, it will fetch/pull shortly.',
            buildId: buildInfo.buildId
        });
    } catch (err) {
        logger.error('Update', `Failed to request update: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message || String(err) });
    }
});

// WebSocket server for /dashboard path
const wss = new WebSocket.Server({ noServer: true });

// Handle WebSocket upgrades on /dashboard path
server.on('upgrade', (request, socket, head) => {
    if (request.url === '/dashboard') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// Persist Home widgets across restarts (Update / --watch kill Node otherwise wipes RAM)
const DASHBOARD_STATE_PATH = path.join(__dirname, 'data', 'dashboard-state.json');
let dashboardStateSaveTimer = null;

function loadDashboardState() {
    try {
        if (!fs.existsSync(DASHBOARD_STATE_PATH)) {
            return { modules: [], instances: {}, lastUpdated: Date.now() };
        }
        const raw = JSON.parse(fs.readFileSync(DASHBOARD_STATE_PATH, 'utf8'));
        if (!raw || !Array.isArray(raw.modules)) {
            return { modules: [], instances: {}, lastUpdated: Date.now() };
        }
        return {
            modules: raw.modules,
            instances: raw.instances && typeof raw.instances === 'object' ? raw.instances : {},
            lastUpdated: typeof raw.lastUpdated === 'number' ? raw.lastUpdated : Date.now()
        };
    } catch (err) {
        logger.warn('Sync', `Failed to load dashboard state: ${err.message}`);
        return { modules: [], instances: {}, lastUpdated: Date.now() };
    }
}

function saveDashboardState(immediate = false) {
    const write = () => {
        dashboardStateSaveTimer = null;
        try {
            fs.mkdirSync(path.dirname(DASHBOARD_STATE_PATH), { recursive: true });
            const payload = {
                modules: dashboardState.modules || [],
                instances: dashboardState.instances || {},
                lastUpdated: dashboardState.lastUpdated || Date.now()
            };
            fs.writeFileSync(DASHBOARD_STATE_PATH, JSON.stringify(payload, null, 2), 'utf8');
        } catch (err) {
            logger.error('Sync', `Failed to save dashboard state: ${err.message}`);
        }
    };

    if (immediate) {
        if (dashboardStateSaveTimer) {
            clearTimeout(dashboardStateSaveTimer);
            dashboardStateSaveTimer = null;
        }
        write();
        return;
    }

    if (dashboardStateSaveTimer) return;
    dashboardStateSaveTimer = setTimeout(write, 500);
}

let dashboardState = loadDashboardState();
logger.info('Sync', `Loaded dashboard state with ${dashboardState.modules.length} module(s)`);

// Connected clients
const clients = new Set();
const clientConnectedHandlers = [];
const clientMessageHandlers = [];

// System monitoring data
let systemStats = {};
let lastCpuUsage = process.cpuUsage();

function broadcastToAll(message) {
    const payload = JSON.stringify(message);
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

function onClientConnected(handler) {
    clientConnectedHandlers.push(handler);
}

function onClientMessage(handler) {
    clientMessageHandlers.push(handler);
}

// Register feature modules (activity log, network analyzer, etc.)
hubModules.registerAll({
    app,
    logger,
    broadcastToAll,
    onClientConnected,
    onClientMessage
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const remote = req.socket.remoteAddress;
    logger.info('Server', `Client connected from ${remote}`);

    clients.add(ws);

    // Do not push full_state on connect. An empty in-memory state after restart
    // used to wipe browser localStorage. Client sends full_state_sync first;
    // server replies with persisted layout only if the client is empty.

    ws.send(JSON.stringify({
        type: 'build_info',
        data: buildInfo
    }));

    // Send latest system stats + metrics-file history for graphs
    if (systemStats && Object.keys(systemStats).length) {
        ws.send(JSON.stringify({
            type: 'system_stats',
            data: {
                ...systemStats,
                history: logger.getSystemMetricsHistory(60)
            }
        }));
    }

    clientConnectedHandlers.forEach((handler) => {
        try {
            handler(ws, req);
        } catch (e) {
            logger.error('Server', `Module connect hook failed: ${e.message}`, {
                stack: e.stack
            });
        }
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            handleMessage(ws, data);
        } catch (e) {
            logger.error('Server', `Error parsing message: ${e.message}`, {
                stack: e.stack
            });
        }
    });

    ws.on('close', () => {
        logger.info('Server', 'Client disconnected');
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        logger.error('Server', `WebSocket error: ${error.message}`);
        clients.delete(ws);
    });
});

// Handle incoming messages
function handleMessage(ws, data) {
    switch (data.type) {
        case 'instance_update':
            logger.info('Sync', `Instance update: ${data.instanceKey}`);

            // Update server state
            if (!dashboardState.instances) {
                dashboardState.instances = {};
            }
            if (!dashboardState.instances[data.instanceKey]) {
                dashboardState.instances[data.instanceKey] = {};
            }

            // Merge the update data
            Object.assign(dashboardState.instances[data.instanceKey], data.data);
            dashboardState.lastUpdated = Date.now();
            saveDashboardState();

            // Broadcast to all other clients
            broadcastToOthers(ws, {
                type: 'instance_update',
                instanceKey: data.instanceKey,
                data: data.data,
                timestamp: data.timestamp
            });
            break;

        case 'full_state_sync':
            logger.info('Sync', 'Full state sync received');

            // Update server state with client's full state
            if (data.state) {
                const incomingModules = Array.isArray(data.state.modules) ? data.state.modules : [];
                const localCount = Array.isArray(dashboardState.modules) ? dashboardState.modules.length : 0;
                const incomingTs = typeof data.state.lastUpdated === 'number'
                    ? data.state.lastUpdated
                    : (typeof data.state.timestamp === 'number' ? data.state.timestamp : Date.now());
                const localTs = typeof dashboardState.lastUpdated === 'number' ? dashboardState.lastUpdated : 0;

                // Empty client: restore from disk/RAM if we have a layout
                if (incomingModules.length === 0 && localCount > 0) {
                    logger.info('Sync', 'Client empty; sending persisted modules back');
                    ws.send(JSON.stringify({
                        type: 'full_state',
                        state: dashboardState
                    }));
                    break;
                }

                // Both sides have layouts: keep the newer one
                if (incomingModules.length > 0 && localCount > 0 && localTs > incomingTs) {
                    logger.info('Sync', 'Persisted state is newer; sending it to client');
                    ws.send(JSON.stringify({
                        type: 'full_state',
                        state: dashboardState
                    }));
                    break;
                }

                if (incomingModules.length === 0 && localCount === 0) {
                    break;
                }

                dashboardState = {
                    modules: incomingModules,
                    instances: data.state.instances && typeof data.state.instances === 'object'
                        ? data.state.instances
                        : {},
                    lastUpdated: Date.now()
                };
                saveDashboardState(true);
                logger.info('Sync', `Updated state with ${incomingModules.length} modules`);

                // Broadcast full state to all other clients
                broadcastToOthers(ws, {
                    type: 'full_state',
                    state: dashboardState
                });
            }
            break;

        case 'pong':
            // Client responded to ping
            break;

        default: {
            let handled = false;
            clientMessageHandlers.forEach((handler) => {
                try {
                    if (handler(ws, data)) handled = true;
                } catch (e) {
                    logger.error('Server', `Module message hook failed: ${e.message}`, {
                        stack: e.stack
                    });
                }
            });
            if (!handled) {
                logger.warn('Server', `Unknown message type: ${data.type}`);
            }
            break;
        }
    }
}

// Broadcast message to all clients except sender
function broadcastToOthers(sender, message) {
    clients.forEach(client => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// System monitoring functions
function getCpuUsage() {
    const currentCpuUsage = process.cpuUsage();
    const diff = {
        user: currentCpuUsage.user - lastCpuUsage.user,
        system: currentCpuUsage.system - lastCpuUsage.system
    };
    lastCpuUsage = currentCpuUsage;

    const total = diff.user + diff.system;
    const usagePercent = Math.round((total / 1000000) * 100); // Convert to percentage
    return Math.min(usagePercent, 100); // Cap at 100%
}

function getCpuTemperature() {
    console.log("[Temperature] Starting temperature detection...");
    return new Promise((resolve, reject) => {
        try {
            // For Raspberry Pi, try multiple temperature sources
            const tempSources = [
                '/sys/class/thermal/thermal_zone0/temp',  // CPU thermal zone
                '/sys/class/hwmon/hwmon0/temp1_input',     // Alternative thermal sensor
                '/sys/class/hwmon/hwmon1/temp1_input'      // Another alternative
            ];

            console.log("[Temperature] Checking thermal zone files...");
            for (const source of tempSources) {
                try {
                    if (fs.existsSync(source)) {
                        const temp = fs.readFileSync(source, 'utf8').trim();
                        const tempValue = parseInt(temp);
                        if (isNaN(tempValue)) {
                            throw new Error(`Invalid temperature value from ${source}: ${temp}`);
                        }
                        // Handle both millidegrees (typical) and degrees
                        const finalTemp = tempValue > 200 ? Math.round(tempValue / 1000) : tempValue;
                        console.log(`[Temperature] Read ${finalTemp}°C from ${source}`);
                        resolve(finalTemp);
                        return;
                    }
    } catch (e) {
        logger.error('Temperature', `Failed to read from ${source}: ${e.message}`, {
            stack: e.stack,
            source
        });
        continue; // Try next source
    }
            }

            // If all thermal zone reads fail, try vcgencmd (Raspberry Pi specific)
            console.log('[Temperature] Trying vcgencmd fallback...' );
            exec('vcgencmd measure_temp', (error, stdout) => {
                console.log('[Temperature] vcgencmd error:', error, 'stdout:', stdout);
                if (error) {
                    reject(new Error(`vcgencmd command failed: ${error.message}`));
                    return;
                }

                if (!stdout) {
                    reject(new Error('vcgencmd returned no output'));
                    return;
                }

                const match = stdout.match(/temp=([0-9.]+)'C/);
                if (!match) {
                    reject(new Error(`Unable to parse temperature from vcgencmd output: ${stdout}`));
                    return;
                }

                const temp = Math.round(parseFloat(match[1]));
                console.log(`[Temperature] Read ${temp}°C from vcgencmd`);
                resolve(temp);
            });
        } catch (e) {
            reject(new Error(`Temperature detection failed: ${e.message}`));
        }
    });
}

function getMemoryUsage() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    // Validate memory readings
    if (totalMem === 0) {
        throw new Error('Unable to read total memory (reported as 0)');
    }

    if (freeMem > totalMem) {
        throw new Error(`Invalid memory readings: free (${freeMem}) > total (${totalMem})`);
    }

    const usedMem = totalMem - freeMem;
    const usagePercent = Math.round((usedMem / totalMem) * 100);

    const formatBytes = (bytes) => {
        const gb = (bytes / (1024 * 1024 * 1024)).toFixed(1);
        return `${gb}GB`;
    };

    const result = {
        usage: usagePercent,
        total: formatBytes(totalMem),
        used: formatBytes(usedMem),
        free: formatBytes(freeMem)
    };

    console.log(`[Memory] Total: ${result.total}, Used: ${result.used}, Free: ${result.free}, Usage: ${result.usage}%`);

    return result;
}

function getDiskUsage() {
    return new Promise((resolve, reject) => {
        exec('df / | tail -1', (error, stdout) => {
            if (error) {
                reject(new Error(`df command failed: ${error.message}`));
                return;
            }

            if (!stdout || stdout.trim() === '') {
                reject(new Error('df command returned no output'));
                return;
            }

            const parts = stdout.trim().split(/\s+/);
            if (parts.length < 6) {
                reject(new Error(`Unexpected df output format: ${stdout}`));
                return;
            }

            const totalKb = parseInt(parts[1]);
            const usedKb = parseInt(parts[2]);
            const usagePercent = parseInt(parts[4].replace('%', ''));

            if (isNaN(totalKb) || isNaN(usedKb) || isNaN(usagePercent)) {
                reject(new Error(`Invalid disk usage values from df output: ${stdout}`));
                return;
            }

            const formatBytes = (bytes) => {
                const gb = (bytes / (1024 * 1024 * 1024)).toFixed(1);
                return `${gb}GB`;
            };

            resolve({
                usage: usagePercent,
                total: formatBytes(totalKb * 1024), // Convert to bytes
                used: formatBytes(usedKb * 1024)
            });
        });
    });
}

function getUptime() {
    const uptime = os.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    let uptimeStr = '';
    if (days > 0) uptimeStr += `${days}d `;
    if (hours > 0) uptimeStr += `${hours}h `;
    uptimeStr += `${minutes}m`;

    return uptimeStr.trim();
}

function getNetworkStatus() {
    // Simple network check - could be enhanced
    try {
        const interfaces = os.networkInterfaces();
        let hasConnection = false;

        for (const [name, addresses] of Object.entries(interfaces)) {
            if (name !== 'lo' && addresses) {
                const hasValidAddress = addresses.some(addr =>
                    !addr.internal && addr.family === 'IPv4'
                );
                if (hasValidAddress) {
                    hasConnection = true;
                    break;
                }
            }
        }

        return hasConnection ? 'online' : 'offline';
    } catch (e) {
        logger.error('Network', `Failed to determine network status: ${e.message}`, {
            stack: e.stack
        });
        return 'unknown';
    }
}

function getRaspberryPiInfo() {
    return new Promise((resolve) => {
        exec('cat /proc/cpuinfo 2>/dev/null | grep "Model"', (error, stdout) => {
            if (!error && stdout) {
                const modelMatch = stdout.match(/Model\s*:\s*(.+)/);
                if (modelMatch) {
                    resolve(modelMatch[1].trim());
                    return;
                }
            }
            exec('cat /proc/device-tree/model 2>/dev/null', (error, stdout) => {
                if (!error && stdout) {
                    resolve(stdout.trim());
                } else {
                    resolve('Unknown');
                }
            });
        });
    });
}

async function updateSystemStats() {
    try {
        const [diskInfo, cpuTemp] = await Promise.all([
            getDiskUsage(),
            getCpuTemperature()
        ]);

        const memoryInfo = getMemoryUsage();

        systemStats = {
            lastUpdate: new Date().toISOString(),
            cpuUsage: getCpuUsage(),
            cpuTemp: cpuTemp,
            memoryUsage: memoryInfo.usage,
            memoryTotal: memoryInfo.total,
            memoryUsed: memoryInfo.used,
            diskUsage: diskInfo.usage,
            diskTotal: diskInfo.total,
            diskUsed: diskInfo.used,
            uptime: getUptime(),
            networkStatus: getNetworkStatus(),
            loadAverage: os.loadavg().map(x => x.toFixed(2)).join(', ')
        };

        console.log(`[System Monitor] Updated stats - CPU: ${systemStats.cpuUsage}%, Temp: ${systemStats.cpuTemp}°C, Memory: ${systemStats.memoryUsage}%`);

        // Persist history for later review + graph source
        logger.logSystemMetrics(systemStats);
        systemStats.history = logger.getSystemMetricsHistory(60);

        // Broadcast system stats to all connected clients
        broadcastToOthers(null, {
            type: 'system_stats',
            data: systemStats
        });

    } catch (e) {
        logger.error('SystemMonitor', `Error updating stats: ${e.message}`, {
            stack: e.stack
        });
        // Don't broadcast if we can't get valid data
        systemStats = {
            error: e.message,
            lastError: new Date().toISOString()
        };

        // Still broadcast the error so the client knows something is wrong
        broadcastToOthers(null, {
            type: 'system_stats',
            data: systemStats
        });
    }
}

process.on('uncaughtException', (err) => {
    logger.error('Process', `Uncaught exception: ${err.message}`, {
        stack: err.stack
    });
});

process.on('unhandledRejection', (reason) => {
    const message = reason && reason.message ? reason.message : String(reason);
    const stack = reason && reason.stack ? reason.stack : null;
    logger.error('Process', `Unhandled rejection: ${message}`, { stack });
});

// Update system stats every 5 seconds
setInterval(updateSystemStats, 5000);

// Initial update
updateSystemStats();

// Ping clients to keep connections alive
setInterval(() => {
    broadcastToOthers(null, { type: 'ping' });
}, 30000);

// Serve only dashboard UI assets — never expose .env, data/, logs/, .git, or server source
const PUBLIC_ROOT_FILES = new Set(['styles.css', 'script.js']);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/:file', (req, res, next) => {
    const file = req.params.file;
    if (!PUBLIC_ROOT_FILES.has(file)) return next();
    res.sendFile(path.join(__dirname, file), (err) => {
        if (err) next();
    });
});

app.use('/js', express.static(path.join(__dirname, 'js'), {
    fallthrough: false,
    index: false,
    dotfiles: 'deny'
}));

// Only module browser clients (never modules/*/server.js or other server-side files)
app.get('/modules/:name/client.js', (req, res, next) => {
    const name = req.params.name;
    if (!/^[a-z0-9_-]+$/i.test(name)) {
        return res.status(400).send('Invalid module name');
    }
    const modulesRoot = path.join(__dirname, 'modules');
    const filePath = path.join(modulesRoot, name, 'client.js');
    if (!filePath.startsWith(modulesRoot + path.sep)) {
        return res.status(400).send('Invalid path');
    }
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Not found');
    }
    res.type('application/javascript').sendFile(filePath);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    logger.info('Server', `Home Hub running on http://0.0.0.0:${PORT}`);
    logger.info('Server', `WebSocket endpoint: ws://localhost:${PORT}/dashboard`);
    logger.info('Server', `Build: ${buildInfo.buildId} (${buildInfo.branch})`);
    logger.info('Server', `Log file: ${logger.LOG_FILE}`);
    logger.info('Server', `Metrics history: ${logger.METRICS_LOG_FILE}`);

    // Tell open browsers a new build is up (watch-mode restart)
    broadcastToAll({
        type: 'build_info',
        data: buildInfo
    });

    const piModel = await getRaspberryPiInfo();
    logger.info('Server', `Detected host: ${piModel}`);
    logger.info('Server', `Memory: ${(os.totalmem() / (1024 * 1024 * 1024)).toFixed(1)}GB, CPU cores: ${os.cpus().length}`);
});
