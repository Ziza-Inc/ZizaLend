import { kvStore, type KvDriver, type KvStore } from '../utils/kvStore.js';
import logger from '../utils/logger.js';

/**
 * Cache facade over the shared key-value store.
 *
 * Every method swallows transport errors and degrades to a cache miss, because
 * a cache is an optimisation: a request that cannot reach the backing store
 * should still be served from the source of truth, just slower. The store may be
 * Redis or, when no `REDIS_URL` is configured, the in-process fallback — see
 * `utils/kvStore.ts` for what that does and does not guarantee.
 */
export class CacheService {
  private readonly store: KvStore;

  /** `store` is injectable so tests can exercise the facade without Redis. */
  constructor(store: KvStore = kvStore) {
    this.store = store;
  }

  /** Which backend is in use (`redis` or `memory`). Reported by `GET /health`. */
  get driver(): KvDriver {
    return this.store.driver;
  }

  private get quiet(): boolean {
    return process.env.NODE_ENV === 'test';
  }

  /**
   * Set a value in the cache with a Time-To-Live (TTL).
   * @param key The cache key
   * @param value The value to cache (will be stringified)
   * @param ttlSeconds The TTL in seconds (default: 300 = 5 minutes)
   */
  async set(key: string, value: unknown, ttlSeconds: number = 300): Promise<void> {
    try {
      await this.store.set(key, JSON.stringify(value), ttlSeconds);
    } catch (error) {
      if (!this.quiet) {
        logger.withContext().error(`Error setting cache for key ${key}`, { error });
      }
    }
  }

  /**
   * Get a value from the cache.
   * @param key The cache key
   * @returns The parsed value, or null if not found or on error
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.store.get(key);
      if (value === null) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      if (!this.quiet) {
        logger.withContext().error(`Error getting cache for key ${key}`, { error });
      }
      return null;
    }
  }

  /**
   * Set a value only if the key does not exist (SET NX — Set if Not Exists).
   * Used for distributed locking.
   * @param key The cache key
   * @param value The value to cache
   * @param ttlSeconds The TTL in seconds
   * @returns true if the key was set, false if the key already existed or the store failed
   */
  async setNotExists(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    try {
      return await this.store.setNX(key, JSON.stringify(value), ttlSeconds);
    } catch (error) {
      logger.withContext().error(`Error setting NX cache for key ${key}`, { error });
      // A lock that could not be acquired is not held.
      return false;
    }
  }

  /**
   * Delete a value from the cache.
   * @param key The cache key
   */
  async delete(key: string): Promise<void> {
    try {
      await this.store.del(key);
    } catch (error) {
      if (!this.quiet) {
        logger.withContext().error(`Error deleting cache for key ${key}`, { error });
      }
    }
  }

  /**
   * Delete a key only when its stored value matches `expectedValue` (fenced
   * compare-and-delete). Used by distributed locks so a run that outlives the
   * TTL cannot delete a lock acquired by a different instance.
   *
   * @returns true if the key existed and the value matched (key deleted),
   *          false if the key was absent or the value did not match.
   */
  async deleteIfMatch(key: string, expectedValue: string): Promise<boolean> {
    try {
      const stored = await this.store.get(key);
      if (stored === null) return false;

      let storedValue: unknown;
      try {
        storedValue = JSON.parse(stored);
      } catch {
        storedValue = stored;
      }

      if (storedValue !== expectedValue) return false;

      await this.store.del(key);
      return true;
    } catch (error) {
      if (!this.quiet) {
        logger.withContext().error(`Error in deleteIfMatch for key ${key}`, { error });
      }
      return false;
    }
  }

  /**
   * Invalidate multiple keys by a pattern (e.g. prefix).
   * Note: `KEYS` is generally not recommended in production, but is suitable for
   * exact or bounded patterns.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.store.keys(pattern);
      if (keys.length > 0) {
        await this.store.del(keys);
      }
    } catch (error) {
      if (!this.quiet) {
        logger.withContext().error(`Error invalidating pattern ${pattern}`, { error });
      }
    }
  }

  /**
   * Ping the backing store to verify connectivity.
   * Returns "ok" on success or "error" if unreachable.
   */
  async ping(): Promise<'ok' | 'error'> {
    try {
      return await this.store.ping();
    } catch {
      return 'error';
    }
  }

  async close(): Promise<void> {
    try {
      await this.store.close();
    } catch (error) {
      if (!this.quiet) {
        logger.withContext().error('Error closing cache store', { error });
      }
    }
  }
}

// Export a singleton instance
export const cacheService = new CacheService();
