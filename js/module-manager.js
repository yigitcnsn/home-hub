/**
 * ModuleManager — Home Hub UI orchestration (CRUD, events, chrome).
 * Feature methods are mixed in from js/*.js (dialog, logging, storage, widgets, sync, system-monitor).
 */
class ModuleManager {
    constructor() {
        this.modules = [];
        this.moduleIdCounter = 0;
        this.draggedElement = null;
        this.moduleInstances = {};
        this.syncEnabled = false;
        this.ws = null;
        this.init();
    }

    init() {
        console.log('[ModuleManager] Initializing...');
        try {
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
        } catch (err) {
            this.logError('ModuleManager', `Initialization failed: ${err.message}`, {
                stack: err.stack
            });
            this.showAlert(
                'Home Hub failed to start cleanly. Check Logs for details.',
                'Startup error'
            );
        }
    }

    setupEventListeners() {
        document.getElementById('addModuleBtn').addEventListener('click', () => {
            this.openAddModuleModal();
        });

        document.getElementById('closeModal').addEventListener('click', () => {
            this.closeAddModuleModal();
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            this.closeAddModuleModal();
        });

        document.getElementById('addBtn').addEventListener('click', () => {
            this.addModule();
        });

        document.getElementById('addModuleModal').addEventListener('click', (e) => {
            if (e.target.id === 'addModuleModal') this.closeAddModuleModal();
        });

        this.setupDialogListeners();

        document.getElementById('sidebarNav').addEventListener('click', (e) => {
            const item = e.target.closest('.nav-item');
            if (!item) return;
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.remove('active'));
            item.classList.add('active');
            this.setView(item.dataset.view || 'home');
        });

        const darkModeBtn = document.getElementById('darkModeBtn');
        if (darkModeBtn) {
            darkModeBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleDarkMode();
            };
        } else {
            this.logError('UI', 'Dark mode button not found during setup');
        }

        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.refreshModules();
        });

        document.getElementById('fullscreenBtn').addEventListener('click', () => {
            this.toggleFullscreen();
        });

        const updateNowBtn = document.getElementById('updateNowBtn');
        if (updateNowBtn) {
            updateNowBtn.addEventListener('click', () => {
                updateNowBtn.disabled = true;
                updateNowBtn.querySelector('.btn-text').textContent = 'Updating…';
                fetch('/api/update/now', { method: 'POST' })
                    .then((r) => r.json())
                    .then((data) => {
                        if (!data.ok) {
                            this.logError('Update', data.error || 'Update request failed', data);
                            this.showAlert(data.error || 'Update request failed', 'Update failed');
                            updateNowBtn.disabled = false;
                            updateNowBtn.querySelector('.btn-text').textContent = 'Update';
                            return;
                        }
                        updateNowBtn.querySelector('.btn-text').textContent = 'Requested';
                        setTimeout(() => {
                            updateNowBtn.disabled = false;
                            updateNowBtn.querySelector('.btn-text').textContent = 'Update';
                        }, 4000);
                    })
                    .catch((err) => {
                        this.logError('Update', `Update request failed: ${err.message}`, {
                            stack: err.stack
                        });
                        this.showAlert('Update request failed: ' + err.message, 'Update failed');
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
            if (!e.target.classList.contains('module')) return;
            this.draggedElement = e.target;
            e.target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        grid.addEventListener('dragend', (e) => {
            if (!e.target.classList.contains('module')) return;
            e.target.classList.remove('dragging');
            document.querySelectorAll('.module').forEach((m) => m.classList.remove('drag-over'));
        });

        grid.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const afterElement = this.getDragAfterElement(grid, e.clientY);
            const dragging = document.querySelector('.dragging');
            if (!dragging) return;
            if (afterElement == null) grid.appendChild(dragging);
            else grid.insertBefore(dragging, afterElement);
        });

        grid.addEventListener('drop', (e) => {
            e.preventDefault();
            if (this.draggedElement) this.saveModuleOrder();
        });
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.module:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    openAddModuleModal() {
        document.getElementById('addModuleModal').classList.add('active');
        document.getElementById('moduleType').value = 'temperature';
        document.getElementById('moduleSize').value = 'medium';
        document.getElementById('addBtn').textContent = 'Add Widget';
        document.getElementById('addBtn').onclick = () => this.addModule();
    }

    closeAddModuleModal() {
        document.getElementById('addModuleModal').classList.remove('active');
    }

    addModule() {
        try {
            const type = document.getElementById('moduleType').value;
            const size = document.getElementById('moduleSize').value;

            const hubMod = window.HomeHubModules &&
                Object.values(window.HomeHubModules).find((m) => m.type === type);
            if (type === 'system' || type === 'network' ||
                (hubMod && hubMod.nav && typeof hubMod.render !== 'function')) {
                this.showAlert(
                    'This is a sidebar module, not a Home widget. Use Speed Test for a widget.',
                    'Invalid widget'
                );
                return;
            }

            const instanceKey = this.getInstanceKey(type);
            const existing = this.modules.find((m) => m.type === type);

            if (existing) {
                existing.size = size;
                existing.instanceKey = instanceKey;
                existing.createdAt = new Date().toISOString();
                if (!this.moduleInstances[instanceKey]) {
                    this.moduleInstances[instanceKey] = this.getSampleData(type);
                }
                this.saveModules();
                this.saveInstances();
                this.renderModules();
                this.sendFullState();
                this.closeAddModuleModal();
                return;
            }

            const module = {
                id: this.moduleIdCounter++,
                type,
                size,
                createdAt: new Date().toISOString(),
                instanceKey
            };

            if (!this.moduleInstances[instanceKey]) {
                this.moduleInstances[instanceKey] = this.getSampleData(type);
            }

            this.modules.push(module);
            this.saveModules();
            this.saveInstances();
            this.renderModules();
            this.closeAddModuleModal();
            this.syncInstanceData(instanceKey, this.moduleInstances[instanceKey]);
            this.sendFullState();
        } catch (err) {
            this.logError('Widgets', `Failed to add widget: ${err.message}`, {
                stack: err.stack
            });
            this.showAlert(`Failed to add widget: ${err.message}`, 'Widget error');
        }
    }

    removeModule(id) {
        const moduleToRemove = this.modules.find((m) => m.id === id);
        if (!moduleToRemove) return;

        const hubMod = window.HomeHubModules &&
            Object.values(window.HomeHubModules).find((m) => m.type === moduleToRemove.type);
        if (moduleToRemove.type === 'system' || (hubMod && hubMod.persistent)) {
            this.showAlert('This module cannot be removed. It is a persistent widget.', 'Pinned widget');
            return;
        }

        const instanceKey = moduleToRemove.instanceKey || this.getInstanceKey(moduleToRemove.type);

        this.modules = this.modules.filter((m) => m.id !== id);

        const stillUsed = this.modules.some((m) =>
            (m.instanceKey || this.getInstanceKey(m.type)) === instanceKey
        );
        if (!stillUsed && this.moduleInstances[instanceKey]) {
            delete this.moduleInstances[instanceKey];
            this.saveInstances();
        }

        this.saveModules();
        this.renderModules();
        this.sendFullState();
    }

    editModule(id) {
        const module = this.modules.find((m) => m.id === id);
        if (!module) return;

        document.getElementById('moduleType').value = module.type;
        document.getElementById('moduleSize').value = module.size;
        document.getElementById('addModuleModal').classList.add('active');

        const addBtn = document.getElementById('addBtn');
        addBtn.textContent = 'Update Widget';

        addBtn.onclick = () => {
            const newType = document.getElementById('moduleType').value;
            const newSize = document.getElementById('moduleSize').value;
            const newInstanceKey = this.getInstanceKey(newType);
            const oldInstanceKey = module.instanceKey || this.getInstanceKey(module.type);

            if (newType !== module.type) {
                const clash = this.modules.find((m) => m.id !== module.id && m.type === newType);
                if (clash) {
                    this.showAlert('A widget of that type already exists.', 'Duplicate widget');
                    return;
                }
            }

            if (oldInstanceKey !== newInstanceKey && this.moduleInstances[oldInstanceKey]) {
                if (!this.moduleInstances[newInstanceKey]) {
                    this.moduleInstances[newInstanceKey] = this.moduleInstances[oldInstanceKey];
                }
                delete this.moduleInstances[oldInstanceKey];
            }

            module.type = newType;
            module.size = newSize;
            module.instanceKey = newInstanceKey;
            delete module.name;

            if (!this.moduleInstances[newInstanceKey]) {
                this.moduleInstances[newInstanceKey] = this.getSampleData(newType);
            }

            this.saveModules();
            this.saveInstances();
            this.renderModules();
            this.sendFullState();
            this.closeAddModuleModal();
        };
    }

    updateInstanceModules(instanceKey) {
        if (this.moduleInstances[instanceKey]) this.renderModules();
    }

    refreshModules() {
        const uniqueInstances = new Set();
        this.modules.forEach((module) => {
            uniqueInstances.add(module.instanceKey || this.getInstanceKey(module.type));
        });

        uniqueInstances.forEach((instanceKey) => {
            const module = this.modules.find((m) =>
                (m.instanceKey || this.getInstanceKey(m.type)) === instanceKey
            );
            if (module) {
                this.moduleInstances[instanceKey] = this.getSampleData(module.type);
            }
        });

        this.saveInstances();
        this.renderModules();

        const btn = document.getElementById('refreshBtn');
        if (!btn) return;
        btn.style.transform = 'rotate(360deg)';
        setTimeout(() => {
            btn.style.transform = 'rotate(0deg)';
        }, 500);
    }

    saveModuleOrder() {
        const moduleElements = document.querySelectorAll('.module');
        const newOrder = Array.from(moduleElements).map((el) => parseInt(el.dataset.moduleId, 10));
        this.modules.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
        this.saveModules();
        this.sendFullState();
    }

    getAllInstances() {
        return Object.keys(this.moduleInstances).map((key) => ({
            key,
            data: this.moduleInstances[key],
            modules: this.modules.filter((m) =>
                (m.instanceKey || this.getInstanceKey(m.type)) === key
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

    toggleDarkMode() {
        const isDark = document.body.classList.toggle('dark-mode');
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

    updateDarkModeIcon() {
        const btn = document.getElementById('darkModeBtn');
        if (btn) btn.textContent = 'Theme';
    }

    startClock() {
        this.updateTime();
        setInterval(() => this.updateTime(), 1000);
    }

    updateTime() {
        const timeValue = document.getElementById('timeValue');
        const dateValue = document.getElementById('dateValue');
        if (!timeValue || !dateValue) return;

        const now = new Date();
        timeValue.textContent = now.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        dateValue.textContent = now.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    buildModuleNav() {
        const nav = document.getElementById('sidebarNav');
        if (!nav || !window.HomeHubModules) return;

        Array.from(nav.querySelectorAll('.nav-item[data-view]:not([data-view="home"])'))
            .forEach((el) => el.remove());

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
            : (hubMod && (hubMod.navLabel || hubMod.label)) || capitalizeFirst(view);

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
}
