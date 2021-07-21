const pino = require('pino');
const util = require('util');
const debug = require('debug');

// off, fatal, error, warn, info, debug, trace

const logger = pino({ level: process.env.LOG_LEVEL || 'debug', });

// https://wildwolf.name/easy-way-to-make-pino-and-debug-work-together/
debug.log = function (s, ...args) {
    logger.debug(util.format(s, ...args));
};

module.exports = logger;
