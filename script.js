// Escape text before inserting into HTML (XSS hygiene)
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeCssToken(value, fallback = 'info') {
    const token = String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return token || fallback;
}

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
        this.buildModuleNav();
        this.renderModules();
        this.startClock();
        this.initSync();
        this.initAutoReload();
        this.setView('home');
        console.log('[ModuleManager] Initialization complete');
    }

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
                .catch(() => {});
        };

        poll();
        setInterval(poll, 15000);
        this._applyBuildInfo = applyBuild;
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
        document.getElementById('sidebarNav').addEventListener('click', (e) => {
            const item = e.target.closest('.nav-item');
            if (!item) return;
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            this.setView(item.dataset.view || 'home');
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
        const updateNowBtn = document.getElementById('updateNowBtn');
        if (updateNowBtn) {
            updateNowBtn.addEventListener('click', () => {
                updateNowBtn.disabled = true;
                updateNowBtn.querySelector('.btn-text').textContent = 'Updating…';
                fetch('/api/update/now', { method: 'POST' })
                    .then((r) => r.json())
                    .then((data) => {
                        if (!data.ok) {
                            alert(data.error || 'Update request failed');
                            return;
                        }
                        // Watch mode should pull + restart; page reloads via build id
                        updateNowBtn.querySelector('.btn-text').textContent = 'Requested';
                        setTimeout(() => {
                            updateNowBtn.disabled = false;
                            updateNowBtn.querySelector('.btn-text').textContent = 'Update';
                        }, 4000);
                    })
                    .catch((err) => {
                        alert('Update request failed: ' + err.message);
                        updateNowBtn.disabled = false;
                        updateNowBtn.querySelector('.btn-text').textContent = 'Update';
                    });
            });
        }

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
        document.getElementById('addBtn').textContent = 'Add Widget';
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

        // Prevent adding system / sidebar-only modules as Home widgets
        const hubMod = window.HomeHubModules && Object.values(window.HomeHubModules).find(m => m.type === type);
        if (type === 'system' || type === 'network' || (hubMod && hubMod.nav && typeof hubMod.render !== 'function')) {
            alert('This is a sidebar module, not a Home widget. Use Speed Test for a widget.');
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

        // System Monitor uses Fitness rings (no Home sparklines)
    }

    createModuleElement(module) {
        const div = document.createElement('div');
        const hubMod = window.HomeHubModules && window.HomeHubModules[module.type];
        const isPersistent = module.type === 'system' || (hubMod && hubMod.persistent);
        div.className = `module ${module.size}${module.type === 'system' ? ' module-system' : ''}`;
        div.draggable = true;
        div.dataset.moduleId = module.id;
        div.dataset.instanceKey = module.instanceKey || this.getInstanceKey(module.name, module.type);

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
                <div class="module-title">${escapeHtml(module.name)}</div>
                <div class="module-actions">
                    ${isPersistent ?
                '<span class="module-persistent" title="Persistent widget">Pinned</span>' :
                `<button class="module-action-btn" onclick="moduleManager.editModule(${Number(module.id) || 0})" title="Edit">Edit</button>
                         <button class="module-action-btn" onclick="moduleManager.removeModule(${Number(module.id) || 0})" title="Remove">Delete</button>`
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
        const statusLabel = (status, activeText, inactiveText) => {
            const isActive = status === 'active';
            return `<div class="comp-sub ${isActive ? 'is-active' : 'is-inactive'}">${isActive ? activeText : inactiveText}</div>`;
        };

        const complicationFace = (value, subHtml) => `
                <div class="comp-face">
                    <div class="comp-value">${escapeHtml(value)}</div>
                    ${subHtml}
                </div>
            `;

        if (type === 'temperature') {
            return complicationFace(data.value, statusLabel(data.status, 'Active', 'Inactive'));
        } else if (type === 'lighting') {
            return complicationFace(data.value, statusLabel(data.status, 'On', 'Off'));
        } else if (type === 'security') {
            return complicationFace(data.value, statusLabel(data.status, 'Secure', 'Unsecure'));
        } else if (type === 'energy') {
            return complicationFace(data.value, `<div class="comp-sub">Current usage</div>`);
        } else if (type === 'weather') {
            return complicationFace(data.value, `<div class="comp-sub">Outside</div>`);
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
                        <div class="error-message">${escapeHtml(data.error)}</div>
                    </div>
                `;
            }

            const formatLastUpdate = (timestamp) => {
                const diff = Math.max(0, Math.floor((Date.now() - new Date(timestamp)) / 1000));
                if (diff < 60) return `${diff}s ago`;
                if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                return `${Math.floor(diff / 86400)}d ago`;
            };

            const clampPct = (value) => {
                if (typeof value !== 'number' || Number.isNaN(value)) return 0;
                return Math.max(0, Math.min(100, value));
            };

            const pct = (value) => (typeof value === 'number' ? `${Math.round(value)}%` : '—');
            const tempNum = typeof data.cpuTemp === 'number' ? Math.round(data.cpuTemp) : null;
            const tempDisplay = tempNum !== null ? String(tempNum) : '—';

            const networkStatus = safeCssToken(data.networkStatus || 'unknown', 'unknown');
            const systemStatus = data.status === 'error' ||
                data.cpuUsage === 'ERR' ||
                data.memoryUsage === 'ERR' ? 'error' : 'online';

            // Fitness rings: outer CPU, middle Memory, inner Disk
            const rings = [
                { key: 'cpu', r: 42, stroke: 7, pct: clampPct(data.cpuUsage) },
                { key: 'mem', r: 32, stroke: 7, pct: clampPct(data.memoryUsage) },
                { key: 'disk', r: 22, stroke: 7, pct: clampPct(data.diskUsage) }
            ];

            const ringsSvg = rings.map((ring) => {
                const c = 2 * Math.PI * ring.r;
                const dash = (ring.pct / 100) * c;
                return `
                    <circle class="fitness-ring-track" cx="50" cy="50" r="${ring.r}" stroke-width="${ring.stroke}"></circle>
                    <circle class="fitness-ring-arc ${ring.key}" cx="50" cy="50" r="${ring.r}" stroke-width="${ring.stroke}"
                        stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}"></circle>
                `;
            }).join('');

            return `
                <div class="system-monitor">
                    <div class="system-fitness">
                        <div class="fitness-rings" aria-hidden="true">
                            <svg viewBox="0 0 100 100">${ringsSvg}</svg>
                            <div class="fitness-center">
                                <span class="fitness-center-value">${escapeHtml(tempDisplay)}</span>
                                <span class="fitness-center-unit">${tempNum !== null ? '°C' : 'Temp'}</span>
                            </div>
                        </div>
                        <div class="fitness-legend">
                            <div class="fitness-legend-row">
                                <span class="fitness-dot cpu"></span>
                                <span class="fitness-legend-label">CPU</span>
                                <span class="fitness-legend-value">${escapeHtml(pct(data.cpuUsage))}</span>
                            </div>
                            <div class="fitness-legend-row">
                                <span class="fitness-dot mem"></span>
                                <span class="fitness-legend-label">Mem</span>
                                <span class="fitness-legend-value">${escapeHtml(pct(data.memoryUsage))}</span>
                            </div>
                            <div class="fitness-legend-row">
                                <span class="fitness-dot disk"></span>
                                <span class="fitness-legend-label">Disk</span>
                                <span class="fitness-legend-value">${escapeHtml(pct(data.diskUsage))}</span>
                            </div>
                        </div>
                    </div>
                    <div class="system-fitness-footer">
                        <span class="fitness-chip">
                            <span class="system-status ${systemStatus}"></span>
                            ${systemStatus === 'online' ? 'Live' : 'Error'}
                        </span>
                        <span class="fitness-chip">Updated ${escapeHtml(formatLastUpdate(data.lastUpdate || new Date().toISOString()))}</span>
                        <span class="fitness-chip">Up ${escapeHtml(data.uptime || '—')}</span>
                        <span class="fitness-chip network-${networkStatus}">Net ${escapeHtml(networkStatus)}</span>
                    </div>
                </div>
            `;
        }

        const hubMod = window.HomeHubModules && window.HomeHubModules[type];
        if (hubMod && typeof hubMod.render === 'function') {
            return hubMod.render(data, module);
        }

        return complicationFace(data.value || 'Ready', statusLabel(data.status, 'Active', 'Inactive'));
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
                addBtn.textContent = 'Add Widget';
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
                // Respond to server ping to maintain connection
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

    buildModuleNav() {
        const nav = document.getElementById('sidebarNav');
        if (!nav || !window.HomeHubModules) return;

        // Keep Home button; rebuild module page buttons
        Array.from(nav.querySelectorAll('.nav-item[data-view]:not([data-view="home"])')).forEach((el) => el.remove());

        Object.values(window.HomeHubModules)
            .filter((mod) => mod.nav && mod.view)
            .forEach((mod) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'nav-item';
                btn.dataset.view = mod.view;
                btn.innerHTML = `<span class="nav-text">${escapeHtml(mod.navLabel || mod.label || mod.view)}</span>`;
                if (mod.view === 'logs') {
                    btn.insertAdjacentHTML(
                        'beforeend',
                        `<span class="logs-nav-badges" id="logsNavBadges">
                            <span class="logs-nav-count" id="logsNavCount" title="Total">0</span>
                            <span class="logs-nav-count logs-nav-warn" id="logsNavWarn" title="Warn" hidden>0</span>
                            <span class="logs-nav-count logs-nav-error" id="logsNavError" title="Error" hidden>0</span>
                        </span>`
                    );
                }
                nav.appendChild(btn);
            });
    }

    setView(view) {
        const title = document.getElementById('pageTitle') || document.querySelector('.page-title');
        const timeDisplay = document.getElementById('timeDisplay');
        const panels = document.querySelectorAll('[data-view-panel]');

        const hubMod = window.HomeHubModules &&
            Object.values(window.HomeHubModules).find((m) => m.view === view);
        const label = view === 'home'
            ? 'Home'
            : (hubMod && (hubMod.navLabel || hubMod.label)) || this.capitalizeFirst(view);

        if (title) title.textContent = label;

        panels.forEach((panel) => {
            const isActive = panel.dataset.viewPanel === view;
            panel.hidden = !isActive;
            if (panel.id === 'modulesGrid') {
                panel.style.display = isActive ? '' : 'none';
            }
        });

        if (timeDisplay) {
            timeDisplay.style.display = view === 'home' ? '' : 'none';
        }

        document.body.className = document.body.className
            .split(/\s+/)
            .filter((c) => c && !c.startsWith('view-'))
            .concat([`view-${view}`])
            .join(' ');
    }

    // Home System Monitor uses SVG Fitness rings; history charts live on Activity Monitor.
    // updateSystemMonitor → renderModules redraws ring arcs from live metrics.

    // Update system monitor with new data
    updateSystemMonitor(instanceKey, data) {
        const instanceData = this.moduleInstances[instanceKey];
        if (!instanceData || !data) return;

        // Update current values (history handled separately)
        const incomingHistory = data.history;
        Object.assign(instanceData, data);
        instanceData.lastUpdate = data.lastUpdate || new Date().toISOString();

        // Prefer history from logs/system-metrics.log (server)
        if (incomingHistory && Array.isArray(incomingHistory.timestamps)) {
            instanceData.history = {
                cpu: Array.isArray(incomingHistory.cpu) ? incomingHistory.cpu.slice() : [],
                memory: Array.isArray(incomingHistory.memory) ? incomingHistory.memory.slice() : [],
                disk: Array.isArray(incomingHistory.disk) ? incomingHistory.disk.slice() : [],
                temperature: Array.isArray(incomingHistory.temperature) ? incomingHistory.temperature.slice() : [],
                timestamps: incomingHistory.timestamps.slice()
            };
        } else {
            if (!instanceData.history) {
                instanceData.history = {
                    cpu: [],
                    memory: [],
                    disk: [],
                    temperature: [],
                    timestamps: []
                };
            }

            if (typeof data.cpuUsage === 'number' && !isNaN(data.cpuUsage)) {
                instanceData.history.cpu.push(data.cpuUsage);
                if (instanceData.history.cpu.length > 60) instanceData.history.cpu.shift();
            }
            if (typeof data.memoryUsage === 'number' && !isNaN(data.memoryUsage)) {
                instanceData.history.memory.push(data.memoryUsage);
                if (instanceData.history.memory.length > 60) instanceData.history.memory.shift();
            }
            if (typeof data.diskUsage === 'number' && !isNaN(data.diskUsage)) {
                instanceData.history.disk.push(data.diskUsage);
                if (instanceData.history.disk.length > 60) instanceData.history.disk.shift();
            }
            if (typeof data.cpuTemp === 'number' && !isNaN(data.cpuTemp) && data.cpuTemp > 0) {
                instanceData.history.temperature.push(data.cpuTemp);
                if (instanceData.history.temperature.length > 60) instanceData.history.temperature.shift();
            }
            instanceData.history.timestamps.push(new Date().toISOString());
            if (instanceData.history.timestamps.length > 60) instanceData.history.timestamps.shift();
        }

        // Add log entry for significant changes
        if (!instanceData.logs) instanceData.logs = [];

        const addLogEntry = (message, type = 'info') => {
            instanceData.logs.push({
                timestamp: new Date().toISOString(),
                message: message,
                type: type
            });

            if (instanceData.logs.length > 50) {
                instanceData.logs.shift();
            }
        };

        const cpuSeries = instanceData.history.cpu || [];
        const memSeries = instanceData.history.memory || [];
        const diskSeries = instanceData.history.disk || [];
        const oldCpu = cpuSeries[cpuSeries.length - 2] || 0;
        const oldMemory = memSeries[memSeries.length - 2] || 0;
        const oldDisk = diskSeries[diskSeries.length - 2] || 0;

        if (typeof data.cpuUsage === 'number' && Math.abs(data.cpuUsage - oldCpu) > 20) {
            const direction = data.cpuUsage > oldCpu ? 'increased' : 'decreased';
            addLogEntry(`CPU usage ${direction} to ${data.cpuUsage}%`, data.cpuUsage > 80 ? 'warning' : 'info');
        }

        if (typeof data.memoryUsage === 'number' && Math.abs(data.memoryUsage - oldMemory) > 15) {
            const direction = data.memoryUsage > oldMemory ? 'increased' : 'decreased';
            addLogEntry(`Memory usage ${direction} to ${data.memoryUsage}%`, data.memoryUsage > 85 ? 'warning' : 'info');
        }

        if (typeof data.diskUsage === 'number' && Math.abs(data.diskUsage - oldDisk) > 10) {
            const direction = data.diskUsage > oldDisk ? 'increased' : 'decreased';
            addLogEntry(`Disk usage ${direction} to ${data.diskUsage}%`, data.diskUsage > 90 ? 'error' : 'info');
        }

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

