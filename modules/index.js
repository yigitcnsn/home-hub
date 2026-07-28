/**
 * Server-side module registry.
 * Add new feature folders under modules/<name>/ with a server.js that exports { id, register }.
 */
const activity = require('./activity/server');
const network = require('./network/server');
const kap = require('./kap/server');
const stocks = require('./stocks/server');

const modules = [
    activity,
    network,
    kap,
    stocks
];

function registerAll(ctx) {
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
