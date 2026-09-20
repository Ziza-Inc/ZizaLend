/**
 * The redaction boundary for anything on its way to a log sink.
 *
 * Why this is a module rather than a logger detail
 * ------------------------------------------------
 * Two writers of durable, low-scrutiny text exist in this service — the logger and the
 * `audit_logs` table — and both were carrying their own idea of what a secret looks like. Two
 * lists drift, and the one that drifts is the one nobody is looking at. Both now call
 * `redactForLogging`, so a field added here is covered in the audit trail as well.
 *
 * Why values are inspected and not only field names
 * -------------------------------------------------
 * Matching on field names alone misses the shapes credentials actually arrive in: a signed
 * transaction XDR is a *substring* of a log message, a token is in a query string, a database
 * password is inside a connection string, and a Stellar secret key is a bare value with no field
 * name at all. `logger.info('fetch failed', { url })` with `url` holding a live token was not
 * covered by a name-based pass, and that is the same class of leak this exists to stop.
 *
 * The two passes are complementary, not alternatives: names catch a secret under a name this
 * list does not recognise by value (an opaque high-entropy string), and values catch a secret
 * whose field name gives nothing away.
 */

/** The marker a redacted value is replaced with. Stable, because tests and readers match on it. */
export const REDACTED = '[REDACTED]';

/** How deep to walk before giving up and truncating. */
const MAX_REDACT_DEPTH = 6;

/**
 * Field names whose values are never written, whatever they hold.
 *
 * The list is deliberately broad. Over-redacting a log line costs a debugging session; under-
 * redacting a credential costs a rotation and possibly a breach, and the asymmetry is what the
 * pattern is tuned for.
 *
 * | Name | Why |
 * |---|---|
 * | `password`, `passwd` | Obvious, and also appears inside DSNs |
 * | `secret`, `seed`, `mnemonic`, `seedPhrase` | Stellar secret seeds, webhook signing secrets, JWT secrets |
 * | `token`, `accessToken`, `refreshToken` | Bearer tokens and OAuth refresh tokens |
 * | `authorization`, `cookie`, `set-cookie` | Whole header values |
 * | `apiKey`, `x-api-key`, `xApiKey` | Internal API keys, which are scoped and long-lived |
 * | `privateKey`, `publicKey` | Wallet key material; the public key is redacted too, because a
 *   public key is a persistent identifier for a person and belongs in the audit trail, not in
 *   the application log |
 * | `signature` | Signed payloads are single-use, but a replayed one is still a replay |
 * | `signedTx`, `xdr` | A signed transaction envelope can be submitted by anyone holding it |
 */
export const SENSITIVE_FIELD_PATTERN =
  /(password|passwd|secret|token|authorization|cookie|api[-_]?key|apikey|private[-_]?key|public[-_]?key|mnemonic|seed[-_]?phrase|seed|signature|signedtx|xdr)/i;

/**
 * The shortest string that can still hold a credential this service issues.
 *
 * A Stellar secret seed is 56 characters, a JWT is longer than that, a scoped API key is longer
 * than a UUID, and a DSN with a password in it is longer again — so a string under eight
 * characters cannot contain one of them, and skipping it avoids running these patterns over every
 * `key=1` sort parameter on every request.
 */
const MIN_REDACTABLE_LENGTH = 8;

/**
 * Replacements applied to every string that reaches the log, in order.
 *
 * The order is load-bearing, and getting it wrong leaks rather than merely tidies:
 *
 * 1. `"field": "value"` first, because a serialised object is the commonest shape and the whole
 *    quoted value should go in one replacement.
 * 2. Query strings before the named-credential rule. A URL is worse handled the other way round:
 *    `?api_key=x&limit=10` matched by the named rule consumed the rest of the query, and a log
 *    line that quietly drops parameters is a log line that lies about the request.
 * 3. The named rule absorbs an optional `Bearer ` prefix, so `authorization: Bearer <token>` is
 *    replaced once and not as a scheme plus an orphaned remainder.
 * 4. A bare `Bearer <token>` last, for a token with no field name in front of it.
 */
const VALUE_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string; describe: string }> = [
  {
    // `"refreshToken": "…"` and `'x-api-key': '…'`, i.e. a credential inside a serialised blob —
    // which is what `JSON.stringify(headers)` produces.
    pattern:
      /("(?:[a-z0-9_-]*(?:password|passwd|secret|token|authorization|cookie|api[-_]?key|apikey|private[-_]?key|mnemonic|seed|signature|xdr)[a-z0-9_-]*)"\s*:\s*")([^"]*)(")/gi,
    replacement: `$1${REDACTED}$3`,
    describe: 'a credential quoted inside a serialised object',
  },
  {
    // Query strings: `?api_key=…&token=…`. The only place a credential travels with a field name
    // the name-based pass never sees, because the whole URL arrives as one string.
    pattern:
      /([?&;])((?:api[-_]?key|apiKey|key|access[-_]?token|token|secret|password|passwd|signature|code)=)([^&\s"'<>#]+)/gi,
    replacement: `$1$2${REDACTED}`,
    describe: 'a credential in a query string',
  },
  {
    // `authorization: Bearer …`, `x-api-key=…`, `signedTxXdr: …` in plain text. The value stops at
    // a query separator so this cannot swallow the parameters that follow a URL.
    pattern:
      /\b((?:proxy-)?authorization|(?:x-)?api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|x-amz-signature|signed[-_]?tx[-_]?xdr|xdr|secret|password|passwd)\b(\s*[:=]\s*)((?:bearer\s+)?[^\s,;"'}{&?]+)/gi,
    replacement: `$1$2${REDACTED}`,
    describe: 'a named credential header or parameter',
  },
  {
    // A bare `Bearer …`, i.e. a token with no field name in front of it.
    pattern: /\b(bearer)\s+[A-Za-z0-9\-._~+/]{6,}=*/gi,
    replacement: `$1 ${REDACTED}`,
    describe: 'a bearer token',
  },
  {
    // Connection strings: `postgres://user:password@host/db`. The password is the only part
    // removed; user and host stay, because they are what makes the line useful.
    pattern: /(\/\/[^:/@\s]+:)([^@/\s]+)(@)/g,
    replacement: `$1${REDACTED}$3`,
    describe: 'a password inside a connection string',
  },
  {
    // A Stellar secret seed: `S` followed by 55 base32 characters. Nothing else in this system
    // has this shape, and it has no field name when it appears inside a message.
    pattern: /\bS[A-Z2-7]{55}\b/g,
    replacement: REDACTED,
    describe: 'a Stellar secret key',
  },
  {
    // A JWT, unsigned segment included: three base64url segments beginning with the `{"` header.
    pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
    replacement: REDACTED,
    describe: 'a JWT',
  },
];

/**
 * Scrub credentials that appear inside a string.
 *
 * Exported because the audit middleware and the logger both need it, and because a test asserting
 * "this token is not in the output" is easier to read against one function.
 */
export function redactString(text: string): string {
  if (typeof text !== 'string' || text.length < MIN_REDACTABLE_LENGTH) return text;

  let result = text;
  for (const { pattern, replacement } of VALUE_PATTERNS) {
    // Each pattern is global and stateless (`lastIndex` is not retained across `replace` calls),
    // so the same compiled regex can be reused for every log line.
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Escape a string so it cannot forge or rewrite a log entry.
 *
 * Messages are routinely assembled out of request data — a dispute resolution note, a loan
 * rejection reason, a notification title rendered from a user's profile. Rendered raw into a
 * line-oriented log, a `\n` in that data starts a *new* log line that a reader cannot tell apart
 * from one the service wrote, which is how log entries get forged and how an injected terminal
 * escape sequence rewrites whatever displays the log.
 *
 * Escaping rather than deleting is deliberate: `\n` in the output says the caller sent a line
 * break, where silently dropping it would leave a log line that lies about its input.
 *
 * `JSON.stringify` is the escaper because a JSON string body already has the right semantics for
 * one log line — line breaks, other control characters, quotes and backslashes all become their
 * escape sequences. The surrounding quotes are trimmed back off so an ordinary message still
 * reads as an ordinary message (`'Loan approved'` stays `Loan approved`).
 */
export function escapeLogText(text: string): string {
  // No early return for the trivial case: `JSON.stringify('')` is `'""'`, so trimming the quotes
  // already yields the empty string, and a branch that handed the raw argument back would leave a
  // path through this function that is not escaped at all.
  return JSON.stringify(text).slice(1, -1);
}

/**
 * Walk a value and replace anything sensitive.
 *
 * Objects are copied rather than mutated: the same `req` can be passed to a logger and then
 * handed to business logic, and a redaction pass that edited it in place would corrupt the
 * request as a side effect of logging it.
 *
 * `seen` guards against cyclic request graphs (`req.app`, `req.res.req`), which are normal in
 * Express and would otherwise recurse until the stack runs out.
 */
export function redactValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (depth > MAX_REDACT_DEPTH) return '[Truncated]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, seen));
  }

  if (value instanceof Error) {
    // `message` and `stack` are strings an exception may have built out of a URL or a header, so
    // they go through the value pass rather than being copied verbatim.
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  if (value instanceof Date) return value;

  // Built with `Object.fromEntries` rather than by assigning into a fresh object.
  //
  // The keys come from the value being redacted, and nothing stops a request body from carrying a
  // `__proto__` key. `result['__proto__'] = {...}` does not create a key: it invokes the setter
  // inherited from `Object.prototype` and sets the *prototype* of the copy, so a caller would be
  // choosing what the object that gets logged inherits from. `Object.fromEntries` defines own
  // data properties instead, which leaves `__proto__` as an ordinary key and leaves the shape of
  // the copy under this module's control.
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]): [string, unknown] => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key) ? REDACTED : redactValue(nested, depth + 1, seen),
    ]),
  );
}

/**
 * The entry point: given anything, return something safe to persist.
 *
 * Both the logger and the audit trail call this, and nothing else should be doing its own
 * redaction — a third implementation is a third list to keep current.
 */
export function redactForLogging(value: unknown): unknown {
  return redactValue(value);
}

/**
 * Whether a field name is one this module redacts.
 *
 * Exposed so the audit trail's tests can assert that the two writers agree on the list instead of
 * re-deriving it.
 */
export function isSensitiveField(name: string): boolean {
  return SENSITIVE_FIELD_PATTERN.test(name);
}

/** The value patterns, for documentation and for the test that keeps them from being removed. */
export const REDACTION_DESCRIPTIONS: readonly string[] = VALUE_PATTERNS.map((p) => p.describe);
