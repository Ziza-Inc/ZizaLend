import type { NextFunction, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import { ErrorCode } from '../errors/errorCodes.js';

/**
 * Builds a 429 response that matches the centralized error envelope used by
 * `errorHandler` (`{ success, message, error: { code, message, type } }`).
 *
 * Previously each limiter returned a bespoke shape (`{ error: '...' }`), so the
 * frontend had to special-case rate-limit failures and could not map them to
 * i18n copy by error code. Every limiter now emits the same envelope plus a
 * `Retry-After` header so clients can back off deterministically.
 */
const rateLimitHandler =
  (message: string, extraErrorFields?: Record<string, unknown>) =>
  (_req: Request, res: Response, _next: NextFunction, options: { windowMs?: number }): void => {
    const retryAfterSeconds = Math.max(1, Math.ceil((options?.windowMs ?? 60_000) / 1000));
    res.setHeader('Retry-After', retryAfterSeconds);

    res.status(429).json({
      success: false,
      message,
      error: {
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message,
        type: 'RATE_LIMIT',
        retryAfterSeconds,
        ...extraErrorFields,
      },
    });
  };

export const createRateLimiter = (
  max: number,
  windowMinutes: number = 15,
): RateLimitRequestHandler =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler('Too many requests, please try again later.'),
  });

export const globalRateLimiter = createRateLimiter(100);
export const strictRateLimiter = createRateLimiter(10, 45);

// Admin operations: 30 req/min per IP (higher limits for legitimate admin activity)
export const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: rateLimitHandler('Too many admin requests, please try again later.'),
});

// Auth endpoints: 10 req/min per IP (stricter rate limiting for brute-force protection)
export const challengeRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('Too many challenge requests, please try again later.'),
});

export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip ?? 'unknown')}:${req.body?.publicKey ?? 'unknown'}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('Too many login attempts, please try again later.'),
});

export const ipLoginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('Too many login attempts from this IP, please try again later.'),
});

export const verifyRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('Too many verification attempts, please try again later.'),
});

// Simulation endpoints: 5 req/min per authenticated user
export const simulationRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: (req) => {
    // Use authenticated user's public key if available, otherwise fall back to IP
    const user = (req as unknown as { user?: { publicKey: string } }).user;
    return user?.publicKey ?? ipKeyGenerator(req.ip ?? 'unknown');
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: rateLimitHandler('Too many simulation requests, please try again later.'),
});
