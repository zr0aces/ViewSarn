// server.js - Playwright render API with API-key file + per-key rate limiting
const config = require('./src/config');
const logger = require('./src/logger');
const { createApp, ensureDir } = require('./src/app');
const { validateOptions } = require('./src/validate');
const { bodyErrorHandler } = require('./src/httpErrors');
const fs = require('fs');
const { validateAuth, authConfigured, isAuthFileInUse } = require('./src/auth');
const { isRateLimitedFor } = require('./src/rateLimit');
const { renderHtmlToBuffer, initBrowser, closeBrowser, _inFlight } = require('./src/render');

const { PORT, OUTPUT_DIR, API_KEYS_FILE, AUTH_DISABLED } = config;

// Fail closed: a deployment with no key source is almost always a mistake (for
// example Docker created apikeys.txt as a directory), so it must not come up open.
if (!authConfigured() && !AUTH_DISABLED) {
  let isDir = false;
  try { isDir = fs.statSync(API_KEYS_FILE).isDirectory(); } catch { /* not there */ }
  logger.fatal({ file: API_KEYS_FILE },
    isDir
      ? 'API_KEYS_FILE is a directory; create the keys file before starting the container. Or set API_KEY, or AUTH_DISABLED=true.'
      : 'No API key configured. Set API_KEY, mount API_KEYS_FILE with at least one key, or set AUTH_DISABLED=true.');
  process.exit(1);
}

(async () => {
  await ensureDir(OUTPUT_DIR, logger);
  await initBrowser();

  const { app } = createApp({
    config,
    logger,
    auth: { validateAuth, authConfigured, isAuthFileInUse },
    limiter: { isRateLimitedFor },
    render: { renderHtmlToBuffer, inFlight: _inFlight },
    validate: { validateOptions },
    httpErrors: { bodyErrorHandler }
  });

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, outputDir: OUTPUT_DIR }, 'Playwright render API listening');
    if (!authConfigured()) {
      logger.warn('WARNING: AUTH_DISABLED=true and no API key configured — authentication is OFF.');
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
