const fs = require('fs').promises;
const fssync = require('fs');
const crypto = require('crypto');
const { API_KEYS_FILE, API_KEY_ENV, API_KEYS_RELOAD_MS } = require('./config');
const logger = require('./logger');

// Keys are compared as SHA-256 digests, never as raw strings. `===` on secrets
// short-circuits at the first differing byte, which leaks their prefix through
// response timing; digests are fixed-length, so a Set lookup or a
// timingSafeEqual over them reveals nothing about the key itself.
const digest = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest();
const digestHex = (value) => digest(value).toString('hex');

function timingSafeEqualBuffers(a, b) {
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let apiKeySet = new Set();
let apiKeysFileExists = false;

function parseKeys(text) {
    const keys = new Set();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        keys.add(digestHex(line));
    }
    return keys;
}

function applyKeyFileError(e) {
    if (e.code === 'ENOENT') {
        apiKeySet = new Set();
        apiKeysFileExists = false;
        return;
    }
    // A transient read error (EACCES, EBUSY on a remount) must not silently
    // drop every key and fall back to unauthenticated mode. Keep what we had.
    logger.error({ err: e, file: API_KEYS_FILE }, 'Error reloading API keys file; keeping previously loaded keys');
}

async function loadApiKeysFromFile() {
    try {
        // Read directly rather than existsSync-then-read: one syscall instead of
        // two, and no window where the file disappears between the two calls.
        apiKeySet = parseKeys(await fs.readFile(API_KEYS_FILE, 'utf8'));
        apiKeysFileExists = true;
        logger.debug({ count: apiKeySet.size }, 'Loaded API keys from file');
    } catch (e) {
        applyKeyFileError(e);
    }
}

// The first load is synchronous on purpose. Loading it asynchronously leaves a
// window at startup where the keys file is configured but not yet read, during
// which validateAuth sees no keys and falls back to API_KEY — or, with no
// API_KEY set, to serving requests unauthenticated.
try {
    apiKeySet = parseKeys(fssync.readFileSync(API_KEYS_FILE, 'utf8'));
    apiKeysFileExists = true;
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
        authRequired = false;
        valid = true; // no auth configured
    }

    return { valid, authRequired, provided };
}

module.exports = {
    validateAuth,
    isAuthFileInUse: () => apiKeysFileExists,
};
