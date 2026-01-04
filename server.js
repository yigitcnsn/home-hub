const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

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
