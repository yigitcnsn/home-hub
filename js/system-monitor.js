/**
 * System Monitor live updates (Home Fitness rings).
 * Extends ModuleManager.prototype — load after module-manager.js
 */
Object.assign(ModuleManager.prototype, {
    updateSystemStats(stats) {
        const systemInstanceKey = 'system_monitoring';

        if (stats.error) {
            this.logError('System', `Stats update failed: ${stats.error}`, {
                lastError: stats.lastError
            });
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
            return;
        }

        this.updateInstanceData(systemInstanceKey, {
            ...stats,
            status: 'active',
            error: undefined,
            errorDetails: undefined,
            lastErrorTime: undefined
        });
    },

    updateSystemMonitor(instanceKey, data) {
        const instanceData = this.moduleInstances[instanceKey];
        if (!instanceData || !data) return;

        const incomingHistory = data.history;
        Object.assign(instanceData, data);
        instanceData.lastUpdate = data.lastUpdate || new Date().toISOString();

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

        if (!instanceData.logs) instanceData.logs = [];

        const addLogEntry = (message, type = 'info') => {
            instanceData.logs.push({
                timestamp: new Date().toISOString(),
                message,
                type
            });
            if (instanceData.logs.length > 50) instanceData.logs.shift();
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
    },

    clearSystemLogs(instanceKey) {
        const instanceData = this.moduleInstances[instanceKey];
        if (!instanceData || !instanceData.logs) return;
        instanceData.logs = [];
        this.saveInstances();
        this.renderModules();
    }
});
