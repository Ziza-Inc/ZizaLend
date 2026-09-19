import { describe, it, expect, beforeEach } from '@jest/globals';
import { createMemoryKvStore, type KvStore } from '../../utils/kvStore.js';
import { RateLimitService, SCORE_UPDATE_RATE_LIMIT } from '../rateLimitService.js';

/**
 * These tests drive the limiter through an injected store rather than a mocked
 * `redis` client. The previous version asserted on raw client calls, which meant
 * it silently depended on REDIS_URL being set in the environment: without it the
 * limiter correctly used the in-process store and the mock was never touched.
 */
let store: KvStore;
let service: RateLimitService;

beforeEach(() => {
  store = createMemoryKvStore();
  service = new RateLimitService(store);
});

describe('rateLimitService', () => {
  it('allows the first request and creates the rate-limit window', async () => {
    const result = await service.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.currentCount).toBe(1);

    // The window is anchored to the first request, so the key must now expire.
    const ttl = await store.ttl('rate_limit:user123');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SCORE_UPDATE_RATE_LIMIT.windowSeconds);
  });

  it('blocks requests once the atomic counter exceeds the limit', async () => {
    await service.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);

    const second = await service.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);
    expect(second.allowed).toBe(true);
    expect(second.currentCount).toBe(2);

    let last = second;
    for (let i = 0; i < 4; i += 1) {
      last = await service.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);
    }

    expect(last.allowed).toBe(false);
    expect(last.currentCount).toBe(6);
    expect(last.remaining).toBe(0);
  });

  it('admits at most maxRequests under concurrent requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.checkRateLimit('score:user1', { maxRequests: 5, windowSeconds: 60 }),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(5);

    // Counters are per identifier, so no bleed into other keys.
    expect(await store.get('rate_limit:score:other')).toBeNull();
  });

  it('counts each identifier independently', async () => {
    await service.checkRateLimit('user-a', SCORE_UPDATE_RATE_LIMIT);
    await service.checkRateLimit('user-a', SCORE_UPDATE_RATE_LIMIT);

    const other = await service.checkRateLimit('user-b', SCORE_UPDATE_RATE_LIMIT);

    expect(other.currentCount).toBe(1);
    expect(other.remaining).toBe(4);
  });

  it('fails open when the store is unavailable', async () => {
    const failing: KvStore = {
      ...store,
      driver: 'redis',
      async incr() {
        throw new Error('Redis connection failed');
      },
    };

    const result = await new RateLimitService(failing).checkRateLimit(
      'user123',
      SCORE_UPDATE_RATE_LIMIT,
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.currentCount).toBe(1);
  });

  it('resets the rate limit counter', async () => {
    await service.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);
    await service.resetRateLimit('user123');

    const result = await service.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);
    expect(result.currentCount).toBe(1);
  });

  it('returns current status without incrementing', async () => {
    await store.set('rate_limit:user123', '2', 120);

    const result = await service.getRateLimitStatus('user123', SCORE_UPDATE_RATE_LIMIT);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
    expect(await store.get('rate_limit:user123')).toBe('2');
  });

  it('returns default status for new identifiers', async () => {
    const result = await service.getRateLimitStatus('user123', SCORE_UPDATE_RATE_LIMIT);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });

  it('reports the driver it is backed by', () => {
    expect(service.driver).toBe('memory');
  });
});
