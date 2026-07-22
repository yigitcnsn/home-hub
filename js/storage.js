/**
 * localStorage persistence for Home widgets + instances.
 * Extends ModuleManager.prototype — load after module-manager.js
 */
Object.assign(ModuleManager.prototype, {
    saveModules() {
        localStorage.setItem('homeHubModules', JSON.stringify(this.modules));
        localStorage.setItem('homeHubModuleIdCounter', this.moduleIdCounter.toString());
    },

    saveInstances() {
        localStorage.setItem('homeHubModuleInstances', JSON.stringify(this.moduleInstances));
    },

    loadModules() {
        const saved = localStorage.getItem('homeHubModules');
        const savedCounter = localStorage.getItem('homeHubModuleIdCounter');

        if (saved) {
            try {
                this.modules = JSON.parse(saved);
                this.modules.forEach((module) => {
                    if (!module.instanceKey) {
                        module.instanceKey = this.getInstanceKey(module.name, module.type);
                    }
                });
            } catch (err) {
                this.logError('Widgets', `Failed to parse saved modules: ${err.message}`, {
                    stack: err.stack
                });
                this.modules = [];
                this.showWidgetFailureDialog([{
                    module: { name: 'Saved layout', type: 'storage' },
                    error: err
                }]);
            }
        }

        this.ensureSystemMonitor();
        this.ensureHubModules();

        if (savedCounter) {
            this.moduleIdCounter = parseInt(savedCounter, 10) || 0;
        }
    },

    loadInstances() {
        const saved = localStorage.getItem('homeHubModuleInstances');
        if (saved) {
            try {
                this.moduleInstances = JSON.parse(saved);
            } catch (err) {
                this.logError('Widgets', `Failed to parse saved instances: ${err.message}`, {
                    stack: err.stack
                });
                this.moduleInstances = {};
            }
            return;
        }

        this.modules.forEach((module) => {
            const instanceKey = module.instanceKey || this.getInstanceKey(module.name, module.type);
            if (!this.moduleInstances[instanceKey]) {
                this.moduleInstances[instanceKey] = this.getSampleData(module.type);
            }
        });
        this.saveInstances();
    },

    ensureSystemMonitor() {
        const systemInstanceKey = 'system_monitoring';
        const existing = this.modules.find((m) =>
            (m.instanceKey || this.getInstanceKey(m.name, m.type)) === systemInstanceKey
        );

        if (!existing) {
            const systemModule = {
                id: this.moduleIdCounter++,
                name: 'System Monitor',
                type: 'system',
                size: 'large',
                createdAt: new Date().toISOString(),
                instanceKey: systemInstanceKey
            };

            if (!this.moduleInstances[systemInstanceKey]) {
                this.moduleInstances[systemInstanceKey] = this.getSampleData('system');
            }

            this.modules.push(systemModule);
            this.saveModules();
            this.saveInstances();
            return;
        }

        if (existing.size !== 'large') {
            existing.size = 'large';
            this.saveModules();
        }
    },

    ensureHubModules() {
        if (!window.HomeHubModules) return;
        Object.values(window.HomeHubModules).forEach((mod) => {
            if (typeof mod.ensure !== 'function') return;
            try {
                mod.ensure(this);
            } catch (err) {
                this.logError('Widgets', `Module ensure failed for ${mod.type || mod.id}: ${err.message}`, {
                    stack: err.stack,
                    type: mod.type
                });
            }
        });
    },

    clearAllWidgets(options = {}) {
        const runClear = () => {
            this.logWarn('Widgets', 'Clearing all widgets (failsafe or user action)');

            this.modules = [];
            this.moduleInstances = {};
            this.moduleIdCounter = 0;

            localStorage.removeItem('homeHubModules');
            localStorage.removeItem('homeHubModuleInstances');
            localStorage.removeItem('homeHubModuleIdCounter');

            this.ensureSystemMonitor();
            this.ensureHubModules();
            this.saveModules();
            this.saveInstances();
            this.renderModules();
            this.sendFullState();
        };

        if (options.skipConfirm) {
            runClear();
            return;
        }

        this.showConfirm(
            'Are you sure you want to clear all widgets? This action cannot be undone.',
            'Clear widgets'
        ).then((ok) => {
            if (ok) runClear();
        });
    }
});
