/**
 * Logging Utilities for Development
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

const logHistory: LogEntry[] = [];
const MAX_LOG_HISTORY = 1000;

let debugMode = false;

/**
 * Enable or disable debug mode
 */
function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

/**
 * Format timestamp for logging
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Create a log entry
 */
function createLogEntry(level: LogLevel, source: string, message: string): LogEntry {
  return {
    timestamp: formatTimestamp(),
    level,
    source,
    message
  };
}

/**
 * Store log entry in history
 */
function storeLog(entry: LogEntry): void {
  logHistory.push(entry);
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }
}

/**
 * Log a message
 */
function log(level: LogLevel, source: string, message: string): void {
  const entry = createLogEntry(level, source, message);
  storeLog(entry);
  
  const prefix = `[${entry.timestamp}] [${source}]`;
  
  switch (level) {
    case 'debug':
      if (debugMode) console.debug(prefix, message);
      break;
    case 'info':
      console.log(prefix, message);
      break;
    case 'warn':
      console.warn(prefix, message);
      break;
    case 'error':
      console.error(prefix, message);
      break;
  }
}

/**
 * Convenience methods
 */
const logger = {
  debug: (source: string, message: string) => log('debug', source, message),
  info: (source: string, message: string) => log('info', source, message),
  warn: (source: string, message: string) => log('warn', source, message),
  error: (source: string, message: string) => log('error', source, message),
  setDebugMode,
  getHistory: () => [...logHistory],
  clearHistory: () => { logHistory.length = 0; }
};

export { logger, LogLevel, LogEntry };
