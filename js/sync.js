/**
 * WebSocket dashboard sync + auto-reload on build change.
 * Extends ModuleManager.prototype — load after module-manager.js
 */
Object.assign(ModuleManager.prototype, {
    initAutoReload() {
        this.knownBuildId = null;
        const applyBuild = (buildId) => {
            if (!buildId) return;
            if (this.knownBuildId && this.knownBuildId !== buildId) {
                console.log(`[AutoReload] New build ${buildId} (was ${this.knownBuildId}) — reloading`);
                window.location.reload();
                return;
            }
            this.knownBuildId = buildId;
        };

        const poll = () => {
            fetch('/api/version')
                .then((r) => r.json())
                .then((data) => applyBuild(data && data.buildId))
                .catch((err) => {
                    console.warn('[AutoReload] Version poll failed:', err.message || err);
                });
        };

        poll();
        setInterval(poll, 15000);
        this._applyBuildInfo = applyBuild;
    },

    initSync() {
        if (typeof WebSocket !== 'undefined') {
            this.initWebSocketSync();
        } else {
            this.initPollingSync();
        }
    },

    initWebSocketSync() {
        try {
            const wsUrl = `ws://${window.location.hostname}:3000/dashboard`;
            this.ws = new WebSocket(wsUrl);
            this.updateSyncStatus('connecting', '...');

            this.ws.onopen = () => {
                this.syncEnabled = true;
                this.updateSyncStatus('connected', 'On');
                this.sendFullState();
            };

            this.ws.onmessage = (event) => {
                try {
                    this.handleSyncMessage(JSON.parse(event.data));
                } catch (e) {
                    this.logError('WebSocket', `Error parsing message: ${e.message}`, {
                        stack: e.stack
                    });
                }
            };

            this.ws.onclose = () => {
                this.syncEnabled = false;
                this.updateSyncStatus('disconnected', 'Off');
                setTimeout(() => this.initWebSocketSync(), 5000);
            };

            this.ws.onerror = () => {
                this.logWarn('WebSocket', 'Connection error (will retry)');
                this.syncEnabled = false;
                this.updateSyncStatus('disconnected', 'Off');
            };
        } catch (e) {
            this.logError('WebSocket', `Failed to initialize: ${e.message}`, {
                stack: e.stack
            });
            this.updateSyncStatus('disconnected', 'Off');
            this.initPollingSync();
        }
    },

    initPollingSync() {
        this.syncEnabled = true;
        this.updateSyncStatus('connecting', '...');
        this.pollingInterval = setInterval(() => this.checkForUpdates(), 30000);
    },

    checkForUpdates() {
        // Placeholder for polling fallback
    },

    handleSyncMessage(message) {
        switch (message.type) {
            case 'instance_update':
                if (message.instanceKey && message.data) {
                    this.updateInstanceData(message.instanceKey, message.data);
                }
                break;

            case 'full_state':
                if (message.state) this.applyFullState(message.state);
                break;

            case 'system_stats':
                if (message.data) {
                    this.updateSystemMonitor('system_monitoring', message.data);
                    if (window.HomeHubModules) {
                        Object.values(window.HomeHubModules).forEach((mod) => {
                            if (typeof mod.onStats === 'function') {
                                mod.onStats(message.data);
                            } else if (typeof mod.handleMessage === 'function') {
                                mod.handleMessage(this, message);
                            }
                        });
                    }
                }
                break;

            case 'ping':
                this.ws.send(JSON.stringify({ type: 'pong' }));
                break;

            case 'build_info':
                if (message.data && typeof this._applyBuildInfo === 'function') {
                    this._applyBuildInfo(message.data.buildId);
                }
                break;

            case 'reload':
                window.location.reload();
                break;

            default: {
                let handled = false;
                if (window.HomeHubModules) {
                    Object.values(window.HomeHubModules).forEach((mod) => {
                        if (typeof mod.handleMessage === 'function' && mod.handleMessage(this, message)) {
                            handled = true;
                        }
                    });
                }
                if (!handled) {
                    console.log('[Sync] Unhandled message type:', message.type);
                }
                break;
            }
        }
    },

    sendFullState() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({
            type: 'full_state_sync',
            state: {
                modules: this.modules,
                instances: this.moduleInstances,
                timestamp: Date.now(),
                lastUpdated: Date.now()
            }
        }));
    },

    applyFullState(state) {
        if (!state || typeof state !== 'object') return;

        const remoteModules = Array.isArray(state.modules) ? state.modules : null;
        const remoteInstances = state.instances && typeof state.instances === 'object'
            ? state.instances
            : null;

        if (remoteModules && remoteModules.length === 0 && this.modules.length > 0) {
            console.log('[Sync] Ignoring empty remote state; keeping local widgets and re-pushing');
            this.sendFullState();
            return;
        }

        if (remoteModules) this.modules = remoteModules;
        if (remoteInstances) this.moduleInstances = remoteInstances;

        this.ensureSystemMonitor();
        this.ensureHubModules();
        this.saveModules();
        this.saveInstances();
        this.renderModules();
    },

    updateInstanceData(instanceKey, data) {
        if (!this.moduleInstances[instanceKey]) return;
        this.moduleInstances[instanceKey] = { ...this.moduleInstances[instanceKey], ...data };
        this.saveInstances();
        this.renderModules();
    },

    syncInstanceData(instanceKey, data) {
        this.updateInstanceData(instanceKey, data);

        if (this.syncEnabled && this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'instance_update',
                instanceKey,
                data,
                timestamp: Date.now()
            }));
            this.showSyncPulse();
            return;
        }

        console.warn('[syncInstanceData] Cannot sync — WebSocket not ready');
    },

    showSyncPulse() {
        const statusElement = document.getElementById('syncStatus');
        if (!statusElement) return;
        statusElement.classList.add('pulse');
        setTimeout(() => statusElement.classList.remove('pulse'), 1000);
    },

    updateSyncStatus(status, icon) {
        const statusElement = document.getElementById('syncStatus');
        if (!statusElement) return;

        statusElement.className = `sync-status ${status}`;
        const iconEl = statusElement.querySelector('.sync-icon');
        if (iconEl) iconEl.textContent = icon;

        const titles = {
            connected: 'Sync: Connected - Real-time updates active',
            connecting: 'Sync: Connecting...',
            disconnected: 'Sync: Disconnected - Changes won\'t sync'
        };
        statusElement.title = titles[status] || 'Sync Status';
    }
});
