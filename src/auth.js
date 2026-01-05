const fs = require('fs').promises;
const fssync = require('fs');
const { API_KEYS_FILE, API_KEY_ENV, API_KEYS_RELOAD_MS } = require('./config');
const logger = require('./logger');

let apiKeySet = new Set();
let apiKeysFileExists = false;

async function loadApiKeysFromFile() {
    try {
        if (!fssync.existsSync(API_KEYS_FILE)) {
            apiKeySet = new Set();
            apiKeysFileExists = false;
            return;
        }
        apiKeysFileExists = true;
        const txt = await fs.readFile(API_KEYS_FILE, 'utf8');
        const lines = txt.split(/\r?\n/);
        const s = new Set();
        for (let raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            if (line.startsWith('#')) continue;
            s.add(line);
        }
        apiKeySet = s;
        logger.debug({ count: apiKeySet.size }, 'Loaded API keys from file');
    } catch (e) {
        logger.error({ err: e, file: API_KEYS_FILE }, 'Error loading API keys file');
        apiKeySet = new Set();
        apiKeysFileExists = false;
    }
}

// Initial load
loadApiKeysFromFile();
// Periodic reload
setInterval(loadApiKeysFromFile, API_KEYS_RELOAD_MS);

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
