/**
 * How a route is named in this service.
 *
 * Two features need to talk about "the same route" in a way that survives the API being mounted
 * twice — once at `/api` for backward compatibility and once at `/api/v1`. The idempotency policy
 * keys replays on it, and the audit trail records privileged actions by it. If the two derived the
 * name differently, an audit search for an action would miss the requests that arrived on the
 * other mount, which is the silent kind of gap that makes an audit trail worse than none.
 */

/** The mounts the same routers are reachable at, longest first so the prefix match is exact. */
export const API_PREFIXES = ['/api/v1', '/api'] as const;

/**
 * Strip the version prefix and any query string, so a route is written once.
 *
 * Works whether or not the caller already had the prefix removed by an Express mount, because
 * `req.url` is rewritten inside a mounted layer while `req.originalUrl` is not.
 */
export function normaliseApiPath(path: string): string {
  const withoutQuery = path.split('?')[0] ?? path;

  for (const prefix of API_PREFIXES) {
    if (withoutQuery === prefix) return '/';
    if (withoutQuery.startsWith(`${prefix}/`)) return withoutQuery.slice(prefix.length);
  }

  return withoutQuery;
}
