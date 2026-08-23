const fs = require('fs').promises;
const { API_KEYS_FILE, API_KEY_ENV, API_KEYS_RELOAD_MS } = require('./config');
const logger = require('./logger');

let apiKeySet = new Set();
let apiKeysFileExists = false;

async function loadApiKeysFromFile() {
    try {
        // Read directly rather than existsSync-then-read: one syscall instead of
        // two, and no window where the file disappears between the two calls.
        const txt = await fs.readFile(API_KEYS_FILE, 'utf8');
        const s = new Set();
        for (const raw of txt.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            s.add(line);
        }
        apiKeySet = s;
        apiKeysFileExists = true;
        logger.debug({ count: s.size }, 'Loaded API keys from file');
    } catch (e) {
        if (e.code === 'ENOENT') {
            apiKeySet = new Set();
            apiKeysFileExists = false;
            return;
        }
        // A transient read error (EACCES, EBUSY on a remount) must not silently
        // drop every key and fall back to unauthenticated mode. Keep what we had.
        logger.error({ err: e, file: API_KEYS_FILE }, 'Error reloading API keys file; keeping previously loaded keys');
    }
}

// Initial load
loadApiKeysFromFile();
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
        if (provided && apiKeySet.has(provided)) valid = true;
    } else if (API_KEY_ENV) {
        authRequired = true;
        if (provided && provided === API_KEY_ENV) valid = true;
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
