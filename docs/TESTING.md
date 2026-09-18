# Testing Guide

Comprehensive testing strategy and commands for the ZizaLend platform.

## Testing Philosophy

ZizaLend employs a multi-layered testing approach:

```
Property-based Fuzz Tests (contracts)
    └── Integration Tests (backend + DB + Redis)
        └── Unit Tests (backend, frontend, contracts)
            └── End-to-End Tests (Playwright)
```

## Backend Testing

### Framework: Jest + Supertest

**Location**: `backend/src/__tests__/`

**Command**: `cd backend && npm test`

### Test Structure

```
backend/src/__tests__/
├── auth.test.ts                    # JWT auth flow
├── eventIndexer.test.ts            # Event indexing logic
├── loanEndpoints.test.ts           # Loan CRUD endpoints
├── notification*.test.ts           # Notification delivery + preferences
├── poolController.*.test.ts        # Pool deposit/withdraw/share price
├── score*.test.ts                  # Credit scoring engine
├── remittance*.test.ts             # Remittance creation + idempotency
├── validation.test.ts              # Zod schema validation
├── integration/                    # Integration tests (require DB + Redis)
│   ├── loanDisputeFlow.test.ts    # Dispute lifecycle
│   └── indexer.integration.test.ts # Indexer E2E
└── ...
```

### Test Stats

| Metric | Count |
|--------|-------|
| Test Suites | 51 |
| Test Cases | 322+ |
| Coverage Target | >80% |

### Running Specific Tests

```bash
# Single file
npm test -- auth.test.ts

# By pattern
npm test -- --testPathPattern="loan"

# With coverage
npm test -- --coverage

# Watch mode
npm test -- --watch

# Integration tests only
RUN_INDEXER_INTEGRATION=true npm test -- --testPathPattern="integration"
```

### Key Test Patterns

```ts
// API endpoint test with Supertest
import request from "supertest";
import app from "../app";

describe("GET /api/v1/loans", () => {
  it("returns active loans for authenticated user", async () => {
    const res = await request(app)
      .get("/api/v1/loans")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.loans).toBeInstanceOf(Array);
  });
});
```

## Frontend Testing

### Unit Tests: Jest + React Testing Library

**Location**: `frontend/src/app/**/*.test.{ts,tsx}`

**Command**: `cd frontend && npm test`

| Metric | Count |
|--------|-------|
| Test Suites | 19 |
| Test Cases | 190 |

### Running Tests

```bash
# All unit tests
npm test

# Watch mode
npm run test:watch

# Specific file
npm test -- LoanCard.test.tsx
```

### Key Test Patterns

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe("Button", () => {
  it("calls onClick when clicked", async () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Click me</Button>);

    await userEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

### End-to-End Tests: Playwright

**Location**: `frontend/e2e/`

**Command**: `cd frontend && npm run test:e2e`

| Metric | Count |
|--------|-------|
| Spec Files | 11 |

### E2E Specs

| Spec | Coverage |
|------|----------|
| `borrower-loan-flow.spec.ts` | Request → Approve → Disburse |
| `borrower-repay-flow.spec.ts` | Repay → Completion |
| `lender-withdraw-flow.spec.ts` | Deposit → Yield → Withdraw |
| `send-remittance.spec.ts` | Remittance creation flow |
| `notifications-inbox.spec.ts` | Notification list + filters |
| `wallet-connection.spec.ts` | Connect → Disconnect → Reconnect |
| `admin-governance.spec.ts` | Admin dispute management |
| `criticalFlows.spec.ts` | Critical path smoke tests |
| `landing-page.spec.ts` | Landing page render |
| `remittance-nft-viewer.spec.ts` | NFT metadata view |
| `recent-transactions.spec.ts` | Transaction drawer |

### Running E2E Tests

```bash
# All specs
npm run test:e2e

# Specific spec
npx playwright test borrower-loan-flow.spec.ts

# Headed mode (see the browser)
npx playwright test --headed

# Debug mode
npx playwright test --debug
```

### Accessibility Audit

```bash
npm run audit:a11y
```

Runs the full axe-playwright accessibility audit after building the app.

## Smart Contract Testing

### Unit + Integration Tests: Rust Test

**Location**: `contracts/*/src/test.rs`, `contracts/tests/`

**Command**: `cd contracts && cargo test -- --test-threads=1`

Note: `--test-threads=1` is required because Soroban test environments share state.

### Test Structure

```
contracts/
├── remittance_nft/src/test.rs     # Mint, score updates, transfer, authorization
├── loan_manager/src/test.rs       # Loan lifecycle, collateral, liquidation
├── lending_pool/src/test.rs       # Deposit, withdraw, share price
├── lending_pool/src/test/
│   └── property_tests.rs          # Property-based tests
├── multisig_governance/src/test.rs # Proposals, approvals, timelock
└── tests/src/lib.rs               # Cross-contract integration tests
```

### Fuzz Testing: Cargo Fuzz

**Location**: `contracts/fuzz/`

**Command**: `cd contracts/fuzz && cargo fuzz run <target>`

| Fuzz Target | Contract | Invariants Tested |
|-------------|----------|-------------------|
| `lending_pool_fuzz` | LendingPool | Share minting, dilution, cooldown |
| `loan_manager_fuzz` | LoanManager | Loan states, collateral ratios |
| `remittance_nft_fuzz` | RemittanceNFT | Score bounds, metadata integrity |
| `multisig_governance_fuzz` | Governance | Approval counts, timelock |
| `fuzz_target_1` | Integration | Cross-contract invariants |

See [FUZZING_README.md](../FUZZING_README.md) and [contracts/fuzz_invariants.md](../contracts/fuzz_invariants.md) for invariant definitions.

## CI Pipeline

The CI pipeline runs the following test jobs on every push and PR:

| Job | Tests |
|-----|-------|
| `backend` | Lint → Build → Typecheck → Migrations → 322 tests |
| `frontend` | Lint → Typecheck → 190 unit tests → Build |
| `e2e` | 11 Playwright specs (push only) |
| `contracts` | Format → Clippy → Unit tests → Fuzz compile |
| `migration-check` | Migration reversibility + idempotency |
| `supply-chain-audit` | Malicious package scanning |

## Load Testing

The repository includes a k6 load test baseline:

```bash
# Install k6
# Run against local environment
TARGET_URL=http://localhost:3000 k6 run scripts/loadtest/baseline.js
```

See [scripts/loadtest/](../scripts/loadtest/) for the load test script.

## Coverage Reports

- **Backend**: `npm test -- --coverage` (Jest coverage)
- **Frontend**: `npm test -- --coverage` (Jest coverage)
- **Contracts**: `cargo tarpaulin --out Xml` (CI only, uploaded as artifact)

## Writing Tests

### Backend

- Use `AppError` for expected error cases
- Mock external services (Soroban RPC, SendGrid, Twilio) at the test boundary
- Integration tests run against a real test database
- Tag slow tests with appropriate test timeout

### Frontend

- Test components from the user's perspective (rendering, interactions)
- Mock API calls using Jest mocks
- Test Zustand stores independently
- Use `@testing-library/user-event` for realistic interactions

### Contracts

- Test happy path, error paths, and edge cases for each function
- Verify events are emitted with correct topics
- Verify storage state changes
- For property tests, define invariants and let the fuzzer generate inputs
- Use `#[should_panic]` for expected panics
