const os = require('os');
const { parseAllowList } = require('./egress');

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

// body-parser silently drops its size cap when it cannot parse the limit string
// (GHSA-v422-hmwv-36x6), so a typo here would remove the protection without a sign.
// Reject anything that is not bytes or a number with a b/kb/mb/gb suffix.
function parseBodyLimit(value) {
    if (value === undefined || value === '') return '15mb';
    if (/^\d+(\.\d+)?\s*(b|kb|mb|gb)?$/i.test(value) && Number.parseFloat(value) > 0) return value;
    throw new Error(`BODY_LIMIT is invalid: "${value}". Use a byte count or a size such as 15mb.`);
}

module.exports = {
    PORT: num(process.env.PORT, 3000, 0),
    // Bytes one key may keep under OUTPUT_DIR; 0 = no cap. Old files are never
    // deleted by the service, so a shared deployment should set this.
    OUTPUT_MAX_BYTES: num(process.env.OUTPUT_MAX_BYTES, 0, 0),
    OUTPUT_DIR: process.env.OUTPUT_DIR || '/output',
    API_KEY_ENV: process.env.API_KEY || null,
    // Explicit opt-out for running with no keys at all. Without it, a service with no
    // key source refuses to start (server.js) and refuses every request (auth.js).
    AUTH_DISABLED: process.env.AUTH_DISABLED === 'true',
    // Wrong keys tolerated per client IP per window before further ones get a 429.
    AUTH_FAIL_MAX: num(process.env.AUTH_FAIL_MAX, 30),
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
    // A queued request that waits longer than this gets a 503 instead of waiting
    // for a slot until a proxy has long since dropped the connection.
    RENDER_QUEUE_WAIT_MS: num(process.env.RENDER_QUEUE_WAIT_MS, 30_000),
    // Ceilings on what one render may allocate. Defaults are estimates from the
    // compose memory budget (about 150 MB per render, 4 bytes per device pixel);
    // measure peak RSS in the image before relying on them.
    MAX_PNG_PIXELS: num(process.env.MAX_PNG_PIXELS, 40_000_000),
    MAX_PDF_PAGES: num(process.env.MAX_PDF_PAGES, 200),
    // Renders one API key may have running or queued at once. 0 = no cap, so a
    // batch caller still queues; shared deployments should set it.
    MAX_INFLIGHT_PER_KEY: num(process.env.MAX_INFLIGHT_PER_KEY, 0, 0),
    SHUTDOWN_TIMEOUT_MS: num(process.env.SHUTDOWN_TIMEOUT_MS, 10_000),
    // Hostnames, IPs and CIDRs that rendered HTML may reach even though they are
    // private, loopback or link-local. Everything else private is blocked.
    EGRESS_ALLOW: parseAllowList(process.env.EGRESS_ALLOW),
    BODY_LIMIT: parseBodyLimit(process.env.BODY_LIMIT),
    // Express `trust proxy`. Off by default: behind a reverse proxy this must be
    // on or every unauthenticated client shares the proxy's IP — one bucket for
    // everyone. On without a trusted proxy in front is worse: clients then spoof
    // X-Forwarded-For and get a fresh bucket per request.
    TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY),
    // Comma-separated origins, or '*'. Empty (default) sends no CORS headers,
    // which is correct for a server-to-server service.
    CORS_ORIGINS: (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean),
    METRICS_ENABLED: process.env.METRICS_ENABLED === 'true',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    IS_PRODUCTION: process.env.NODE_ENV === 'production',
};
