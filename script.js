// Module Management System
class ModuleManager {
    constructor() {
        this.modules = [];
        this.moduleIdCounter = 0;
        this.draggedElement = null;
        this.moduleInstances = {}; // Store shared data for module instances
        this.init();
    }

    init() {
        console.log('[ModuleManager] Initializing...');
        this.loadModules();
        this.loadInstances();
        this.loadDarkMode();
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.renderModules();
        this.startClock();
        this.initSync();
        console.log('[ModuleManager] Initialization complete');
    }

    setupEventListeners() {
        // Add Module Button
        document.getElementById('addModuleBtn').addEventListener('click', () => {
            this.openAddModuleModal();
        });

        // Modal Controls
        document.getElementById('closeModal').addEventListener('click', () => {
            this.closeAddModuleModal();
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            this.closeAddModuleModal();
        });

        document.getElementById('addBtn').addEventListener('click', () => {
            this.addModule();
        });

        // Close modal on outside click
        document.getElementById('addModuleModal').addEventListener('click', (e) => {
            if (e.target.id === 'addModuleModal') {
                this.closeAddModuleModal();
            }
        });

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
                const view = item.dataset.view;
                document.querySelector('.page-title').textContent = this.capitalizeFirst(view);
            });
        });

        // Top bar actions
        const darkModeBtn = document.getElementById('darkModeBtn');
        console.log('[setupEventListeners] Dark mode button found:', darkModeBtn);
        if (darkModeBtn) {
            darkModeBtn.onclick = (e) => {
                console.log('[darkModeBtn] Click event triggered');
                e.preventDefault();
                e.stopPropagation();
                this.toggleDarkMode();
            };
            console.log('[setupEventListeners] Dark mode button onclick handler attached');
        } else {
            console.error('[setupEventListeners] Dark mode button not found!');
        }

        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.refreshModules();
        });

        document.getElementById('fullscreenBtn').addEventListener('click', () => {
            this.toggleFullscreen();
        });

        // Developer actions
        document.getElementById('clearWidgetsBtn').addEventListener('click', () => {
            this.clearAllWidgets();
        });
    }

    setupDragAndDrop() {
        const grid = document.getElementById('modulesGrid');

        grid.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('module')) {
                this.draggedElement = e.target;
                e.target.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            }
        });

        grid.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('module')) {
                e.target.classList.remove('dragging');
                document.querySelectorAll('.module').forEach(m => m.classList.remove('drag-over'));
            }
        });

        grid.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const afterElement = this.getDragAfterElement(grid, e.clientY);
            const dragging = document.querySelector('.dragging');

            if (afterElement == null) {
                grid.appendChild(dragging);
            } else {
                grid.insertBefore(dragging, afterElement);
            }
        });

        grid.addEventListener('drop', (e) => {
            e.preventDefault();
            if (this.draggedElement) {
                this.saveModuleOrder();
            }
        });
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.module:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    openAddModuleModal() {
        document.getElementById('addModuleModal').classList.add('active');
        document.getElementById('moduleName').value = '';
        document.getElementById('moduleType').value = 'temperature';
        document.getElementById('moduleSize').value = 'medium';
        document.getElementById('addBtn').textContent = 'Add Module';
    }

    closeAddModuleModal() {
        document.getElementById('addModuleModal').classList.remove('active');
    }

    addModule() {
        const name = document.getElementById('moduleName').value.trim();
        const type = document.getElementById('moduleType').value;
        const size = document.getElementById('moduleSize').value;

        if (!name) {
            alert('Please enter a module name');
            return;
        }

        // Prevent manual addition of system monitor
        if (type === 'system') {
            alert('System monitor is automatically added and cannot be created manually.');
            return;
        }

        const instanceKey = this.getInstanceKey(name, type);

        // Check if a module with the same name and type already exists
        const existingModuleIndex = this.modules.findIndex(m =>
            (m.instanceKey || this.getInstanceKey(m.name, m.type)) === instanceKey
        );

        if (existingModuleIndex !== -1) {
            // Update existing module instead of adding new one
            const existingModule = this.modules[existingModuleIndex];
            existingModule.size = size;
            existingModule.createdAt = new Date().toISOString();

            // Update instance data if it doesn't exist
            if (!this.moduleInstances[instanceKey]) {
                this.moduleInstances[instanceKey] = this.getSampleData(type);
            }

            this.saveModules();
            this.saveInstances();
            this.renderModules();
            this.closeAddModuleModal();
            return;
        }

        // Create new module if it doesn't exist
        const module = {
            id: this.moduleIdCounter++,
            name: name,
            type: type,
            size: size,
            createdAt: new Date().toISOString(),
            instanceKey: instanceKey
        };

        // Initialize instance data if it doesn't exist
        if (!this.moduleInstances[instanceKey]) {
            this.moduleInstances[instanceKey] = this.getSampleData(type);
        }

        this.modules.push(module);
        this.saveModules();
        this.saveInstances();
        this.renderModules();
        this.closeAddModuleModal();

        // Sync the new instance across devices
        this.syncInstanceData(instanceKey, this.moduleInstances[instanceKey]);
    }

    getInstanceKey(name, type) {
        return `${type}_${name.toLowerCase().replace(/\s+/g, '_')}`;
    }

    removeModule(id) {
        const moduleToRemove = this.modules.find(m => m.id === id);
        if (!moduleToRemove) return;

        // Prevent removal of system monitor
        if (moduleToRemove.type === 'system') {
            alert('System monitor cannot be removed. It is a persistent widget.');
            return;
        }

        const instanceKey = moduleToRemove.instanceKey || this.getInstanceKey(moduleToRemove.name, moduleToRemove.type);

        // Remove the module
        this.modules = this.modules.filter(m => m.id !== id);

        // Check if any other modules use this instance
        const modulesWithInstance = this.modules.filter(m =>
            (m.instanceKey || this.getInstanceKey(m.name, m.type)) === instanceKey
        );

        // If no other modules use this instance, clean up the instance data
        if (modulesWithInstance.length === 0 && this.moduleInstances[instanceKey]) {
            delete this.moduleInstances[instanceKey];
            this.saveInstances();
        }

        this.saveModules();
        this.renderModules();
    }

    renderModules() {
        const grid = document.getElementById('modulesGrid');
        grid.innerHTML = '';

        this.modules.forEach(module => {
            const moduleElement = this.createModuleElement(module);
            grid.appendChild(moduleElement);
        });

        // Draw graphs for system monitor modules
        setTimeout(() => {
            this.modules.forEach(module => {
                if (module.type === 'system') {
                    const instanceKey = module.instanceKey || this.getInstanceKey(module.name, module.type);
                    const instanceData = this.moduleInstances[instanceKey];
                    if (instanceData) {
                        this.drawSystemGraphs(module.id, instanceData);
                    }
                }
            });
        }, 100); // Small delay to ensure DOM is ready
    }

    createModuleElement(module) {
        const div = document.createElement('div');
        div.className = `module ${module.size}`;
        div.draggable = true;
        div.dataset.moduleId = module.id;
        div.dataset.instanceKey = module.instanceKey || this.getInstanceKey(module.name, module.type);

        const typeLabels = {
            temperature: 'Temperature',
            lighting: 'Lighting',
            security: 'Security',
            energy: 'Energy',
            weather: 'Weather',
            system: 'System Monitor',
            custom: 'Custom'
        };

        // Get instance data (shared across all modules with same name+type)
        const instanceKey = module.instanceKey || this.getInstanceKey(module.name, module.type);
        const instanceData = this.moduleInstances[instanceKey] || this.getSampleData(module.type);

        // If instance doesn't exist, create it
        if (!this.moduleInstances[instanceKey]) {
            this.moduleInstances[instanceKey] = instanceData;
            this.saveInstances();
        }

        div.innerHTML = `
            <div class="module-header">
                <div>
                    <div class="module-title">${module.name}</div>
                    <div class="module-type">${typeLabels[module.type]}</div>
                </div>
                <div class="module-actions">
                    ${module.type === 'system' ?
                '<span class="module-persistent" title="Persistent widget">🔒</span>' :
                `<button class="module-action-btn" onclick="moduleManager.editModule(${module.id})" title="Edit">Edit</button>
                         <button class="module-action-btn" onclick="moduleManager.removeModule(${module.id})" title="Remove">Delete</button>`
            }
                </div>
            </div>
            <div class="module-content">
                ${this.getModuleContent(module.type, instanceData, module)}
            </div>
        `;

        return div;
    }

    getSampleData(type) {
        const data = {
            temperature: { value: '22°C', status: 'active' },
            lighting: { value: '75%', status: 'active' },
            security: { value: 'Armed', status: 'active' },
            energy: { value: '2.4 kW', status: 'active' },
            weather: { value: '18°C', status: 'active' },
            system: {
                cpuUsage: 15,
                cpuTemp: 45,
                memoryUsage: 35,
                memoryTotal: '4GB',
                memoryUsed: '1.4GB',
                diskUsage: 42,
                diskTotal: '32GB',
                diskUsed: '13.4GB',
                uptime: '2d 4h 23m',
                networkStatus: 'online',
                loadAverage: '0.15, 0.22, 0.18',
                lastUpdate: new Date().toISOString(),
                // Historical data for graphs (last 20 data points)
                history: {
                    cpu: Array.from({ length: 20 }, () => Math.floor(Math.random() * 100)),
                    memory: Array.from({ length: 20 }, () => Math.floor(Math.random() * 100)),
                    disk: Array.from({ length: 20 }, () => Math.floor(Math.random() * 100)),
                    temperature: [], // Start empty, will be populated with real data
                    timestamps: Array.from({ length: 20 }, (_, i) => new Date(Date.now() - (19 - i) * 5000).toISOString())
                },
                logs: [
                    { timestamp: new Date(Date.now() - 30000).toISOString(), message: 'System monitor initialized', type: 'info' },
                    { timestamp: new Date(Date.now() - 25000).toISOString(), message: 'CPU temperature monitoring started', type: 'info' },
                    { timestamp: new Date(Date.now() - 20000).toISOString(), message: 'Memory usage tracking active', type: 'info' },
                    { timestamp: new Date(Date.now() - 15000).toISOString(), message: 'Disk monitoring enabled', type: 'info' },
                    { timestamp: new Date(Date.now() - 10000).toISOString(), message: 'Network status check completed', type: 'success' }
                ]
            },
            custom: { value: 'Ready', status: 'active' }
        };
        return data[type] || data.custom;
    }

    getModuleContent(type, data, module) {
        if (type === 'temperature') {
            return `
                <div class="module-value">${data.value}</div>
                <div class="module-status ${data.status}">${data.status === 'active' ? 'Active' : 'Inactive'}</div>
            `;
        } else if (type === 'lighting') {
            return `
                <div class="module-value">${data.value}</div>
                <div class="module-status ${data.status}">${data.status === 'active' ? 'On' : 'Off'}</div>
            `;
        } else if (type === 'security') {
            return `
                <div class="module-value">${data.value}</div>
                <div class="module-status ${data.status}">${data.status === 'active' ? 'Secure' : 'Unsecure'}</div>
            `;
        } else if (type === 'energy') {
            return `
                <div class="module-value">${data.value}</div>
                <div class="module-status ${data.status}">Current Usage</div>
            `;
        } else if (type === 'weather') {
            return `
                <div class="module-value">${data.value}</div>
                <div class="module-status ${data.status}">Outside</div>
            `;
        } else if (type === 'system') {
            // Check for error state
            if (data.error) {
                return `
                    <div class="system-monitor error-state">
                        <div class="system-header">
                            <div class="system-title">System Monitor - ERROR</div>
                            <div class="system-last-update">
                                <span class="update-label">Error:</span>
                                <span class="error-message">${data.error}</span>
                            </div>
                        </div>
                        <div class="system-error">
                            <div class="error-icon">⚠️</div>
                            <div class="error-text">Unable to read system information</div>
                            <div class="error-details">Check server logs for details</div>
                        </div>
                    </div>
                `;
            }

            // Create visual graphs and status indicators
            const getStatusIndicator = (status, value) => {
                const statusClasses = {
                    online: 'status-online',
                    offline: 'status-offline',
                    unknown: 'status-unknown'
                };
                return `<span class="status-indicator ${statusClasses[status] || 'status-unknown'}">${value}</span>`;
            };

            const getTempIndicator = (temp) => {
                let tempClass = 'temp-normal';
                if (temp > 70) tempClass = 'temp-high';
                else if (temp > 50) tempClass = 'temp-warm';
                return `<span class="temp-indicator ${tempClass}">${temp}°C</span>`;
            };

            const formatLastUpdate = (timestamp) => {
                const now = new Date();
                const update = new Date(timestamp);
                const diff = Math.floor((now - update) / 1000);

                if (diff < 60) return `${diff}s ago`;
                if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                return `${Math.floor(diff / 86400)}d ago`;
            };

            // Generate logs HTML
            const generateLogsHTML = (logs) => {
                if (!logs || logs.length === 0) return '<div class="no-logs">No logs available</div>';

                return logs.slice(-10).reverse().map(log => {
                    const time = new Date(log.timestamp).toLocaleTimeString();
                    const logClass = `log-entry log-${log.type}`;
                    const icon = log.type === 'error' ? '❌' : log.type === 'warning' ? '⚠️' : log.type === 'success' ? '✅' : 'ℹ️';
                    return `<div class="${logClass}"><span class="log-time">${time}</span><span class="log-icon">${icon}</span><span class="log-message">${log.message}</span></div>`;
                }).join('');
            };

            return `
                <div class="system-monitor">
                    <div class="system-header">
                        <div class="system-title">System Health</div>
                        <div class="system-last-update">
                            <span class="update-label">Last update:</span>
                            <span class="update-time">${formatLastUpdate(data.lastUpdate || new Date().toISOString())}</span>
                        </div>
                    </div>

                    <div class="system-graphs">
                        <div class="graph-row">
                            <div class="graph-container">
                                <div class="graph-header">
                                    <span class="graph-title">CPU Usage</span>
                                    <span class="graph-value">${data.cpuUsage}%</span>
                                </div>
                                <canvas class="system-graph" id="cpu-graph-${module.id}" width="300" height="80"></canvas>
                            </div>
                            <div class="graph-container">
                                <div class="graph-header">
                                    <span class="graph-title">Memory</span>
                                    <span class="graph-value">${data.memoryUsage}%</span>
                                </div>
                                <canvas class="system-graph" id="memory-graph-${module.id}" width="300" height="80"></canvas>
                            </div>
                        </div>
                        <div class="graph-row">
                            <div class="graph-container">
                                <div class="graph-header">
                                    <span class="graph-title">Disk Usage</span>
                                    <span class="graph-value">${data.diskUsage}%</span>
                                </div>
                                <canvas class="system-graph" id="disk-graph-${module.id}" width="300" height="80"></canvas>
                            </div>
                            <div class="graph-container">
                                <div class="graph-header">
                                    <span class="graph-title">CPU Temperature</span>
                                    <span class="graph-value">${data.cpuTemp}°C</span>
                                </div>
                                <canvas class="system-graph" id="temp-graph-${module.id}" width="300" height="80"></canvas>
                            </div>
                        </div>
                    </div>

                    <div class="system-details">
                        <div class="detail-row">
                            <div class="detail-item">
                                <span class="detail-label">Memory Details</span>
                                <span class="detail-value">${data.memoryUsed} / ${data.memoryTotal}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Disk Details</span>
                                <span class="detail-value">${data.diskUsed} / ${data.diskTotal}</span>
                            </div>
                        </div>
                        <div class="detail-row">
                            <div class="detail-item">
                                <span class="detail-label">Uptime</span>
                                <span class="detail-value">${data.uptime}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Network</span>
                                <span class="detail-value">${getStatusIndicator(data.networkStatus, data.networkStatus)}</span>
                            </div>
                        </div>
                    </div>

                    <div class="system-logs">
                        <div class="logs-header">
                            <span class="logs-title">System Logs</span>
                            <button class="logs-clear-btn" onclick="moduleManager.clearSystemLogs('${module.instanceKey || this.getInstanceKey(module.name, module.type)}')">Clear</button>
                        </div>
                        <div class="logs-container" id="logs-container-${module.id}">
                            ${generateLogsHTML(data.logs)}
                        </div>
                    </div>
                </div>
            `;
        } else {
            return `
                <div class="module-value">${data.value}</div>
                <div class="module-status ${data.status}">${data.status === 'active' ? 'Active' : 'Inactive'}</div>
            `;
        }
    }

    editModule(id) {
        const module = this.modules.find(m => m.id === id);
        if (module) {
            document.getElementById('moduleName').value = module.name;
            document.getElementById('moduleType').value = module.type;
            document.getElementById('moduleSize').value = module.size;
            this.openAddModuleModal();

            // Change add button to update
            const addBtn = document.getElementById('addBtn');
            addBtn.textContent = 'Update Module';
            const oldInstanceKey = module.instanceKey || this.getInstanceKey(module.name, module.type);

            addBtn.onclick = () => {
                const newName = document.getElementById('moduleName').value.trim();
                const newType = document.getElementById('moduleType').value;
                const newSize = document.getElementById('moduleSize').value;
                const newInstanceKey = this.getInstanceKey(newName, newType);

                // If instance key changed, migrate data
                if (oldInstanceKey !== newInstanceKey && this.moduleInstances[oldInstanceKey]) {
                    if (!this.moduleInstances[newInstanceKey]) {
                        this.moduleInstances[newInstanceKey] = this.moduleInstances[oldInstanceKey];
                    }
                    // Update all modules with old key to new key
                    this.modules.forEach(m => {
                        if (m.instanceKey === oldInstanceKey) {
                            m.instanceKey = newInstanceKey;
                        }
                    });
                }

                module.name = newName;
                module.type = newType;
                module.size = newSize;
                module.instanceKey = newInstanceKey;

                // Update all modules with same instance key
                this.updateInstanceModules(newInstanceKey);

                this.saveModules();
                this.saveInstances();
                this.renderModules();
                this.closeAddModuleModal();
                addBtn.textContent = 'Add Module';
                addBtn.onclick = () => this.addModule();
            };
        }
    }

    updateInstanceModules(instanceKey) {
        // Update all modules that share this instance
        const instanceData = this.moduleInstances[instanceKey];
        if (instanceData) {
            this.renderModules();
        }
    }

    refreshModules() {
        // Simulate data refresh and update all instances
        const uniqueInstances = new Set();
        this.modules.forEach(module => {
            const instanceKey = module.instanceKey || this.getInstanceKey(module.name, module.type);
            uniqueInstances.add(instanceKey);
            console.log(`Refreshing ${module.name} (instance: ${instanceKey})...`);
        });

        // Update instance data (in a real app, this would fetch new data)
        uniqueInstances.forEach(instanceKey => {
            const modulesWithInstance = this.modules.filter(m =>
                (m.instanceKey || this.getInstanceKey(m.name, m.type)) === instanceKey
            );
            if (modulesWithInstance.length > 0) {
                const module = modulesWithInstance[0];
                // Update instance data - in real app, fetch from API
                this.moduleInstances[instanceKey] = this.getSampleData(module.type);
            }
        });

        this.saveInstances();
        this.renderModules();

        // Visual feedback
        const btn = document.getElementById('refreshBtn');
        btn.style.transform = 'rotate(360deg)';
        setTimeout(() => {
            btn.style.transform = 'rotate(0deg)';
        }, 500);
    }

    updateInstanceData(instanceKey, data) {
        if (this.moduleInstances[instanceKey]) {
            this.moduleInstances[instanceKey] = { ...this.moduleInstances[instanceKey], ...data };
            this.saveInstances();
            this.renderModules();
            console.log(`[updateInstanceData] Updated instance ${instanceKey} with data:`, data);
        }
    }

    // Method to sync instance data across devices
    syncInstanceData(instanceKey, data) {
        console.log(`[syncInstanceData] Called for ${instanceKey}`, data);
        this.updateInstanceData(instanceKey, data);

        // Send to server for cross-device sync
        if (this.syncEnabled && this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({
                type: 'instance_update',
                instanceKey: instanceKey,
                data: data,
                timestamp: Date.now()
            });
            this.ws.send(message);
            console.log(`[syncInstanceData] Synced ${instanceKey} to server`);
            this.showSyncPulse();
        } else {
            console.warn(`[syncInstanceData] Cannot sync - syncEnabled: ${this.syncEnabled}, ws readyState: ${this.ws ? this.ws.readyState : 'no ws'}`);
        }
    }

    // Show a brief pulse animation when data is synced
    showSyncPulse() {
        const statusElement = document.getElementById('syncStatus');
        if (statusElement) {
            statusElement.classList.add('pulse');
            setTimeout(() => {
                statusElement.classList.remove('pulse');
            }, 1000);
        }
    }

    // Initialize sync system
    initSync() {
        if (typeof WebSocket !== 'undefined') {
            this.initWebSocketSync();
        } else {
            console.log('[initSync] WebSocket not supported, falling back to polling');
            this.initPollingSync();
        }
    }

    // WebSocket-based real-time sync
    initWebSocketSync() {
        try {
            // Connect directly to the WebSocket server on port 3000
            const wsUrl = `ws://${window.location.hostname}:3000/dashboard`;
            console.log('[WebSocket] Connecting to:', wsUrl);
            this.ws = new WebSocket(wsUrl);

            this.updateSyncStatus('connecting', '⏳');

            this.ws.onopen = () => {
                console.log('[WebSocket] Connected to sync server');
                this.syncEnabled = true;
                this.updateSyncStatus('connected', '✓');
                // Send current state to server
                this.sendFullState();
                console.log('[WebSocket] Full state sent, ready for sync');
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleSyncMessage(message);
                } catch (e) {
                    console.error('[WebSocket] Error parsing message:', e);
                }
            };

            this.ws.onclose = () => {
                console.log('[WebSocket] Disconnected, retrying in 5 seconds...');
                this.syncEnabled = false;
                this.updateSyncStatus('disconnected', '✗');
                setTimeout(() => this.initWebSocketSync(), 5000);
            };

            this.ws.onerror = (error) => {
                console.error('[WebSocket] Error:', error);
                this.syncEnabled = false;
                this.updateSyncStatus('disconnected', '✗');
            };

        } catch (e) {
            console.error('[WebSocket] Failed to initialize:', e);
            this.updateSyncStatus('disconnected', '✗');
            this.initPollingSync();
        }
    }

    // Fallback polling sync for older browsers or when WebSocket fails
    initPollingSync() {
        console.log('[Polling] Initializing polling sync every 30 seconds');
        this.syncEnabled = true;
        this.updateSyncStatus('connecting', '⟲');

        this.pollingInterval = setInterval(() => {
            this.checkForUpdates();
        }, 30000);
    }

    // Handle incoming sync messages
    handleSyncMessage(message) {
        switch (message.type) {
            case 'instance_update':
                if (message.instanceKey && message.data) {
                    console.log(`[Sync] Received update for ${message.instanceKey}`);
                    this.updateInstanceData(message.instanceKey, message.data);
                }
                break;

            case 'full_state':
                if (message.state) {
                    console.log('[Sync] Received full state update');
                    this.applyFullState(message.state);
                }
                break;

            case 'system_stats':
                if (message.data) {
                    console.log('[System] Received system stats update');
                    this.updateSystemMonitor('system_monitoring', message.data);
                }
                break;

            case 'ping':
                // Respond to server ping to maintain connection
                this.ws.send(JSON.stringify({ type: 'pong' }));
                break;
        }
    }

    // Send current full state to server
    sendFullState() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const fullState = {
                modules: this.modules,
                instances: this.moduleInstances,
                timestamp: Date.now()
            };

            this.ws.send(JSON.stringify({
                type: 'full_state_sync',
                state: fullState
            }));
        }
    }

    // Apply full state received from server
    applyFullState(state) {
        if (state.modules) {
            this.modules = state.modules;
        }
        if (state.instances) {
            this.moduleInstances = state.instances;
        }
        this.saveModules();
        this.saveInstances();
        this.renderModules();
    }

    // Update system stats from server
    updateSystemStats(stats) {
        // Update the system instance data
        const systemInstanceKey = 'system_monitoring';

        if (stats.error) {
            console.error('[System] Stats update failed:', stats.error);
            // Update with error state
            this.updateInstanceData(systemInstanceKey, {
                ...stats,
                cpuUsage: 'ERR',
                cpuTemp: 'ERR',
                memoryUsage: 'ERR',
                memoryTotal: 'ERR',
                memoryUsed: 'ERR',
                diskUsage: 'ERR',
                diskTotal: 'ERR',
                diskUsed: 'ERR',
                uptime: 'ERR',
                networkStatus: 'ERR',
                loadAverage: 'ERR'
            });
        } else {
            this.updateInstanceData(systemInstanceKey, stats);
        }
    }

    // Check for updates (polling fallback)
    checkForUpdates() {
        // In a real implementation, this would fetch from your server
        // For now, just a placeholder
        console.log('[Polling] Checking for updates...');
    }

    // Update sync status indicator
    updateSyncStatus(status, icon) {
        const statusElement = document.getElementById('syncStatus');
        if (statusElement) {
            statusElement.className = `sync-status ${status}`;
            statusElement.querySelector('.sync-icon').textContent = icon;

            // Update title attribute
            const titles = {
                connected: 'Sync: Connected - Real-time updates active',
                connecting: 'Sync: Connecting...',
                disconnected: 'Sync: Disconnected - Changes won\'t sync'
            };
            statusElement.title = titles[status] || 'Sync Status';
        }
    }

    // Method to get all unique instances for device sync
    getAllInstances() {
        return Object.keys(this.moduleInstances).map(key => ({
            key: key,
            data: this.moduleInstances[key],
            modules: this.modules.filter(m =>
                (m.instanceKey || this.getInstanceKey(m.name, m.type)) === key
            ).length
        }));
    }

    // Developer method to clear all widgets and instances
    clearAllWidgets() {
        if (confirm('Are you sure you want to clear all widgets? This action cannot be undone.')) {
            console.log('[clearAllWidgets] Clearing all widgets and instances...');

            // Clear all data
            this.modules = [];
            this.moduleInstances = {};
            this.moduleIdCounter = 0;

            // Clear localStorage
            localStorage.removeItem('homeHubModules');
            localStorage.removeItem('homeHubModuleInstances');
            localStorage.removeItem('homeHubModuleIdCounter');

            // Re-render empty grid
            this.renderModules();

            console.log('[clearAllWidgets] All widgets and instances cleared');
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    saveModuleOrder() {
        const moduleElements = document.querySelectorAll('.module');
        const newOrder = Array.from(moduleElements).map(el => parseInt(el.dataset.moduleId));
        this.modules.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
        this.saveModules();
    }

    saveModules() {
        localStorage.setItem('homeHubModules', JSON.stringify(this.modules));
        localStorage.setItem('homeHubModuleIdCounter', this.moduleIdCounter.toString());
    }

    saveInstances() {
        localStorage.setItem('homeHubModuleInstances', JSON.stringify(this.moduleInstances));
    }

    loadModules() {
        const saved = localStorage.getItem('homeHubModules');
        const savedCounter = localStorage.getItem('homeHubModuleIdCounter');

        if (saved) {
            this.modules = JSON.parse(saved);
            // Ensure all modules have instanceKey
            this.modules.forEach(module => {
                if (!module.instanceKey) {
                    module.instanceKey = this.getInstanceKey(module.name, module.type);
                }
            });
        }

        // Always ensure system monitor widget exists
        this.ensureSystemMonitor();

        if (savedCounter) {
            this.moduleIdCounter = parseInt(savedCounter);
        }
    }

    // Ensure system monitor widget always exists
    ensureSystemMonitor() {
        const systemInstanceKey = 'system_monitoring';
        const existingSystemMonitor = this.modules.find(m =>
            (m.instanceKey || this.getInstanceKey(m.name, m.type)) === systemInstanceKey
        );

        if (!existingSystemMonitor) {
            console.log('[System] Creating persistent system monitor widget');

            const systemModule = {
                id: this.moduleIdCounter++,
                name: 'System Monitor',
                type: 'system',
                size: 'medium',
                createdAt: new Date().toISOString(),
                instanceKey: systemInstanceKey
            };

            // Initialize system monitor instance data
            if (!this.moduleInstances[systemInstanceKey]) {
                this.moduleInstances[systemInstanceKey] = this.getSampleData('system');
            }

            this.modules.push(systemModule);
            this.saveModules();
            this.saveInstances();
        }
    }

    loadInstances() {
        const saved = localStorage.getItem('homeHubModuleInstances');
        if (saved) {
            this.moduleInstances = JSON.parse(saved);
        } else {
            // Initialize instance data for existing modules
            this.modules.forEach(module => {
                const instanceKey = module.instanceKey || this.getInstanceKey(module.name, module.type);
                if (!this.moduleInstances[instanceKey]) {
                    this.moduleInstances[instanceKey] = this.getSampleData(module.type);
                }
            });
            this.saveInstances();
        }
    }

    toggleDarkMode() {
        console.log('[toggleDarkMode] Called');
        const body = document.body;
        const wasDark = body.classList.contains('dark-mode');
        const isDark = body.classList.toggle('dark-mode');
        console.log('[toggleDarkMode] Dark mode state changed:', wasDark, '->', isDark);
        console.log('[toggleDarkMode] Body classes:', body.className);
        this.saveDarkMode(isDark);
        this.updateDarkModeIcon(isDark);
        console.log('[toggleDarkMode] Complete');
    }

    loadDarkMode() {
        console.log('[loadDarkMode] Loading dark mode preference...');
        const saved = localStorage.getItem('homeHubDarkMode');
        console.log('[loadDarkMode] Saved preference:', saved);
        if (saved === 'true') {
            document.body.classList.add('dark-mode');
            console.log('[loadDarkMode] Dark mode enabled');
            this.updateDarkModeIcon(true);
        } else {
            console.log('[loadDarkMode] Light mode (default)');
            this.updateDarkModeIcon(false);
        }
    }

    saveDarkMode(isDark) {
        console.log('[saveDarkMode] Saving dark mode preference:', isDark);
        localStorage.setItem('homeHubDarkMode', isDark.toString());
        console.log('[saveDarkMode] Saved to localStorage');
    }

    updateDarkModeIcon(isDark) {
        console.log('[updateDarkModeIcon] Updating icon, isDark:', isDark);
        const btn = document.getElementById('darkModeBtn');
        console.log('[updateDarkModeIcon] Button found:', btn);
        if (btn) {
            const icon = isDark ? '◑' : '◐';
            btn.textContent = icon;
            console.log('[updateDarkModeIcon] Icon updated to:', icon);
        } else {
            console.warn('[updateDarkModeIcon] Button not found!');
        }
    }

    startClock() {
        this.updateTime();
        setInterval(() => {
            this.updateTime();
        }, 1000);
    }

    updateTime() {
        const timeValue = document.getElementById('timeValue');
        const dateValue = document.getElementById('dateValue');

        if (!timeValue || !dateValue) {
            return;
        }

        const now = new Date();

        const timeOptions = {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };
        const timeString = now.toLocaleTimeString(undefined, timeOptions);

        const dateOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        const dateString = now.toLocaleDateString(undefined, dateOptions);

        timeValue.textContent = timeString;
        dateValue.textContent = dateString;
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    // Draw system graphs using Canvas
    drawSystemGraphs(moduleId, data) {
        // Don't draw graphs if there's no history data (error state)
        if (!data.history || !data.history.cpu || !data.history.memory || !data.history.disk) {
            console.log(`[System Graphs] Skipping graph drawing for module ${moduleId} - no history data available`);
            return;
        }
        // CPU Graph
        this.drawGraph(`cpu-graph-${moduleId}`, data.history.cpu, '#3b82f6', data.cpuUsage);

        // Memory Graph
        this.drawGraph(`memory-graph-${moduleId}`, data.history.memory, '#10b981', data.memoryUsage);

        // Disk Graph
        this.drawGraph(`disk-graph-${moduleId}`, data.history.disk, '#f59e0b', data.diskUsage);

        // Temperature Graph (only draw if we have temperature history data)
        if (data.history.temperature && data.history.temperature.length > 0) {
            const tempHistory = data.history.temperature.map(temp => Math.min((temp / 80) * 100, 100));
            this.drawGraph(`temp-graph-${moduleId}`, tempHistory, '#ef4444', (data.cpuTemp / 80) * 100);
        }
    }

    drawGraph(canvasId, data, color, currentValue) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Set up gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, color + '40'); // Semi-transparent
        gradient.addColorStop(1, color + '10');

        // Draw area fill
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(0, height);

        const points = data.length;
        const stepX = width / (points - 1);

        for (let i = 0; i < points; i++) {
            const x = i * stepX;
            const y = height - (data[i] / 100) * height;
            ctx.lineTo(x, y);
        }

        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();

        // Draw line
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        for (let i = 0; i < points; i++) {
            const x = i * stepX;
            const y = height - (data[i] / 100) * height;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();

        // Draw current value indicator
        const currentX = (points - 1) * stepX;
        const currentY = height - (currentValue / 100) * height;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(currentX, currentY, 4, 0, 2 * Math.PI);
        ctx.fill();

        // Add glow effect
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    // Update system monitor with new data
    updateSystemMonitor(instanceKey, data) {
        const instanceData = this.moduleInstances[instanceKey];
        if (!instanceData || !data) return;

        // Update current values
        Object.assign(instanceData, data);
        instanceData.lastUpdate = new Date().toISOString();

        // Update historical data
        if (!instanceData.history) {
            instanceData.history = {
                cpu: Array.from({ length: 20 }, () => 0),
                memory: Array.from({ length: 20 }, () => 0),
                disk: Array.from({ length: 20 }, () => 0),
                temperature: [], // Start empty, will be populated with real data
                timestamps: Array.from({ length: 20 }, (_, i) => new Date(Date.now() - (19 - i) * 5000).toISOString())
            };
        }

        // Shift historical data and add new values
        instanceData.history.cpu.shift();
        instanceData.history.cpu.push(data.cpuUsage || 0);

        instanceData.history.memory.shift();
        instanceData.history.memory.push(data.memoryUsage || 0);

        instanceData.history.disk.shift();
        instanceData.history.disk.push(data.diskUsage || 0);

        // Only add temperature data if we have a valid reading
        if (data.cpuTemp && data.cpuTemp > 0) {
            instanceData.history.temperature.push(data.cpuTemp);
            // Keep only the last 20 temperature readings
            if (instanceData.history.temperature.length > 20) {
                instanceData.history.temperature.shift();
            }
        }

        instanceData.history.timestamps.shift();
        instanceData.history.timestamps.push(new Date().toISOString());

        // Add log entry for significant changes
        if (!instanceData.logs) instanceData.logs = [];

        const addLogEntry = (message, type = 'info') => {
            instanceData.logs.push({
                timestamp: new Date().toISOString(),
                message: message,
                type: type
            });

            // Keep only last 50 logs
            if (instanceData.logs.length > 50) {
                instanceData.logs.shift();
            }
        };

        // Check for significant changes and log them
        const oldCpu = instanceData.history.cpu[instanceData.history.cpu.length - 2] || 0;
        const oldMemory = instanceData.history.memory[instanceData.history.memory.length - 2] || 0;
        const oldDisk = instanceData.history.disk[instanceData.history.disk.length - 2] || 0;

        if (Math.abs(data.cpuUsage - oldCpu) > 20) {
            const direction = data.cpuUsage > oldCpu ? 'increased' : 'decreased';
            addLogEntry(`CPU usage ${direction} to ${data.cpuUsage}%`, data.cpuUsage > 80 ? 'warning' : 'info');
        }

        if (Math.abs(data.memoryUsage - oldMemory) > 15) {
            const direction = data.memoryUsage > oldMemory ? 'increased' : 'decreased';
            addLogEntry(`Memory usage ${direction} to ${data.memoryUsage}%`, data.memoryUsage > 85 ? 'warning' : 'info');
        }

        if (Math.abs(data.diskUsage - oldDisk) > 10) {
            const direction = data.diskUsage > oldDisk ? 'increased' : 'decreased';
            addLogEntry(`Disk usage ${direction} to ${data.diskUsage}%`, data.diskUsage > 90 ? 'error' : 'info');
        }

        // Update all modules that use this instance
        this.renderModules();
    }

    // Clear system logs
    clearSystemLogs(instanceKey) {
        const instanceData = this.moduleInstances[instanceKey];
        if (instanceData && instanceData.logs) {
            instanceData.logs = [];
            this.saveInstances();
            this.renderModules();
        }
    }
}

// Initialize the module manager when DOM is loaded
let moduleManager;
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DOMContentLoaded] DOM ready, initializing ModuleManager...');
    moduleManager = new ModuleManager();
    console.log('[DOMContentLoaded] ModuleManager instance created:', moduleManager);
});

