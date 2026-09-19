# API Idempotency

Every request that can change state must carry an `Idempotency-Key`. The API
deduplicates on it, so a request that is sent twice is executed once and the
second send is answered with the first one's response.

This is enforced by the API rather than offered to it. Before, the key was
opt-in: a middleware deduplicated *if* a caller happened to send one, so the
protection held only for clients that already knew about it. A double-click in
the UI, a proxy retry, or a script that retries on timeout would each disburse
twice.

## Which requests need a key

| Method | Key required? |
|---|---|
| `POST` | Yes, unless the operation is on the replay-safe list below |
| `PATCH` | Yes, for the same reason |
| `PUT` | No — RFC 9110 defines a repeated `PUT` as leaving the state the first one left |
| `DELETE` | No, for the same reason |
| `GET`, `HEAD`, `OPTIONS` | No — nothing changes |

The decision is made in
[`backend/src/middleware/idempotencyPolicy.ts`](../../backend/src/middleware/idempotencyPolicy.ts)
and applied by
[`backend/src/middleware/idempotency.ts`](../../backend/src/middleware/idempotency.ts),
which is mounted once on the API surface in `backend/src/app.ts` rather than
route by route. A new endpoint is therefore covered the moment it is reachable,
instead of when somebody remembers to annotate it.

### Replay-safe operations

These are the exceptions, and each one is a decision with a written reason:

| Operation | Why a repeat is harmless |
|---|---|
| `POST /auth/challenge` | Mints a fresh challenge; calling it twice grants nothing, the second challenge is simply the one that gets signed |
| `POST /auth/login` | Exchanges a signed challenge for a token; the signature is single-use at the challenge level, so a repeat cannot disburse |
| `POST /auth/logout` | Clearing a session twice leaves the same state as clearing it once |
| `POST /simulate/payment` | Reads current state and reports what a payment *would* do; it writes nothing |
| `POST /notifications/mark-read` | Declares a set of notifications read; the desired state is the state |
| `POST /notifications/mark-all-read` | As above |

Nothing that creates a durable record from caller input or moves funds appears
on this list, and a test asserts that it never does.

## Sending a key

```
Idempotency-Key: 8f14e45f-ea1b-4a3e-9b7a-8f0d2c1a4b6e
```

The value must be 8–200 characters from `A-Z a-z 0-9 . _ : -`. An opaque
identifier such as a UUID is what it is for; do not send a natural key (a loan
id, an amount, a timestamp), because the guarantee is "one key means one
operation" and a reused natural key makes distinct operations collide.

Mint **one key per logical operation** and reuse that same value for every
attempt at that operation. Two attempts under one key are one operation to the
API; two attempts under different keys are two.

### Errors

| Code | Status | Meaning |
|---|---|---|
| `MISSING_IDEMPOTENCY_KEY` | 400 | The endpoint changes state and the header was absent. `field` is `Idempotency-Key` |
| `INVALID_IDEMPOTENCY_KEY` | 400 | The header was present but not a usable token |
| `DUPLICATE_REQUEST` | 409 | A request with this key is in flight right now |

## Response headers

| Header | Values | Meaning |
|---|---|---|
| `X-Idempotency-Cache` | `HIT` | The response was served from the idempotency cache |
| `X-Idempotent-Replayed` | `true` / `false` | `true` = a cached replay; `false` = this request did the work |

`X-Idempotent-Replayed` is always set on a request that carried a key, so a
client can branch on one header:

```ts
const replayed = response.headers.get("X-Idempotent-Replayed") === "true";
if (!replayed) {
  showSuccessToast("Repayment submitted"); // this call did the work
} else {
  // a retry of the same operation — the work was already done
}
```

## Two windows, because a retry and a double-click are different

A **replay** — the same key arriving after the first request finished — is
answered from the cached response. The work is not done again.

A request that arrives while the first is **still running** is refused with 409
`DUPLICATE_REQUEST`. This is the window a cache alone cannot cover: a
double-click does not wait for the first response before sending the second, so
both requests miss the cache and both would run. The first request claims the
key before doing any work and releases the claim after its response is recorded.

A well-behaved client that receives `DUPLICATE_REQUEST` waits briefly and sends
the same key again; by then the first request has finished, so the retry is
answered from the cache with the original outcome. The frontend's `apiFetch`
does exactly this (`frontend/src/app/hooks/useApi.ts`), and the SDK generates a
key per operation when `autoIdempotencyKey` is on (the default) so its internal
retries reuse one.

## How a key is scoped

The cache key is `method → route → caller → key`. Each part is there for a
reason:

- **Route and method** — a key is only unique within the operation that minted
  it, so two endpoints cannot read each other's responses if a client reuses one
  string.
- **Caller** — a key is scoped to a digest of the presented credential
  (`Authorization`, else `X-API-Key`), not to a decoded identity. This middleware
  runs before authentication, so nothing has been verified yet and a claim read
  out of an unverified token would let a caller choose which scope to look in.
  The credential is hashed rather than embedded because cache keys turn up in
  logs and in `KEYS` output; a digest cannot be reversed into the token, and it
  cannot be chosen without holding the credential.

A consequence worth knowing: because the scope is the presented credential, a
token refresh mid-operation is a different scope, and the retry is a new
operation.

## Cache behaviour

- Only `2xx` and `4xx` responses are recorded. A `5xx` is never cached, so a
  retry can succeed where the first attempt failed.
- A recorded outcome is replayable for **24 hours**.
- An in-flight claim is held for 30 seconds. If a request dies without
  responding, the claim expires and a retry is allowed through rather than
  being refused forever.
- If the cache is unreachable the request proceeds without deduplication. A
  cache is an optimisation, and a cache outage must not turn a working write
  into a failure — the trade-off is that during an outage the deduplication
  guarantee is not available.
- A `POST` to a path under `/api` or `/user` that matches **no** route is
  refused with `MISSING_IDEMPOTENCY_KEY` before reaching the 404 handler. This
  is the deliberate cost of defaulting to "require a key": an unclassified
  endpoint is protected rather than open.

## Where this is tested

| Test | What it pins |
|---|---|
| `backend/src/tests/idempotency.test.ts` | The middleware: refusal without a key, key validation, replay, scoping, the in-flight refusal, cache-failure behaviour |
| `backend/src/__tests__/idempotencyCoverage.test.ts` | Every mutating operation in the published OpenAPI document is refused without a key, on both the `/api` and `/api/v1` mounts, and every allowlist exemption is real and reasoned |
| `backend/src/__tests__/remittanceIdempotency.test.ts` | Through the app: a replayed key creates exactly one remittance, and a missing key creates none |
| `frontend/src/app/hooks/useApi.idempotencyKey.test.tsx` | The client sends a key, reuses it for an overlapping repeat, and replays a `DUPLICATE_REQUEST` instead of surfacing an error |
| `packages/sdk/src/__tests__/client.test.ts` | The SDK retries a `POST` only while it carries one key |

## Out of scope

- Changing the cache backend or the TTL.
- Replaying side effects. The cache stores and replays the HTTP response only;
  the underlying transaction is not re-executed.
- Deduplicating across two different credentials.
