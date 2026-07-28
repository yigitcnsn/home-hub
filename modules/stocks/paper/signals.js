/**
 * Paper signal + auto-trade settings persistence.
 */
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data', 'stocks');
const SETTINGS_FILE = path.join(DATA_DIR, 'paper-settings.json');
const SIGNALS_FILE = path.join(DATA_DIR, 'paper-signals.json');

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

function getSettings() {
    const saved = readJson(SETTINGS_FILE, null);
    return {
        autoTrade: saved && typeof saved.autoTrade === 'boolean'
            ? saved.autoTrade
            : config.autoTradeDefault,
        cooldowns: saved && saved.cooldowns && typeof saved.cooldowns === 'object'
            ? saved.cooldowns
            : {},
        updatedAt: (saved && saved.updatedAt) || null
    };
}

function saveSettings(settings) {
    const next = {
        autoTrade: !!settings.autoTrade,
        cooldowns: settings.cooldowns || {},
        updatedAt: new Date().toISOString()
    };
    writeJson(SETTINGS_FILE, next);
    return next;
}

function setAutoTrade(enabled) {
    const cur = getSettings();
    cur.autoTrade = !!enabled;
    return saveSettings(cur);
}

function touchCooldown(symbol, atMs) {
    const cur = getSettings();
    cur.cooldowns = { ...cur.cooldowns, [symbol]: atMs || Date.now() };
    return saveSettings(cur);
}

function clearCooldown(symbol) {
    const cur = getSettings();
    if (!cur.cooldowns[symbol]) return cur;
    const next = { ...cur.cooldowns };
    delete next[symbol];
    cur.cooldowns = next;
    return saveSettings(cur);
}

function getSignals() {
    const list = readJson(SIGNALS_FILE, []);
    return Array.isArray(list) ? list : [];
}

function appendSignal(signal) {
    const list = getSignals();
    list.unshift(signal);
    writeJson(SIGNALS_FILE, list.slice(0, config.maxSignals));
    return signal;
}

function clearSignals() {
    writeJson(SIGNALS_FILE, []);
}

function resetStrategyState() {
    writeJson(SETTINGS_FILE, {
        autoTrade: config.autoTradeDefault,
        cooldowns: {},
        updatedAt: new Date().toISOString()
    });
    clearSignals();
}

module.exports = {
    getSettings,
    saveSettings,
    setAutoTrade,
    touchCooldown,
    clearCooldown,
    getSignals,
    appendSignal,
    clearSignals,
    resetStrategyState
};
