/**
 * The bounded domains every Prometheus label in this service draws from.
 *
 * Each distinct label value is a separate time series, and Prometheus keeps them all in memory. A
 * label carrying a loan id, a Stellar public key or a raw request path therefore grows without
 * bound as traffic arrives — the failure mode is the metrics backend falling over under load, which
 * is exactly when the metrics are needed.
 *
 * Three of the four labels on the HTTP metrics come straight off the request and are bounded only
 * once something says so: `method` and `route` by the routing table, `status_code` by the handler.
 * This module is where that is stated, and `metrics.ts` calls the normalisers below so the *values*
 * are bounded, not just the intent. `__tests__/metricsCardinality.test.ts` asserts the same domains
 * against the live registry, so a new metric with a new label fails CI until it is declared here.
 */

/** The methods Node's HTTP parser accepts. Anything else is not a method we can observe. */
export const HTTP_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'TRACE',
  'CONNECT',
]);

export const STATUS_CLASSES: ReadonlySet<string> = new Set(['1xx', '2xx', '3xx', '4xx', '5xx']);

/**
 * The exact status codes this API can produce, deliberately narrower than 100–599.
 *
 * The counter keeps exact codes rather than classes so a spike in 401s or 429s stays alertable.
 * Enumerating the codes it may emit — rather than accepting whatever `res.statusCode` holds — is
 * what keeps that from being an open set: five hundred possible codes across every route and method
 * is not bounded enough to be safe, and none of the codes left out are ones a handler here returns.
 */
export const KNOWN_STATUS_CODES: ReadonlySet<string> = new Set([
  '200',
  '201',
  '202',
  '204',
  '301',
  '302',
  '304',
  '400',
  '401',
  '403',
  '404',
  '405',
  '406',
  '408',
  '409',
  '410',
  '413',
  '415',
  '422',
  '429',
  '500',
  '501',
  '502',
  '503',
  '504',
]);

/**
 * Used in place of a value outside its declared domain.
 *
 * A separate series named `other` is itself bounded, and visible: if it appears, something is
 * emitting a value this module does not know about, which is worth seeing on a dashboard rather
 * than hiding by dropping the observation.
 */
export const OTHER = 'other';

/** The label value for a request that did not reach a route, so its real path is unknown. */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * Segment shapes that identify a single resource.
 *
 * Matched against one path segment at a time: `123` is a loan id, a 56-character base32 string is a
 * Stellar account, a 64-character hex string is a transaction hash, and a UUID is a UUID. Ordinary
 * path words (`loans`, `remittances`) and Express parameters (`:loanId`) are untouched, which is
 * what keeps the label useful for grouping.
 */
const IDENTIFIER_LIKE: readonly RegExp[] = [
  /^\d+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{16,}$/i,
  /^[0-9A-Za-z]{40,}$/,
];

function looksLikeIdentifier(segment: string): boolean {
  return IDENTIFIER_LIKE.some((pattern) => pattern.test(segment));
}

/**
 * Reduce a route label to its template, replacing anything resource-shaped with `:param`.
 *
 * `req.route.path` already gives a template, so on the normal path this is a no-op. It earns its
 * keep in two cases: `req.baseUrl` is the *matched* mount prefix, which contains substituted values
 * when a router is mounted under a parameterised path, and a request that never matched a route has
 * no template at all. The caller passes the raw path in that case, and the raw path is
 * attacker-controlled — an unmatched `/wp-admin/<random>` per request would otherwise mint a series
 * per request.
 */
export function normaliseRouteLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed === '' || trimmed === UNMATCHED_ROUTE) return UNMATCHED_ROUTE;

  const normalised = trimmed
    .split('/')
    .map((segment, index) => {
      // `index === 0` is the empty string before a leading slash.
      if (index === 0 || segment === '' || segment.startsWith(':')) return segment;
      return looksLikeIdentifier(segment) ? ':param' : segment;
    })
    .join('/');

  return normalised === '' ? UNMATCHED_ROUTE : normalised;
}

/**
 * Whether a label is a template that cannot grow with traffic: no segment may be resource-shaped.
 *
 * Assertion helper rather than a runtime filter — `normaliseRouteLabel` is what enforces it, and
 * this is what lets a test state the property directly.
 */
export function isTemplateRouteLabel(label: string): boolean {
  if (label === UNMATCHED_ROUTE) return true;
  if (!label.startsWith('/')) return false;

  return label.split('/').every((segment, index) => {
    if (index === 0 || segment === '') return true;
    if (segment.startsWith(':')) return true;
    return !looksLikeIdentifier(segment);
  });
}

/** Constrain an HTTP method to the parser's vocabulary. */
export function normaliseMethod(method: string): string {
  return HTTP_METHODS.has(method) ? method : OTHER;
}

/** Constrain a status code to the declared set. */
export function normaliseStatusCode(statusCode: number): string {
  const code = String(statusCode);
  return KNOWN_STATUS_CODES.has(code) ? code : OTHER;
}

/** The status class for a code, or `other` when the code is outside HTTP's 1xx–5xx range. */
export function statusClassFor(statusCode: number): string {
  const statusClass = `${Math.floor(statusCode / 100)}xx`;
  return STATUS_CLASSES.has(statusClass) ? statusClass : OTHER;
}

/**
 * The declared label domains, by metric name and then by label name.
 *
 * A validator rather than a list, because the property that matters is not which labels exist but
 * which values they may hold — and only a predicate can express "a route template, never a raw
 * path". The audit in `__tests__/metricsCardinality.test.ts` walks the live registry and requires
 * an entry here for every label on every metric, so a new label fails CI until it is declared.
 *
 * `le` is added by prom-client to every histogram bucket rather than by this service: it holds the
 * configured bucket upper bound, so it is finite by construction and accepts any value.
 */
/**
 * The V8 heap spaces. Fixed by V8 rather than by traffic, so each of these is one series per process.
 */
const V8_HEAP_SPACES: ReadonlySet<string> = new Set([
  'read_only',
  'new',
  'old',
  'code',
  'shared',
  'trusted',
  'new_large_object',
  'large_object',
  'code_large_object',
  'shared_large_object',
  'trusted_large_object',
]);

/** The GC kinds prom-client reports, from its own enum. */
const GC_KINDS: ReadonlySet<string> = new Set(['minor', 'major', 'incremental', 'weakcb']);

/**
 * Node's active handle, request and resource class names — `Timeout`, `TCPSocketWrap` and so on.
 *
 * Asserted as a class name rather than against a fixed list on purpose: the enumeration belongs to
 * the runtime and changes between Node versions, so an allowlist here would fail a test on an
 * upgrade for no security or capacity reason. What the predicate does rule out is instance data
 * appearing in the label — a socket address, an id, a path — which is what would actually be
 * unbounded.
 */
const NODE_RESOURCE_CLASS = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** One value per running process, so bounded by construction. */
const RUNTIME_VERSION = /^(v?\d+(\.\d+){0,3}|\d+)$/;

export const LABEL_VALIDATORS: Readonly<
  Record<string, Readonly<Record<string, (value: string) => boolean>>>
> = {
  // This service's own metrics.
  http_request_duration_seconds: {
    method: (value) => HTTP_METHODS.has(value) || value === OTHER,
    route: isTemplateRouteLabel,
    status_class: (value) => STATUS_CLASSES.has(value) || value === OTHER,
    le: () => true,
  },
  http_requests_total: {
    method: (value) => HTTP_METHODS.has(value) || value === OTHER,
    route: isTemplateRouteLabel,
    status_code: (value) => KNOWN_STATUS_CODES.has(value) || value === OTHER,
  },

  // Framework metrics, from prom-client's `collectDefaultMetrics`. Listed here rather than excluded
  // from the audit so that a label added to one of them — by an upgrade or by passing options — is
  // a failing test rather than a silent change to the label space.
  nodejs_active_handles: { type: (value) => NODE_RESOURCE_CLASS.test(value) },
  nodejs_active_requests: { type: (value) => NODE_RESOURCE_CLASS.test(value) },
  nodejs_active_resources: { type: (value) => NODE_RESOURCE_CLASS.test(value) },
  nodejs_gc_duration_seconds: {
    kind: (value) => GC_KINDS.has(value),
    le: () => true,
  },
  nodejs_heap_space_size_total_bytes: { space: (value) => V8_HEAP_SPACES.has(value) },
  nodejs_heap_space_size_used_bytes: { space: (value) => V8_HEAP_SPACES.has(value) },
  nodejs_heap_space_size_available_bytes: { space: (value) => V8_HEAP_SPACES.has(value) },
  nodejs_version_info: {
    version: (value) => RUNTIME_VERSION.test(value),
    major: (value) => RUNTIME_VERSION.test(value),
    minor: (value) => RUNTIME_VERSION.test(value),
    patch: (value) => RUNTIME_VERSION.test(value),
  },
};
