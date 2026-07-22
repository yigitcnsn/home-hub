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
                this.normalizeWidgetKeys();
            } catch (err) {
                this.logError('Widgets', `Failed to parse saved modules: ${err.message}`, {
                    stack: err.stack
                });
                this.modules = [];
                this.showWidgetFailureDialog([{
                    module: { type: 'storage' },
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

    /** Migrate legacy name-based instance keys → one key per type. */
    normalizeWidgetKeys() {
        let changed = false;
        const byType = new Map();

        this.modules.forEach((module) => {
            if (!module || !module.type) return;
            const key = this.getInstanceKey(module.type);
            const oldKey = module.instanceKey;

            if (oldKey && oldKey !== key && this.moduleInstances[oldKey] && !this.moduleInstances[key]) {
                this.moduleInstances[key] = this.moduleInstances[oldKey];
                delete this.moduleInstances[oldKey];
                changed = true;
            }

            if (module.instanceKey !== key) {
                module.instanceKey = key;
                changed = true;
            }

            if (Object.prototype.hasOwnProperty.call(module, 'name')) {
                delete module.name;
                changed = true;
            }

            // Keep a single widget per type (prefer first)
            if (byType.has(module.type)) {
                module._dedupe = true;
            } else {
                byType.set(module.type, module);
            }
        });

        const before = this.modules.length;
        this.modules = this.modules.filter((m) => !m._dedupe);
        if (this.modules.length !== before) changed = true;

        if (changed) {
            this.saveModules();
            this.saveInstances();
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
            const instanceKey = module.instanceKey || this.getInstanceKey(module.type);
            if (!this.moduleInstances[instanceKey]) {
                this.moduleInstances[instanceKey] = this.getSampleData(module.type);
            }
        });
        this.saveInstances();
    },

    ensureSystemMonitor() {
        const systemInstanceKey = 'system_monitoring';
        const existing = this.modules.find((m) =>
            m.type === 'system' ||
            (m.instanceKey || this.getInstanceKey(m.type)) === systemInstanceKey
        );

        if (!existing) {
            const systemModule = {
                id: this.moduleIdCounter++,
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

        existing.type = 'system';
        existing.instanceKey = systemInstanceKey;
        let touched = false;
        if (existing.size !== 'large') {
            existing.size = 'large';
            touched = true;
        }
        if (Object.prototype.hasOwnProperty.call(existing, 'name')) {
            delete existing.name;
            touched = true;
        }
        if (touched) this.saveModules();
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
