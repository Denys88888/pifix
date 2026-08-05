import winston from 'winston';
import { env } from '../config/env';

const devFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} ${level}: ${message}${extra}`;
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: env.isProduction
    ? winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json())
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        devFormat,
      ),
  defaultMeta: { service: 'pifix-api' },
  transports: [new winston.transports.Console()],
});

/** Values that must never reach the logs. */
const REDACTED_KEYS = ['accessToken', 'password', 'authorization', 'seed', 'privateKey', 'apiKey'];

export function redact<T extends Record<string, unknown>>(payload: T): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    clone[key] = REDACTED_KEYS.some((needle) => key.toLowerCase().includes(needle.toLowerCase()))
      ? '[redacted]'
      : value;
  }
  return clone;
}
