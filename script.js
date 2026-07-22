/**
 * Home Hub client bootstrap.
 * Feature code lives in js/*.js — this file only starts ModuleManager.
 */
let moduleManager;

document.addEventListener('DOMContentLoaded', () => {
    console.log('[DOMContentLoaded] Initializing ModuleManager...');
    moduleManager = new ModuleManager();
    window.moduleManager = moduleManager;
});
