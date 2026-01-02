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
    }

    getInstanceKey(name, type) {
        return `${type}_${name.toLowerCase().replace(/\s+/g, '_')}`;
    }

    removeModule(id) {
        const moduleToRemove = this.modules.find(m => m.id === id);
        if (!moduleToRemove) return;

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
                    <button class="module-action-btn" onclick="moduleManager.editModule(${module.id})" title="Edit">Edit</button>
                    <button class="module-action-btn" onclick="moduleManager.removeModule(${module.id})" title="Remove">Delete</button>
                </div>
            </div>
            <div class="module-content">
                ${this.getModuleContent(module.type, instanceData)}
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
            custom: { value: 'Ready', status: 'active' }
        };
        return data[type] || data.custom;
    }

    getModuleContent(type, data) {
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

    // Method to sync instance data across devices (for future real-time sync)
    syncInstanceData(instanceKey, data) {
        this.updateInstanceData(instanceKey, data);
        // In a real implementation, this would broadcast to other devices
        console.log(`[syncInstanceData] Syncing ${instanceKey} across devices`);
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

        if (savedCounter) {
            this.moduleIdCounter = parseInt(savedCounter);
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
}

// Initialize the module manager when DOM is loaded
let moduleManager;
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DOMContentLoaded] DOM ready, initializing ModuleManager...');
    moduleManager = new ModuleManager();
    console.log('[DOMContentLoaded] ModuleManager instance created:', moduleManager);
});

