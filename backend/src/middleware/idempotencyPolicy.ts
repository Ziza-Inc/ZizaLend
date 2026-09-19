import { createHash } from 'node:crypto';
import { normaliseApiPath } from '../utils/apiPath.js';

/**
 * Which requests have to carry an `Idempotency-Key`, and why the others do not.
 *
 * The middleware used to deduplicate only when a caller happened to send a key, which meant the
 * protection was opt-in: a client that did not know about it — a double-click in the UI, a proxy
 * retry, a script that simply retries on timeout — could disburse twice. Making the header
 * required is what turns deduplication into a property of the API rather than of the caller.
 *
 * The policy is stated here, once, and applied by `idempotency.ts`, so a route cannot be added
 * without a decision: `__tests__/idempotencyCoverage.test.ts` reads `packages/openapi.json` and
 * fails when a documented operation is neither key-required nor listed as replay-safe below.
 */

/**
 * Methods that HTTP does not define as idempotent.
 *
 * `GET`/`HEAD`/`OPTIONS` change nothing, and a repeated `PUT` or `DELETE` is defined to leave the
 * same state as the first one — requiring a key there would be ceremony the caller has to satisfy
 * for no protection. That is also the line the SDK draws when it decides whether a request may be
 * retried at all (`IDEMPOTENT_METHODS` in `packages/sdk/src/client.ts`), so the client already
 * sends a key for exactly these methods and no others.
 */
export const KEY_REQUIRED_METHODS: ReadonlySet<string> = new Set(['POST', 'PATCH']);

/** The header name, in the casing the API and the SDK agree on. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/**
 * How long a completed response stays replayable, and how long an in-flight claim is held before
 * it is assumed to belong to a request that died.
 */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
export const IN_FLIGHT_TTL_SECONDS = 30;

/**
 * A key is an opaque caller-chosen token. The bounds keep it from becoming an unbounded cache key,
 * and the character set keeps a key from carrying anything that would have to be escaped when it is
 * embedded in one.
 */
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

export interface ReplaySafeRoute {
  method: 'POST' | 'PATCH';
  /** Router-relative path, without the `/api` or `/api/v1` mount prefix. */
  path: string;
  /** Why a repeated call is harmless here. Read by reviewers, not by the code. */
  reason: string;
  /**
   * Set when the published OpenAPI document does not describe this path.
   *
   * Not a loophole: the test that reads this file requires an exemption to be *either* documented
   * in `packages/openapi.json` or accompanied by an explanation here, so an exemption can never be
   * added for a path nobody can point at without saying so in the diff.
   */
  notInPublishedContract?: string;
}

/**
 * The state-changing endpoints that are safe to call twice without a key.
 *
 * Each entry is a decision, so each carries the argument for it. Nothing here creates a durable
 * record from caller input or moves funds; everything else under a key-required method does.
 */
export const REPLAY_SAFE_ROUTES: readonly ReplaySafeRoute[] = [
  {
    method: 'POST',
    path: '/auth/challenge',
    reason:
      'Mints a fresh challenge for the caller to sign. Calling it twice invalidates nothing and ' +
      'grants nothing; the second challenge is simply the one that gets signed.',
  },
  {
    method: 'POST',
    path: '/auth/login',
    reason:
      'Exchanges a signed challenge for a token. The signature is single-use at the challenge ' +
      'level, so a repeated call either fails the challenge check or issues a second token for ' +
      'the same key — neither disburses anything.',
  },
  {
    method: 'POST',
    path: '/auth/logout',
    reason: 'Clearing a session twice leaves the same state as clearing it once.',
  },
  {
    method: 'POST',
    path: '/simulate',
    reason:
      'A simulation. It reads the current state and returns what a payment would do; it writes ' +
      'nothing, on-chain or off.',
    notInPublishedContract:
      'The published document calls this /simulate/payment, a path that has no route and whose ' +
      'annotation says /simulate. The two drifted because the spec could not be regenerated (see ' +
      '`scripts/dump-swagger.mjs`); correcting the document also means correcting the SDK, which ' +
      'calls the same phantom path, so it is tracked separately rather than half-fixed here.',
  },
  {
    method: 'POST',
    path: '/notifications/mark-read',
    reason:
      'Declares a set of notifications read. Applying the same declaration twice produces the ' +
      'same state, and the caller cannot be charged twice for it.',
  },
  {
    method: 'POST',
    path: '/notifications/mark-all-read',
    reason: 'As `mark-read`: the desired state is the whole state.',
  },
];

/**
 * Re-exported so the policy, its tests and the audit trail all name a route the same way.
 * See `utils/apiPath.ts` for why that matters.
 */
export { normaliseApiPath } from '../utils/apiPath.js';

/** The replay-safe entry covering this request, if there is one. */
export function findReplaySafeRoute(method: string, path: string): ReplaySafeRoute | undefined {
  const upperMethod = method.toUpperCase();
  const normalised = normaliseApiPath(path).replace(/\/$/, '');

  return REPLAY_SAFE_ROUTES.find(
    (route) => route.method === upperMethod && route.path === normalised,
  );
}

/**
 * Whether this request must carry an `Idempotency-Key`.
 *
 * Applied by the middleware, not by the route table, so a new endpoint is covered the moment it is
 * mounted rather than when somebody remembers to add a middleware to it.
 */
export function requiresIdempotencyKey(method: string, path: string): boolean {
  if (!KEY_REQUIRED_METHODS.has(method.toUpperCase())) return false;
  return findReplaySafeRoute(method, path) === undefined;
}

/** Whether a supplied key is usable, i.e. within the documented length and character set. */
export function isValidIdempotencyKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/**
 * The scope a replay is looked up under.
 *
 * Deliberately derived from the *presented* credential rather than from a decoded identity: this
 * middleware runs before the auth middleware, so nothing has verified the request yet, and reading
 * a claim out of an unverified token would let a caller choose which scope to look in. A digest of
 * the credential itself cannot be chosen without holding the credential. The token is hashed rather
 * than embedded so the cache key — which turns up in logs and in `KEYS` output — carries no secret.
 */
export function credentialScope(
  authorization: string | undefined,
  apiKey: string | undefined,
): string {
  const credential = authorization ?? apiKey;
  if (!credential) return 'anonymous';

  return `c:${createHash('sha256').update(credential).digest('hex').slice(0, 16)}`;
}

/**
 * The cache key for a request's outcome.
 *
 * Scoped by method and by the normalised route as well as by the caller: a key is only guaranteed
 * unique within the operation that minted it, and two different endpoints reusing one string must
 * not read each other's responses.
 */
export function idempotencyCacheKey(params: {
  method: string;
  path: string;
  scope: string;
  key: string;
}): string {
  const route = normaliseApiPath(params.path).replace(/\/$/, '');
  return `idemp:${params.method.toUpperCase()}:${route}:${params.scope}:${params.key}`;
}

/** The key that records a request in flight, checked before the work is done. */
export function inFlightLockKey(cacheKey: string): string {
  return `${cacheKey}:inflight`;
}
