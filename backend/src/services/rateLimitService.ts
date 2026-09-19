import { kvStore, type KvDriver, type KvStore } from '../utils/kvStore.js';
import logger from '../utils/logger.js';

interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  currentCount: number;
}

/**
 * Fixed-window rate limiting over the shared key-value store.
 *
 * The counter is bumped with an atomic INCR so concurrent requests cannot all
 * read the same value and slip through the boundary together. When the store is
 * Redis the window is shared by every instance; when it falls back to the
 * in-process store (no `REDIS_URL`), each instance counts separately — the limit
 * still applies, but it is per-instance rather than global.
 *
 * If the store is unreachable the service fails **open** (the request is
 * allowed). Rate limiting is a protection against abuse, not a correctness
 * requirement, and failing closed would take the API down with Redis.
 */
export class RateLimitService {
  private static readonly DEFAULT_CONFIG: RateLimitConfig = {
    maxRequests: 10,
    windowSeconds: 86400, // 24 hours
  };

  private readonly store: KvStore;

  /** `store` is injectable so tests can exercise the limiter without Redis. */
  constructor(store: KvStore = kvStore) {
    this.store = store;
  }

  /** Which backend is in use (`redis` or `memory`). Reported by `GET /health`. */
  get driver(): KvDriver {
    return this.store.driver;
  }

  /**
   * Check if a request is allowed based on rate limit rules.
   *
   * @param identifier Unique identifier (e.g., userId, IP address)
   * @param config Rate limit configuration
   * @returns Rate limit result with allowance status and metadata
   */
  async checkRateLimit(
    identifier: string,
    config: RateLimitConfig = RateLimitService.DEFAULT_CONFIG,
  ): Promise<RateLimitResult> {
    const key = `rate_limit:${identifier}`;

    try {
      // INCR is atomic, so concurrent requests cannot all read the same counter
      // value and pass the boundary together. The TTL is set on the first hit
      // only, so the window is anchored to the first request.
      const currentCount = await this.store.incr(key);
      if (currentCount === 1) {
        await this.store.expire(key, config.windowSeconds);
      }

      const ttlSeconds = await this.store.ttl(key);
      const resetTime = new Date(
        Date.now() + (ttlSeconds > 0 ? ttlSeconds : config.windowSeconds) * 1000,
      );

      return {
        allowed: currentCount <= config.maxRequests,
        remaining: Math.max(0, config.maxRequests - currentCount),
        resetTime,
        currentCount,
      };
    } catch (error) {
      logger.withContext().error('Rate limit check failed', { identifier, error });

      // Fail open: allow the request if the store is unavailable. This prevents
      // the entire service from failing due to rate limiting issues.
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetTime: new Date(Date.now() + config.windowSeconds * 1000),
        currentCount: 1,
      };
    }
  }

  /**
   * Reset the rate limit counter for a specific identifier.
   * Useful for testing or administrative purposes.
   *
   * @param identifier Unique identifier to reset
   */
  async resetRateLimit(identifier: string): Promise<void> {
    const key = `rate_limit:${identifier}`;
    try {
      await this.store.del(key);
      logger.withContext().info('Rate limit reset', { identifier });
    } catch (error) {
      logger.withContext().error('Failed to reset rate limit', { identifier, error });
    }
  }

  /**
   * Get current rate limit status without incrementing the counter.
   *
   * @param identifier Unique identifier
   * @param config Rate limit configuration
   * @returns Current rate limit status
   */
  async getRateLimitStatus(
    identifier: string,
    config: RateLimitConfig = RateLimitService.DEFAULT_CONFIG,
  ): Promise<Omit<RateLimitResult, 'currentCount'>> {
    const key = `rate_limit:${identifier}`;

    try {
      const currentValue = await this.store.get(key);

      if (!currentValue) {
        return {
          allowed: true,
          remaining: config.maxRequests,
          resetTime: new Date(Date.now() + config.windowSeconds * 1000),
        };
      }

      const currentCount = Number.parseInt(currentValue, 10);
      if (!Number.isFinite(currentCount)) {
        return {
          allowed: true,
          remaining: config.maxRequests,
          resetTime: new Date(Date.now() + config.windowSeconds * 1000),
        };
      }

      const ttlSeconds = await this.store.ttl(key);

      return {
        allowed: currentCount < config.maxRequests,
        remaining: Math.max(0, config.maxRequests - currentCount),
        resetTime: new Date(
          Date.now() + (ttlSeconds > 0 ? ttlSeconds : config.windowSeconds) * 1000,
        ),
      };
    } catch (error) {
      logger.withContext().error('Failed to get rate limit status', { identifier, error });

      // Return conservative values on error
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetTime: new Date(Date.now() + config.windowSeconds * 1000),
      };
    }
  }
}

// Export singleton instance
export const rateLimitService = new RateLimitService();

// Export configuration constants for score updates
export const SCORE_UPDATE_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5, // Maximum 5 score updates per user per day
  windowSeconds: 86400, // 24 hours
};
