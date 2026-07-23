/**
 * Home widget render / create / sample data.
 * Extends ModuleManager.prototype — load after module-manager.js
 */
(function () {
    function renderSystemFitness(data) {
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

    Object.assign(ModuleManager.prototype, {
        getInstanceKey(typeOrName, maybeType) {
            // Back-compat: older callers used getInstanceKey(name, type)
            const type = maybeType != null ? maybeType : typeOrName;
            if (type === 'system') return 'system_monitoring';
            return String(type || 'unknown');
        },

        getWidgetLabel(type) {
            const defaults = {
                system: 'System Monitor',
                speed_test: 'Speed Test',
                kap: 'KAP'
            };
            const hubMod = window.HomeHubModules && window.HomeHubModules[type];
            if (hubMod && (hubMod.label || hubMod.navLabel)) {
                return hubMod.label || hubMod.navLabel;
            }
            return defaults[type] || capitalizeFirst(type);
        },

        renderModules() {
            const grid = document.getElementById('modulesGrid');
            if (!grid) {
                this.logError('Widgets', 'modulesGrid element not found');
                return;
            }

            grid.innerHTML = '';
            const failures = [];

            this.modules.forEach((module) => {
                try {
                    grid.appendChild(this.createModuleElement(module));
                } catch (err) {
                this.logError(
                    'Widgets',
                    `Failed to create widget "${module && module.type}": ${err.message}`,
                    {
                        moduleId: module && module.id,
                        type: module && module.type,
                        size: module && module.size,
                        stack: err.stack
                    }
                );
                    failures.push({ module, error: err });
                }
            });

            if (failures.length > 0) {
                this.showWidgetFailureDialog(failures);
            }
        },

        createModuleElement(module) {
            if (!module || typeof module !== 'object') {
                throw new Error('Invalid module definition');
            }

            const div = document.createElement('div');
            const hubMod = window.HomeHubModules && window.HomeHubModules[module.type];
            const isPersistent = module.type === 'system' || (hubMod && hubMod.persistent);
            const size = module.size || 'medium';
            div.className = `module ${size}${module.type === 'system' ? ' module-system' : ''}`;
            div.draggable = true;
            div.dataset.moduleId = module.id;
            div.dataset.instanceKey = module.instanceKey || this.getInstanceKey(module.type);

            const instanceKey = module.instanceKey || this.getInstanceKey(module.type);
            let instanceData;
            try {
                instanceData = this.moduleInstances[instanceKey] || this.getSampleData(module.type);
            } catch (err) {
                this.logError('Widgets', `Sample data failed for ${module.type}: ${err.message}`, {
                    stack: err.stack,
                    type: module.type
                });
                throw new Error(`Sample data failed for type "${module.type}": ${err.message}`);
            }

            if (!this.moduleInstances[instanceKey]) {
                this.moduleInstances[instanceKey] = instanceData;
                this.saveInstances();
            }

            let contentHtml;
            try {
                contentHtml = this.getModuleContent(module.type, instanceData, module);
            } catch (err) {
                this.logError(
                    'Widgets',
                    `Render failed for "${module.type}": ${err.message}`,
                    { moduleId: module.id, type: module.type, stack: err.stack }
                );
                throw new Error(`Render failed: ${err.message}`);
            }

            const title = this.getWidgetLabel(module.type);

            div.innerHTML = `
                <div class="module-header">
                    <div class="module-title">${escapeHtml(title)}</div>
                    <div class="module-actions">
                        ${isPersistent
        ? '<span class="module-persistent" title="Persistent widget">Pinned</span>'
        : `<button class="module-action-btn" onclick="moduleManager.editModule(${Number(module.id) || 0})" title="Edit">Edit</button>
                           <button class="module-action-btn" onclick="moduleManager.removeModule(${Number(module.id) || 0})" title="Remove">Delete</button>`}
                    </div>
                </div>
                <div class="module-content">${contentHtml}</div>
            `;

            return div;
        },

        getSampleData(type) {
            const data = {
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
                    history: { cpu: [], memory: [], disk: [], temperature: [], timestamps: [] },
                    logs: []
                }
            };

            if (window.HomeHubModules) {
                Object.values(window.HomeHubModules).forEach((mod) => {
                    if (mod.type && typeof mod.getSampleData === 'function') {
                        data[mod.type] = mod.getSampleData();
                    }
                });
            }

            return data[type] || {};
        },

        getModuleContent(type, data, module) {
            if (type === 'system') {
                return renderSystemFitness(data);
            }

            const hubMod = window.HomeHubModules && window.HomeHubModules[type];
            if (hubMod && typeof hubMod.render === 'function') {
                return hubMod.render(data, module);
            }

            return `
                <div class="system-monitor error-state">
                    <div class="error-text">Unknown widget</div>
                    <div class="error-message">${escapeHtml(type || 'missing type')}</div>
                </div>
            `;
        }
    });
})();
