/**
 * Centraliserad logger för strukturerad loggning
 *
 * Tillhandahåller en enhetlig loggningsmetod med:
 * - Nivåhantering (error, warn, info, debug)
 * - Tidsstämplar i ISO 8601-format
 * - Modulspecifika loggare
 * - Metadata-stöd för kontextuell information
 *
 * Usage:
 *   const { createLogger } = require('./utils/logger');
 *   const logger = createLogger('module-name');
 *
 *   logger.info('Meddelande', { meta: 'data' });
 *   logger.error('Fel', { error: err.message });
 *
 * Konfigurera nivå via miljövariabel:
 *   LOG_LEVEL=debug node app.js
 *
 * @module logger
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

function formatMessage(level, module, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level.toUpperCase()}] [${module}] ${message}${metaStr}`;
}

function createLogger(module) {
  return {
    error: (message, meta) => {
      if (currentLevel >= LOG_LEVELS.error) {
        console.error(formatMessage('error', module, message, meta));
      }
    },
    warn: (message, meta) => {
      if (currentLevel >= LOG_LEVELS.warn) {
        console.warn(formatMessage('warn', module, message, meta));
      }
    },
    info: (message, meta) => {
      if (currentLevel >= LOG_LEVELS.info) {
        console.info(formatMessage('info', module, message, meta));
      }
    },
    debug: (message, meta) => {
      if (currentLevel >= LOG_LEVELS.debug) {
        console.debug(formatMessage('debug', module, message, meta));
      }
    },
  };
}

module.exports = { createLogger, LOG_LEVELS };
