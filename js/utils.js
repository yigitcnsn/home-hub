/**
 * Shared client helpers (XSS / CSS token hygiene).
 */
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeCssToken(value, fallback = 'info') {
    const token = String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return token || fallback;
}

function capitalizeFirst(str) {
    return String(str || '').charAt(0).toUpperCase() + String(str || '').slice(1);
}
