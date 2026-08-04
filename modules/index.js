/**
 * Server-side module registry.
 * Add new feature folders under modules/<name>/ with a server.js that exports { id, register }.
 */
const notifications = require('./notifications/server');
const activity = require('./activity/server');
const network = require('./network/server');
const stocksai = require('./stocksai/server');
const stocks = require('./stocks/server');
const aiinfo = require('./aiinfo/server');
const prismdesk = require('./prismdesk/server');

/** Notifications first so ctx.notify is available to every other module. */
const modules = [
    notifications,
    activity,
    network,
    stocksai,
    stocks,
    aiinfo,
    prismdesk
];

function registerAll(ctx) {
    const listeners = Object.create(null);

    ctx.on = function on(event, fn) {
        if (typeof fn !== 'function') return;
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
    };

    ctx.emit = function emit(event, payload) {
        const list = listeners[event] || [];
        list.forEach((fn) => {
            try {
                fn(payload);
            } catch (err) {
                if (ctx.logger) {
                    ctx.logger.warn('Hub', `Event ${event} handler failed: ${err.message || err}`);
                }
            }
        });
    };

    modules.forEach((mod) => {
        if (mod && typeof mod.register === 'function') {
            mod.register(ctx);
        }
    });
}

module.exports = {
    modules,
    registerAll
};
