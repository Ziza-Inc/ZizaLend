import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/errorCodes.js';
import logger from '../utils/logger.js';
import { Sentry } from '../config/sentry.js';

/**
 * Error type discriminator for client-side type narrowing.
 */
export type ErrorType =
  | 'VALIDATION'
  | 'AUTH'
  | 'AUTHORIZATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMIT'
  | 'BUSINESS_LOGIC'
  | 'SERVER';

/**
 * Maps HTTP status codes to error types for client-side narrowing.
 */
function getErrorType(statusCode: number, errorCode?: string): ErrorType {
  if (statusCode === 400) {
    return errorCode === 'RATE_LIMIT_EXCEEDED' ? 'RATE_LIMIT' : 'VALIDATION';
  }
  if (statusCode === 401) return 'AUTH';
  if (statusCode === 403) return 'AUTHORIZATION';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 405) return 'VALIDATION';
  if (statusCode === 409) return 'CONFLICT';
  if (statusCode === 413) return 'VALIDATION';
  if (statusCode === 429) return 'RATE_LIMIT';
  if (statusCode >= 500) return 'SERVER';
  return 'BUSINESS_LOGIC';
}

/**
 * Builds a consistent structured error response with request ID and type.
 */
function buildErrorResponse(
  statusCode: number,
  message: string,
  errorCode: ErrorCode,
  requestId: string | undefined,
  options?: {
    field?: string | undefined;
    details?: unknown;
    errors?: Array<{ path: string; message: string }>;
    stack?: string | undefined;
  },
): Record<string, unknown> {
  const errorType = getErrorType(statusCode, errorCode);

  const errorDetail: Record<string, unknown> = {
    code: errorCode,
    message,
    type: errorType,
  };

  if (requestId) {
    errorDetail.requestId = requestId;
  }

  if (options?.field) {
    errorDetail.field = options.field;
  }

  if (options?.details) {
    errorDetail.details = options.details;
  }

  if (options?.stack) {
    errorDetail.stack = options.stack;
  }

  const response: Record<string, unknown> = {
    success: false,
    // Legacy format for backward compatibility
    message,
    // New structured format
    error: errorDetail,
  };

  if (options?.field && !response.field) {
    response.field = options.field;
  }

  if (options?.errors) {
    response.errors = options.errors;
  }

  // Backward compat: expose stack at top level for dev tooling
  if (options?.stack) {
    response.stack = options.stack;
  }

  return response;
}

/**
 * Flattens nested Zod error paths for cleaner client consumption.
 * 'body.field.nested' → 'field.nested' by stripping the common source prefix.
 */
function flattenZodPath(path: string): string {
  // Strip common source prefixes: body., query., params.
  return path.replace(/^(body|query|params)\./, '');
}

/**
 * Global error handling middleware.
 *
 * Must be registered LAST in the Express middleware chain (after all
 * routes). Catches all errors forwarded via `next(err)` and returns
 * a consistent JSON error response with structured error codes,
 * request ID for tracing, and error type for client-side narrowing.
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = req.requestId as string | undefined;

  // ── Zod Validation Errors ────────────────────────────────────
  if (err instanceof z.ZodError) {
    const issues = err.issues;
    const details = issues.map((issue: z.ZodIssue) => ({
      field: flattenZodPath(issue.path.join('.')),
      message: issue.message,
      code: issue.code,
    }));

    const firstField = details.length > 0 ? details[0]?.field : undefined;

    logger.warn('Validation failed', {
      requestId,
      path: req.path,
      method: req.method,
      errors: details,
    });

    res.status(400).json(
      buildErrorResponse(400, 'Validation failed', ErrorCode.VALIDATION_ERROR, requestId, {
        field: firstField,
        details,
        errors: issues.map((issue: z.ZodIssue) => ({
          path: flattenZodPath(issue.path.join('.')),
          message: issue.message,
        })),
      }),
    );
    return;
  }

  // ── Known Operational Errors ─────────────────────────────────
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error('Internal AppError', {
        requestId,
        path: req.path,
        method: req.method,
        errorCode: err.errorCode,
        message: err.message,
        stack: err.stack,
      });
      Sentry.captureException(err, {
        extra: { path: req.path, method: req.method, requestId },
      });
    } else {
      logger.info('Operational error', {
        requestId,
        path: req.path,
        method: req.method,
        errorCode: err.errorCode,
        message: err.message,
      });
    }

    const responseMessage = err.isOperational ? err.message : 'Internal server error';

    res.status(err.statusCode).json(
      buildErrorResponse(err.statusCode, responseMessage, err.errorCode, requestId, {
        field: err.field,
        details: err.details as Record<string, unknown> | undefined,
      }),
    );
    return;
  }

  // ── Malformed JSON body (body-parser) ──────────────────────
  // `express.json()` raises a SyntaxError with type "entity.parse.failed"
  // when the body is not valid JSON. Without this branch it fell through to
  // the generic 500 handler, so a client typo looked like a server outage.
  if (
    err instanceof SyntaxError &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.parse.failed'
  ) {
    logger.warn('Malformed JSON request body', {
      requestId,
      path: req.path,
      method: req.method,
    });

    res
      .status(400)
      .json(
        buildErrorResponse(
          400,
          'Request body is not valid JSON',
          ErrorCode.INVALID_JSON,
          requestId,
        ),
      );
    return;
  }

  // ── Payload Too Large (body-parser) ────────────────────────
  if ('type' in err && (err as { type?: string }).type === 'entity.too.large') {
    logger.warn('Request payload too large', {
      requestId,
      path: req.path,
      method: req.method,
    });

    res
      .status(413)
      .json(
        buildErrorResponse(
          413,
          'Request payload too large',
          ErrorCode.PAYLOAD_TOO_LARGE,
          requestId,
        ),
      );
    return;
  }

  // ── Unexpected / Programming Errors ──────────────────────────
  logger.error('Unhandled error', {
    requestId,
    message: err.message,
    name: err.name,
    path: req.path,
    method: req.method,
    ...(err.stack && { stack: err.stack }),
  });

  Sentry.captureException(err, {
    extra: { path: req.path, method: req.method, requestId },
  });

  const shouldExposeStackTrace =
    process.env.NODE_ENV === 'development' && process.env.EXPOSE_STACK_TRACES === 'true';

  res.status(500).json(
    buildErrorResponse(500, 'Internal server error', ErrorCode.INTERNAL_ERROR, requestId, {
      stack: shouldExposeStackTrace ? err.stack : undefined,
    }),
  );
};
