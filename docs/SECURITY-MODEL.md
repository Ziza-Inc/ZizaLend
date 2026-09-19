# ZizaLend Authentication & Authorization Model

This document describes the security model for the ZizaLend backend API: how
identities are established, how roles map to scopes, and which scope guard
protects each route group. See also [SECURITY.md](../SECURITY.md) for the
vulnerability-disclosure policy.

---

## Authentication flows

### 1. Challenge–signature–JWT (primary, for wallet users)

1. **GET /api/auth/challenge?publicKey=G…** — server returns a one-time nonce
   message valid for 5 minutes.
2. Client signs the message with the Stellar Ed25519 private key.
3. **POST /api/auth/verify** — server verifies the signature via
   `Keypair.verify`, resolves the role for that public key (see [Role
   resolution](#role-resolution) below), and mints a JWT.
4. The JWT is returned both in the JSON body and set as a `httpOnly`,
   `SameSite=strict` cookie named `ZizaLend_jwt` (overridable via
   `JWT_COOKIE_NAME` env var). The cookie is used for SSE/EventSource
   connections that cannot attach `Authorization` headers.
5. JWT lifetime: **24 hours** (`JWT_EXPIRES_IN = "24h"`).
   Secret: `JWT_SECRET` environment variable (required).

JWT payload shape (`JwtPayload` in `authService.ts`):

```ts
{
  publicKey: string;   // Stellar G… address
  role: UserRole;      // "admin" | "borrower" | "lender"
  scopes: string[];    // derived from role via ROLE_SCOPES
  iat: number;
  exp: number;
}
```

Subsequent requests supply the JWT via:
- `Authorization: Bearer <token>` header, or
- the `ZizaLend_jwt` cookie.

### 2. API-key authentication (for backend services / admin tooling)

Admin operations use `x-api-key: <key>` instead of JWTs. Keys are configured
in the `INTERNAL_API_KEY` environment variable as a comma-separated list.

Key formats:

| Format | Example | Grants |
|---|---|---|
| Legacy (no scope prefix) | `mysecretkey` | All admin scopes |
| Scoped | `admin:disputes:mysecretkey` | Only `admin:disputes` |

Available scopes: `admin:disputes`, `admin:indexer`, `admin:webhooks`,
`admin:loans`.

Implemented in `backend/src/middleware/auth.ts` (`requireApiKey`).

---

## Role resolution

`resolveRoleForWallet(publicKey)` in `backend/src/auth/rbac.ts`:

1. If the public key is in `ADMIN_WALLETS` (comma-separated env) → **admin**.
2. If the public key is in `LENDER_WALLETS` → **lender**.
3. Otherwise → **borrower**.

---

## Role-to-scope table

Defined in `ROLE_SCOPES` in `backend/src/auth/rbac.ts`:

| Role | Scopes granted |
|---|---|
| `admin` | `admin:all` |
| `lender` | `read:loans`, `read:pool` |
| `borrower` | `read:loans`, `write:repayment`, `read:score`, `read:notifications`, `write:notifications` |

> **Note:** `lender` does **not** have `write:pool`. Pool write endpoints
> (`build-deposit`, `build-withdraw`, `build-emergency-withdraw`, `submit`)
> require `write:pool`, which means lenders currently receive 403 on those
> routes. This is a known gap tracked in issue #1179.

---

## Route-group authorization map

### JWT-authenticated routes (`requireJwtAuth` + `requireScopes`)

| Route group | Role check | Required scope |
|---|---|---|
| `GET /api/pool/stats` | `requireLender` | `read:pool` |
| `GET /api/pool/depositor/:address` | `requireLender` | `read:pool` |
| `GET /api/pool/depositor/:address/yield-history` | `requireLender` | `read:pool` |
| `GET /api/pool/:token/share-price` | `requireLender` | `read:pool` |
| `POST /api/pool/build-deposit` | `requireLender` | `write:pool` |
| `POST /api/pool/build-withdraw` | `requireLender` | `write:pool` |
| `POST /api/pool/build-emergency-withdraw` | `requireLender` | `write:pool` |
| `POST /api/pool/submit` | `requireLender` | `write:pool` |
| `GET /api/loans/*` | — | `read:loans` |
| `GET /api/indexer/loans/*` | — | `read:loans` |
| `GET/POST /api/notifications` | — | `read:notifications` / `write:notifications` |
| `POST /api/remittances` | — | `write:remittances` |
| `GET /api/remittances` | — | `read:remittances` |

### API-key-authenticated routes (`requireApiKey(scope)`)

| Route | Required scope |
|---|---|
| `GET /api/admin/loan-disputes` | `admin:disputes` |
| `POST /api/admin/loan-disputes/:id/resolve` | `admin:disputes` |
| `POST /api/admin/loans/check-defaults` | `admin:loans` |
| `GET /api/admin/indexer/*` | `admin:indexer` |
| `GET /api/events/status` | `admin:indexer` |
| `GET /api/indexer/events/recent` | `admin:indexer` |
| `GET/POST/DELETE /api/indexer/webhooks/*` | `admin:webhooks` |
| `GET/POST/DELETE /api/admin/webhooks/*` | `admin:webhooks` |

---

## Auth middleware stack

```
backend/src/middleware/jwtAuth.ts   — requireJwtAuth, requireLender,
                                      requireBorrower, requireScopes
backend/src/middleware/auth.ts      — requireApiKey (API-key scoped access)
backend/src/services/authService.ts — generateJwtToken, verifyJwtToken,
                                      generateChallenge, verifySignature
backend/src/auth/rbac.ts            — ROLE_SCOPES, resolveRoleForWallet,
                                      resolveScopesForRole
```

---

## Contract-side trust model

This document covers the backend API. The contracts enforce their own model, and
one part of it is deliberately reachable from a single key, so it is recorded
here as well as in the
[governance runbook](runbooks/governance-admin-rotation.md).

### Admin escape hatch

Every governable contract (`remittance_nft`, `loan_manager`, `lending_pool`)
exposes the same three related entry points:

| Entry point | Authorised by | Effect |
| --- | --- | --- |
| `set_governance(governance)` | current admin | Records the governance contract permitted to replace this contract's admin |
| `set_admin(new_admin)` | the governance contract **when one is configured**, otherwise the current admin | Replaces the admin in one step. This is what `MultisigGovernance::finalize_admin_transfer` calls, and it is the boundary at which the target verifies the caller really is the governance contract rather than merely holding the admin key |
| `propose_admin(new_admin)`, then `accept_admin()` | current admin, then the proposed admin | Two-step replacement that works whether or not governance is configured |

`set_governance` is what makes governance meaningful. Without it a single admin
key could call `set_admin` directly and bypass the 24-hour timelock and the
signer quorum that `MultisigGovernance` enforces, which would make the whole
apparatus decorative.

**The escape hatch.** After `set_governance`, `propose_admin` /
`accept_admin` remain available to the current admin. That is deliberate: a
governance module that cannot be bypassed is one that can permanently strand a
contract if its signers lose access to their keys, and a stranded lending pool
is worse than a governed one with a documented recovery path.

The consequence is stated plainly, because it is the entire reason this section
exists: **the admin key can still rotate the admin without governance.**
Governance is the intended path, not the only one.

**Mitigation — alert on these two events, on all three contracts:**

| Event | Topics | Data | Meaning |
| --- | --- | --- | --- |
| `AdminProposed` | `AdminProposed`, current admin | proposed admin | A two-step rotation has started. If nobody expected one, treat it as an incident |
| `AdminTransferred` | `AdminTransferred`, `via` | `(previous_admin, new_admin)` | The admin changed. `via` is `accept`, `governance` or `admin`, and it is the field that says whether the escape hatch was used |

An `AdminTransferred` whose `via` is `accept` or `admin`, with no governance
proposal behind it, is the escape hatch in use and needs a human decision. The
procedure is in
[docs/runbooks/governance-admin-rotation.md](runbooks/governance-admin-rotation.md).
