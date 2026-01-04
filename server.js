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
    try {
        // For Raspberry Pi, read CPU temperature
        const temp = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
        return Math.round(parseInt(temp) / 1000); // Convert from millidegrees to degrees
    } catch (e) {
        // Fallback for other systems
        return Math.round(os.loadavg()[0] * 10 + 40); // Rough estimate
    }
}

function getMemoryUsage() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const usagePercent = Math.round((usedMem / totalMem) * 100);

    const formatBytes = (bytes) => {
        const gb = (bytes / (1024 * 1024 * 1024)).toFixed(1);
        return `${gb}GB`;
    };

    return {
        usage: usagePercent,
        total: formatBytes(totalMem),
        used: formatBytes(usedMem),
        free: formatBytes(freeMem)
    };
}

function getDiskUsage() {
    return new Promise((resolve) => {
        exec('df / | tail -1', (error, stdout) => {
            if (error) {
                resolve({ usage: 0, total: '0GB', used: '0GB' });
                return;
            }

            const parts = stdout.trim().split(/\s+/);
            const totalKb = parseInt(parts[1]) * 1024; // Convert to bytes
            const usedKb = parseInt(parts[2]) * 1024;
            const usagePercent = parseInt(parts[4].replace('%', ''));

            const formatBytes = (bytes) => {
                const gb = (bytes / (1024 * 1024 * 1024)).toFixed(1);
                return `${gb}GB`;
            };

            resolve({
                usage: usagePercent,
                total: formatBytes(totalKb),
                used: formatBytes(usedKb)
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

async function updateSystemStats() {
    try {
        const diskInfo = await getDiskUsage();

        systemStats = {
            cpuUsage: getCpuUsage(),
            cpuTemp: getCpuTemperature(),
            memoryUsage: getMemoryUsage().usage,
            memoryTotal: getMemoryUsage().total,
            memoryUsed: getMemoryUsage().used,
            diskUsage: diskInfo.usage,
            diskTotal: diskInfo.total,
            diskUsed: diskInfo.used,
            uptime: getUptime(),
            networkStatus: getNetworkStatus(),
            loadAverage: os.loadavg().map(x => x.toFixed(2)).join(', ')
        };

        // Broadcast system stats to all connected clients
        broadcastToOthers(null, {
            type: 'system_stats',
            data: systemStats
        });

    } catch (e) {
        console.error('[System Monitor] Error updating stats:', e);
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

// Note: Static files are served by Nginx on port 80
// Node.js only handles WebSocket connections

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[Server] Home Hub WebSocket server running on port ${PORT}`);
    console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/dashboard`);
    console.log(`[Server] Static files served by Nginx on port 80`);
});
