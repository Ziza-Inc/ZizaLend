import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

/**
 * The completeness half of the audit trail.
 *
 * Two properties, because either alone is satisfiable while the trail is still incomplete:
 *
 * - **Structural**: every mutating route on a privileged router is audited by construction, and
 *   the list this test declares matches the routes that actually exist. A new privileged action
 *   fails this test until it is added to the list, which is the review step.
 * - **Behavioural**: an entry appears for a success, for a failure *with the reason*, and for a
 *   request that was refused before it reached a handler. The last one is the case that made the
 *   old per-route placement wrong: the audit middleware sat behind the auth middleware, so a
 *   denied admin action produced no record at all.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-min-32-chars-long!!';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>();

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  default: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
}));

/** A dispute resolution that succeeds unless the test makes it fail. */
const resolveDispute = jest.fn((_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: { resolved: true } });
});

jest.unstable_mockModule('../controllers/adminDisputeController.js', () => ({
  listLoanDisputes: jest.fn((_req: Request, res: Response) =>
    res.json({ success: true, data: [] }),
  ),
  getLoanDispute: jest.fn((_req: Request, res: Response) => res.json({ success: true, data: {} })),
  resolveLoanDispute: resolveDispute,
  rejectLoanDispute: jest.fn((_req: Request, res: Response) => res.json({ success: true })),
}));

jest.unstable_mockModule('../controllers/indexerController.js', () => ({
  getIndexerStatus: jest.fn((_req: Request, res: Response) => res.json({})),
  getBorrowerEvents: jest.fn((_req: Request, res: Response) => res.json({ data: [] })),
  getLoanEvents: jest.fn((_req: Request, res: Response) => res.json({ data: [] })),
  getRecentEvents: jest.fn((_req: Request, res: Response) => res.json({ data: [] })),
  createWebhookSubscription: jest.fn((_req: Request, res: Response) => res.status(201).json({})),
  deleteWebhookSubscription: jest.fn((_req: Request, res: Response) => res.json({})),
  getWebhookDeliveries: jest.fn((_req: Request, res: Response) => res.json({})),
  listQuarantinedEvents: jest.fn((_req: Request, res: Response) => res.json({ data: [] })),
  listWebhookSubscriptions: jest.fn((_req: Request, res: Response) => res.json({ data: [] })),
  reprocessQuarantinedEvents: jest.fn((_req: Request, res: Response) => res.json({})),
  reindexLedgerRange: jest.fn((_req: Request, res: Response) => res.json({})),
}));

jest.unstable_mockModule('../services/defaultChecker.js', () => ({
  defaultChecker: { checkOverdueLoans: jest.fn(async () => ({ checked: 0 })) },
}));

jest.unstable_mockModule('../controllers/loanController.js', () => ({
  buildRejectLoanTx: jest.fn((_req: Request, res: Response) => res.json({ xdr: 'AAAA' })),
  requestLoan: jest.fn(),
}));

const { auditLog } = await import('../middleware/auditLog.js');
const { default: adminRoutes } = await import('../routes/adminRoutes.js');
const { default: indexerRoutes } = await import('../routes/indexerRoutes.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { AppError } = await import('../errors/AppError.js');

// ── The declared list of privileged actions ───────────────────────

/**
 * Every mutating route on the two privileged routers, with what it does.
 *
 * This list is asserted against the routers' own source below, so adding a route without adding it
 * here fails the suite rather than shipping un-audited.
 */
const PRIVILEGED_ACTIONS: ReadonlyArray<{ method: string; routePath: string; what: string }> = [
  {
    method: 'POST',
    routePath: '/loans/:loanId/build-reject',
    what: 'build a rejection for an admin to sign',
  },
  {
    method: 'POST',
    routePath: '/loan-disputes/:disputeId/resolve',
    what: 'resolve a dispute (API key)',
  },
  {
    method: 'POST',
    routePath: '/disputes/:disputeId/resolve',
    what: 'resolve a dispute (admin JWT)',
  },
  { method: 'POST', routePath: '/disputes/:disputeId/reject', what: 'reject a dispute' },
  { method: 'POST', routePath: '/check-defaults', what: 'run on-chain default checks' },
  { method: 'POST', routePath: '/reindex', what: 'reindex a ledger range' },
  {
    method: 'POST',
    routePath: '/quarantine-events/reprocess',
    what: 'reprocess quarantined events',
  },
  { method: 'POST', routePath: '/webhooks', what: 'register a webhook subscription' },
  { method: 'DELETE', routePath: '/webhooks/:id', what: 'remove a webhook subscription' },
  {
    method: 'POST',
    routePath: '/webhooks',
    what: 'register a webhook subscription (indexer mount)',
  },
  {
    method: 'DELETE',
    routePath: '/webhooks/:subscriptionId',
    what: 'remove a webhook subscription (indexer mount)',
  },
  { method: 'POST', routePath: '/update', what: 'adjust a credit score' },
];

/**
 * The route files that carry privileged actions.
 *
 * `scoreRoutes` is here because an admin key reaches `POST /score/update` through it rather than
 * through the admin router, so a list of just the admin and indexer routers would have granted it
 * exactly the exemption the issue is about.
 */
const PRIVILEGED_ROUTE_FILES = ['adminRoutes.ts', 'indexerRoutes.ts', 'scoreRoutes.ts'];

const MUTATING_METHODS = new Set(['post', 'patch', 'put', 'delete']);

/** Every `router.<method>('…')` registration in a route file. */
function registeredRoutes(source: string): Array<{ method: string; routePath: string }> {
  const found: Array<{ method: string; routePath: string }> = [];
  const pattern = /router\.(get|post|patch|put|delete|all)\(\s*['"]([^'"]+)['"]/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const [, method, routePath] = match;
    if (method && routePath && MUTATING_METHODS.has(method)) {
      found.push({ method: method.toUpperCase(), routePath });
    }
  }

  return found;
}

const ROUTES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../routes');

function readRouteFile(name: string): string {
  return readFileSync(path.join(ROUTES_DIR, name), 'utf8');
}

// ── A harness that mounts the real routers ────────────────────────

const ADMIN_KEY = 'admin-key-value';
const DISPUTES_KEY = 'disputes-key-value';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/indexer', indexerRoutes);
  app.use('/api/v1/indexer', indexerRoutes);
  app.use(errorHandler);
  return app;
}

const adminToken = () =>
  `Bearer ${jwt.sign(
    { publicKey: 'GADMIN', role: 'admin', scopes: ['admin:all'] },
    process.env.JWT_SECRET!,
    {
      algorithm: 'HS256',
      expiresIn: '1h',
    },
  )}`;

/** The audit rows written so far, as `{ sql, params }`. */
function auditWrites(): Array<{ sql: string; params: unknown[] }> {
  return mockQuery.mock.calls
    .filter(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_logs'))
    .map(([sql, params]) => ({ sql: sql as string, params: (params ?? []) as unknown[] }));
}

/** The row for a given action, if one was written. */
function rowForAction(action: string): unknown[] | undefined {
  return auditWrites().find((write) => write.params.includes(action))?.params;
}

/** The insert runs from a `finish`/`close` listener, so let the microtask queue drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const originalApiKey = process.env.INTERNAL_API_KEY;
const originalAdminWallets = process.env.ADMIN_WALLETS;

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  resolveDispute.mockImplementation((_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: { resolved: true } });
  });
  // `<scope>:<value>` per the format `requireApiKey` parses.
  process.env.INTERNAL_API_KEY = `admin:disputes:${DISPUTES_KEY},admin:webhooks:${ADMIN_KEY}`;
  // The admin role is resolved from the wallet against current configuration rather than trusted
  // from the token, so the wallet has to actually be an admin for the request to be allowed.
  process.env.ADMIN_WALLETS = 'GADMIN';
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.INTERNAL_API_KEY;
  else process.env.INTERNAL_API_KEY = originalApiKey;

  if (originalAdminWallets === undefined) delete process.env.ADMIN_WALLETS;
  else process.env.ADMIN_WALLETS = originalAdminWallets;
});

describe('privileged action coverage', () => {
  it('declares every mutating route on the privileged routers', () => {
    const declared = new Set(
      PRIVILEGED_ACTIONS.map(({ method, routePath }) => `${method} ${routePath}`),
    );

    for (const file of PRIVILEGED_ROUTE_FILES) {
      for (const { method, routePath } of registeredRoutes(readRouteFile(file))) {
        // A new mutating route must appear in the declared list before this passes, which is the
        // review step that keeps the trail exhaustive.
        expect(declared).toContain(`${method} ${routePath}`);
      }
    }
  });

  it('has mutating routes to check (guards against a vacuous test)', () => {
    const found = PRIVILEGED_ROUTE_FILES.flatMap((file) => registeredRoutes(readRouteFile(file)));
    expect(found.length).toBeGreaterThanOrEqual(PRIVILEGED_ACTIONS.length);
  });

  it('audits by mounting the middleware on the router, so a new route is covered', () => {
    for (const file of PRIVILEGED_ROUTE_FILES) {
      const source = readRouteFile(file);
      expect(source).toContain('router.use(auditLog)');
      expect(source).toContain("from '../middleware/auditLog.js'");
    }
  });

  it('mounts the audit middleware before any route on the router', () => {
    // A `router.use` placed after a registration would leave everything registered above it
    // un-audited, which reads the same as an action that never happened.
    for (const file of PRIVILEGED_ROUTE_FILES) {
      const source = readRouteFile(file);
      expect(source.indexOf('router.use(auditLog)')).toBeLessThan(
        source.indexOf('router.get(') === -1 ? Infinity : source.indexOf('router.get('),
      );
      expect(source.indexOf('router.use(auditLog)')).toBeLessThan(source.indexOf('router.post('));
    }
  });
});

describe('an audit row is produced for every outcome', () => {
  it('records a successful privileged action', async () => {
    await request(buildApp())
      .post('/api/v1/admin/disputes/7/resolve')
      .set('Authorization', adminToken())
      .send({ action: 'confirm', resolution: 'evidence verified' })
      .expect(200);
    await settle();

    const row = rowForAction('POST /admin/disputes/:disputeId/resolve');
    expect(row).toBeDefined();
    expect(row).toEqual([
      'GADMIN', // actor, from the authenticated JWT
      'POST /admin/disputes/:disputeId/resolve',
      'DisputeID:7', // target
      expect.any(String), // payload
      expect.anything(), // ip
      200,
      null, // no reason: it succeeded
    ]);
  });

  it('records a failure with the reason', async () => {
    resolveDispute.mockImplementation(() => {
      throw AppError.forbidden('Dispute already closed by another operator', 'CONFLICT');
    });

    await request(buildApp())
      .post('/api/v1/admin/disputes/7/resolve')
      .set('Authorization', adminToken())
      .send({ action: 'confirm', resolution: 'evidence verified' })
      .expect(403);
    await settle();

    const row = rowForAction('POST /admin/disputes/:disputeId/resolve');
    expect(row?.[5]).toBe(403);
    expect(String(row?.[6])).toContain('Dispute already closed by another operator');
  });

  it('records a request refused before it reached a handler', async () => {
    // The case the per-route placement missed entirely: the audit middleware sat *behind* the auth
    // middleware, so an unauthorised privileged attempt left no trace.
    await request(buildApp())
      .post('/api/v1/admin/disputes/7/resolve')
      .send({ action: 'confirm', resolution: 'evidence verified' })
      .expect(401);
    await settle();

    const row = rowForAction('POST /admin/disputes/:disputeId/resolve');
    expect(row).toBeDefined();
    expect(row?.[0]).toBe('unknown');
    expect(row?.[5]).toBe(401);
  });

  it('records a rejection by role, naming the reason', async () => {
    const borrower = jwt.sign(
      { publicKey: 'GBORROWER', role: 'borrower' },
      process.env.JWT_SECRET!,
      {
        algorithm: 'HS256',
        expiresIn: '1h',
      },
    );

    await request(buildApp())
      .post('/api/v1/admin/disputes/7/resolve')
      .set('Authorization', `Bearer ${borrower}`)
      .send({ action: 'confirm', resolution: 'evidence verified' })
      .expect(403);
    await settle();

    const row = rowForAction('POST /admin/disputes/:disputeId/resolve');
    expect(row?.[0]).toBe('GBORROWER');
    expect(String(row?.[6])).toContain('Insufficient role permissions');
  });

  it('records the API-key route that had no audit middleware at all', async () => {
    await request(buildApp())
      .post('/api/admin/loan-disputes/12/resolve')
      .set('x-api-key', DISPUTES_KEY)
      .send({ action: 'confirm', resolution: 'evidence verified' })
      .expect(200);
    await settle();

    const row = rowForAction('POST /admin/loan-disputes/:disputeId/resolve');
    expect(row).toBeDefined();
    expect(row?.[0]).toBe('INTERNAL_API_KEY');
    expect(row?.[2]).toBe('DisputeID:12');
  });

  it('records an action whose requester hung up, with no status to report', async () => {
    // Driven directly rather than over a socket: a disconnect is a `close` with no `finish`, and
    // reproducing that through supertest means racing a real connection teardown.
    const listeners = new Map<string, () => void>();
    const fakeReq = {
      method: 'POST',
      baseUrl: '/api/v1/admin',
      path: '/disputes/7/resolve',
      params: { disputeId: '7' },
      // Set by Express when a route matches; it is not restored when the router unwinds.
      route: { path: '/disputes/:disputeId/resolve' },
      headers: { authorization: 'Bearer x' },
      body: { action: 'confirm' },
      user: { publicKey: 'GADMIN', role: 'admin' },
      ip: '127.0.0.1',
    } as unknown as Request;
    const fakeRes = {
      statusCode: 200,
      locals: {},
      on: (event: string, listener: () => void) => {
        listeners.set(event, listener);
        return fakeRes;
      },
    } as unknown as Response;

    auditLog(fakeReq, fakeRes, jest.fn() as unknown as NextFunction);
    listeners.get('close')?.();
    await settle();

    const row = rowForAction('POST /admin/disputes/:disputeId/resolve');
    expect(row).toBeDefined();
    expect(row?.[5]).toBeNull();
    expect(String(row?.[6])).toContain('CLIENT_DISCONNECTED');
  });

  it('does not record a read', async () => {
    await request(buildApp())
      .get('/api/v1/admin/disputes')
      .set('Authorization', adminToken())
      .expect(200);
    await settle();

    expect(auditWrites()).toHaveLength(0);
  });

  it('names an action identically on both mounts, so one search finds both', async () => {
    for (const base of ['/api/admin', '/api/v1/admin']) {
      await request(buildApp())
        .post(`${base}/disputes/7/resolve`)
        .set('Authorization', adminToken())
        .send({ action: 'confirm', resolution: 'evidence verified' })
        .expect(200);
    }
    await settle();

    const actions = auditWrites().map((write) => write.params[1]);
    expect(actions).toEqual([
      'POST /admin/disputes/:disputeId/resolve',
      'POST /admin/disputes/:disputeId/resolve',
    ]);
  });

  it('keeps a credential out of the recorded payload', async () => {
    await request(buildApp())
      .post('/api/v1/admin/webhooks')
      .set('x-api-key', ADMIN_KEY)
      .send({
        callbackUrl: 'https://example.com/hook',
        eventTypes: ['LoanRequested'],
        secret: 'whsec_live_leak',
      })
      .expect(201);
    await settle();

    const payload = String(auditWrites()[0]?.params[3]);
    expect(payload).not.toContain('whsec_live_leak');
    expect(payload).toContain('example.com/hook');
  });

  it('writes exactly one row per request, not one per listener', async () => {
    // Both `finish` and `close` fire on a normal response; a trail with two rows per action is a
    // trail an operator cannot count.
    await request(buildApp())
      .post('/api/v1/admin/disputes/7/resolve')
      .set('Authorization', adminToken())
      .send({ action: 'confirm', resolution: 'evidence verified' })
      .expect(200);
    await settle();
    await settle();

    expect(auditWrites()).toHaveLength(1);
  });
});

void ({} as NextFunction);
