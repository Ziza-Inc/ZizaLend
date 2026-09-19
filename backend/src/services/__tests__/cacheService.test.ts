import { describe, it, expect, afterEach } from '@jest/globals';
import { createMemoryKvStore, type KvStore } from '../../utils/kvStore.js';
import { CacheService } from '../cacheService.js';

/**
 * The cache facade must never propagate a store failure — it degrades to a miss
 * so the caller falls back to the database. Both halves of that contract are
 * covered here: the happy path over the in-process driver, and a store that
 * fails every call.
 */
describe('CacheService', () => {
  const stores: KvStore[] = [];

  const newService = (): { service: CacheService; store: KvStore } => {
    const store = createMemoryKvStore();
    stores.push(store);
    return { service: new CacheService(store), store };
  };

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()));
  });

  it('round-trips structured values as JSON', async () => {
    const { service } = newService();
    const payload = { score: 742, band: 'prime', history: [1, 2, 3] };

    await service.set('score:user:1', payload, 300);

    expect(await service.get<typeof payload>('score:user:1')).toEqual(payload);
  });

  it('returns null for a miss', async () => {
    const { service } = newService();
    expect(await service.get('absent')).toBeNull();
  });

  it('returns null rather than throwing on unparsable cached data', async () => {
    const { service, store } = newService();
    await store.set('corrupt', '{not json', 60);

    expect(await service.get('corrupt')).toBeNull();
  });

  it('acquires NX locks exactly once', async () => {
    const { service } = newService();

    expect(await service.setNotExists('lock', 'instance-a', 60)).toBe(true);
    expect(await service.setNotExists('lock', 'instance-b', 60)).toBe(false);
    expect(await service.get('lock')).toBe('instance-a');
  });

  it('deletes keys', async () => {
    const { service, store } = newService();
    await service.set('key', 'value', 60);

    await service.delete('key');

    expect(await store.get('key')).toBeNull();
  });

  it('only releases a lock held by the matching value', async () => {
    const { service, store } = newService();
    await service.set('lock', 'instance-a', 60);

    expect(await service.deleteIfMatch('lock', 'instance-b')).toBe(false);
    expect(await store.get('lock')).not.toBeNull();

    expect(await service.deleteIfMatch('lock', 'instance-a')).toBe(true);
    expect(await store.get('lock')).toBeNull();
  });

  it('compares non-JSON lock values verbatim', async () => {
    const { service, store } = newService();
    await store.set('lock', 'raw-token', 60);

    expect(await service.deleteIfMatch('lock', 'raw-token')).toBe(true);
    expect(await store.get('lock')).toBeNull();
  });

  it('returns false when releasing a lock that is already gone', async () => {
    const { service } = newService();
    expect(await service.deleteIfMatch('absent', 'anything')).toBe(false);
  });

  it('invalidates by pattern without touching unrelated keys', async () => {
    const { service, store } = newService();
    await service.set('pool:stats', { tvl: 1 }, 60);
    await service.set('pool:borrower:G1', { loans: 2 }, 60);
    await service.set('score:user:1', 700, 60);

    await service.invalidatePattern('pool:*');

    expect(await store.get('pool:stats')).toBeNull();
    expect(await store.get('pool:borrower:G1')).toBeNull();
    expect(await service.get('score:user:1')).toBe(700);
  });

  it('reports the backing driver and a healthy ping', async () => {
    const { service } = newService();

    expect(service.driver).toBe('memory');
    expect(await service.ping()).toBe('ok');
  });

  describe('with an unreachable store', () => {
    class FailingStore implements KvStore {
      readonly driver = 'redis' as const;
      async get(): Promise<string | null> {
        throw new Error('ECONNREFUSED');
      }
      async set(): Promise<void> {
        throw new Error('ECONNREFUSED');
      }
      async setNX(): Promise<boolean> {
        throw new Error('ECONNREFUSED');
      }
      async del(): Promise<void> {
        throw new Error('ECONNREFUSED');
      }
      async keys(): Promise<string[]> {
        throw new Error('ECONNREFUSED');
      }
      async incr(): Promise<number> {
        throw new Error('ECONNREFUSED');
      }
      async expire(): Promise<void> {
        throw new Error('ECONNREFUSED');
      }
      async ttl(): Promise<number> {
        throw new Error('ECONNREFUSED');
      }
      async ping(): Promise<'ok' | 'error'> {
        throw new Error('ECONNREFUSED');
      }
      async close(): Promise<void> {
        throw new Error('ECONNREFUSED');
      }
    }

    it('degrades to cache misses instead of failing the request', async () => {
      const service = new CacheService(new FailingStore());

      expect(await service.get('key')).toBeNull();
      // A lock that could not be acquired must not be reported as held.
      expect(await service.setNotExists('key', 'value', 60)).toBe(false);
      expect(await service.deleteIfMatch('key', 'value')).toBe(false);
      expect(await service.ping()).toBe('error');

      // Writes and deletes are best-effort and must not throw.
      await expect(service.set('key', 'value', 60)).resolves.toBeUndefined();
      await expect(service.delete('key')).resolves.toBeUndefined();
      await expect(service.invalidatePattern('key:*')).resolves.toBeUndefined();
      await expect(service.close()).resolves.toBeUndefined();
    });
  });
});
