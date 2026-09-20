import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/errorCodes.js';
import { cacheService } from '../services/cacheService.js';
import logger from '../utils/logger.js';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_TTL_SECONDS,
  IN_FLIGHT_TTL_SECONDS,
  isValidIdempotencyKey,
  credentialScope,
  idempotencyCacheKey,
  inFlightLockKey,
  normaliseApiPath,
  presentedCredential,
  requiresIdempotencyKey,
} from './idempotencyPolicy.js';

interface CachedResponse {
  status: number;
  body: unknown;
}

/**
 * Makes a state-changing request safe to send twice.
 *
 * Two mechanisms, because they cover different windows:
 *
 * - A **replay** of a completed request is answered from the cached response, so the work is not
 *   done again. This is what a client retrying after a timeout needs.
 * - A request that arrives while the first is still **in flight** is refused with 409 rather than
 *   run a second time. A client that double-clicks does not wait for the first response before
 *   sending the second, so the cache alone would be a race: both requests miss, both disburse.
 *
 * Which requests need a key is decided by `idempotencyPolicy.ts`, and the decision is applied here
 * rather than route by route, so a newly mounted endpoint is covered the moment it is reachable
 * instead of when somebody remembers to add a middleware to it.
 *
 * The path used for that decision comes from `originalUrl`, not `path`: this middleware is mounted
 * on the API prefixes, and Express rewrites `req.url` to the remainder inside a mounted layer, so
 * `/api/v1/loans` would arrive as `/v1/loans` and match no policy entry.
 */
export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const path = normaliseApiPath(req.originalUrl || req.path);
  const required = requiresIdempotencyKey(req.method, path);
  const supplied = req.header(IDEMPOTENCY_KEY_HEADER);
  const key = supplied?.trim();

  if (!key) {
    if (!required) return next();

    return next(
      AppError.badRequest(
        `${IDEMPOTENCY_KEY_HEADER} is required for ${req.method} ${path}. Send a unique key per ` +
          'logical operation and reuse it when retrying; a replay is answered from the original ' +
          'response instead of running the work again. See docs/wiki/api-idempotency.md.',
        ErrorCode.MISSING_IDEMPOTENCY_KEY,
        IDEMPOTENCY_KEY_HEADER,
      ),
    );
  }

  if (!isValidIdempotencyKey(key)) {
    return next(
      AppError.badRequest(
        `${IDEMPOTENCY_KEY_HEADER} must be between 8 and 200 characters and contain only ` +
          'A-Z, a-z, 0-9, ".", "_", ":" or "-".',
        ErrorCode.INVALID_IDEMPOTENCY_KEY,
        IDEMPOTENCY_KEY_HEADER,
      ),
    );
  }

  const cacheKey = idempotencyCacheKey({
    method: req.method,
    path,
    scope: credentialScope(presentedCredential(req.headers)),
    key,
  });

  try {
    const cached = await cacheService.get<CachedResponse>(cacheKey);

    if (cached) {
      logger.info('Idempotency replay', {
        key,
        url: req.originalUrl,
        method: req.method,
      });

      // X-Idempotent-Replayed: true signals to the client that this response
      // is a cached replay of a prior request, not a fresh execution.
      // Clients can use this to de-duplicate toasts and avoid double-counting.
      res
        .status(cached.status)
        .set('X-Idempotency-Cache', 'HIT')
        .set('X-Idempotent-Replayed', 'true')
        .json(cached.body);
      return;
    }

    // Nothing recorded yet. Claim the operation before the work is done, so a second request that
    // arrives concurrently is refused instead of running alongside the first.
    const claim = randomUUID();
    const lockKey = inFlightLockKey(cacheKey);
    const claimed = await cacheService.setNotExists(lockKey, claim, IN_FLIGHT_TTL_SECONDS);

    if (!claimed) {
      // `setNotExists` reports false both when the key exists and when the store refused the write.
      // Reading the key back tells the two apart: a held claim is a duplicate in flight, an absent
      // one means the cache is unavailable — and a cache that is down must not fail requests, so
      // that case proceeds without the in-flight window rather than answering 409.
      const held = await cacheService.get<string>(lockKey);

      if (held) {
        logger.warn('Idempotency key already in flight', {
          key,
          url: req.originalUrl,
          method: req.method,
        });

        return next(
          AppError.conflict(
            `A request with this ${IDEMPOTENCY_KEY_HEADER} is already in flight. Wait for it to ` +
              'finish and reuse its response, or generate a new key for a new operation.',
            ErrorCode.DUPLICATE_REQUEST,
          ),
        );
      }
    }

    // Capture the original methods to intercept the response body
    const originalJson = res.json;
    const originalSend = res.send;

    let responseBody: unknown;

    // Override res.json
    res.json = function (body: unknown) {
      responseBody = body;
      return originalJson.call(this, body);
    };

    // Override res.send (as res.json eventually calls res.send)
    res.send = function (body: unknown) {
      if (!responseBody) {
        if (typeof body === 'string') {
          try {
            responseBody = JSON.parse(body);
          } catch {
            responseBody = body;
          }
        } else {
          responseBody = body;
        }
      }
      return originalSend.call(this, body);
    };

    // X-Idempotent-Replayed: false on the first (fresh) execution so the
    // client always receives the header and can branch on its value.
    res.set('X-Idempotent-Replayed', 'false');

    // Fenced by the claim token: only the request that took the claim may release it, so a request
    // whose claim has already expired cannot delete the claim a later request acquired.
    const releaseClaim = async (): Promise<void> => {
      await cacheService.deleteIfMatch(lockKey, claim);
    };

    // Store the response in cache once the request is finished
    res.on('finish', async () => {
      // Only cache 2xx and 4xx status codes.
      // 5xx errors should usually be retried without returning a cached failure.
      if (res.statusCode >= 200 && res.statusCode < 500 && responseBody) {
        try {
          await cacheService.set(
            cacheKey,
            {
              status: res.statusCode,
              body: responseBody,
            },
            IDEMPOTENCY_TTL_SECONDS,
          );
        } catch (error) {
          logger.error(`Error caching idempotency key ${key}`, { error });
        }
      }

      // Released after the outcome is recorded. Releasing first would open a window in which a
      // concurrent retry finds neither a claim nor a cached response and runs the work again.
      await releaseClaim();
    });

    // A request that is aborted mid-flight never emits 'finish', so the claim is released here
    // rather than left to time out. On a normal response 'close' follows 'finish' and this is a
    // no-op, because the fenced delete finds nothing to remove.
    res.on('close', () => {
      void releaseClaim();
    });

    next();
  } catch (error) {
    logger.error('Error in idempotency middleware', { error, key });
    next();
  }
};
