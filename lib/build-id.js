const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

function safeGit(cmd) {
    try {
        return execSync(cmd, {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch (_) {
        return null;
    }
}

function getBuildInfo() {
    const commit = safeGit('git rev-parse --short HEAD') || 'unknown';
    const branch = safeGit('git rev-parse --abbrev-ref HEAD') || 'unknown';
    const dirty = Boolean(safeGit('git status --porcelain'));
    let packageVersion = '0.0.0';
    try {
        packageVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || packageVersion;
    } catch (_) {
        // ignore
    }

    return {
        buildId: commit,
        branch,
        dirty,
        version: packageVersion,
        startedAt: new Date().toISOString()
    };
}

module.exports = {
    getBuildInfo
};
