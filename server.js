// server.js - Playwright render API with API-key file + per-key rate limiting
const config = require('./src/config');
const logger = require('./src/logger');
const { createApp, ensureDir } = require('./src/app');
const { validateOptions } = require('./src/validate');
const { bodyErrorHandler } = require('./src/httpErrors');
const { validateAuth, isAuthFileInUse } = require('./src/auth');
const { isRateLimitedFor } = require('./src/rateLimit');
const { renderHtmlToBuffer, initBrowser, closeBrowser, _inFlight } = require('./src/render');

const { PORT, OUTPUT_DIR, API_KEY_ENV, API_KEYS_FILE } = config;

(async () => {
  await ensureDir(OUTPUT_DIR, logger);
  await initBrowser();

  const { app } = createApp({
    config,
    logger,
    auth: { validateAuth, isAuthFileInUse },
    limiter: { isRateLimitedFor },
    render: { renderHtmlToBuffer, inFlight: _inFlight },
    validate: { validateOptions },
    httpErrors: { bodyErrorHandler }
  });

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
