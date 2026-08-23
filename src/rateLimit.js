const { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } = require('./config');

const counters = new Map(); // id -> { windowStart: number, count: number }

// Without this the map grows one entry per distinct IP forever. Sweeping keeps
// it bounded by the number of *active* clients, with no timer.
const SWEEP_THRESHOLD = 1024;

let lastSweep = 0;

// Sweeping on every new key is O(n) per request under an IP spray — precisely
// the load a limiter faces — so it is amortised to once per window instead.
// Nothing older than one window can survive a sweep, so the map stays bounded
// by the distinct clients seen within a single window.
function maybeSweep(now) {
    if (counters.size < SWEEP_THRESHOLD) return;
    if (now - lastSweep < RATE_LIMIT_WINDOW_MS) return;
    lastSweep = now;
    for (const [id, rec] of counters) {
        if (now - rec.windowStart > RATE_LIMIT_WINDOW_MS) counters.delete(id);
    }
}

function isRateLimitedFor(id) {
    const now = Date.now();
    let rec = counters.get(id);

    // A fresh id and an expired window open a window the same way. Counting the
    // request through one path is what lets RATE_LIMIT_MAX=0 reject request one.
    if (!rec || now - rec.windowStart > RATE_LIMIT_WINDOW_MS) {
        if (!rec) maybeSweep(now);
        rec = { windowStart: now, count: 0 };
        counters.set(id, rec);
    }

    rec.count += 1;
    const resetMs = RATE_LIMIT_WINDOW_MS - (now - rec.windowStart);

    if (rec.count > RATE_LIMIT_MAX) return { limited: true, remaining: 0, resetMs };
    return { limited: false, remaining: RATE_LIMIT_MAX - rec.count, resetMs };
}

module.exports = { isRateLimitedFor, _size: () => counters.size };
