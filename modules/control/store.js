/**
 * Persist Control Panel feature kill-switches under data/control/.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'control');
const FEATURES_FILE = path.join(DATA_DIR, 'features.json');

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

function load() {
    const raw = readJson(FEATURES_FILE, null);
    if (!raw || typeof raw !== 'object') {
        return { features: {}, updatedAt: null };
    }
    const features = raw.features && typeof raw.features === 'object' ? raw.features : {};
    return {
        features,
        updatedAt: raw.updatedAt || null
    };
}

function save(state) {
    const next = {
        features: state.features || {},
        updatedAt: new Date().toISOString()
    };
    writeJson(FEATURES_FILE, next);
    return next;
}

function getEnabledMap() {
    return { ...load().features };
}

function hasSaved(id) {
    const features = load().features;
    return Object.prototype.hasOwnProperty.call(features, id);
}

function setEnabled(id, enabled) {
    const state = load();
    state.features[id] = !!enabled;
    return save(state);
}

function ensureDefault(id, defaultEnabled) {
    if (hasSaved(id)) return load();
    return setEnabled(id, defaultEnabled !== false);
}

module.exports = {
    load,
    save,
    getEnabledMap,
    hasSaved,
    setEnabled,
    ensureDefault
};
