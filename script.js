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
                const view = item.dataset.view || 'home';
                this.setView(view);
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

        // Prevent manual addition of persistent modules
        const hubMod = window.HomeHubModules && Object.values(window.HomeHubModules).find(m => m.type === type);
        if (type === 'system' || (hubMod && hubMod.persistent)) {
            alert('This module is automatic and cannot be created manually.');
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

        // Prevent removal of persistent modules
        const hubMod = window.HomeHubModules && Object.values(window.HomeHubModules).find(m => m.type === moduleToRemove.type);
        if (moduleToRemove.type === 'system' || (hubMod && hubMod.persistent)) {
            alert('This module cannot be removed. It is a persistent widget.');
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
        const hubMod = window.HomeHubModules && window.HomeHubModules[module.type];
        const isPersistent = module.type === 'system' || (hubMod && hubMod.persistent);
        div.className = `module ${module.size}${module.type === 'system' ? ' module-system' : ''}`;
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
        if (window.HomeHubModules) {
            Object.values(window.HomeHubModules).forEach((m) => {
                if (m.type && m.label) typeLabels[m.type] = m.label;
            });
        }

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
                    <div class="module-type">${typeLabels[module.type] || module.type}</div>
                </div>
                <div class="module-actions">
                    ${isPersistent ?
                '<span class="module-persistent" title="Persistent widget">Pinned</span>' :
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
                    cpu: [],
                    memory: [],
                    disk: [],
                    temperature: [],
                    timestamps: []
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

        if (window.HomeHubModules) {
            Object.values(window.HomeHubModules).forEach((mod) => {
                if (mod.type && typeof mod.getSampleData === 'function') {
                    data[mod.type] = mod.getSampleData();
                }
            });
        }

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
            if (!data || (!data.lastUpdate && !data.error)) {
                return `
                    <div class="system-monitor loading-state">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">Connecting to host…</div>
                    </div>
                `;
            }

            if (data.error) {
                return `
                    <div class="system-monitor error-state">
                        <div class="error-text">Unable to read system information</div>
                        <div class="error-message">${data.error}</div>
                    </div>
                `;
            }

            const formatLastUpdate = (timestamp) => {
                const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
                if (diff < 60) return `${diff}s ago`;
                if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                return `${Math.floor(diff / 86400)}d ago`;
            };

            const usageClass = (value) => {
                if (typeof value !== 'number') return 'level-error';
                if (value >= 85) return 'level-high';
                if (value >= 65) return 'level-warm';
                return 'level-ok';
            };

            const tempClass = (temp) => {
                if (typeof temp !== 'number') return 'level-error';
                if (temp >= 70) return 'level-high';
                if (temp >= 55) return 'level-warm';
                return 'level-ok';
            };

            const pct = (value) => (typeof value === 'number' ? `${value}%` : '—');
            const temp = (value) => (typeof value === 'number' ? `${value}°C` : '—');
            const barWidth = (value) => (typeof value === 'number' ? Math.max(0, Math.min(100, value)) : 0);
            const tempBarWidth = (value) => (typeof value === 'number' ? Math.max(0, Math.min(100, (value / 80) * 100)) : 0);

            const networkStatus = (data.networkStatus || 'unknown').toLowerCase();
            const systemStatus = data.status === 'error' ||
                data.cpuUsage === 'ERR' ||
                data.memoryUsage === 'ERR' ? 'error' : 'online';

            const generateLogsHTML = (logs) => {
                if (!logs || logs.length === 0) {
                    return '<div class="no-logs">No recent events</div>';
                }

                return logs.slice(-8).reverse().map(log => {
                    const time = new Date(log.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });
                    return `
                        <div class="log-entry log-${log.type || 'info'}">
                            <span class="log-time">${time}</span>
                            <span class="log-message">${log.message}</span>
                        </div>
                    `;
                }).join('');
            };

            const instanceKey = module.instanceKey || this.getInstanceKey(module.name, module.type);

            return `
                <div class="system-monitor">
                    <div class="system-toolbar">
                        <div class="system-live">
                            <span class="system-status ${systemStatus}"></span>
                            <span class="system-status-label">${systemStatus === 'online' ? 'Live' : 'Error'}</span>
                        </div>
                        <span class="system-updated">Updated ${formatLastUpdate(data.lastUpdate || new Date().toISOString())}</span>
                    </div>

                    <div class="system-metrics">
                        <div class="metric-card ${usageClass(data.cpuUsage)}">
                            <div class="metric-top">
                                <span class="metric-label">CPU</span>
                                <span class="metric-value">${pct(data.cpuUsage)}</span>
                            </div>
                            <div class="metric-bar"><span class="metric-bar-fill" style="width:${barWidth(data.cpuUsage)}%"></span></div>
                            <div class="metric-sub">Host load</div>
                            <canvas class="system-graph" id="cpu-graph-${module.id}" width="280" height="56"></canvas>
                        </div>

                        <div class="metric-card ${usageClass(data.memoryUsage)}">
                            <div class="metric-top">
                                <span class="metric-label">Memory</span>
                                <span class="metric-value">${pct(data.memoryUsage)}</span>
                            </div>
                            <div class="metric-bar"><span class="metric-bar-fill" style="width:${barWidth(data.memoryUsage)}%"></span></div>
                            <div class="metric-sub">${data.memoryUsed || '—'} / ${data.memoryTotal || '—'}</div>
                            <canvas class="system-graph" id="memory-graph-${module.id}" width="280" height="56"></canvas>
                        </div>

                        <div class="metric-card ${usageClass(data.diskUsage)}">
                            <div class="metric-top">
                                <span class="metric-label">Disk</span>
                                <span class="metric-value">${pct(data.diskUsage)}</span>
                            </div>
                            <div class="metric-bar"><span class="metric-bar-fill" style="width:${barWidth(data.diskUsage)}%"></span></div>
                            <div class="metric-sub">${data.diskUsed || '—'} / ${data.diskTotal || '—'}</div>
                            <canvas class="system-graph" id="disk-graph-${module.id}" width="280" height="56"></canvas>
                        </div>

                        <div class="metric-card ${tempClass(data.cpuTemp)}">
                            <div class="metric-top">
                                <span class="metric-label">Temperature</span>
                                <span class="metric-value">${temp(data.cpuTemp)}</span>
                            </div>
                            <div class="metric-bar"><span class="metric-bar-fill" style="width:${tempBarWidth(data.cpuTemp)}%"></span></div>
                            <div class="metric-sub">Safe under 70°C</div>
                            <canvas class="system-graph" id="temp-graph-${module.id}" width="280" height="56"></canvas>
                        </div>
                    </div>

                    <div class="system-meta">
                        <div class="meta-item">
                            <span class="meta-label">Uptime</span>
                            <span class="meta-value">${data.uptime || '—'}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Network</span>
                            <span class="meta-value network-${networkStatus}">${networkStatus}</span>
                        </div>
                    </div>

                    <div class="system-logs">
                        <div class="logs-header">
                            <span class="logs-title">Recent events</span>
                            <button type="button" class="logs-clear-btn" onclick="moduleManager.clearSystemLogs('${instanceKey}')">Clear</button>
                        </div>
                        <div class="logs-container" id="logs-container-${module.id}">
                            ${generateLogsHTML(data.logs)}
                        </div>
                    </div>
                </div>
            `;
        }

        const hubMod = window.HomeHubModules && window.HomeHubModules[type];
        if (hubMod && typeof hubMod.render === 'function') {
            return hubMod.render(data, module);
        }

        return `
                <div class="module-value">${data.value}</div>
                <div class="module-status ${data.status}">${data.status === 'active' ? 'Active' : 'Inactive'}</div>
            `;
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

            this.updateSyncStatus('connecting', '...');

            this.ws.onopen = () => {
                console.log('[WebSocket] Connected to sync server');
                this.syncEnabled = true;
                this.updateSyncStatus('connected', 'On');
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
                this.updateSyncStatus('disconnected', 'Off');
                setTimeout(() => this.initWebSocketSync(), 5000);
            };

            this.ws.onerror = (error) => {
                console.error('[WebSocket] Error:', error);
                this.syncEnabled = false;
                this.updateSyncStatus('disconnected', 'Off');
            };

        } catch (e) {
            console.error('[WebSocket] Failed to initialize:', e);
            this.updateSyncStatus('disconnected', 'Off');
            this.initPollingSync();
        }
    }

    // Fallback polling sync for older browsers or when WebSocket fails
    initPollingSync() {
        console.log('[Polling] Initializing polling sync every 30 seconds');
        this.syncEnabled = true;
        this.updateSyncStatus('connecting', '...');

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
            // Update with detailed error state
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
                loadAverage: 'ERR',
                status: 'error',
                errorDetails: stats.error,
                lastErrorTime: stats.lastError || new Date().toISOString()
            });
        } else {
            // Clear any previous error state
            this.updateInstanceData(systemInstanceKey, {
                ...stats,
                status: 'active',
                error: undefined,
                errorDetails: undefined,
                lastErrorTime: undefined
            });
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

            // Always keep persistent modules
            this.ensureSystemMonitor();
            this.ensureHubModules();
            this.renderModules();

            console.log('[clearAllWidgets] Widgets cleared; persistent modules restored');
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
        this.ensureHubModules();

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
                size: 'large',
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
        } else if (existingSystemMonitor.size !== 'large') {
            existingSystemMonitor.size = 'large';
            this.saveModules();
        }
    }

    ensureHubModules() {
        if (!window.HomeHubModules) return;
        Object.values(window.HomeHubModules).forEach((mod) => {
            if (typeof mod.ensure === 'function') {
                mod.ensure(this);
            }
        });
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
            btn.textContent = 'Theme';
            console.log('[updateDarkModeIcon] Label set to Theme');
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

    setView(view) {
        const title = document.querySelector('.page-title');
        const grid = document.getElementById('modulesGrid');
        const logsView = document.getElementById('logsView');
        const timeDisplay = document.getElementById('timeDisplay');

        if (title) {
            title.textContent = view === 'logs' ? 'Logs' : 'Home';
        }

        if (logsView) {
            logsView.hidden = view !== 'logs';
        }

        if (grid) {
            grid.hidden = view === 'logs';
            grid.style.display = view === 'logs' ? 'none' : '';
        }

        if (timeDisplay) {
            timeDisplay.style.display = view === 'logs' ? 'none' : '';
        }

        document.body.classList.toggle('view-logs', view === 'logs');
    }

    // Draw system graphs using Canvas
    drawSystemGraphs(moduleId, data) {
        // CPU Graph - show error if no data
        if (data.history?.cpu && data.history.cpu.length > 0 && typeof data.cpuUsage === 'number') {
            this.drawGraph(`cpu-graph-${moduleId}`, data.history.cpu, '#3b82f6', data.cpuUsage);
        } else {
            this.showGraphError(`cpu-graph-${moduleId}`, 'CPU data unavailable');
        }

        // Memory Graph - show error if no data
        if (data.history?.memory && data.history.memory.length > 0 && typeof data.memoryUsage === 'number') {
            this.drawGraph(`memory-graph-${moduleId}`, data.history.memory, '#10b981', data.memoryUsage);
        } else {
            this.showGraphError(`memory-graph-${moduleId}`, 'Memory data unavailable');
        }

        // Disk Graph - show error if no data
        if (data.history?.disk && data.history.disk.length > 0 && typeof data.diskUsage === 'number') {
            this.drawGraph(`disk-graph-${moduleId}`, data.history.disk, '#f59e0b', data.diskUsage);
        } else {
            this.showGraphError(`disk-graph-${moduleId}`, 'Disk data unavailable');
        }

        // Temperature Graph - show error if no data
        if (data.history?.temperature && data.history.temperature.length > 0 && typeof data.cpuTemp === 'number') {
            const tempHistory = data.history.temperature.map(temp => Math.min((temp / 80) * 100, 100));
            const tempColor = data.cpuTemp >= 70 ? '#ef4444' : data.cpuTemp >= 55 ? '#f59e0b' : '#10b981';
            this.drawGraph(`temp-graph-${moduleId}`, tempHistory, tempColor, (data.cpuTemp / 80) * 100);
        } else {
            this.showGraphError(`temp-graph-${moduleId}`, 'Temperature data unavailable');
        }
    }

    showGraphError(canvasId, message) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw error background
        ctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
        ctx.fillRect(0, 0, width, height);

        // Draw error border
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(2, 2, width - 4, height - 4);

        // Draw error icon and text
        ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', width / 2, height / 2 - 8);

        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(message, width / 2, height / 2 + 8);

        console.error(`[System Monitor] ${message} for ${canvasId}`);
    }

    drawGraph(canvasId, data, color, currentValue) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const points = Array.isArray(data) ? data.filter(v => typeof v === 'number') : [];

        ctx.clearRect(0, 0, width, height);

        if (points.length === 0) {
            ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
            ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Waiting for history…', width / 2, height / 2 + 4);
            return;
        }

        const values = points.length === 1 ? [points[0], points[0]] : points;
        const stepX = width / Math.max(values.length - 1, 1);
        const yFor = (value) => {
            const clamped = Math.max(0, Math.min(100, value));
            return height - 4 - (clamped / 100) * (height - 8);
        };

        // Baseline
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height - 4);
        ctx.lineTo(width, height - 4);
        ctx.stroke();

        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, color + '33');
        gradient.addColorStop(1, color + '00');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(0, height - 4);
        values.forEach((value, i) => {
            ctx.lineTo(i * stepX, yFor(value));
        });
        ctx.lineTo((values.length - 1) * stepX, height - 4);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        values.forEach((value, i) => {
            const x = i * stepX;
            const y = yFor(value);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        const lastValue = typeof currentValue === 'number' ? currentValue : values[values.length - 1];
        const lastX = (values.length - 1) * stepX;
        const lastY = yFor(lastValue);

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fill();
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
                cpu: [],
                memory: [],
                disk: [],
                temperature: [],
                timestamps: []
            };
        }

        // Add new values only if data is available (no fallbacks)
        if (typeof data.cpuUsage === 'number' && !isNaN(data.cpuUsage)) {
            instanceData.history.cpu.push(data.cpuUsage);
            if (instanceData.history.cpu.length > 20) {
                instanceData.history.cpu.shift();
            }
        }

        if (typeof data.memoryUsage === 'number' && !isNaN(data.memoryUsage)) {
            instanceData.history.memory.push(data.memoryUsage);
            if (instanceData.history.memory.length > 20) {
                instanceData.history.memory.shift();
            }
        }

        if (typeof data.diskUsage === 'number' && !isNaN(data.diskUsage)) {
            instanceData.history.disk.push(data.diskUsage);
            if (instanceData.history.disk.length > 20) {
                instanceData.history.disk.shift();
            }
        }

        // Only add temperature data if we have a valid reading
        if (typeof data.cpuTemp === 'number' && !isNaN(data.cpuTemp) && data.cpuTemp > 0) {
            instanceData.history.temperature.push(data.cpuTemp);
            if (instanceData.history.temperature.length > 20) {
                instanceData.history.temperature.shift();
            }
        }

        // Always add timestamp for this data point
        instanceData.history.timestamps.push(new Date().toISOString());
        if (instanceData.history.timestamps.length > 20) {
            instanceData.history.timestamps.shift();
        }

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

