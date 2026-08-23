// server.js - Playwright render API with API-key file + per-key rate limiting
const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const crypto = require('crypto');

const { PORT, OUTPUT_DIR, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, BODY_LIMIT, TRUST_PROXY, CORS_ORIGINS, METRICS_ENABLED, API_KEY_ENV, API_KEYS_FILE } = require('./src/config');
const logger = require('./src/logger');
const { validateOptions } = require('./src/validate');
const { bodyErrorHandler } = require('./src/httpErrors');
const { validateAuth, isAuthFileInUse } = require('./src/auth');
const { isRateLimitedFor } = require('./src/rateLimit');
const { renderHtmlToBuffer, initBrowser, closeBrowser, _inFlight: renderInFlight } = require('./src/render');

// Ensure output dir exists
async function ensureDir(dir) {
  try { await fs.mkdir(dir, { recursive: true }); } catch (e) {
    if (e.code !== 'EEXIST') logger.error({ err: e, dir }, 'Error ensuring dir');
  }
}

(async () => {
  await ensureDir(OUTPUT_DIR);
  await initBrowser();

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
  app.use(bodyErrorHandler({ bodyLimit: BODY_LIMIT, logger }));

  // Counters are process-local and reset on restart, like the rate limiter.
  const metrics = { requests: 0, renders: 0, failures: 0, rejected: 0, timeouts: 0, unauthorized: 0, rateLimited: 0 };

  // auth & rate-limit middleware
  app.use((req, res, next) => {
    // /health skips authentication only: container healthchecks and load
    // balancer probes cannot present a key. It stays rate limited, so an
    // unauthenticated caller cannot poll it for free.
    const isHealth = req.path === '/health' || req.path === '/metrics';

    const { valid, provided } = isHealth ? { valid: true, provided: null } : validateAuth(req);

    metrics.requests += 1;

    if (!valid) {
      metrics.unauthorized += 1;
      res.set('WWW-Authenticate', 'Bearer realm="PlaywrightRender"');
      return res.status(401).json({ error: 'Unauthorized', request_id: req.requestId });
    }

    // choose id for rate-limiting
    const id = provided || (req.ip || req.connection.remoteAddress || 'unknown');

    // apply rate limit
    const rl = isRateLimitedFor(id);
    // set rate-limit headers
    res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(rl.resetMs / 1000))); // seconds

    if (rl.limited) {
      res.setHeader('Retry-After', String(Math.ceil(rl.resetMs / 1000)));
      metrics.rateLimited += 1;
      return res.status(429).json({ error: 'Rate limit exceeded', retry_after_seconds: Math.ceil(rl.resetMs / 1000), request_id: req.requestId });
    }

    // attach key id for downstream logging
    req.authId = id;
    next();
  });

  // POST /convert
  app.post('/convert', async (req, res) => {
    try {
      const body = req.body || {};
      const html = body.html;
      if (!html || typeof html !== 'string') {
        return res.status(400).json({ error: 'Missing "html" (string)', request_id: req.requestId });
      }

      const invalid = validateOptions(body.options);
      if (invalid) return res.status(400).json({ error: invalid, request_id: req.requestId });

      const options = Object.assign({
        format: 'A4',
        orientation: 'portrait',
        margin: '10mm',
        single: false,
        scale: null,
        png: false,
        dpi: 96,
        filename: null
      }, body.options || {});

      const saveToDisk = !!body.save;
      const outPathRel = body.outPath || null;

      if (saveToDisk) await ensureDir(OUTPUT_DIR);

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
        await renderHtmlToBuffer(html, options, { signal: disconnected.signal });
      const duration = Date.now() - start;

      // log basic info
      metrics.renders += 1;
      logger.info({
        requestId: req.requestId,
        auth: req.authId ? req.authId : 'anon',
        size: buffer.length,
        mode: options.png ? 'png' : 'pdf',
        duration: `${duration}ms`
      }, 'Convert request completed');

      const ext = options.png ? 'png' : 'pdf';
      const filename = options.filename ? options.filename : `output-${Date.now()}.${ext}`;

      if (saveToDisk) {
        let finalPath;
        if (outPathRel) {
          const safeRel = path.normalize(outPathRel).replace(/^(\.\.(\/|\\|$))+/, '');
          finalPath = path.join(OUTPUT_DIR, safeRel);
        } else {
          finalPath = path.join(OUTPUT_DIR, filename);
        }
        await ensureDir(path.dirname(finalPath));
        await fs.writeFile(finalPath, buffer);
        return res.json({ path: finalPath, filename: path.basename(finalPath), size: buffer.length, scale, contentSize, paper, orientation });
      }

      res.setHeader('Content-Type', options.png ? 'image/png' : 'application/pdf');
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      // buffer is already a Buffer; Buffer.from would copy every rendered byte.
      return res.send(buffer);
    } catch (err) {
      // 503 (queue full) and 504 (render deadline) are load signals, not faults:
      // log them at warn and let the client back off rather than retry blindly.
      const status = err && err.status ? err.status : 500;
      // 499 means the client already hung up. There is nobody to answer, and
      // writing to a closed socket only produces a second error.
      if (status === 499) {
        logger.debug({ requestId: req.requestId }, 'Client disconnected before the render started');
        return;
      }
      // Not `msg`: pino uses that key for the message itself, so passing it here
      // emits a duplicate key and the reason wins over the label.
      if (status === 500) {
        metrics.failures += 1;
        logger.error({ err, requestId: req.requestId }, 'Error in /convert');
      } else {
        if (status === 503) metrics.rejected += 1;
        if (status === 504) metrics.timeouts += 1;
        logger.warn({ status, reason: err.message, requestId: req.requestId }, 'Render not completed');
      }
      if (status === 503) res.setHeader('Retry-After', '5');
      // 503 and 504 describe load and are safe to echo. A 500 message is
      // whatever Chromium or the filesystem produced — internal detail the
      // caller cannot act on. It goes to the log, with the id to correlate.
      const error = status === 500 ? 'Internal render error' : err.message;
      return res.status(status).json({ error, request_id: req.requestId });
    }
  });

  if (METRICS_ENABLED) {
    // Prometheus text exposition. Hand-rolled: six counters do not justify a
    // dependency. Unauthenticated like /health, and rate limited the same way.
    app.get('/metrics', (req, res) => {
      const inFlight = renderInFlight();
      const lines = [
        ['viewsarn_requests_total', 'counter', 'Requests reaching the auth middleware', metrics.requests],
        ['viewsarn_renders_total', 'counter', 'Renders completed successfully', metrics.renders],
        ['viewsarn_render_failures_total', 'counter', 'Renders that failed with a 500', metrics.failures],
        ['viewsarn_render_rejected_total', 'counter', 'Renders rejected with a 503 because the queue was full', metrics.rejected],
        ['viewsarn_render_timeouts_total', 'counter', 'Renders abandoned with a 504 at the deadline', metrics.timeouts],
        ['viewsarn_unauthorized_total', 'counter', 'Requests rejected with a 401', metrics.unauthorized],
        ['viewsarn_rate_limited_total', 'counter', 'Requests rejected with a 429', metrics.rateLimited],
        ['viewsarn_renders_active', 'gauge', 'Renders holding a slot right now', inFlight.active],
        ['viewsarn_renders_queued', 'gauge', 'Requests waiting for a render slot', inFlight.waiting]
      ];
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(lines.map(([name, type, help, value]) =>
        `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}`).join('\n') + '\n');
    });
  }

  app.get('/health', (req, res) => res.json({
    ok: true,
    pid: process.pid,
    apiAuthFileInUse: isAuthFileInUse(),
    rate_limit_window_ms: RATE_LIMIT_WINDOW_MS,
    rate_limit_max: RATE_LIMIT_MAX
  }));

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, outputDir: OUTPUT_DIR }, 'Playwright render API listening');
    if (!API_KEY_ENV && !isAuthFileInUse()) {
      logger.warn('WARNING: No API key configured — authentication is DISABLED. Set API_KEY env or mount API_KEYS_FILE.');
    } else if (isAuthFileInUse()) {
      logger.info({ file: API_KEYS_FILE }, 'API keys file in use');
    }
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Received shutdown signal');
    server.close(async () => {
      logger.info('HTTP server closed');
      await closeBrowser();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

})();
