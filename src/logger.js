const pino = require('pino');
const { LOG_LEVEL } = require('./config');

const logger = pino({
    level: LOG_LEVEL,
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
        },
    },
});

module.exports = logger;
