// server.js - Playwright render API with API-key file + per-key rate limiting
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs').promises;

const { PORT, OUTPUT_DIR, RATE_LIMIT_MAX } = require('./src/config');
const logger = require('./src/logger');
const { validateAuth, isAuthFileInUse } = require('./src/auth');
const { isRateLimitedFor } = require('./src/rateLimit');
const { renderHtmlToBuffer, initBrowser, closeBrowser } = require('./src/render');

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
  app.use(bodyParser.json({ limit: '15mb' }));

  // auth & rate-limit middleware
  app.use((req, res, next) => {
    const { valid, authRequired, provided } = validateAuth(req);

    if (!valid) {
      res.set('WWW-Authenticate', 'Bearer realm="PlaywrightRender"');
      return res.status(401).json({ error: 'Unauthorized' });
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
      return res.status(429).json({ error: 'Rate limit exceeded', retry_after_seconds: Math.ceil(rl.resetMs / 1000) });
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
      if (!html || typeof html !== 'string') return res.status(400).json({ error: 'Missing "html" (string)' });

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

      // render
      const start = Date.now();
      const { buffer, scale, contentSize, paper, orientation } = await renderHtmlToBuffer(html, options);
      const duration = Date.now() - start;

      // log basic info
      logger.info({
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
      return res.send(Buffer.from(buffer));
    } catch (err) {
      logger.error({ err }, 'Error in /convert');
      return res.status(500).json({ error: (err && err.message) ? err.message : String(err) });
    }
  });

  app.get('/health', (req, res) => res.json({
    ok: true,
    pid: process.pid,
    apiAuthFileInUse: isAuthFileInUse(),
    rate_limit_window_ms: require('./src/config').RATE_LIMIT_WINDOW_MS,
    rate_limit_max: RATE_LIMIT_MAX
  }));

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, outputDir: OUTPUT_DIR }, 'Playwright render API listening');
    if (!require('./src/config').API_KEY_ENV && !isAuthFileInUse()) {
      logger.warn('WARNING: No API key configured — authentication is DISABLED. Set API_KEY env or mount API_KEYS_FILE.');
    } else if (isAuthFileInUse()) {
      logger.info({ file: require('./src/config').API_KEYS_FILE }, 'API keys file in use');
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
