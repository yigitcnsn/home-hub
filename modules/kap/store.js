const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'kap');
const DISCLOSURES_FILE = path.join(DATA_DIR, 'disclosures.json');
const CLASSIFICATIONS_FILE = path.join(DATA_DIR, 'classifications.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

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

function getDisclosures() {
    return readJson(DISCLOSURES_FILE, []);
}

function saveDisclosures(list) {
    writeJson(DISCLOSURES_FILE, list);
}

function upsertDisclosures(incoming) {
    const current = getDisclosures();
    const byId = new Map(current.map((d) => [String(d.id), d]));
    let added = 0;
    for (const item of incoming) {
        const id = String(item.id);
        if (!byId.has(id)) {
            added += 1;
            byId.set(id, item);
        } else {
            byId.set(id, { ...byId.get(id), ...item });
        }
    }
    const next = Array.from(byId.values()).sort((a, b) => {
        return new Date(b.date || 0) - new Date(a.date || 0);
    });
    saveDisclosures(next);
    return { total: next.length, added, list: next };
}

function getClassifications() {
    return readJson(CLASSIFICATIONS_FILE, []);
}

function saveClassifications(list) {
    writeJson(CLASSIFICATIONS_FILE, list);
}

function upsertClassification(record) {
    const list = getClassifications();
    const idx = list.findIndex((c) => String(c.id) === String(record.id));
    if (idx >= 0) list[idx] = record;
    else list.unshift(record);
    // Keep newest first, cap history
    list.sort((a, b) => new Date(b.classifiedAt || 0) - new Date(a.classifiedAt || 0));
    while (list.length > 500) list.pop();
    saveClassifications(list);
    return record;
}

function getClassificationById(id) {
    return getClassifications().find((c) => String(c.id) === String(id)) || null;
}

function getJobs() {
    return readJson(JOBS_FILE, []);
}

function saveJobs(list) {
    writeJson(JOBS_FILE, list.slice(0, 200));
}

module.exports = {
    DATA_DIR,
    getDisclosures,
    upsertDisclosures,
    getClassifications,
    upsertClassification,
    getClassificationById,
    getJobs,
    saveJobs
};
