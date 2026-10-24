const express = require('express');
const crypto = require('crypto');
const { contentDisposition } = require('./contentDisposition');
const { saveBuffer } = require('./save');
const { sendError } = require('./httpErrors');

// /convert failures that are load signals, and the counter each one feeds.
const LOAD_COUNTERS = { 413: 'oversize', 503: 'rejected', 504: 'timeouts' };

// Builds the Express app from injected collaborators, so tests can drive the
// whole HTTP layer without a browser, a real keys file, or a bound port.
//   auth       = { validateAuth, authConfigured, isAuthFileInUse }
//   limiter    = { isRateLimitedFor }
//   render     = { renderHtmlToBuffer, inFlight, browserReady }
//   validate   = { validateOptions, validateBody }
//   httpErrors = { bodyErrorHandler, finalErrorHandler }
function createApp({ config, logger, auth, limiter, render, validate, httpErrors }) {
    const { OUTPUT_DIR, OUTPUT_MAX_BYTES = 0, AUTH_FAIL_MAX, MAX_INFLIGHT_PER_KEY = 0, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, BODY_LIMIT, TRUST_PROXY, CORS_ORIGINS, METRICS_ENABLED } = config;

    const app = express();
    app.disable('x-powered-by');
    // Without this, req.ip behind a reverse proxy is the proxy's address, so every
    // unauthenticated caller shares one rate-limit bucket.
    app.set('trust proxy', TRUST_PROXY);
    // One id per request, echoed back and attached to every log line for it, so a
    // client-reported failure can be found in the logs. An inbound id is honoured
    // so a trace spanning several services keeps one identifier.
    app.use((req, res, next) => {
        req.requestId = req.get('x-request-id') || crypto.randomUUID();
        res.setHeader('X-Request-Id', req.requestId);
        next();
    });

    if (CORS_ORIGINS.length > 0) {
        app.use((req, res, next) => {
            const origin = req.get('origin');
            const allowed = CORS_ORIGINS.includes('*') ? '*' : (CORS_ORIGINS.includes(origin) ? origin : null);
            if (allowed) {
                res.setHeader('Access-Control-Allow-Origin', allowed);
                res.setHeader('Vary', 'Origin');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Request-Id');
                res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
                res.setHeader('Access-Control-Max-Age', '600');
            }
            if (req.method === 'OPTIONS') return res.sendStatus(allowed ? 204 : 403);
            next();
        });
    }

    app.use(express.json({ limit: BODY_LIMIT }));

    // The body parser rejects oversized and malformed bodies before any route
    // runs. Without this, Express's default handler answers them with an HTML
    // page, so those two codes alone broke the JSON error contract.
    app.use(httpErrors.bodyErrorHandler({ bodyLimit: BODY_LIMIT, logger }));

    // Counters are process-local and reset on restart, like the rate limiter.
    const metrics = { requests: 0, renders: 0, failures: 0, rejected: 0, timeouts: 0, unauthorized: 0, rateLimited: 0, oversize: 0, perKeyLimited: 0 };
    // Renders running or queued per caller, for MAX_INFLIGHT_PER_KEY.
    const inflight = new Map();

    // auth & rate-limit middleware
    app.use((req, res, next) => {
        // /health skips authentication only: container healthchecks and load
        // balancer probes cannot present a key. It stays rate limited, so an
        // unauthenticated caller cannot poll it for free. /metrics is open only
        // when the service itself runs without keys.
        const skipAuth = req.path === '/health' || (req.path === '/metrics' && !auth.authConfigured());

        // One client identity for both the failed-key bucket and the anonymous principal.
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        const { valid, principal } = skipAuth ? { valid: true, principal: null } : auth.validateAuth(req);

        metrics.requests += 1;

        if (!valid) {
            // Wrong keys are counted per IP, after validation: a valid key always
            // passes, so one noisy client behind a shared proxy IP cannot lock out
            // good ones. Past the budget the answer changes from 401 to 429.
            const fail = limiter.isRateLimitedFor(`authfail:${clientIp}`, AUTH_FAIL_MAX);
            if (fail.limited) {
                res.setHeader('Retry-After', String(Math.ceil(fail.resetMs / 1000)));
                metrics.rateLimited += 1;
                return sendError(req, res, 429, 'Too many failed authentication attempts', { retry_after_seconds: Math.ceil(fail.resetMs / 1000) });
            }
            metrics.unauthorized += 1;
            res.set('WWW-Authenticate', 'Bearer realm="PlaywrightRender"');
            return sendError(req, res, 401, 'Unauthorized');
        }

        // A keyed caller is limited and logged by its principal; everyone else by IP.
        req.principal = principal || { id: clientIp, label: 'anon' };

        // apply rate limit
        const rl = limiter.isRateLimitedFor(req.principal.id);
        // set rate-limit headers
        res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
        res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(rl.resetMs / 1000))); // seconds

        if (rl.limited) {
            res.setHeader('Retry-After', String(Math.ceil(rl.resetMs / 1000)));
            metrics.rateLimited += 1;
            return sendError(req, res, 429, 'Rate limit exceeded', { retry_after_seconds: Math.ceil(rl.resetMs / 1000) });
        }

        next();
    });

    // POST /convert
    app.post('/convert', async (req, res) => {
        try {
            const body = req.body || {};
            const html = body.html;
            if (!html || typeof html !== 'string') {
                return sendError(req, res, 400, 'Missing "html" (string)');
            }

            const invalid = validate.validateBody(body) || validate.validateOptions(body.options);
            if (invalid) return sendError(req, res, 400, invalid);

            // Defaults for format, margin, dpi and the rest live in render.js.
            const options = body.options || {};

            // One caller must not hold every slot. Off by default (0) so a batch
            // caller still queues; shared deployments opt in.
            const callerId = req.principal.id;
            if (MAX_INFLIGHT_PER_KEY > 0) {
                if ((inflight.get(callerId) || 0) >= MAX_INFLIGHT_PER_KEY) {
                    metrics.perKeyLimited += 1;
                    res.setHeader('Retry-After', '5');
                    return sendError(req, res, 429, 'Too many renders in flight for this key');
                }
                inflight.set(callerId, (inflight.get(callerId) || 0) + 1);
                res.on('close', () => {
                    const left = (inflight.get(callerId) || 1) - 1;
                    if (left > 0) inflight.set(callerId, left); else inflight.delete(callerId);
                });
            }

            const saveToDisk = !!body.save;
            const outPathRel = body.outPath || null;

            // Abort only on a real client disconnect: 'close' also fires on normal
            // completion, so writableFinished is what separates the two. Deliberately
            // not req.signal — in Express 5 that is already aborted by the time the
            // handler runs, which would reject every render as a disconnect.
            const disconnected = new AbortController();
            res.on('close', () => {
                if (!res.writableFinished) disconnected.abort();
            });

            // render
            const start = Date.now();
            const { buffer, scale, contentSize, paper, orientation } =
                await render.renderHtmlToBuffer(html, options, { signal: disconnected.signal });
            const duration = Date.now() - start;

            // Count and log only once the response has gone out: a header or write
            // failure after the render must not be reported as a success.
            res.on('finish', () => {
                metrics.renders += 1;
                logger.info({
                    requestId: req.requestId,
                    auth: req.principal.label,
                    size: buffer.length,
                    mode: options.png ? 'png' : 'pdf',
                    duration: `${duration}ms`
                }, 'Convert request completed');
            });

            const ext = options.png ? 'png' : 'pdf';
            const filename = options.filename ? options.filename : `output-${crypto.randomUUID()}.${ext}`;

            if (saveToDisk) {
                const saved = await saveBuffer({
                    root: OUTPUT_DIR,
                    label: req.principal.label,
                    outPath: outPathRel,
                    defaultName: filename,
                    buffer,
                    maxBytes: OUTPUT_MAX_BYTES
                });
                return res.json({ ...saved, size: buffer.length, scale, contentSize, paper, orientation });
            }

            res.setHeader('Content-Type', options.png ? 'image/png' : 'application/pdf');
            res.setHeader('Content-Length', buffer.length);
            res.setHeader('Content-Disposition', contentDisposition(filename));
            // buffer is already a Buffer; Buffer.from would copy every rendered byte.
            return res.send(buffer);
        } catch (err) {
            // 503 (queue full) and 504 (render deadline) are load signals, not faults:
            // log them at warn and let the client back off rather than retry blindly.
            const status = err && err.status ? err.status : 500;
            // 499 means the client already hung up. There is nobody to answer, and
            // writing to a closed socket only produces a second error.
            if (status === 499) {
                logger.debug({ requestId: req.requestId }, 'Client disconnected before the render finished');
                return;
            }
            // Not `msg`: pino uses that key for the message itself, so passing it here
            // emits a duplicate key and the reason wins over the label.
            if (status === 500) {
                metrics.failures += 1;
                logger.error({ err, requestId: req.requestId }, 'Error in /convert');
            } else {
                if (LOAD_COUNTERS[status]) metrics[LOAD_COUNTERS[status]] += 1;
                logger.warn({ status, reason: err.message, requestId: req.requestId }, 'Render not completed');
            }
            if (status === 503) res.setHeader('Retry-After', '5');
            // 503 and 504 describe load and are safe to echo. A 500 message is
            // whatever Chromium or the filesystem produced — internal detail the
            // caller cannot act on. It goes to the log, with the id to correlate.
            const error = status === 500 ? 'Internal render error' : err.message;
            return sendError(req, res, status, error);
        }
    });

    if (METRICS_ENABLED) {
        // Prometheus text exposition. Hand-rolled: a handful of counters and gauges
        // do not justify a dependency. Requires a key whenever auth is configured, and is rate limited like every route.
        app.get('/metrics', (req, res) => {
            const inFlight = render.inFlight();
            const lines = [
                ['viewsarn_requests_total', 'counter', 'Requests reaching the auth middleware', metrics.requests],
                ['viewsarn_renders_total', 'counter', 'Renders completed successfully', metrics.renders],
                ['viewsarn_render_failures_total', 'counter', 'Renders that failed with a 500', metrics.failures],
                ['viewsarn_render_rejected_total', 'counter', 'Renders rejected with a 503 because the queue was full', metrics.rejected],
                ['viewsarn_render_timeouts_total', 'counter', 'Renders abandoned with a 504 at the deadline', metrics.timeouts],
                ['viewsarn_unauthorized_total', 'counter', 'Requests rejected with a 401', metrics.unauthorized],
                ['viewsarn_rate_limited_total', 'counter', 'Requests rejected with a 429', metrics.rateLimited],
                ['viewsarn_render_oversize_total', 'counter', 'Renders refused with a 413 because the output would be too large', metrics.oversize],
                ['viewsarn_per_key_limited_total', 'counter', 'Renders refused with a 429 because the key had too many in flight', metrics.perKeyLimited],
                ['viewsarn_renders_active', 'gauge', 'Renders holding a slot right now', inFlight.active],
                ['viewsarn_renders_queued', 'gauge', 'Requests waiting for a render slot', inFlight.waiting]
            ];
            res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            res.send(lines.map(([name, type, help, value]) =>
                `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}`).join('\n') + '\n');
        });
    }

    // 503 when the browser is gone, so an orchestrator restarts the container
    // instead of leaving a green health check over a service that cannot render.
    app.get('/health', (req, res) => res.status(render.browserReady() ? 200 : 503).json({
        ok: render.browserReady(),
        browser: render.browserReady() ? 'connected' : 'disconnected',
        apiAuthFileInUse: auth.isAuthFileInUse(),
        rate_limit_window_ms: RATE_LIMIT_WINDOW_MS,
        rate_limit_max: RATE_LIMIT_MAX
    }));

    app.use((req, res) => sendError(req, res, 404, 'Not found'));
    app.use(httpErrors.finalErrorHandler({ logger }));

    return { app, metrics };
}

module.exports = { createApp };
