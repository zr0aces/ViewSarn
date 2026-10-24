const fs = require('fs').promises;
const fssync = require('fs');
const crypto = require('crypto');
const { API_KEYS_FILE, API_KEY_ENV, API_KEYS_RELOAD_MS, AUTH_DISABLED } = require('./config');
const logger = require('./logger');

// Keys are compared as SHA-256 digests, never as raw strings. `===` on secrets
// short-circuits at the first differing byte, which leaks their prefix through
// response timing; digests are fixed-length, so a Set lookup or a
// timingSafeEqual over them reveals nothing about the key itself.
const digest = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest();
const digestHex = (value) => digest(value).toString('hex');

// What the rest of the service may know about a caller. `id` (the full digest)
// keys the rate limiter, so two keys can never share a bucket. `label` is a short
// prefix for logs and directory names. The raw key never leaves this module.
const principalFor = (key) => {
    const hex = digestHex(key);
    return { id: `k:${hex}`, label: hex.slice(0, 12) };
};

function timingSafeEqualBuffers(a, b) {
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let apiKeySet = new Set();
let apiKeysFileExists = false;
// Consecutive reads that found the file missing or empty. A rotation that
// truncates the file and then rewrites it is seen as "empty" for a moment, and
// treating that as "no keys" would switch the service to its no-key path. One such
// read keeps the previous keys; a second in a row is a real revocation.
let emptyReads = 0;

function parseKeys(text) {
    const keys = new Set();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        keys.add(digestHex(line));
    }
    return keys;
}

function noteEmpty(missing) {
    emptyReads += 1;
    if (emptyReads < 2 && apiKeySet.size > 0) {
        logger.warn({ file: API_KEYS_FILE, missing }, 'API keys file is missing or empty; keeping previous keys until the next reload');
        return;
    }
    apiKeySet = new Set();
    apiKeysFileExists = !missing;
}

function applyKeys(keys) {
    if (keys.size === 0) return noteEmpty(false);
    emptyReads = 0;
    apiKeySet = keys;
    apiKeysFileExists = true;
}

function applyKeyFileError(e) {
    if (e.code === 'ENOENT') return noteEmpty(true);
    // A transient read error (EACCES, EBUSY on a remount) must not silently
    // drop every key and fall back to unauthenticated mode. Keep what we had.
    logger.error({ err: e, file: API_KEYS_FILE }, 'Error reloading API keys file; keeping previously loaded keys');
}

async function loadApiKeysFromFile() {
    try {
        // Read directly rather than existsSync-then-read: one syscall instead of
        // two, and no window where the file disappears between the two calls.
        applyKeys(parseKeys(await fs.readFile(API_KEYS_FILE, 'utf8')));
        logger.debug({ count: apiKeySet.size }, 'Loaded API keys from file');
    } catch (e) {
        applyKeyFileError(e);
    }
}

// The first load is synchronous on purpose. Loading it asynchronously leaves a
// window at startup where the keys file is configured but not yet read, during
// which validateAuth sees no keys and falls back to API_KEY or refuses requests.
try {
    applyKeys(parseKeys(fssync.readFileSync(API_KEYS_FILE, 'utf8')));
} catch (e) {
    applyKeyFileError(e);
}
// Periodic reload
const apiKeyReloadTimer = setInterval(loadApiKeysFromFile, API_KEYS_RELOAD_MS);
apiKeyReloadTimer.unref?.();

function validateAuth(req) {
    const authHeader = req.get('authorization');
    const xKey = req.get('x-api-key');
    let provided = null;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        provided = authHeader.slice(7).trim();
    } else if (xKey) {
        provided = xKey.trim();
    }

    let authRequired = false;
    let valid = false;

    if (apiKeysFileExists && apiKeySet.size > 0) {
        authRequired = true;
        if (provided && apiKeySet.has(digestHex(provided))) valid = true;
    } else if (API_KEY_ENV) {
        authRequired = true;
        if (provided && timingSafeEqualBuffers(digest(provided), digest(API_KEY_ENV))) valid = true;
    } else {
        // Nothing configured. Open mode is an explicit choice (AUTH_DISABLED), never
        // a default: a missing or unreadable keys file must not publish the service.
        authRequired = !AUTH_DISABLED;
        valid = AUTH_DISABLED;
    }

    return { valid, authRequired, principal: valid && authRequired ? principalFor(provided) : null };
}

// True when at least one key can authenticate a caller. An empty keys file does not count.
const authConfigured = () => (apiKeysFileExists && apiKeySet.size > 0) || !!API_KEY_ENV;

module.exports = {
    validateAuth,
    authConfigured,
    isAuthFileInUse: () => apiKeysFileExists,
    _reloadKeys: loadApiKeysFromFile,
};
