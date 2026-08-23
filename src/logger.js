const pino = require('pino');
const { LOG_LEVEL, IS_PRODUCTION } = require('./config');

// pino-pretty runs in a worker thread and emits human-readable, non-parseable
// output. Production logs stay as raw JSON on stdout: cheaper and machine-readable.
const logger = pino({
    level: LOG_LEVEL,
    ...(IS_PRODUCTION ? {} : {
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        },
    }),
});

module.exports = logger;
