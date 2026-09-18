# Contributor issue backlog

This directory is the **source of truth for the project's issue backlog**. Each file is
one issue: YAML frontmatter plus a body. `scripts/publish-issues.mjs` syncs them to GitHub,
so the backlog is reviewed in a pull request before it appears in the tracker, and a
closed issue is re-opened by the next run while its draft still exists.

```bash
# report the difference between this directory and the tracker
GITHUB_TOKEN=<token> node scripts/publish-issues.mjs

# create and update issues, and close ones with no draft
GITHUB_TOKEN=<token> node scripts/publish-issues.mjs --apply --close-missing

# regenerate this index
node scripts/publish-issues.mjs --write-index
```

Matching is by the `<!-- backlog-id: ... -->` marker in the published body, so renaming a
draft updates its issue instead of opening a second one. Running the publisher twice
changes nothing the second time.

**116 issues** — 38 beginner, 54 intermediate, 24 advanced.

## By area

### backend (27)

| # | Issue | Difficulty |
|---|---|---|
| [001](./001-fix-backend-no-explicit-any-warnings.md) | Fix 24 `@typescript-eslint/no-explicit-any` warnings across backend | beginner |
| [006](./006-integration-tests-notification-system.md) | Add integration tests for the notification system | intermediate |
| [036](./036-backend-001-migration-duplicate-timestamps.md) | Resolve duplicate migration timestamps that make ordering ambiguous | intermediate |
| [037](./037-backend-002-rpc-retry-backoff.md) | Add bounded retry with backoff around Soroban RPC calls | intermediate |
| [038](./038-backend-003-idempotency-coverage.md) | Require an idempotency key on every state-changing endpoint | intermediate |
| [039](./039-backend-004-indexer-reorg.md) | Handle ledger reorganisation in the event indexer | advanced |
| [040](./040-backend-005-idempotent-event-ingest.md) | Make event ingestion idempotent end to end and prove it with a test | intermediate |
| [041](./041-backend-006-score-reconciliation-cadence.md) | Schedule and monitor score reconciliation | intermediate |
| [042](./042-backend-007-score-decay-doc.md) | Document the score decay model and pin it with tests | beginner |
| [043](./043-backend-008-webhook-signature.md) | Sign webhook deliveries and document verification | advanced |
| [044](./044-backend-009-webhook-ssrf.md) | Validate webhook URLs against private address ranges | advanced |
| [045](./045-backend-010-rate-limit-distributed.md) | Verify the rate limiter behaves correctly across instances | intermediate |
| [046](./046-backend-011-rls-or-scoping-audit.md) | Audit every query for tenant and ownership scoping | advanced |
| [047](./047-backend-012-error-code-coverage.md) | Route every thrown error through a declared error code | intermediate |
| [048](./048-backend-013-pagination-consistency.md) | Make pagination consistent across list endpoints | intermediate |
| [049](./049-backend-014-soft-delete-policy.md) | Define whether user data is deleted or anonymised, and implement it | advanced |
| [050](./050-backend-015-connection-pool-config.md) | Make database pool sizing explicit and configurable | beginner |
| [051](./051-backend-016-graceful-shutdown.md) | Shut down cleanly on SIGTERM without abandoning in-flight transactions | intermediate |
| [052](./052-backend-017-metrics-cardinality.md) | Review metric labels for unbounded cardinality | intermediate |
| [053](./053-backend-018-audit-log-completeness.md) | Cover every privileged action with an audit log entry | advanced |
| [054](./054-backend-019-openapi-drift.md) | Detect drift between the OpenAPI spec and the implemented routes | intermediate |
| [055](./055-backend-020-notification-preferences.md) | Honour per-user notification preferences on every dispatch path | intermediate |
| [056](./056-backend-021-cache-invalidation.md) | Prove cache invalidation for state that changes on-chain | advanced |
| [057](./057-backend-022-simulation-accuracy.md) | Verify the transaction preview matches what execution does | advanced |
| [058](./058-backend-023-log-redaction.md) | Redact secrets and personal data from logs | intermediate |
| [059](./059-backend-024-remittance-validation.md) | Validate remittance amounts and counterparties against documented rules | beginner |
| [060](./060-backend-025-loadtest-scenarios.md) | Extend the load test to the read paths users actually hit | intermediate |

### ci-cd (8)

| # | Issue | Difficulty |
|---|---|---|
| [101](./101-ci-001-required-checks-doc.md) | Document the required checks and how to satisfy them | beginner |
| [102](./102-ci-002-workflow-timeouts.md) | Set a timeout on every workflow job | beginner |
| [103](./103-ci-003-caching.md) | Cache dependencies consistently to cut CI duration | intermediate |
| [104](./104-ci-004-concurrency-cancel.md) | Cancel superseded runs to stop wasting runner time | beginner |
| [105](./105-ci-005-dependency-review-scope.md) | Verify dependency review covers every lockfile | intermediate |
| [106](./106-ci-006-trivy-scan.md) | Run the container image scan and act on its result | intermediate |
| [107](./107-ci-007-release-process.md) | Document and automate the release process | intermediate |
| [108](./108-ci-008-deploy-staging-secrets.md) | Audit the staging deployment workflow for secret handling and least privilege | advanced |

### contracts (25)

| # | Issue | Difficulty |
|---|---|---|
| [011](./011-contracts-001-pool-error-code-gap.md) | LendingPool: close the gap at error code 8, or document why it is reserved | beginner |
| [012](./012-contracts-002-error-code-registry.md) | Publish a single machine-readable registry of every contract error code | intermediate |
| [013](./013-contracts-003-pool-gap-doc.md) | Document the full `PoolError` and `NftError` ranges in the contract READMEs | beginner |
| [014](./014-contracts-004-gas-benchmark-harness.md) | Add a gas benchmark harness that records CPU instruction cost per entry point | advanced |
| [015](./015-contracts-005-check-defaults-bounded.md) | Bound the work `check_defaults` does per invocation | advanced |
| [016](./016-contracts-006-pool-adjust-outstanding-auth.md) | Narrow or document the authorisation on `adjust_outstanding` | intermediate |
| [017](./017-contracts-007-storage-ttl-audit.md) | Audit and test TTL extension for every persistent storage key | advanced |
| [018](./018-contracts-008-multisig-signer-rotation.md) | Add signer-set rotation to MultisigGovernance | advanced |
| [019](./019-contracts-009-multisig-proposal-queue.md) | Allow more than one pending governance proposal | advanced |
| [020](./020-contracts-010-nft-score-history-retention.md) | Bound the growth of per-user score history | intermediate |
| [021](./021-contracts-011-nft-uri-allowlist-review.md) | Review the metadata URI scheme allowlist against real metadata hosts | beginner |
| [022](./022-contracts-012-pool-share-inflation.md) | Test the pool against first-depositor share inflation | advanced |
| [023](./023-contracts-013-remittance-indexing.md) | Add event indexing guidance and a schema for every contract event | intermediate |
| [024](./024-contracts-014-interest-math-property-tests.md) | Property-test the interest and late-fee arithmetic for monotonicity | intermediate |
| [025](./025-contracts-015-late-fee-grace.md) | Test the interaction between the grace period and the late-fee ledger marker | intermediate |
| [026](./026-contracts-016-collateral-enforcement.md) | Decide and document whether collateral is enforced at approval or only at liquidation | intermediate |
| [027](./027-contracts-017-liquidate-dust.md) | Cover liquidation of a loan whose remaining debt is dust | intermediate |
| [028](./028-contracts-018-pause-scope.md) | Document precisely what each pause flag blocks | beginner |
| [029](./029-contracts-019-governance-timelock-tests.md) | Test the timelock boundary against the proposal TTL | intermediate |
| [030](./030-contracts-020-admin-escape-hatch-doc.md) | Document the admin escape hatch and its risk in the security model | beginner |
| [031](./031-contracts-021-deploy-verification-script.md) | Verify deployed bytecode against the repository build | intermediate |
| [032](./032-contracts-022-fuzz-campaign-in-ci.md) | Run a bounded fuzz campaign on a schedule | intermediate |
| [033](./033-contracts-023-contract-size-budget-tighten.md) | Tighten the WASM size budget from 256 KiB to a measured ceiling | beginner |
| [034](./034-contracts-024-optimize-verification.md) | Verify whether `stellar contract optimize` changes any artifact | beginner |
| [035](./035-contracts-025-governance-quorum-config.md) | Make the governance quorum configurable at initialization without redeploying | intermediate |

### docs (8)

| # | Issue | Difficulty |
|---|---|---|
| [109](./109-docs-001-contracts-readme-cli.md) | Update the contracts README for the current CLI and the current API | beginner |
| [110](./110-docs-002-adr-backfill.md) | Backfill architecture decision records for the decisions already made | intermediate |
| [111](./111-docs-003-readme-feature-accuracy.md) | Verify every claim in the README against the implementation | beginner |
| [112](./112-docs-004-screenshot-freshness.md) | Keep screenshots current and generated rather than pasted | intermediate |
| [113](./113-docs-005-runbook-index.md) | Index the runbooks and state when each one applies | beginner |
| [114](./114-docs-006-contributor-first-pr.md) | Make the first-pull-request path concrete and verified | beginner |
| [115](./115-docs-007-glossary.md) | Add a glossary for the domain and the Stellar terms used throughout | beginner |
| [116](./116-docs-008-security-policy-detail.md) | Strengthen the security policy with scope, expectations, and a triage path | beginner |

### frontend (23)

| # | Issue | Difficulty |
|---|---|---|
| [002](./002-fix-frontend-react-hooks-violations.md) | Fix React Hooks violations in frontend components | beginner |
| [004](./004-add-loading-states-error-boundaries.md) | Add loading states and error boundaries to frontend loan components | beginner |
| [008](./008-responsive-loan-dashboard.md) | Add responsive design for the loan management dashboard | intermediate |
| [061](./061-frontend-001-error-code-i18n.md) | Map every API error code to localised copy | intermediate |
| [062](./062-frontend-002-wallet-adapter-matrix.md) | Test the wallet connection flow against each supported wallet | intermediate |
| [063](./063-frontend-003-signing-safety.md) | Show the user exactly what they are signing before the wallet prompt | advanced |
| [064](./064-frontend-004-optimistic-update-rollback.md) | Roll back optimistic UI updates when a transaction fails | advanced |
| [065](./065-frontend-005-offline-degradation.md) | Handle a Soroban RPC outage without appearing broken | intermediate |
| [066](./066-frontend-006-accessibility-budget.md) | Make the accessibility audit a gate rather than a script | intermediate |
| [067](./067-frontend-007-e2e-conditional-bug.md) | Fix the e2e job condition, which tests nothing on pull requests | beginner |
| [068](./068-frontend-008-service-worker-staleness.md) | Bound service-worker cache staleness for financial data | advanced |
| [069](./069-frontend-009-bundle-budget.md) | Enforce a bundle-size budget | beginner |
| [070](./070-frontend-010-form-validation-parity.md) | Share validation rules between the form and the backend | intermediate |
| [071](./071-frontend-011-i18n-completeness.md) | Detect missing and unused translation keys | beginner |
| [072](./072-frontend-012-number-formatting.md) | Use one money-formatting path and avoid floating-point amounts | intermediate |
| [073](./073-frontend-013-notification-read-state.md) | Make notification read state consistent across tabs and devices | intermediate |
| [074](./074-frontend-014-empty-error-loading-states.md) | Give every data surface explicit loading, empty, and error states | beginner |
| [075](./075-frontend-015-route-metadata.md) | Generate per-route metadata and social previews | beginner |
| [076](./076-frontend-016-hydration-mismatch.md) | Eliminate hydration mismatches in wallet-dependent UI | intermediate |
| [077](./077-frontend-017-admin-guard.md) | Verify the admin area refuses non-admin users on the server, not only in the UI | advanced |
| [078](./078-frontend-018-theme-and-motion.md) | Respect reduced-motion and theme preferences | beginner |
| [079](./079-frontend-019-sdk-usage-boundary.md) | Frontend: the app builds its own contracts calls instead of using a shared transaction layer | intermediate |
| [080](./080-frontend-020-demo-data-honesty.md) | Make demo and seeded data visibly demo data | beginner |

### infrastructure (5)

| # | Issue | Difficulty |
|---|---|---|
| [003](./003-property-based-fuzz-tests-lending-pool.md) | Add property-based fuzz tests for the lending pool contract | intermediate |
| [005](./005-complete-fuzzing-documentation.md) | Complete fuzzing documentation (fuzz_invariants.md and FUZZING_README.md) | beginner |
| [007](./007-docker-healthcheck-redis.md) | Add Docker healthcheck configuration for Redis service | beginner |
| [009](./009-add-sdk-loan-refinance-extension.md) | Add SDK client methods for loan refinancing and extension | intermediate |
| [010](./010-add-contract-event-tests.md) | Add event emission verification tests for Soroban smart contracts | advanced |

### packages/sdk (4)

| # | Issue | Difficulty |
|---|---|---|
| [083](./083-sdk-003-openapi-parity.md) | Verify the SDK surface matches the OpenAPI operations | intermediate |
| [085](./085-sdk-005-versioning-policy.md) | Publish a versioning and compatibility policy for the workspace packages | beginner |
| [090](./090-sdk-010-package-readmes.md) | Add a README to the types package | beginner |
| [091](./091-sdk-011-e2e-sdk-tests.md) | Add an integration test that exercises the SDK against a running backend | advanced |

### sdk (8)

| # | Issue | Difficulty |
|---|---|---|
| [081](./081-sdk-001-retry-can-double-submit.md) | SDK: a retried POST can submit the same transaction twice | advanced |
| [082](./082-sdk-002-typed-error-codes.md) | SDK: type the API error code so consumers can branch exhaustively | intermediate |
| [084](./084-sdk-004-pagination-iterator.md) | SDK: add a cursor iterator so consumers stop re-implementing pagination | intermediate |
| [086](./086-sdk-006-events-typed.md) | SDK: make `LoanEventRecord.eventType` a discriminated union | beginner |
| [087](./087-sdk-007-unpublished-install.md) | SDK: the README's install command does not correspond to a published package | beginner |
| [088](./088-sdk-008-is-authenticated-expiry.md) | SDK: `isAuthenticated` reports true for an expired token | beginner |
| [089](./089-sdk-009-retry-after.md) | SDK: honour `Retry-After` instead of guessing the backoff | intermediate |
| [092](./092-sdk-012-total-deadline.md) | SDK: bound the total time a request can take, not just each attempt | intermediate |

### testing (8)

| # | Issue | Difficulty |
|---|---|---|
| [093](./093-testing-001-coverage-threshold.md) | Enforce a coverage threshold in CI instead of uploading a report | intermediate |
| [094](./094-testing-002-backend-coverage.md) | Add coverage measurement and a threshold for the backend | intermediate |
| [095](./095-testing-003-frontend-unit-coverage.md) | Add coverage measurement for the frontend unit tests | beginner |
| [096](./096-testing-004-contract-invariant-suite.md) | Write an accounting invariant suite that runs against every test scenario | advanced |
| [097](./097-testing-005-deterministic-time.md) | Make every time-dependent test deterministic | intermediate |
| [098](./098-testing-006-negative-path-matrix.md) | Build a negative-path matrix for every entry point | advanced |
| [099](./099-testing-007-flaky-test-policy.md) | Detect and quarantine flaky tests | intermediate |
| [100](./100-testing-008-test-documentation.md) | Document how to run each test layer, and what each layer is for | beginner |

## How to add an issue

Add a file named `NNN-<area>-<slug>.md` with this frontmatter:

```yaml
---
title: "Area: the outcome, stated as a change"
area: contracts | backend | frontend | sdk | testing | ci-cd | docs
difficulty: beginner | intermediate | advanced
labels: ["contracts", "help wanted"]
---
```

Then write `## Context` (why this matters), `## Task` (what to do),
`## Definition of Done` (how a reviewer knows), and `## Relevant files`.

Run `node scripts/publish-issues.mjs --validate-only` first: it refuses a missing
frontmatter field, a duplicate id, and a duplicate title, which is also what CI checks.
