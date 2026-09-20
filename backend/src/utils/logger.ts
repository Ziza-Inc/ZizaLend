import winston from 'winston';
import { getRequestId } from './requestContext.js';
import {
  REDACTED,
  escapeLogText,
  isSensitiveField,
  redactForLogging,
  redactString,
} from './redaction.js';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const validLevels = Object.keys(levels);

const defaultLevelForEnv = () => {
  const env = process.env.NODE_ENV || 'development';
  // Changed from "info" to "http" so priority 3 (http) logs pass in staging/production
  return env === 'development' ? 'debug' : 'http';
};

const level = () => {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured && validLevels.includes(configured)) {
    return configured;
  }
  return defaultLevelForEnv();
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'grey',
};

winston.addColors(colors);

/** Dev: human-readable with colors and optional metadata */
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${timestamp} ${level}: ${message}${metaStr}${stackStr}`;
  }),
);

/** Production: JSON for parsing and querying */
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'iso' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const withRequestId = winston.format((info) => {
  const requestIdFromContext = getRequestId();
  if (requestIdFromContext && !info.requestId) {
    info.requestId = requestIdFromContext;
  }
  return info;
});

/**
 * Metadata keys that winston owns and that therefore must not be replaced wholesale.
 *
 * `message` and `stack` are still *scanned* rather than trusted: an exception message built out
 * of a URL or a header is a common way for a token to reach a log, and the field name gives no
 * hint of it. They are run through the value pass instead of the name pass, so a clean message is
 * left exactly as written.
 *
 * The list of what counts as a secret lives in `utils/redaction.ts`, shared with the audit trail,
 * so there is one definition rather than one per writer.
 */
const LOG_META_RESERVED_KEYS = new Set(['level', 'message', 'timestamp', 'stack', 'splat']);

/** Strips credentials from every metadata field on a log record. */
export const withRedaction = winston.format((info) => {
  for (const key of Object.keys(info)) {
    const value = info[key];

    if (LOG_META_RESERVED_KEYS.has(key)) {
      info[key] = typeof value === 'string' ? redactString(value) : value;
      continue;
    }

    // The name pass applies to the record's own keys; the value pass handles everything
    // underneath them, including credentials embedded in strings.
    info[key] = isSensitiveField(key) ? REDACTED : redactForLogging(value);
  }
  return info;
});

const isProduction = process.env.NODE_ENV === 'production';

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isProduction ? productionFormat : devFormat,
  }),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  // Redaction runs at the logger rather than inside each transport's format chain.
  //
  // Winston applies the logger's format and then the transport's, so a rule placed here covers
  // every transport — including one added later for a new sink. That is the difference between a
  // guarantee and a habit: when this lived in the console transport's own chain, adding a second
  // transport (a file, a log shipper) silently wrote credentials to it, and nothing failed.
  format: winston.format.combine(withRequestId(), withRedaction()),
  transports,
});

export interface LogContext {
  requestId?: string;
  userId?: string;
  loanId?: string;
  [key: string]: unknown;
}

const withContext = (context: LogContext = {}) => {
  const requestId = context.requestId || getRequestId();
  const baseMeta: Record<string, unknown> = {};

  if (requestId) baseMeta.requestId = requestId;
  if (context.userId) baseMeta.userId = context.userId;
  if (context.loanId) baseMeta.loanId = context.loanId;

  // Messages are escaped here, at the point where caller data becomes a log entry.
  //
  // This is the path request-scoped logging takes, so every message assembled out of a request
  // body — a rejection reason, a dispute note, an email subject — passes through it. Escaping
  // line breaks and other control characters is what stops a caller from writing a log line the
  // service did not write, or from driving the terminal that is displaying the log.
  return {
    info: (message: string, meta?: unknown) =>
      logger.info(escapeLogText(message), { ...baseMeta, ...(meta as Record<string, unknown>) }),
    warn: (message: string, meta?: unknown) =>
      logger.warn(escapeLogText(message), { ...baseMeta, ...(meta as Record<string, unknown>) }),
    error: (message: string, meta?: unknown) =>
      logger.error(escapeLogText(message), { ...baseMeta, ...(meta as Record<string, unknown>) }),
    http: (message: string, meta?: unknown) =>
      logger.http(escapeLogText(message), { ...baseMeta, ...(meta as Record<string, unknown>) }),
  };
};

const loggerWithContext = Object.assign(logger, { withContext });

export default loggerWithContext;
