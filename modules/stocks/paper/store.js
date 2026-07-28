/**
 * Paper portfolio persistence under data/stocks/ (gitignored via data/).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('./config');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data', 'stocks');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'paper-portfolio.json');
const ORDERS_FILE = path.join(DATA_DIR, 'paper-orders.json');
const FILLS_FILE = path.join(DATA_DIR, 'paper-fills.json');

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function readJson(file, fallback) {
    try {
        ensureDir();
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function writeJson(file, data) {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function defaultPortfolio() {
    const cash = config.startingCashTry;
    return {
        startingCash: cash,
        cash,
        positions: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        realizedPnl: 0
    };
}

function getPortfolio() {
    const saved = readJson(PORTFOLIO_FILE, null);
    if (saved && typeof saved.cash === 'number') {
        return {
            startingCash: typeof saved.startingCash === 'number' ? saved.startingCash : config.startingCashTry,
            cash: saved.cash,
            positions: saved.positions && typeof saved.positions === 'object' ? saved.positions : {},
            createdAt: saved.createdAt || new Date().toISOString(),
            updatedAt: saved.updatedAt || new Date().toISOString(),
            realizedPnl: typeof saved.realizedPnl === 'number' ? saved.realizedPnl : 0
        };
    }
    const fresh = defaultPortfolio();
    writeJson(PORTFOLIO_FILE, fresh);
    return fresh;
}

function savePortfolio(portfolio) {
    const next = {
        ...portfolio,
        updatedAt: new Date().toISOString()
    };
    writeJson(PORTFOLIO_FILE, next);
    return next;
}

function resetPortfolio(startingCash) {
    const cash = typeof startingCash === 'number' && startingCash > 0
        ? startingCash
        : config.startingCashTry;
    const fresh = {
        startingCash: cash,
        cash,
        positions: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        realizedPnl: 0
    };
    writeJson(PORTFOLIO_FILE, fresh);
    writeJson(ORDERS_FILE, []);
    writeJson(FILLS_FILE, []);
    return fresh;
}

function getOrders() {
    const list = readJson(ORDERS_FILE, []);
    return Array.isArray(list) ? list : [];
}

function saveOrders(orders) {
    writeJson(ORDERS_FILE, Array.isArray(orders) ? orders : []);
    return getOrders();
}

function getFills() {
    const list = readJson(FILLS_FILE, []);
    return Array.isArray(list) ? list : [];
}

function appendFill(fill) {
    const list = getFills();
    list.unshift(fill);
    writeJson(FILLS_FILE, list.slice(0, config.maxFills));
    return fill;
}

function getOpenOrders() {
    return getOrders().filter((o) => o && (o.status === 'open' || o.status === 'partial'));
}

module.exports = {
    newId,
    getPortfolio,
    savePortfolio,
    resetPortfolio,
    getOrders,
    saveOrders,
    getFills,
    appendFill,
    getOpenOrders,
    defaultPortfolio
};
