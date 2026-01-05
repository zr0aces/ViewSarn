const path = require('path');

module.exports = {
    PORT: process.env.PORT ? Number(process.env.PORT) : 3000,
    OUTPUT_DIR: process.env.OUTPUT_DIR || '/output',
    API_KEY_ENV: process.env.API_KEY || null,
    API_KEYS_FILE: process.env.API_KEYS_FILE || '/app/apikeys.txt',
    API_KEYS_RELOAD_MS: process.env.API_KEYS_RELOAD_MS ? Number(process.env.API_KEYS_RELOAD_MS) : 30_000,
    RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS ? Number(process.env.RATE_LIMIT_WINDOW_MS) : 60_000,
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : 120,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};
