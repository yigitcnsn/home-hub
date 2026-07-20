const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);

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

// Store the current dashboard state
let dashboardState = {
    modules: [],
    instances: {},
    lastUpdated: Date.now()
};

// Connected clients
const clients = new Set();

// System monitoring data
let systemStats = {};
let lastCpuUsage = process.cpuUsage();

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    console.log(`[Server] New client connected from ${req.socket.remoteAddress}`);

    clients.add(ws);

    // Send current state to new client
    ws.send(JSON.stringify({
        type: 'full_state',
        state: dashboardState
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            handleMessage(ws, data);
        } catch (e) {
            console.error('[Server] Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        console.log('[Server] Client disconnected');
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('[Server] WebSocket error:', error);
        clients.delete(ws);
    });
});

// Handle incoming messages
function handleMessage(ws, data) {
    switch (data.type) {
        case 'instance_update':
            console.log(`[Server] Instance update: ${data.instanceKey}`);

            // Update server state
            if (!dashboardState.instances[data.instanceKey]) {
                dashboardState.instances[data.instanceKey] = {};
            }

            // Merge the update data
            Object.assign(dashboardState.instances[data.instanceKey], data.data);
            dashboardState.lastUpdated = Date.now();

            // Broadcast to all other clients
            broadcastToOthers(ws, {
                type: 'instance_update',
                instanceKey: data.instanceKey,
                data: data.data,
                timestamp: data.timestamp
            });
            break;

        case 'full_state_sync':
            console.log('[Server] Full state sync received');

            // Update server state with client's full state
            if (data.state) {
                dashboardState = data.state;
                console.log(`[Server] Updated state with ${data.state.modules?.length || 0} modules`);

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

        default:
            console.log('[Server] Unknown message type:', data.type);
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
                    console.error(`[Temperature] Failed to read from ${source}:`, e.message);
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

        // Broadcast system stats to all connected clients
        broadcastToOthers(null, {
            type: 'system_stats',
            data: systemStats
        });

    } catch (e) {
        console.error('[System Monitor] Error updating stats:', e.message);
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

// Update system stats every 5 seconds
setInterval(updateSystemStats, 5000);

// Initial update
updateSystemStats();

// Ping clients to keep connections alive
setInterval(() => {
    broadcastToOthers(null, { type: 'ping' });
}, 30000);

// Serve dashboard UI from the project directory
app.use(express.static(path.join(__dirname)));

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    console.log(`[Server] Home Hub running on http://0.0.0.0:${PORT}`);
    console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/dashboard`);

    // Log system information
    const piModel = await getRaspberryPiInfo();
    console.log(`[Server] Detected Raspberry Pi model: ${piModel}`);
    console.log(`[Server] Total memory: ${(os.totalmem() / (1024 * 1024 * 1024)).toFixed(1)}GB`);
    console.log(`[Server] CPU cores: ${os.cpus().length}`);
});
