# Quarantined tests

Tests that are excluded from the merge gate, and who is accountable for getting them back.

## Why this file exists

A test that fails intermittently, and is re-run until it passes, is worse than no test. It
teaches everyone who sees it that red does not mean stop, and that is the habit that lets a real
regression through. So a test that cannot pass reliably has two honest options: be fixed, or be
quarantined deliberately — recorded here, out of the gate, with a name and a date attached.

Three rules make the difference between quarantine and neglect:

1. **No CI job retries a failing test.** `frontend/playwright.config.ts` is pinned to
   `retries: 0` in CI; a trace is retained on failure instead, so the artifact that used to come
   from the second attempt is still there. A retry is recorded as the thing it is — the test
   failed.
2. **Quarantine is tracked.** Every unconditional skip in a test file must have a row in the
   table below. `npm run check:quarantine` fails when code and ledger disagree in either
   direction, so a test cannot be quietly skipped by removing it from the gate.
3. **Quarantine expires.** The deadline is checked on every pull request. Once it passes, the
   check fails until the row is either removed — the test is fixed — or renewed with a new date
   and a reason. A renewal is a visible decision; letting a date pass is not.

Environment-gated tests — the suites that skip themselves when no database is configured — are
_not_ quarantined and do not belong here. They pass or skip by a stated condition, and they run
in CI, where the database exists.

## Ledger

| Test                                                                                                                | Layer   | Owner                  | Deadline   | Reason                                                                                                                                                                                                     | Tracking |
| ------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `frontend/e2e/criticalFlows.spec.ts` › `Lend: Deposit funds → View updated pool stats`                              | e2e     | @omolobamoyinoluwa-max | 2026-12-31 | The spec asserts against wallet-connect state, `/api/*` mock paths, and Zustand hydration that have drifted from the current app, so it fails against the app rather than against the change under review. | #132     |
| `frontend/e2e/criticalFlows.spec.ts` › `Remittance: View history`                                                   | e2e     | @omolobamoyinoluwa-max | 2026-12-31 | Same drift as the `Lend: Deposit funds` case above — the remittance route mocks no longer match what the history view requests.                                                                            | #132     |
| `frontend/e2e/criticalFlows.spec.ts` › `Account: Settings update → logout → redirect to login`                      | e2e     | @omolobamoyinoluwa-max | 2026-12-31 | Same drift as the `Lend: Deposit funds` case above — the settings response shape the flow mocks is no longer what the page reads.                                                                          | #132     |
| `frontend/e2e/lender-withdraw-flow.spec.ts` › `Lender Withdraw Flow`                                                | e2e     | @omolobamoyinoluwa-max | 2026-12-31 | The whole suite mocks a pool-stats and withdraw shape the frontend no longer calls; every spec in it would fail for the same reason. Restore file-by-file as the flows are re-aligned.                     | #132     |
| `frontend/e2e/notifications-inbox.spec.ts` › `opens notifications inbox from dropdown view all and applies filters` | e2e     | @omolobamoyinoluwa-max | 2026-12-31 | Depends on the notification dropdown rendering from a hydrated store and on filter query parameters the inbox no longer forwards, so the assertions never reach the state under test.                      | #132     |
| `frontend/e2e/recent-transactions.spec.ts` › `opens recent transactions drawer with copied hashes`                  | e2e     | @omolobamoyinoluwa-max | 2026-12-31 | Asserts on clipboard contents and on a drawer that now reads its rows from a different store slice than the one the spec seeds.                                                                            | #132     |
| `frontend/e2e/remittance-nft-viewer.spec.ts` › `shows Remittance NFT metadata on the kingdom page`                  | e2e     | @omolobamoyinoluwa-max | 2026-12-31 | The kingdom page reads NFT metadata through a route the spec does not mock, so the spec observes an empty state and fails on the assertion it was written for.                                             | #132     |
| `frontend/e2e/remittance-nft-viewer.spec.ts` › `shows empty NFT state with remittance CTA`                          | e2e     | @omolobamoyinoluwa-max | 2026-12-31 | Same missing route mock as the metadata case above; the empty state it asserts on is produced by the missing mock rather than by the condition it means to test.                                           | #132     |
| `backend/src/__tests__/scoreConfig.test.ts` › `calls sorobanService.getScoreConfig for LoanRepaid events`           | backend | @omolobamoyinoluwa-max | 2026-12-31 | Needs a mocked on-chain simulation; the indexer test environment requires a live Soroban RPC instance, so the assertion cannot be reached without a network dependency in unit tests.                      | #469     |
| `backend/src/__tests__/scoreConfig.test.ts` › `calls sorobanService.getScoreConfig for LoanDefaulted events`        | backend | @omolobamoyinoluwa-max | 2026-12-31 | Same cause as the `LoanRepaid` case above: a live Soroban RPC is required to reach the assertion.                                                                                                          | #469     |

### Columns

| Column     | Meaning                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| `Test`     | `` `<path from the repository root>` › `<test name as written in the file>` `` |
| `Layer`    | One of `backend`, `frontend`, `e2e`, `sdk`, `contracts`, `integration`         |
| `Owner`    | A GitHub handle, `@`-prefixed. The person expected to fix or renew the row     |
| `Deadline` | `YYYY-MM-DD`. Checked against the current date on every pull request           |
| `Reason`   | What makes the test unreliable. "Flaky" is not a reason — name the cause       |
| `Tracking` | An issue or pull request reference, `#123`                                     |

## Checking it

```bash
npm run check:quarantine
```

The checker reads the table above and the test sources, and fails when:

- a row's file or test name no longer exists, or its deadline has passed;
- a test is skipped in code with no row in the table;
- a row names a `Layer`, `Owner`, `Deadline`, `Reason` or `Tracking` the table's own rules do not
  accept;
- `frontend/playwright.config.ts` reintroduces a retry in CI, or a workflow retries a test step.

It runs on every pull request as part of `scripts-typecheck` in `.github/workflows/ci.yml`.
