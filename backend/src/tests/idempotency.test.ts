import type { Request, Response, NextFunction } from 'express';
import { jest } from '@jest/globals';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { ErrorCode } from '../errors/errorCodes.js';
import { AppError } from '../errors/AppError.js';
import { cacheService } from '../services/cacheService.js';

/**
 * Unit tests for the idempotency middleware.
 *
 * The cache is the real singleton with its methods spied on, backed by a Map, so the middleware
 * runs its actual read/write/lock sequence — the thing this middleware can get wrong is the order
 * of those three steps, and a mock that returned canned values per call could not show it.
 */

const asMock = (fn: unknown) => fn as jest.Mock;

/** A minimal in-process stand-in for the KV store the cache facade delegates to. */
function installFakeCache(): Map<string, string> {
  const store = new Map<string, string>();

  jest.spyOn(cacheService, 'get').mockImplementation((async (key: string) => {
    const raw = store.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  }) as never);

  jest.spyOn(cacheService, 'set').mockImplementation((async (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value));
  }) as never);

  jest.spyOn(cacheService, 'setNotExists').mockImplementation((async (
    key: string,
    value: unknown,
  ) => {
    if (store.has(key)) return false;
    store.set(key, JSON.stringify(value));
    return true;
  }) as never);

  jest.spyOn(cacheService, 'deleteIfMatch').mockImplementation((async (
    key: string,
    expected: string,
  ) => {
    const raw = store.get(key);
    if (raw === undefined) return false;
    if (JSON.parse(raw) !== expected) return false;
    store.delete(key);
    return true;
  }) as never);

  return store;
}

/** The `next` value the middleware passes on: an Error to be handled, or undefined to continue. */
function nextError(next: NextFunction): AppError | undefined {
  const calls = (next as jest.Mock).mock.calls;
  return calls.length > 0 ? (calls[0]?.[0] as AppError | undefined) : undefined;
}

describe('idempotency middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let store: Map<string, string>;

  beforeEach(() => {
    store = installFakeCache();

    req = {
      header: jest.fn() as unknown as Request['header'],
      headers: {},
      method: 'POST',
      path: '/api/remittances',
      originalUrl: '/api/remittances',
    };

    res = {
      status: jest.fn().mockReturnThis() as unknown as Response['status'],
      set: jest.fn().mockReturnThis() as unknown as Response['set'],
      json: jest.fn().mockReturnThis() as unknown as Response['json'],
      send: jest.fn().mockReturnThis() as unknown as Response['send'],
      on: jest.fn() as unknown as Response['on'],
      statusCode: 201,
    };

    next = jest.fn() as unknown as NextFunction;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const withKey = (key: string | undefined) => {
    asMock(req.header).mockImplementation((name: string) =>
      name === 'Idempotency-Key' ? key : undefined,
    );
  };

  it('refuses a state-changing request that carries no key', async () => {
    withKey(undefined);

    await idempotencyMiddleware(req as Request, res as Response, next);

    const error = nextError(next);
    expect(error).toBeInstanceOf(AppError);
    expect(error?.statusCode).toBe(400);
    expect(error?.errorCode).toBe(ErrorCode.MISSING_IDEMPOTENCY_KEY);
    // Nothing was written, so no work can have been done.
    expect(store.size).toBe(0);
  });

  it('names the header it wants, so a caller knows how to retry', async () => {
    withKey(undefined);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(nextError(next)?.message).toContain('Idempotency-Key');
    expect(nextError(next)?.field).toBe('Idempotency-Key');
  });

  it('lets a read through without a key', async () => {
    req.method = 'GET';
    req.originalUrl = '/api/loans';
    withKey(undefined);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(asMock(cacheService.get)).not.toHaveBeenCalled();
  });

  it('lets a declared replay-safe endpoint through without a key', async () => {
    req.originalUrl = '/api/auth/challenge';
    req.path = '/api/auth/challenge';
    withKey(undefined);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(asMock(cacheService.get)).not.toHaveBeenCalled();
  });

  it('refuses a key that is too short to be an opaque token', async () => {
    withKey('short');

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(nextError(next)?.errorCode).toBe(ErrorCode.INVALID_IDEMPOTENCY_KEY);
  });

  it('refuses a key containing whitespace, which would alias with another key', async () => {
    withKey('two words here');

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(nextError(next)?.errorCode).toBe(ErrorCode.INVALID_IDEMPOTENCY_KEY);
  });

  it('replays the stored response instead of running the request again', async () => {
    withKey('replay-key-0001');
    store.set(
      'idemp:POST:/remittances:anonymous:replay-key-0001',
      JSON.stringify({ status: 201, body: { id: 'remittance-1' } }),
    );

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'remittance-1' });
    expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'true');
    expect(next).not.toHaveBeenCalled();
  });

  it('scopes the cache key to the caller, so one caller cannot read another\u2019s response', async () => {
    withKey('shared-key-0001');
    req.headers = { authorization: 'Bearer token-a' };

    await idempotencyMiddleware(req as Request, res as Response, next);

    const writtenKey = [...store.keys()][0];
    expect(writtenKey).toBeDefined();
    expect(writtenKey).toMatch(
      /^idemp:POST:\/remittances:c:[0-9a-f]{16}:shared-key-0001:inflight$/,
    );
    // The credential is hashed, not embedded: the cache key shows up in logs and KEYS output.
    expect(writtenKey).not.toContain('token-a');
  });

  it('scopes an API-key caller too, and never mixes the two credentials up', async () => {
    withKey('shared-key-0002');
    req.headers = { 'x-api-key': 'api-key-b' };

    await idempotencyMiddleware(req as Request, res as Response, next);
    const apiKeyScope = [...store.keys()][0];
    expect(apiKeyScope).toMatch(/^idemp:POST:\/remittances:c:[0-9a-f]{16}:shared-key-0002/);

    // Same key, same route, but a JWT instead of the API key: a different scope, so the two
    // callers cannot read each other's responses.
    jest.restoreAllMocks();
    store = installFakeCache();
    req.headers = { authorization: 'Bearer token-a' };

    await idempotencyMiddleware(req as Request, res as Response, next);
    expect([...store.keys()][0]).not.toBe(apiKeyScope);
  });

  it('scopes the cache key to the route, so two endpoints reusing a key do not collide', async () => {
    withKey('reused-key-0001');
    await idempotencyMiddleware(req as Request, res as Response, next);
    const firstKey = [...store.keys()][0];

    jest.restoreAllMocks();
    store = installFakeCache();
    req.originalUrl = '/api/loans/request';
    req.path = '/api/loans/request';

    await idempotencyMiddleware(req as Request, res as Response, next);
    const secondKey = [...store.keys()][0];

    expect(firstKey).not.toBe(secondKey);
  });

  it('refuses a second request while the first is still in flight', async () => {
    withKey('concurrent-key-01');

    // First request: claims the operation and hands off to the handler.
    await idempotencyMiddleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledWith();

    // Second request, same key, before the first has produced a response.
    const secondNext = jest.fn() as unknown as NextFunction;
    const secondRes = {
      ...res,
      set: jest.fn().mockReturnThis() as unknown as Response['set'],
    } as Partial<Response>;

    await idempotencyMiddleware(req as Request, secondRes as Response, secondNext);

    const error = nextError(secondNext);
    expect(error?.statusCode).toBe(409);
    expect(error?.errorCode).toBe(ErrorCode.DUPLICATE_REQUEST);
  });

  it('marks a fresh execution as not replayed', async () => {
    withKey('fresh-key-0000001');

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'false');
    expect(next).toHaveBeenCalledWith();
  });

  it('records the response only after it has been sent, and releases the claim after that', async () => {
    withKey('ordering-key-0001');

    await idempotencyMiddleware(req as Request, res as Response, next);

    const finishHandlers = asMock(res.on).mock.calls.filter(([event]) => event === 'finish');
    expect(finishHandlers).toHaveLength(1);

    // While the request is running the claim exists and the outcome does not.
    const lockKey = [...store.keys()][0] as string;
    expect(lockKey.endsWith(':inflight')).toBe(true);
    expect(store.has(lockKey.replace(/:inflight$/, ''))).toBe(false);

    // The handler writes its response through the intercepted `res.json`.
    (res as { statusCode: number }).statusCode = 201;
    (res.json as unknown as (body: unknown) => void)({ id: 'remittance-1' });
    await (finishHandlers[0]?.[1] as () => Promise<void>)();

    const outcomeKey = lockKey.replace(/:inflight$/, '');
    expect(store.has(outcomeKey)).toBe(true);
    expect(store.get(outcomeKey)).toContain('remittance-1');
    // Claim released: a retry now replays rather than being refused as in-flight.
    expect(store.has(lockKey)).toBe(false);
  });

  it('releases the claim when a request is aborted, so a retry is not refused forever', async () => {
    withKey('aborted-key-0001');

    await idempotencyMiddleware(req as Request, res as Response, next);
    const lockKey = [...store.keys()][0] as string;
    expect(store.has(lockKey)).toBe(true);

    const closeHandlers = asMock(res.on).mock.calls.filter(([event]) => event === 'close');
    expect(closeHandlers).toHaveLength(1);
    (closeHandlers[0]?.[1] as () => void)();

    await new Promise((resolve) => setImmediate(resolve));
    expect(store.has(lockKey)).toBe(false);
  });

  it('does not cache a 5xx, so a caller can retry a server failure', async () => {
    withKey('server-error-key1');

    await idempotencyMiddleware(req as Request, res as Response, next);
    const finishHandlers = asMock(res.on).mock.calls.filter(([event]) => event === 'finish');

    (res as { statusCode: number }).statusCode = 500;
    (res.json as unknown as (body: unknown) => void)({ error: 'boom' });
    await (finishHandlers[0]?.[1] as () => Promise<void>)();

    // Neither the outcome nor the claim is retained, so the retry runs.
    expect([...store.keys()].filter((k) => !k.endsWith(':inflight'))).toEqual([]);
  });

  it('serves the request when the cache is unreachable rather than failing it', async () => {
    withKey('cache-down-000001');
    asMock(cacheService.setNotExists).mockRejectedValue(new Error('redis is down'));
    asMock(cacheService.get).mockRejectedValue(new Error('redis is down'));

    await idempotencyMiddleware(req as Request, res as Response, next);

    // A cache outage must not turn a working write into a 500.
    expect(next).toHaveBeenCalledWith();
  });
});
