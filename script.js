// Module Management System
class ModuleManager {
    constructor() {
        this.modules = [];
        this.moduleIdCounter = 0;
        this.draggedElement = null;
        this.init();
    }

    init() {
        this.loadModules();
        this.loadDarkMode();
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.renderModules();
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
        if (darkModeBtn) {
            darkModeBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleDarkMode();
            };
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

        const module = {
            id: this.moduleIdCounter++,
            name: name,
            type: type,
            size: size,
            createdAt: new Date().toISOString()
        };

        this.modules.push(module);
        this.saveModules();
        this.renderModules();
        this.closeAddModuleModal();
    }

    removeModule(id) {
        this.modules = this.modules.filter(m => m.id !== id);
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

        const typeLabels = {
            temperature: 'Temperature',
            lighting: 'Lighting',
            security: 'Security',
            energy: 'Energy',
            weather: 'Weather',
            custom: 'Custom'
        };

        const sampleData = this.getSampleData(module.type);

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
                ${this.getModuleContent(module.type, sampleData)}
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
            addBtn.onclick = () => {
                module.name = document.getElementById('moduleName').value.trim();
                module.type = document.getElementById('moduleType').value;
                module.size = document.getElementById('moduleSize').value;
                this.saveModules();
                this.renderModules();
                this.closeAddModuleModal();
                addBtn.textContent = 'Add Module';
                addBtn.onclick = () => this.addModule();
            };
        }
    }

    refreshModules() {
        // Simulate data refresh
        this.modules.forEach(module => {
            // In a real app, this would fetch new data
            console.log(`Refreshing ${module.name}...`);
        });

        // Visual feedback
        const btn = document.getElementById('refreshBtn');
        btn.style.transform = 'rotate(360deg)';
        setTimeout(() => {
            btn.style.transform = 'rotate(0deg)';
        }, 500);
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

    loadModules() {
        const saved = localStorage.getItem('homeHubModules');
        const savedCounter = localStorage.getItem('homeHubModuleIdCounter');

        if (saved) {
            this.modules = JSON.parse(saved);
        }

        if (savedCounter) {
            this.moduleIdCounter = parseInt(savedCounter);
        }
    }

    toggleDarkMode() {
        const body = document.body;
        const isDark = body.classList.toggle('dark-mode');
        this.saveDarkMode(isDark);
        this.updateDarkModeIcon(isDark);
    }

    loadDarkMode() {
        const saved = localStorage.getItem('homeHubDarkMode');
        if (saved === 'true') {
            document.body.classList.add('dark-mode');
            this.updateDarkModeIcon(true);
        } else {
            this.updateDarkModeIcon(false);
        }
    }

    saveDarkMode(isDark) {
        localStorage.setItem('homeHubDarkMode', isDark.toString());
    }

    updateDarkModeIcon(isDark) {
        const btn = document.getElementById('darkModeBtn');
        if (btn) {
            btn.textContent = isDark ? '◑' : '◐';
        }
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

// Initialize the module manager when DOM is loaded
let moduleManager;
document.addEventListener('DOMContentLoaded', () => {
    moduleManager = new ModuleManager();
});

