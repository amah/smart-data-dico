// Simple logger utility

/**
 * Log levels
 */
export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG'
}

/**
 * Simple logger function
 * @param level Log level
 * @param message Message to log
 * @param meta Additional metadata
 */
export function log(level: LogLevel, message: string, meta?: any): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(meta && { meta })
  };
  
  // In production, this would be replaced with a proper logging solution
  console.log(JSON.stringify(logEntry));
}

// Convenience methods
export const logger = {
  error: (message: string, meta?: any) => log(LogLevel.ERROR, message, meta),
  warn: (message: string, meta?: any) => log(LogLevel.WARN, message, meta),
  info: (message: string, meta?: any) => log(LogLevel.INFO, message, meta),
  debug: (message: string, meta?: any) => log(LogLevel.DEBUG, message, meta)
};