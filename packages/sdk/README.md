# ZizaLend TypeScript SDK

Typed API client for the ZizaLend decentralized lending protocol. Provides full TypeScript coverage for all 50+ API endpoints with built-in auth, retry logic, and error handling.

## Installation

**These packages are not published to a registry.** The command that used to be
here — `npm install @zizalend/sdk @zizalend/types` — returns a 404: neither
package exists on npm, and no workflow in this repository publishes one.
`packages/sdk/package.json` also depends on `@zizalend/types` as `"*"`, a
specifier that only resolves inside the npm workspace, so even a git install
would not resolve the dependency. The full policy, including what has to happen
before the first publish, is in [docs/VERSIONING.md](../../docs/VERSIONING.md).

### From a clone (the supported path)

```bash
git clone https://github.com/Ziza-Inc/ZizaLend.git
cd ZizaLend
npm install                                              # installs both workspaces
npm run build --workspace packages/types --workspace packages/sdk
```

Order matters on a cold clone: `@zizalend/types` is generated from
[`packages/openapi.json`](../openapi.json), and this package is compiled against
that generated output, so `types` builds first. The root `npm run build` takes
care of it.

Inside the repository the workspace resolves the import, so no path alias is
needed:

```ts
import { Zizalend } from "@zizalend/sdk";
```

### From outside the repository

Not supported yet. There is no registry entry to install from, and a git
dependency would not resolve `@zizalend/types: "*"`. Track
[docs/VERSIONING.md](../../docs/VERSIONING.md) for the release workflow that
changes this.

## Quick Start

```ts
import { Zizalend } from "@zizalend/sdk";

const api = new Zizalend({
  baseUrl: "http://localhost:3001/api/v1",
  timeoutMs: 30000,
});

// Authenticate with a Stellar wallet
const { token } = await api.auth.authenticate(publicKey, signTransaction);

// Fetch borrower loans
const loans = await api.loans.list({ status: "active" });

// Get pool stats
const stats = await api.pool.getStats();
```

## Configuration

```ts
interface ClientConfig {
  /** Base URL for the API (e.g. http://localhost:3001/api/v1) */
  baseUrl: string;
  /** JWT token — set after login or from persisted session */
  token?: string;
  /** API key for server-to-server admin endpoints */
  apiKey?: string;
  /** Request timeout in milliseconds, applied to each attempt (default: 60000) */
  timeoutMs?: number;
  /** Maximum retries for transient errors (default: 3) */
  maxRetries?: number;
  /**
   * Wall-clock budget in milliseconds for one logical request, covering every attempt and
   * every backoff wait between them. Without it, the worst case is
   * `timeoutMs * (maxRetries + 1)` plus backoff. See "Bounding total latency".
   */
  totalTimeoutMs?: number;
  /** Upper bound in milliseconds on any single backoff wait (default: 30000) */
  maxRetryDelayMs?: number;
}
```

### Authentication Modes

| Mode                 | Use Case                        | Config                       |
| -------------------- | ------------------------------- | ---------------------------- |
| **JWT (Browser)**    | User-facing apps                | `setToken()` after login     |
| **API Key (Server)** | Admin automation, webhooks      | Pass `apiKey` in constructor |
| **Unauthenticated**  | Health checks, public endpoints | No token or key needed       |

## API Modules

### Auth

```ts
// Challenge-response login with Stellar wallet
const { token } = await api.auth.authenticate(publicKey, signTransaction);

// Verify session (asks the server, so this is the authoritative answer)
const session = await api.auth.verify();

// Logout (adds JWT to server-side revocation list)
await api.auth.logout();
```

#### Session validity

`isAuthenticated()` answers whether the token the client holds is still _usable_, not merely
whether one is set. It reads the token's `exp` claim and treats a token within a 30-second
skew margin of expiry as expired, so a restored session whose token has lapsed does not render
a signed-in surface that fails every request with a 401.

```ts
api.auth.hasToken(); // is a token set at all?
api.auth.isAuthenticated(); // is it still usable?
api.auth.getTokenExpiresAt(); // when does it lapse, or null if that cannot be read
```

A token whose expiry cannot be read locally — not a JWT, or no `exp` claim — reports `true`
from `isAuthenticated()` when one is set: the client cannot prove it expired, and guessing the
other way would sign out callers whose server issues opaque tokens. For those, and whenever the
answer has to be certain, use `await api.auth.verify()`.

`readTokenExpiryMs(token)` is exported for code that needs the raw claim.

### Loans

```ts
// List borrower loans with filters
const { loans, pagination } = await api.loans.list({
  status: "active",
  page: 1,
  limit: 20,
});

// Get loan details
const loan = await api.loans.get(loanId);

// Get loan events (timeline)
const events = await api.loans.getEvents(loanId, { page: 1, limit: 50 });

// Get amortization schedule
const schedule = await api.loans.getAmortizationSchedule(loanId);

// Build unsigned loan request transaction
const { unsignedTxXdr } = await api.loans.buildLoanRequestTx({
  borrowerPublicKey,
  amount: 1000,
});

// Build repayment transaction
const { unsignedTxXdr } = await api.loans.buildRepayTx({
  loanId: 42,
  amount: 500,
});

// Build refinance transaction
const { unsignedTxXdr } = await api.loans.buildRefinanceTx({
  loanId: 42,
  newAmount: 800,
  newTerm: 90,
});

// Build extend transaction
const { unsignedTxXdr } = await api.loans.buildExtendTx({
  loanId: 42,
  extraLedgers: 4320,
});

// Submit signed transaction
const result = await api.loans.submitSignAndSubmit({
  unsignedTxXdr,
  signedTxXdr,
});

// Cancel pending loan
await api.loans.cancelLoan(loanId);

// Get loan configuration
const config = await api.loans.getConfig();
```

### Pool (Lending Pool)

```ts
// Get pool statistics
const stats = await api.pool.getStats();
// => { totalDeposits, utilizationRate, apy, activeLoansCount, sharePrice }

// Get depositor portfolio
const portfolio = await api.pool.getDepositorPortfolio(address);
// => { depositAmount, shares, sharePercent, estimatedYield }

// Get share price
const { sharePrice } = await api.pool.getSharePrice();

// Build deposit transaction
const { unsignedTxXdr } = await api.pool.buildDepositTx({
  providerPublicKey: address,
  tokenAddress: USDC_CONTRACT,
  amount: 500,
});

// Build withdraw transaction
const { unsignedTxXdr } = await api.pool.buildWithdrawTx({
  providerPublicKey: address,
  tokenAddress: USDC_CONTRACT,
  shares: 100,
});

// Build emergency withdraw (bypasses cooldown)
const { unsignedTxXdr } = await api.pool.buildEmergencyWithdrawTx({
  providerPublicKey: address,
  tokenAddress: USDC_CONTRACT,
  shares: 100,
});

// Get yield history
const history = await api.pool.getYieldHistory(address);

// Get withdrawal cooldown
const cooldown = await api.pool.getWithdrawalCooldown();
```

### Scores

```ts
// Get user score
const { score, tier } = await api.scores.get(address);

// Get score breakdown (component analysis)
const breakdown = await api.scores.getBreakdown(address);
// => { baseScore, repaymentBonus, consistencyFactor, latePenalties }

// Get score history (up to 50 entries)
const history = await api.scores.getHistory(address);

// Trigger score reconciliation (admin)
await api.scores.reconcile(address);
```

### Notifications

```ts
// List notifications with filters
const { notifications, pagination, unreadCount } = await api.notifications.list(
  {
    status: "unread",
    type: "repayment_due",
    page: 1,
    limit: 20,
  },
);

// Mark as read
await api.notifications.markRead(notificationId);

// Mark all as read
await api.notifications.markAllRead();

// Get notification preferences
const prefs = await api.notifications.getPreferences();

// Update preferences
await api.notifications.updatePreferences({
  emailEnabled: true,
  smsEnabled: false,
  digestFrequency: "weekly",
  perTypeOverrides: {
    loan_approved: true,
    repayment_due: true,
    score_changed: false,
  },
});
```

### Remittances

```ts
// List remittances with filters
const { remittances, pagination } = await api.remittances.list({
  status: "completed",
  page: 1,
  limit: 20,
});

// Get remittance by ID
const remittance = await api.remittances.get(remittanceId);

// Create a remittance
await api.remittances.create({
  recipientAddress: "GABCDEF...",
  amount: 500,
  fromCurrency: "USD",
  toCurrency: "PHP",
  memo: "Family support",
});
```

### Transactions

```ts
// List recent transactions
const { transactions, pagination } = await api.transactions.list({
  type: "repayment",
  page: 1,
  limit: 20,
});
```

### Events (SSE Streaming)

```ts
// Stream loan events in real-time
const stream = api.events.stream({
  eventTypes: ["LoanRepaid", "LoanDefaulted"],
});

stream.onMessage((event) => {
  console.log("New event:", event.eventType, event.loanId);
});

stream.onError((error) => {
  console.error("Stream error:", error);
});

// Close the stream
stream.close();

// Get event stream status
const status = await api.events.getStreamStatus();
```

### Indexer (Admin)

```ts
// Get indexer status
const status = await api.indexer.getStatus();
// => { lastIndexedLedger, lagLedgers, currentLedger, isSynced }

// List webhook subscriptions
const subs = await api.indexer.listWebhookSubscriptions();

// Create webhook subscription
await api.indexer.createWebhookSubscription({
  callbackUrl: "https://example.com/webhooks",
  eventTypes: ["LoanRepaid", "LoanDefaulted"],
  secret: "hmac-secret-key",
});

// Trigger reindex (admin)
await api.indexer.reindex({ fromLedger: 1000, toLedger: 2000 });

// Run default check (admin)
await api.indexer.runDefaultCheck();
```

### Admin

```ts
// List audit logs
const { entries, pagination } = await api.admin.listAuditLogs({
  actor: "GADMIN...",
  page: 1,
});

// List loan disputes
const disputes = await api.admin.listDisputes({ status: "open" });

// Resolve a dispute
await api.admin.resolveDispute(disputeId, {
  resolution: "approved",
  adminNote: "Borrower provided proof of repayment",
});
```

### Simulation

```ts
// Simulate remittance history
const result = await api.simulation.simulatePayment({
  userId: "GABC...",
  amount: 500,
  frequency: "monthly",
  months: 12,
});
// => { projectedScore, confidenceLevel, recommendations }
```

### Health

```ts
// Basic health check
const health = await api.health.check();

// Deep health (includes DB, Redis, Stellar RPC, indexer lag)
const deep = await api.health.deepCheck();

// Version info
const version = await api.health.version();
// => { gitSha, builtAt, nodeVersion, contracts }
```

### User

```ts
// Get user profile
const profile = await api.user.getProfile(address);

// Update profile
await api.user.updateProfile({
  displayName: "Alice",
  email: "alice@example.com",
});
```

## Error Handling

```ts
import { ApiError, RequestDeadlineExceededError } from "@zizalend/sdk";

try {
  const loans = await api.loans.list();
} catch (error) {
  if (error instanceof ApiError) {
    console.error(`API Error ${error.statusCode}: ${error.message}`);

    if (error.isAuthError) {
      // Redirect to login
    } else if (error.isRateLimited) {
      // Retries were already attempted before this surfaced
    } else if (error.isValidationError) {
      // Show field-level errors
      console.error("Invalid field:", error.field);
    }
  } else if (error instanceof RequestDeadlineExceededError) {
    // The client stopped the request, the network did not fail. See "Bounding total latency".
    console.error(
      `Gave up after ${error.elapsedMs}ms of a ${error.totalTimeoutMs}ms budget`,
    );
  }
}
```

### Retry behavior

The client automatically retries on transient failures (HTTP 429, 502, 503, 504) and network
errors. Configure via `maxRetries` (default: 3).

**`Retry-After` is honoured.** A 429 or 503 that carries the header is waited out for the
interval it states, in either form RFC 9110 allows: delta-seconds (`Retry-After: 60`) or an
HTTP-date (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`). The old behaviour of always sleeping
`2^attempt * 200ms` meant three retries fired inside a one-minute rate-limit window and the
caller got a rate-limit error that waiting would have avoided. When the header is absent or
unparseable the client falls back to exponential backoff from 200ms.

**Every wait is capped.** `maxRetryDelayMs` (default `30000`) bounds both an honoured
`Retry-After` and the exponential fallback, so a server asking for an hour cannot pin a client
for an hour.

**Every wait is jittered.** A delay derived from `Retry-After` is a floor, so the jitter is
additive (up to 250ms): subtracting from it would send every client back before the window
reopened. The exponential fallback uses equal jitter — half the window fixed, half random — so
a fleet that hit the same limiter at the same moment does not return in lockstep.

### Bounding total latency

`timeoutMs` applies to each attempt, and `maxRetries` multiplies it: with the defaults, one
logical request can occupy 120 seconds plus backoff. `totalTimeoutMs` bounds the whole
operation instead.

```ts
const api = new Zizalend({
  baseUrl: "http://localhost:3001/api/v1",
  timeoutMs: 30000,
  totalTimeoutMs: 5000, // give up after five seconds, retries and backoff included
});
```

A per-attempt timeout is never allowed to outlive the shared budget: with 30-second attempts
and a 5-second budget, the first attempt is aborted at five seconds. The client also stops
retrying as soon as the remaining budget cannot fit another attempt plus its backoff, rather
than sleeping past a deadline that has already decided the outcome.

When the budget runs out the client throws `RequestDeadlineExceededError`, carrying
`totalTimeoutMs` and `elapsedMs`. It is deliberately not an `ApiError` and deliberately not the
last transport error: nothing was refused by the server and nothing necessarily failed on the
network — the client chose to stop, and reporting the underlying `ECONNRESET` would attribute
that decision to the network.

### Typed error codes

`ApiError.errorCode` is a closed union generated from the backend registry, so a `switch` over
it is exhaustive and a comparison against a code the backend has removed fails to compile
rather than silently never matching.

```ts
import { ApiError, UNKNOWN_API_ERROR } from "@zizalend/sdk";

try {
  await api.loans.buildRepayTx(loanId, { borrowerPublicKey, amount: "100" });
} catch (error) {
  if (error instanceof ApiError) {
    switch (error.errorCode) {
      case "INSUFFICIENT_COLLATERAL":
        break;
      case "LOAN_NOT_ACTIVE":
        break;
      case UNKNOWN_API_ERROR:
        // The failure did not come from the backend's error handler — a proxy 502, a
        // transport error surfacing as a response, or a backend that predates a code.
        break;
    }
  }
}
```

The union is regenerated from `backend/src/errors/errorCodes.ts` by
`npm run generate:error-codes`; CI fails if the generated file and the registry disagree.
`UNKNOWN_API_ERROR` is the only member that is not a backend code, and `hasKnownErrorCode`
tells you whether the server actually named the failure.

### Iterating paginated collections

`loans`, `remittances`, `transactions`, and the indexer's borrower events all paginate with a
cursor. Each module exposes an async iterator that walks every page, so consumers do not each
reimplement the loop:

```ts
// Every active loan, page by page.
for await (const loan of api.loans.iterate({ status: "active" })) {
  console.log(loan.loanId);
}

// Whole transaction history as an array.
const all = await api.transactions.collect();

// Borrower events, read through the endpoint's nested envelope.
for await (const event of api.indexer.iterateBorrowerEvents(borrower)) {
  console.log(event.eventType);
}
```

`iterate` / `iterateBorrowerEvents` return an `AsyncGenerator`, so a page is fetched only when
its items are requested and `break` stops fetching. `collect` gathers everything into one array.
The non-iterating `list` methods are unchanged and still fetch a single page.

Iteration stops on three conditions, all of which matter:

- **No next cursor** — the server says there is nothing more.
- **A cursor that has already been requested.** A server that echoes the cursor it was given
  makes a loop that only checks for an absent cursor spin forever; the iterator keeps the set of
  cursors it has sent and returns when one repeats.
- **`maxPages`** (default `100`). A server that mints a fresh cursor per request without ever
  advancing is not detectable from the cursor alone, so the page ceiling is what bounds the
  loop. Pass `startCursor` to resume from a cursor you stored.

## Event Streaming

The SDK supports real-time Server-Sent Events (SSE) for live updates:

```ts
const stream = api.events.stream();

const unsubscribe = stream.onMessage((event) => {
  console.log("Event:", event);
});

// Later:
unsubscribe();
stream.close();
```

The stream automatically reconnects on disconnection with exponential backoff.

## Server-to-Server Usage

For backend services, use API key authentication:

```ts
const adminClient = new Zizalend({
  baseUrl: "http://backend:3001/api/v1",
  apiKey: process.env.INTERNAL_API_KEY,
});

// Admin-only endpoints
await adminClient.indexer.reindex({ fromLedger: 0 });
await adminClient.admin.resolveDispute(disputeId, { resolution: "approved" });
```

## TypeScript

The SDK is fully typed. Import types directly:

```ts
import type {
  BorrowerLoan,
  PoolStats,
  UserScore,
  Notification,
  Remittance,
} from "@zizalend/sdk";
```

`@zizalend/types` provides generated types from the OpenAPI 3.0 spec. The SDK re-exports these with domain-specific type aliases for convenience.

## Related Packages

| Package           | Description                     |
| ----------------- | ------------------------------- |
| `@zizalend/sdk`   | Typed API client (this package) |
| `@zizalend/types` | Auto-generated OpenAPI types    |

For what counts as a breaking change, how versions move, and what a consumer
should pin, see [docs/VERSIONING.md](../../docs/VERSIONING.md).

## License

ISC License — see LICENSE file for details.
