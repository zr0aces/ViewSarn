const os = require('os');

// min is the smallest meaningful value: 0 is a legitimate PORT (bind an
// ephemeral port) and a legitimate RATE_LIMIT_MAX (reject everything), but a
// concurrency or interval of 0 would wedge the service, so those require 1.
const num = (value, fallback, min = 1) => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) && n >= min ? n : fallback;
};

// Accepts what Express accepts: false (default), true, a hop count, or a list
// of trusted addresses/subnets.
function parseTrustProxy(value) {
    if (value === undefined || value === '' || value === 'false') return false;
    if (value === 'true') return true;
    const hops = Number(value);
    if (Number.isInteger(hops) && hops >= 0) return hops;
    return value;
}

module.exports = {
    PORT: num(process.env.PORT, 3000, 0),
    OUTPUT_DIR: process.env.OUTPUT_DIR || '/output',
    API_KEY_ENV: process.env.API_KEY || null,
    API_KEYS_FILE: process.env.API_KEYS_FILE || '/app/apikeys.txt',
    API_KEYS_RELOAD_MS: num(process.env.API_KEYS_RELOAD_MS, 30_000),
    RATE_LIMIT_WINDOW_MS: num(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    RATE_LIMIT_MAX: num(process.env.RATE_LIMIT_MAX, 120, 0),
    // Concurrent Chromium pages. Each in-flight render holds a page and its
    // memory, so this is the main lever on peak RSS.
    RENDER_CONCURRENCY: num(process.env.RENDER_CONCURRENCY, os.availableParallelism()),
    // Requests allowed to wait for a slot. Each one holds its parsed body, so
    // an unbounded queue trades an OOM from pages for an OOM from bodies.
    RENDER_QUEUE_MAX: num(process.env.RENDER_QUEUE_MAX, 100),
    // Wall-clock ceiling for one render. Without it a wedged page holds its
    // slot forever and RENDER_CONCURRENCY such requests wedge the service.
    RENDER_TIMEOUT_MS: num(process.env.RENDER_TIMEOUT_MS, 60_000),
    BODY_LIMIT: process.env.BODY_LIMIT || '15mb',
    // Express `trust proxy`. Off by default: behind a reverse proxy this must be
    // on or every unauthenticated client shares the proxy's IP — one bucket for
    // everyone. On without a trusted proxy in front is worse: clients then spoof
    // X-Forwarded-For and get a fresh bucket per request.
    TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY),
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    IS_PRODUCTION: process.env.NODE_ENV === 'production',
};
