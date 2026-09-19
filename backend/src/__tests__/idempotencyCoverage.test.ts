import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { jest } from '@jest/globals';
import {
  KEY_REQUIRED_METHODS,
  REPLAY_SAFE_ROUTES,
  findReplaySafeRoute,
  normaliseApiPath,
  requiresIdempotencyKey,
} from '../middleware/idempotencyPolicy.js';

/**
 * The route-coverage half of the idempotency guarantee.
 *
 * The middleware is mounted on the API surface rather than route by route (`app.ts`), which is what
 * makes coverage automatic for a new endpoint. This test is what makes that claim checkable: it
 * enumerates the mutating operations from the published OpenAPI document and asserts, against the
 * running app, that each one refuses a request that arrives without a key. A route that is somehow
 * reachable without passing the middleware — a new router mounted outside the `/api` surface, a
 * route table that bypasses it — makes the corresponding case fail.
 *
 * It also fails on the opposite mistake: an entry in the replay-safe allowlist that no longer
 * matches a documented operation is dead policy, and it means the exemption was granted for a route
 * that has since been renamed, so the *current* route of that name is silently exempt.
 */

// ── An in-memory cache, so the middleware's claim step is real ────
const fakeCacheStore = new Map<string, unknown>();
jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(async (key: string) => fakeCacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      fakeCacheStore.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      fakeCacheStore.delete(key);
    }),
    setNotExists: jest.fn(async (key: string, value: unknown) => {
      if (fakeCacheStore.has(key)) return false;
      fakeCacheStore.set(key, value);
      return true;
    }),
    deleteIfMatch: jest.fn(async (key: string, expected: string) => {
      if (fakeCacheStore.get(key) !== expected) return false;
      fakeCacheStore.delete(key);
      return true;
    }),
  },
}));

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: jest.fn() },
  query: jest.fn(),
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

const { default: app } = await import('../app.js');

// ── The published contract ────────────────────────────────────────
interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
}

const SPEC_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/openapi.json',
);

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;

/** Every documented operation that a caller uses to change something. */
const documentedMutations = Object.entries(spec.paths).flatMap(([routePath, operations]) =>
  Object.keys(operations)
    .filter((method) => ['post', 'patch', 'put', 'delete'].includes(method))
    .map((method) => ({ method: method.toUpperCase(), path: routePath })),
);

/**
 * The URL to send the request to.
 *
 * The spec writes paths relative to the servers it declares (`/api` and `/api/v1`); `/user` is
 * mounted on its own, outside those prefixes.
 */
function urlFor(routePath: string): string {
  const concrete = routePath.replace(/\{[^}]+\}/g, 'placeholder-id');
  return routePath.startsWith('/user') ? concrete : `/api/v1${concrete}`;
}

describe('idempotency coverage over the published API', () => {
  it('has documented mutating operations to check (guards against a vacuous test)', () => {
    expect(documentedMutations.length).toBeGreaterThan(20);
  });

  it.each(documentedMutations)(
    'classifies $method $path, and refuses it without a key unless it is declared replay-safe',
    async ({ method, path: routePath }) => {
      if (!KEY_REQUIRED_METHODS.has(method)) {
        // PUT and DELETE are idempotent by definition, so the policy does not require a key. The
        // assertion is that this is the *stated* reason, not an accident of the method list.
        expect(requiresIdempotencyKey(method, normaliseApiPath(routePath))).toBe(false);
        return;
      }

      if (findReplaySafeRoute(method, normaliseApiPath(routePath))) {
        // Exempt, and the exemption is asserted to be deliberate in the next test.
        expect(requiresIdempotencyKey(method, normaliseApiPath(routePath))).toBe(false);
        return;
      }

      const response = await request(app)
        [method.toLowerCase() as 'post' | 'patch'](urlFor(routePath))
        .send({});

      expect({
        method,
        path: routePath,
        status: response.status,
        code: response.body?.error?.code,
      }).toEqual({
        method,
        path: routePath,
        status: 400,
        code: 'MISSING_IDEMPOTENCY_KEY',
      });
    },
  );

  it('enforces the same rule on the unversioned /api mount', async () => {
    const versioned = await request(app).post('/api/v1/remittances').send({});
    const unversioned = await request(app).post('/api/remittances').send({});

    expect(versioned.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
    expect(unversioned.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('covers a mutating route reached through a non-/api mount', async () => {
    const response = await request(app).patch('/user/profile').send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('refuses an undocumented mutating request too, rather than defaulting to open', async () => {
    // Default-deny is the property that makes a new route safe before anybody classifies it.
    const response = await request(app).post('/api/not-a-real-route').send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('leaves harmless methods untouched', async () => {
    for (const method of ['get', 'head', 'options'] as const) {
      const response = await request(app)[method]('/api/v1/loans');
      expect(response.status).not.toBe(400);
    }
  });

  it('only exempts routes that are actually documented', () => {
    const documented = new Set(documentedMutations.map(({ method, path: p }) => `${method} ${p}`));

    for (const route of REPLAY_SAFE_ROUTES) {
      const name = `${route.method} ${route.path}`;

      if (documented.has(name)) {
        // Documented, so nothing further to explain.
        expect(route.notInPublishedContract).toBeUndefined();
        continue;
      }

      // Not documented: allowed only with a written account of why, so an exemption can never be
      // granted for a path nobody can point at without that being visible in the diff.
      expect(route.notInPublishedContract).toEqual(expect.any(String));
      expect(route.notInPublishedContract!.length).toBeGreaterThan(40);
    }
  });

  it('does not carry a stale exemption for a path the published contract names instead', () => {
    // The specific drift this found: the document said `/simulate/payment` while the router served
    // `/simulate`. The exemption must name the mounted path, or it exempts nothing and the real
    // route is left needing a key that its callers never send.
    const exempt = REPLAY_SAFE_ROUTES.map(({ method, path: p }) => `${method} ${p}`);
    expect(exempt).toContain('POST /simulate');
    expect(exempt).not.toContain('POST /simulate/payment');
  });

  it('gives every exemption a written reason', () => {
    for (const route of REPLAY_SAFE_ROUTES) {
      expect(route.reason.length).toBeGreaterThan(40);
    }
  });

  it('exempts nothing that creates a durable record or moves funds', () => {
    // Named explicitly: if one of these ever appears in the allowlist, the exemption is wrong
    // regardless of what its reason says. `POST /auth/login` is the one deliberate exception —
    // it cannot disburse, and it is the call that mints the credential the key would be scoped to.
    const neverExempt = [
      'POST /remittances',
      'POST /remittances/{id}/submit',
      'POST /loans/request',
      'POST /pool/deposit',
      'POST /pool/withdraw',
      'POST /loans/{loanId}/repay',
      'POST /loans/{loanId}/liquidate',
    ];

    const exempt = REPLAY_SAFE_ROUTES.map(({ method, path: p }) => `${method} ${p}`);
    for (const route of neverExempt) {
      expect(exempt).not.toContain(route);
    }
  });
});
