const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const pino = require('pino');
const { validateOptions, validateBody } = require('../src/validate');
const { bodyErrorHandler, finalErrorHandler } = require('../src/httpErrors');
const { createApp } = require('../src/app');

async function start(app) {
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

// Stub collaborators for createApp: no browser, no keys file, no real limiter.
// `logs` collects every log line as an object so tests can inspect log content.
function makeDeps(over = {}) {
  const logs = [];
  const logger = pino({ level: 'debug' }, { write: line => logs.push(JSON.parse(line)) });
  const outputDir = over.outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'viewsarn-'));
  let hits = 0;
  const deps = {
    config: {
      OUTPUT_DIR: outputDir,
      AUTH_FAIL_MAX: 30,
      RATE_LIMIT_MAX: 120,
      RATE_LIMIT_WINDOW_MS: 60_000,
      BODY_LIMIT: '100kb',
      TRUST_PROXY: false,
      CORS_ORIGINS: [],
      METRICS_ENABLED: true,
      ...over.config
    },
    logger,
    auth: {
      validateAuth(req) {
        const header = req.get('authorization');
        const provided = header && header.toLowerCase().startsWith('bearer ')
          ? header.slice(7).trim()
          : (req.get('x-api-key') || null);
        const valid = provided === 'k1';
        return { valid, authRequired: true, principal: valid ? { id: 'k:digest-of-k', label: 'abc123def456' } : null };
      },
      authConfigured: () => true,
      isAuthFileInUse: () => false,
      ...over.auth
    },
    limiter: {
      isRateLimitedFor() {
        hits += 1;
        const max = over.rateLimitAfter ?? Infinity;
        return hits > max
          ? { limited: true, remaining: 0, resetMs: 30_000 }
          : { limited: false, remaining: 100, resetMs: 30_000 };
      },
      ...over.limiter
    },
    render: {
      renderHtmlToBuffer: async () => ({
        buffer: Buffer.from('%PDF-stub'),
        scale: 1,
        contentSize: { width: 1, height: 1 },
        paper: 'A4',
        orientation: 'portrait'
      }),
      inFlight: () => ({ active: 0, waiting: 0 }),
      browserReady: () => true,
      ...over.render
    },
    validate: { validateOptions, validateBody },
    httpErrors: { bodyErrorHandler, finalErrorHandler }
  };
  return { deps, logs, outputDir };
}

async function boot(over) {
  const made = makeDeps(over);
  const { app, metrics } = createApp(made.deps);
  const server = await start(app);
  return { ...made, ...server, metrics };
}

const post = (url, body, headers = {}) => fetch(`${url}/convert`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k1', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

module.exports = { start, makeDeps, boot, post };
