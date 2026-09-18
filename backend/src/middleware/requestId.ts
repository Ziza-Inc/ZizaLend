import type { Request, Response, NextFunction } from 'express';
import { createRequestId, runWithRequestContext } from '../utils/requestContext.js';

declare module 'express' {
  interface Request {
    requestId?: string;
  }
}

/** Maximum accepted length for a caller-supplied correlation id. */
export const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Accepted character set for a caller-supplied correlation id.
 * Deliberately narrow: the value is echoed into response headers and written
 * to every log line for the request, so control characters (notably CR/LF)
 * could forge log entries, and arbitrarily long values could be used to
 * amplify log volume.
 */
const ALLOWED_REQUEST_ID = /^[A-Za-z0-9._:-]+$/;

/**
 * Returns the caller-supplied request id when it is safe to reuse, otherwise
 * `undefined` so a fresh id is generated.
 */
function sanitizeIncomingRequestId(header: string | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;

  const trimmed = header.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_REQUEST_ID_LENGTH) return undefined;
  if (!ALLOWED_REQUEST_ID.test(trimmed)) return undefined;

  return trimmed;
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = sanitizeIncomingRequestId(req.header('x-request-id')) ?? createRequestId();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  runWithRequestContext(requestId, () => {
    next();
  });
};
