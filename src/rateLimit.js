const { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } = require('./config');

const counters = new Map(); // id -> { windowStart: number, count: number }

function isRateLimitedFor(id) {
    const now = Date.now();
    const rec = counters.get(id);
    if (!rec) {
        counters.set(id, { windowStart: now, count: 1 });
        return { limited: false, remaining: RATE_LIMIT_MAX - 1, resetMs: RATE_LIMIT_WINDOW_MS };
    }
    const elapsed = now - rec.windowStart;
    if (elapsed > RATE_LIMIT_WINDOW_MS) {
        // reset window
        rec.windowStart = now;
        rec.count = 1;
        counters.set(id, rec);
        return { limited: false, remaining: RATE_LIMIT_MAX - 1, resetMs: RATE_LIMIT_WINDOW_MS };
    }
    // same window
    rec.count += 1;
    const remaining = Math.max(0, RATE_LIMIT_MAX - rec.count);
    counters.set(id, rec);
    if (rec.count > RATE_LIMIT_MAX) {
        const resetMs = RATE_LIMIT_WINDOW_MS - elapsed;
        return { limited: true, remaining: 0, resetMs };
    }
    return { limited: false, remaining, resetMs: RATE_LIMIT_WINDOW_MS - elapsed };
}

module.exports = { isRateLimitedFor };
