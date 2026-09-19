import { describe, it, expect, afterEach } from '@jest/globals';
import {
  createMemoryKvStore,
  createRedisKvStore,
  resolveCacheDriver,
  type KvStore,
} from '../utils/kvStore.js';

/**
 * The in-process store exists so the API can boot without Redis, which means its
 * behaviour has to match the Redis contract the rest of the code relies on:
 * NX writes, TTLs that actually expire, and INCR that keeps the remaining TTL.
 */
describe('resolveCacheDriver', () => {
  it('defaults to the in-process store when REDIS_URL is unset', () => {
    expect(resolveCacheDriver({})).toBe('memory');
    expect(resolveCacheDriver({ CACHE_DRIVER: 'auto' })).toBe('memory');
  });

  it('prefers Redis in auto mode when REDIS_URL is set', () => {
    expect(resolveCacheDriver({ REDIS_URL: 'redis://localhost:6379' })).toBe('redis');
    expect(resolveCacheDriver({ REDIS_URL: 'rediss://user:pw@host:6379' })).toBe('redis');
  });

  it('treats a blank REDIS_URL as absent', () => {
    expect(resolveCacheDriver({ REDIS_URL: '   ' })).toBe('memory');
  });

  it('honours an explicit memory preference even when REDIS_URL is set', () => {
    expect(resolveCacheDriver({ CACHE_DRIVER: 'memory', REDIS_URL: 'redis://x' })).toBe('memory');
  });

  it('is case-insensitive about the preference', () => {
    expect(resolveCacheDriver({ CACHE_DRIVER: 'MEMORY' })).toBe('memory');
    expect(resolveCacheDriver({ CACHE_DRIVER: ' Redis ', REDIS_URL: 'redis://x' })).toBe('redis');
  });

  it('fails loudly when Redis is demanded but not configured', () => {
    expect(() => resolveCacheDriver({ CACHE_DRIVER: 'redis' })).toThrow(/requires REDIS_URL/);
    expect(() => resolveCacheDriver({ CACHE_DRIVER: 'redis', REDIS_URL: '  ' })).toThrow(
      /requires REDIS_URL/,
    );
  });

  it('rejects an unknown preference', () => {
    expect(() => resolveCacheDriver({ CACHE_DRIVER: 'memcached' })).toThrow(/Invalid CACHE_DRIVER/);
  });
});

describe('redis key-value store pointed at a dead server', () => {
  // 127.0.0.1:1 refuses instantly, which is exactly the misconfiguration case:
  // REDIS_URL is set (so the driver is redis) but nothing is listening.
  it('rejects instead of hanging, then fails fast during the cooldown', async () => {
    const store = createRedisKvStore('redis://127.0.0.1:1');

    await expect(store.get('key')).rejects.toThrow();

    const startedAt = Date.now();
    await expect(store.get('key')).rejects.toThrow(/marked unavailable/);

    // The second call must not dial again, so it cannot pay a connect timeout.
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(store.driver).toBe('redis');

    await store.close();
  }, 30_000);
});

describe('memory key-value store', () => {
  let store: KvStore;

  afterEach(async () => {
    if (store) await store.close();
  });

  it('round-trips values and reports misses as null', async () => {
    store = createMemoryKvStore();

    expect(await store.get('missing')).toBeNull();

    await store.set('key', 'value', 60);
    expect(await store.get('key')).toBe('value');
  });

  it('expires keys once their TTL elapses', async () => {
    store = createMemoryKvStore();
    await store.set('short', 'value', 0.05);

    expect(await store.get('short')).toBe('value');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await store.get('short')).toBeNull();
  });

  it('reports TTLs the way Redis does', async () => {
    store = createMemoryKvStore();

    await store.set('no-expiry', 'value', 0);
    expect(await store.ttl('no-expiry')).toBe(-1);
    expect(await store.ttl('absent')).toBe(-2);

    await store.set('windowed', 'value', 120);
    const ttl = await store.ttl('windowed');
    expect(ttl).toBeGreaterThan(110);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('writes NX keys once, then treats them as held until they expire', async () => {
    store = createMemoryKvStore();

    expect(await store.setNX('lock', 'a', 60)).toBe(true);
    expect(await store.setNX('lock', 'b', 60)).toBe(false);
    expect(await store.get('lock')).toBe('a');

    // An expired lock is free again.
    await store.set('short-lock', 'a', 0.05);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await store.setNX('short-lock', 'b', 60)).toBe(true);
  });

  it('increments monotonically and preserves the remaining TTL', async () => {
    store = createMemoryKvStore();

    expect(await store.incr('counter')).toBe(1);
    expect(await store.incr('counter')).toBe(2);

    await store.set('windowed', '5', 120);
    expect(await store.incr('windowed')).toBe(6);
    // INCR must not reset the window it is counting.
    expect(await store.ttl('windowed')).toBeGreaterThan(110);

    await store.expire('counter', 30);
    expect(await store.ttl('counter')).toBeGreaterThan(25);
  });

  it('treats a non-numeric counter as zero', async () => {
    store = createMemoryKvStore();
    await store.set('garbage', 'not-a-number', 60);

    expect(await store.incr('garbage')).toBe(1);
  });

  it('matches glob patterns for key invalidation', async () => {
    store = createMemoryKvStore();
    await store.set('pool:stats', 'a', 60);
    await store.set('pool:borrower:G1', 'b', 60);
    await store.set('score:user:1', 'c', 60);
    await store.set('pool:expired', 'd', 0.05);

    // Let the short-lived key lapse first, so the assertions below describe live
    // keys only and do not race the clock.
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Expired keys are invisible to pattern matching too.
    expect(await store.keys('*')).toHaveLength(3);
    expect((await store.keys('pool:*')).sort()).toEqual(['pool:borrower:G1', 'pool:stats']);
    expect(await store.keys('score:user:?')).toEqual(['score:user:1']);
  });

  it('deletes single keys and batches', async () => {
    store = createMemoryKvStore();
    await store.set('a', '1', 60);
    await store.set('b', '2', 60);
    await store.set('c', '3', 60);

    await store.del('a');
    expect(await store.get('a')).toBeNull();

    await store.del(['b', 'c']);
    expect(await store.get('b')).toBeNull();
    expect(await store.get('c')).toBeNull();
  });

  it('is always reachable and discards everything on close', async () => {
    store = createMemoryKvStore();
    await store.set('key', 'value', 60);

    expect(await store.ping()).toBe('ok');
    expect(store.driver).toBe('memory');

    await store.close();
    expect(await store.get('key')).toBeNull();
  });
});
