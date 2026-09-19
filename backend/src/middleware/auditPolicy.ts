import { normaliseApiPath } from '../utils/apiPath.js';

/**
 * What counts as a privileged action, and what it is called in the audit trail.
 *
 * The property that matters for an audit trail is completeness, not volume. An entry for a read
 * that changed nothing buries the entries that matter, and a *missing* entry is worse than noise:
 * it reads as the absence of an action, so an operator investigating an incident concludes nothing
 * happened. That is why the middleware this policy drives is mounted on the routers rather than on
 * individual routes — a privileged action added tomorrow, by someone who has not read this file,
 * is audited because the router is.
 */

/**
 * Methods that can change something.
 *
 * `GET`/`HEAD`/`OPTIONS` cannot, and are not recorded: an audit trail of reads is a log, and this
 * table is queried by an operator asking "who changed this?".
 */
export const AUDITED_METHODS: ReadonlySet<string> = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Whether a request on this method can be a privileged action. */
export function isAuditedMethod(method: string): boolean {
  return AUDITED_METHODS.has(method.toUpperCase());
}

/**
 * The name an action is recorded under.
 *
 * `/api/v1` and `/api` are the same endpoint, so both must produce the same name or an audit
 * search silently misses half the history. `baseUrl` is included because the routers are mounted
 * with different prefixes — `POST /webhooks` is ambiguous between the admin and indexer surfaces,
 * and the whole point of the record is to be unambiguous.
 */
export function auditActionName(
  method: string,
  baseUrl: string,
  route: string | string[] | undefined,
): string {
  // Express exposes a matched route's *pattern* on `req.route.path` — `/:disputeId/resolve`
  // rather than `/7/resolve`. The pattern is what this records, because `action` is the column an
  // operator filters on: a concrete path would make every dispute a different action, so searching
  // for "who resolved disputes" would return nothing. The identity of the thing acted on is not
  // lost — it belongs in `target`, one column over.
  //
  // `req.route` is set by the route layer before any of its own middleware runs, so a request
  // refused by authentication still records the pattern of the route it was aiming at. A path that
  // matched no route falls back to what was asked for, which is the only thing known about it.
  const routePath = Array.isArray(route) ? route[0] : route;
  const named = normaliseApiPath(`${baseUrl ?? ''}${routePath ?? ''}`);

  return `${method.toUpperCase()} ${named}`;
}

/**
 * Recover a route's parameters from its pattern and the path that was requested.
 *
 * Needed because Express restores `req.params` — along with `req.url` and `req.baseUrl` — when a
 * router finishes unwinding, and an error that is handled at the application level unwinds the
 * router first. Reading `req.params` in the audit write therefore worked for a request that
 * succeeded and was empty for a request that was refused, so the rows that most needed a target
 * were the ones without a name to it.
 *
 * The pattern and the trimmed path line up segment for segment, so the values can be read back:
 * `/disputes/7/resolve` against `/disputes/:disputeId/resolve` gives `{ disputeId: '7' }`.
 */
export function routeParamsFrom(
  route: string | string[] | undefined,
  path: string,
): Record<string, string> {
  const pattern = Array.isArray(route) ? route[0] : route;
  if (!pattern) return {};

  const patternSegments = pattern.split('/').filter((segment) => segment.length > 0);
  const pathSegments = path.split('/').filter((segment) => segment.length > 0);

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const segment = patternSegments[index] as string;
    if (!segment.startsWith(':')) continue;

    const value = pathSegments[index];
    if (value !== undefined) {
      // Express writes a parameter's name as `:name`, optionally suffixed (`:id(\\d+)`) or
      // suffixed with `?`. The name is the leading identifier.
      const name = /^:([A-Za-z0-9_]+)/.exec(segment)?.[1];
      if (name) params[name] = decodeURIComponent(value);
    }
  }

  return params;
}

/**
 * Where the error handler puts the reason a request failed, for the audit trail to pick up.
 *
 * A `res.locals` convention rather than the audit middleware inspecting the response body: the
 * body is a wire format that can change, whereas this is an explicit hand-off between the two
 * middlewares, and the error handler is the point at which the reason is known.
 */
export const AUDIT_REASON_LOCAL = 'auditErrorReason';

/** Record the reason for a failure, as the error handler sees it. */
export function setAuditFailureReason(
  locals: Record<string, unknown>,
  errorCode: string,
  message: string,
): void {
  locals[AUDIT_REASON_LOCAL] = `${errorCode}: ${message}`;
}

/**
 * The reason to record for a finished request.
 *
 * `null` on success: an outcome with no reason is a success, and inventing "ok" for it would put a
 * value in the column that nobody can filter on meaningfully.
 */
export function auditReasonFor(
  res: { statusCode: number; locals?: Record<string, unknown> },
  finished: boolean,
): string | null {
  if (!finished) {
    // The request never produced a response. Recording this is the point of the issue: an action
    // that failed partway must still appear, and a client that hung up mid-action is exactly the
    // case an operator needs to see.
    return 'CLIENT_DISCONNECTED: the connection closed before a response was sent';
  }

  const reason = res.locals?.[AUDIT_REASON_LOCAL];
  if (typeof reason === 'string' && reason.length > 0) return reason;

  if (res.statusCode >= 400) {
    // A 4xx/5xx written without going through the error handler (an early `res.status(403)` in a
    // middleware, say). The status is still recorded; there is simply no reason text for it.
    return 'UNRECORDED_REASON: no reason was reported for this failure';
  }

  return null;
}
