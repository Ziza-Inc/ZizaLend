import { createClient, type RedisClientType } from 'redis';
import logger from './logger.js';

/**
 * Key-value store with two interchangeable drivers.
 *
 * `redis` is the real thing and is selected whenever `REDIS_URL` is configured.
 * `memory` is a process-local fallback used when it is not, so the API can boot
 * and serve traffic on a host with no Redis instead of refusing to start.
 *
 * The memory driver deliberately implements the *same contract* as the Redis
 * driver — NX semantics, TTLs and monotonic INCR — because the code above it
 * depends on those guarantees: distributed locks in the default checker,
 * fixed-window rate limits on score updates, and cached API responses. What it
 * cannot reproduce is scope. Values live in a single process, so cache entries
 * are not shared between instances, and rate-limit counters reset on restart.
 * That is the correct trade for a deployment that has no Redis, and it is
 * reported by `GET /health` so an operator is never misled about which driver
 * is actually serving them.
 */

export type KvDriver = 'redis' | 'memory';

/** Driver preference, from the `CACHE_DRIVER` environment variable. */
export type CacheDriverPreference = 'auto' | 'redis' | 'memory';

export interface KvStore {
  /** Which backend is actually in use. Surfaced by the health endpoints. */
  readonly driver: KvDriver;

  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Set only when the key is absent. Returns whether the key was written. */
  setNX(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(keys: string | string[]): Promise<void>;
  /** Keys matching a glob pattern (`*` and `?` supported). */
  keys(pattern: string): Promise<string[]>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  /** Remaining TTL in seconds, `-1` when the key has no expiry, `-2` when absent. */
  ttl(key: string): Promise<number>;
  ping(): Promise<'ok' | 'error'>;
  close(): Promise<void>;
}

/** Translate a Redis-style glob into an anchored regular expression. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

/** Absolute expiry timestamp, or `null` for a key that never expires. */
function expiryFrom(ttlSeconds: number): number | null {
  return ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
}

interface MemoryEntry {
  value: string;
  expiresAt: number | null;
}

/** How often expired in-memory keys are reclaimed. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * In-process store used when no Redis is configured, and in tests.
 */
export function createMemoryKvStore(): KvStore {
  const entries = new Map<string, MemoryEntry>();

  /** Read an entry, treating an expired one as absent. */
  const live = (key: string): MemoryEntry | undefined => {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  // Reclaim keys that are never read again. `unref()` keeps the timer from
  // holding the process open, which matters for tests and CLI entrypoints.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) entries.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref?.();

  return {
    driver: 'memory',

    async get(key) {
      return live(key)?.value ?? null;
    },

    async set(key, value, ttlSeconds) {
      entries.set(key, { value, expiresAt: expiryFrom(ttlSeconds) });
    },

    async setNX(key, value, ttlSeconds) {
      if (live(key)) return false;
      entries.set(key, { value, expiresAt: expiryFrom(ttlSeconds) });
      return true;
    },

    async del(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) entries.delete(key);
    },

    async keys(pattern) {
      const matcher = globToRegExp(pattern);
      return [...entries.keys()].filter((key) => live(key) !== undefined && matcher.test(key));
    },

    async incr(key) {
      const existing = live(key);
      const current = Number.parseInt(existing?.value ?? '0', 10);
      const next = (Number.isFinite(current) ? current : 0) + 1;
      // Redis INCR preserves the remaining TTL, so this must too.
      entries.set(key, { value: String(next), expiresAt: existing?.expiresAt ?? null });
      return next;
    },

    async expire(key, ttlSeconds) {
      const entry = live(key);
      if (entry) entry.expiresAt = expiryFrom(ttlSeconds);
    },

    async ttl(key) {
      const entry = live(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      return Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    },

    // The local store is always reachable, which is what `ok` means here.
    async ping() {
      return 'ok';
    },

    async close() {
      clearInterval(sweep);
      entries.clear();
    },
  };
}

/** How long an initial dial may take before it is treated as a failure. */
const CONNECT_TIMEOUT_MS = 5_000;

/** Dial attempts (including the first) before giving up on a connect(). */
const MAX_CONNECT_ATTEMPTS = 3;

/** How long to stop dialling after a failure, so callers fail fast. */
export const REDIS_COOLDOWN_MS = 5_000;

/**
 * Redis-backed store. The connection is opened lazily on first use so that
 * importing this module never performs I/O.
 *
 * Two details matter when Redis is configured but *unreachable* — a wrong URL, a
 * firewall, a paused instance:
 *
 *  - `reconnectStrategy` is bounded. node-redis retries forever by default,
 *    which leaves `connect()` pending rather than rejecting, so every cached
 *    read would hang instead of degrading to a miss.
 *  - a failed dial opens a short cooldown, during which calls fail immediately
 *    instead of re-dialling. Without it each request pays the full connect
 *    timeout. Once the cooldown lapses the next call tries again, so the store
 *    recovers on its own when Redis comes back.
 */
export function createRedisKvStore(url: string): KvStore {
  let client: RedisClientType | undefined;
  let connecting: Promise<RedisClientType> | undefined;
  let downUntil = 0;

  const connect = async (): Promise<RedisClientType> => {
    if (client?.isOpen) return client;

    if (Date.now() < downUntil) {
      throw new Error('Redis is marked unavailable after a failed connection attempt');
    }

    if (!connecting) {
      const created = createClient({
        url,
        socket: {
          connectTimeout: CONNECT_TIMEOUT_MS,
          reconnectStrategy: (retries) =>
            retries >= MAX_CONNECT_ATTEMPTS
              ? new Error('Redis unreachable')
              : Math.min(retries * 100, 500),
        },
      });
      created.on('error', (error: Error) => {
        logger.error('Redis client error', { error: error.message });
      });
      client = created;
      connecting = created
        .connect()
        .then(() => created)
        .catch((error: Error) => {
          // Start the cooldown only on a failed *dial*; a dropped established
          // connection is handled by node-redis' own reconnect loop.
          downUntil = Date.now() + REDIS_COOLDOWN_MS;
          throw error;
        })
        .finally(() => {
          connecting = undefined;
        });
    }

    return connecting;
  };

  return {
    driver: 'redis',

    async get(key) {
      return (await connect()).get(key);
    },

    async set(key, value, ttlSeconds) {
      const connected = await connect();
      if (ttlSeconds > 0) await connected.setEx(key, ttlSeconds, value);
      else await connected.set(key, value);
    },

    async setNX(key, value, ttlSeconds) {
      const connected = await connect();
      const result =
        ttlSeconds > 0
          ? await connected.set(key, value, { NX: true, EX: ttlSeconds })
          : await connected.set(key, value, { NX: true });
      return result === 'OK';
    },

    async del(keys) {
      await (await connect()).del(keys);
    },

    async keys(pattern) {
      return (await connect()).keys(pattern);
    },

    async incr(key) {
      return (await connect()).incr(key);
    },

    async expire(key, ttlSeconds) {
      await (await connect()).expire(key, ttlSeconds);
    },

    async ttl(key) {
      return (await connect()).ttl(key);
    },

    async ping() {
      try {
        const reply = await (await connect()).ping();
        return reply === 'PONG' ? 'ok' : 'error';
      } catch {
        return 'error';
      }
    },

    async close() {
      if (client?.isOpen) {
        await client.quit();
      }
      client = undefined;
      connecting = undefined;
    },
  };
}

/**
 * Decide which driver to use.
 *
 * `auto` (the default) prefers Redis when `REDIS_URL` is present and falls back
 * to memory when it is not. `redis` is a hard requirement — a deployment that
 * asks for Redis and silently got a per-process cache would be a very quiet
 * problem — so it throws when no URL is configured.
 */
export function resolveCacheDriver(env: NodeJS.ProcessEnv = process.env): KvDriver {
  const preference = (env.CACHE_DRIVER ?? 'auto').trim().toLowerCase();
  const hasRedisUrl = Boolean(env.REDIS_URL && env.REDIS_URL.trim() !== '');

  if (preference === 'memory') return 'memory';
  if (preference === 'redis') {
    if (!hasRedisUrl) {
      throw new Error('CACHE_DRIVER=redis requires REDIS_URL to be set and non-empty');
    }
    return 'redis';
  }
  if (preference !== 'auto') {
    throw new Error(`Invalid CACHE_DRIVER "${preference}" — expected one of: auto, redis, memory`);
  }

  return hasRedisUrl ? 'redis' : 'memory';
}

/** Build the store selected by the environment. */
export function createKvStore(env: NodeJS.ProcessEnv = process.env): KvStore {
  const driver = resolveCacheDriver(env);
  const quiet = env.NODE_ENV === 'test';

  if (driver === 'memory') {
    if (!quiet) {
      logger.warn(
        'REDIS_URL is not set — using the in-process key-value store. Cache entries and ' +
          'rate-limit counters are per-instance and are discarded on restart. Set REDIS_URL ' +
          'to share them across instances.',
      );
    }
    return createMemoryKvStore();
  }

  if (!quiet) {
    logger.info('Using Redis for caching and rate limiting.');
  }
  return createRedisKvStore(env.REDIS_URL!.trim());
}

/** Shared singleton used by the cache and rate-limit services. */
export const kvStore: KvStore = createKvStore();
