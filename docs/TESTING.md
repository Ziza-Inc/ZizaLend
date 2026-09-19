# Testing Guide

Where each test layer lives, what it is for, how long it takes, and what it cannot catch.

The point of this document is that you can pick the layer a new test belongs in without reading
the whole CI configuration, and run just that layer while you iterate.

## Choosing a layer

Work downwards until a layer can actually fail for the change you made. The cheapest layer that
can catch the defect is the one to add the test to.

| If you changed…                                                   | Add the test to                                                    | Because                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Arithmetic, authorisation, or state in a contract                 | Contract unit tests — the `#[cfg(test)] mod test` in that contract | The whole contract runs in-process; a test here is milliseconds and needs no network |
| The way two contracts talk to each other                          | `contracts/tests/`                                                 | Only this layer runs two contracts against each other with real authentication       |
| The shape of a REST handler, its validation, or its error mapping | `backend/src/__tests__/`                                           | Supertest drives the real Express app; no server needed                              |
| A query, a migration, or anything that needs Postgres or Redis    | `backend/src/__tests__/integration/`                               | The unit layer mocks the pool, so it cannot catch a bad query                        |
| A React component, a store, or a piece of formatting              | `frontend/src/**/*.test.tsx`                                       | Rendering and interactions, from the user's perspective                              |
| A method on `@zizalend/sdk`                                       | `packages/sdk/src/__tests__/`                                      | The SDK is published separately and has its own failure modes                        |
| A user journey that spans pages and the API                       | `frontend/e2e/`                                                    | The only layer that runs the app in a browser                                        |
| An invariant that should hold for _any_ input                     | `contracts/fuzz/fuzz_targets/`                                     | A fuzzer searches the input space; a unit test only checks the inputs you thought of |

## The layers

| Layer                       | Command                                                                                      | Observed duration             | What it proves                                                                                   | What it cannot catch                                            |
| --------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Contract unit tests (guest) | `cd contracts && cargo test -- --test-threads=1`                                             | ~56 s warm, ~345 s cold in CI | One contract, in Soroban's test environment: state transitions, arithmetic, auth, emitted events | Anything across two contracts, or anything about the deployment |
| Contract integration tests  | included in the command above                                                                | <2 s of that 56 s             | Two contracts interacting with real signatures (`contracts/tests/`)                              | Frontend or backend behaviour                                   |
| Fuzz targets                | `cd contracts/fuzz && cargo fuzz run <target>`                                               | unbounded — run until stopped | Invariants hold for generated input, not just the inputs the author chose                        | Anything that is not an invariant                               |
| Backend unit tests          | `cd backend && npm test`                                                                     | ~100 s                        | Handlers, services, validation and error mapping against a mocked database                       | A wrong SQL statement, a migration, cross-request state         |
| Backend integration tests   | `cd backend && RUN_INDEXER_INTEGRATION=true npm test`                                        | a few minutes                 | Those same paths against a real Postgres and Redis                                               | Frontend behaviour                                              |
| Frontend unit tests         | `cd frontend && npm test`                                                                    | ~15 s                         | Components and stores render and respond to interaction                                          | Routing, data fetching, the real API                            |
| SDK tests                   | `cd packages/sdk && npm test`                                                                | ~6 s                          | The published client's typing, retry, pagination and error mapping                               | The server behind it                                            |
| End-to-end tests            | `cd frontend && npx playwright test --project=chromium`                                      | ~75 s in CI                   | A user journey in a real browser against the real app                                            | Anything the mocks in the spec paper over                       |
| WASM size budgets           | `node scripts/check-wasm-size.mjs`                                                           | ~1 s                          | Each contract stays under its recorded budget                                                    | Correctness                                                     |
| Migration checks            | `cd backend && npx node-pg-migrate up && npx node-pg-migrate down && npx node-pg-migrate up` | ~15 s                         | Migrations are reversible and re-runnable                                                        | What the application expects them to produce                    |
| Load test                   | `TARGET_URL=http://localhost:3000 k6 run scripts/loadtest/baseline.js`                       | minutes                       | Throughput and latency under load                                                                | Correctness                                                     |

### Contract unit tests (guest code)

The `#[cfg(test)] mod test` block inside each contract is guest code: it is compiled for the host
and runs in Soroban's test environment, calling the contract the same way the ledger does.

```bash
cd contracts && cargo test -- --test-threads=1
```

`--test-threads=1` is not a preference. The contracts' tests share the Soroban test environment's
registered contract IDs, and running them in parallel makes them interfere — the suite passes in
isolation and fails together.

**Iterating on one contract.** This is the command to reach for; it skips the other four
contracts and the integration crate:

```bash
cd contracts && cargo test -p lending_pool -- --test-threads=1
```

**Iterating on one test.** Add the test's name as a filter — anything containing it matches, so a
longer prefix is usually enough:

```bash
cd contracts && cargo test -p lending_pool test_double_initialize_returns_error -- --test-threads=1
```

### Contract integration tests

`contracts/tests/` holds a crate with three integration suites — `accounting.rs`,
`admin_model.rs` and `real_auth.rs` — plus `contracts/tests/src/lib.rs`. They deploy more than one
contract and exercise the calls between them, including real signature verification, which no
single-contract test can do. They run as part of `cargo test` above.

### Fuzz targets

```bash
cd contracts/fuzz && cargo fuzz run lending_pool_fuzz
```

| Target                     | Contract      | Invariants                        |
| -------------------------- | ------------- | --------------------------------- |
| `lending_pool_fuzz`        | LendingPool   | Share minting, dilution, cooldown |
| `loan_manager_fuzz`        | LoanManager   | Loan states, collateral ratios    |
| `remittance_nft_fuzz`      | RemittanceNFT | Score bounds, metadata integrity  |
| `multisig_governance_fuzz` | Governance    | Approval counts, timelock         |
| `fuzz_target_1`            | Integration   | Cross-contract invariants         |

CI compiles the targets but does not run them: a fuzz run has no natural end, and a bounded one
would report coverage rather than correctness. See
[FUZZING_README.md](../contracts/FUZZING_README.md) and
[contracts/fuzz_invariants.md](../contracts/fuzz_invariants.md).

### Backend

**Unit tests — `backend/src/__tests__/`**

```bash
cd backend && npm test
```

The Jest config is ESM, so the `test` script runs node with `--experimental-vm-modules`. Calling
`npx jest` directly skips that flag and the suites fail to load; use `npm test`.

```bash
cd backend && npm test -- auth.test.ts                    # one file
cd backend && npm test -- --testPathPattern="loan"        # by pattern
cd backend && npm test -- --coverage                      # with coverage
cd backend && npm run test:watch                          # watch mode
```

**Integration tests — `backend/src/__tests__/integration/`**

These need a real Postgres and Redis and are gated behind an environment variable, so the default
`npm test` run skips them rather than failing on a machine without a database.

```bash
cd backend && RUN_INDEXER_INTEGRATION=true npm test
```

The database-backed suites elsewhere in `__tests__/` use the same gate: they `describe.skip`
themselves when there is no connection string, and run in CI, where there is one.

**Migrations**

```bash
cd backend && npx node-pg-migrate up
cd backend && npx node-pg-migrate down
cd backend && npx node-pg-migrate up
```

Up, down, up again. A migration that cannot be reversed is a migration that cannot be rolled back
in production.

### Frontend unit tests

**Location**: `frontend/src/**/*.test.{ts,tsx}`

```bash
cd frontend && npm test
cd frontend && npm test -- LoanCard.test.tsx
cd frontend && npm run test:watch
```

Test through the user's eyes: render, interact, assert on what is visible. Mock the API at the
module boundary. Test Zustand stores directly rather than through a component.

### SDK tests

**Location**: `packages/sdk/src/__tests__/`

```bash
cd packages/sdk && npm test
```

Jest is installed at the workspace root, so the `test` script reaches up a level to find it.

### End-to-end tests

**Location**: `frontend/e2e/`

```bash
cd frontend && npm run test:e2e                      # every project
cd frontend && npx playwright test --project=chromium # CI runs only chromium
cd frontend && npx playwright test borrower-loan-flow.spec.ts
cd frontend && npx playwright test --headed          # see the browser
cd frontend && npx playwright test --debug           # step through
```

Playwright starts the dev server itself (`webServer` in `playwright.config.ts`), so there is
nothing to start first.

**CI does not retry a failing spec.** `retries` is `0` in every environment. A spec that only
passes on a second attempt has failed, and a green second attempt is how a real regression gets
merged. When a spec cannot pass reliably it is quarantined in
[QUARANTINED-TESTS.md](./QUARANTINED-TESTS.md) with an owner and a deadline, and
`npm run check:quarantine` fails CI if a spec is skipped without a row in that ledger.

### Accessibility audit

```bash
cd frontend && npm run audit:a11y
```

Builds the app and runs the axe-playwright audit against it.

### WASM size budgets

```bash
node scripts/check-wasm-size.mjs
```

Per-contract budgets, with the reasoning recorded beside each in the script. Requires a release
build first:

```bash
cd contracts && cargo build --workspace --target wasm32v1-none --release --exclude zizalend-integration-tests
```

### Load testing

```bash
TARGET_URL=http://localhost:3000 k6 run scripts/loadtest/baseline.js
```

See [scripts/loadtest/](../scripts/loadtest/).

## Coverage

| Layer     | Command                                     | Enforced                |
| --------- | ------------------------------------------- | ----------------------- |
| Backend   | `cd backend && npm test -- --coverage`      | Reported                |
| Frontend  | `cd frontend && npm test -- --coverage`     | Reported                |
| Contracts | `cd contracts && cargo tarpaulin --out Xml` | `--fail-under 75` in CI |

Coverage is a floor, not a goal. The contract threshold is what makes it a check rather than a
number nobody reads.

## CI

`.github/workflows/ci.yml` runs these on every pull request:

| Job                  | What it runs                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `supply-chain-audit` | Lockfile scan for known-malicious packages, plus the dependency-review scope and licence policy |
| `backend`            | Lint → build → typecheck → migrations → unit tests                                              |
| `migration-check`    | Migration reversibility, idempotency, and unique timestamp prefixes                             |
| `frontend`           | Lint → i18n key check → typecheck → unit tests → build                                          |
| `e2e`                | Playwright, chromium project, push to `main` or a frontend change                               |
| `contracts`          | Format → clippy → unit and integration tests → release WASM → size budgets → coverage           |
| `packages`           | OpenAPI type generation, typecheck and build                                                    |
| `scripts-typecheck`  | Deploy script typecheck, quarantine policy                                                      |

`frontend`, `backend` and `contracts` each run a different layer, so a failure in one tells you
which layer to reproduce locally before you open the file.

## Writing tests

**Contracts**

- Cover the happy path, every error path, and the boundaries.
- Assert on emitted events and their topics, not only on return values.
- Prefer a typed error assertion over `#[should_panic]`; a panic test passes for the wrong reason
  if the contract panics earlier than intended.
- One behaviour per test, named after the behaviour.

**Backend**

- Use `AppError` for expected failures.
- Mock external services — Soroban RPC, SendGrid, Twilio — at the boundary, never in the middle of
  the code under test.
- Anything that touches the database belongs behind the integration gate.
- Set an explicit timeout on a test that waits for a timer or a retry.

**Frontend**

- Query by role and accessible name; a test that breaks when a class changes is testing the wrong
  thing.
- Test the store separately from the component that reads it.
- Mock the API module, not `fetch`.

**TypeScript across the repository**

- A test that asserts on a generated artefact should compare it against the source it is generated
  from, so drift fails rather than passes.
