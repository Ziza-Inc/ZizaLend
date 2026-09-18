# ZizaLend Contracts — Access Control & State Mutation Matrix

This document is the audit-prep deliverable for every public entry point on
every ZizaLend smart contract. Each row specifies:

- **Required Authorizer**: who must sign (`require_auth`) for the call to
  succeed (a contract that the function `invoke_contract`s is auto-trusted
  within its auth context).
- **Delegable?**: whether the role can be granted to additional addresses
  by `authorize_minter`-style flows, or is strictly admin-only.
- **Mutates**: the storage keys / state machine transitions touched.
- **Emits**: events published (used to verify audit logs).
- **Gates**: downstream operations blocked or unblocked by this call.
- **Reentrancy note**: call-out when there's a cross-contract `invoke`
  followed by state mutation that auditors should scrutinize.

> Cross-references live in Rust source at `contracts/<contract>/src/lib.rs`
> and the per-contract `events.rs`. Idempotency / re-entry defenses are
> spelled out in inline ` // CEI: ` comments next to the relevant lines.

---

## Roles and required deploy-time wiring

Each contract has three distinct privileged roles. They are deliberately
separate; reusing one address for two of them should be an explicit, documented
decision rather than a side effect of deployment.

| Role | Scope | How it is set |
| --- | --- | --- |
| **Admin** | Config, pause, upgrade, and the two-step admin hand-off, on every contract | `initialize`, then `propose_admin` / `accept_admin` |
| **LoanManager** | `LendingPool::disburse` and `LendingPool::settle_outstanding` — the only path by which principal leaves the pool | `LendingPool::set_loan_manager` |
| **Governance** | `set_admin` on `LendingPool`, `LoanManager`, and `RemittanceNFT` | `set_governance` on each contract |

### Why the LoanManager role exists

A contract address authorises only *implicitly* — by being the contract
currently executing. A `LoanManager` calling
`token.transfer(pool, borrower, ..)` can therefore never be authorised: the pool
is not in that call stack, and no signature can stand in for a contract address.
Disbursement must be initiated *by the pool*, which is what
`LendingPool::disburse` is for. The `LoanManager` authorises the call and the
pool moves its own funds.

### Why the Governance role exists

`MultisigGovernance::finalize_admin_transfer` invokes `set_admin` on its target.
Before this role existed that call required the *current admin's* signature,
which a governance contract cannot supply, and `set_admin` was simultaneously
reachable by the admin key alone — making the 24-hour timelock and signer quorum
bypassable. Now:

- `set_governance(governance)` is admin-gated.
- Once set, `set_admin` accepts authorisation from the governance contract only.
- `propose_admin` / `accept_admin` remain available to the admin as a two-step
  escape hatch should governance become unreachable.

### Required wiring after deployment

```text
1. deploy RemittanceNFT, LendingPool, LoanManager, MultisigGovernance
2. nft.initialize(admin)
3. pool.initialize(admin)
4. nft.authorize_minter(manager)                 # lets the manager mint reputation NFTs
5. manager.initialize(nft, pool, token, admin)
6. pool.set_loan_manager(manager)                # MANDATORY
7. nft.set_score_recorder(manager)               # MANDATORY
8. gov.initialize(admin, target_contract)
9. target.set_governance(governance)             # on pool, manager and nft
```

Step 6 is mandatory: without it `disburse` returns `LoanManagerNotSet` and **no
loan can be funded**. Step 7 is likewise mandatory for scoring: without it
`update_score` and `decrease_score` reject the manager with
`UnauthorizedScoreRecorder`, so repaying a loan no longer moves a borrower's
score. That failure is deliberately safe and quiet in the sense that it stops
crediting rather than crediting from an untrusted writer. Step 9 closes the
single-key `set_admin` bypass.

Steps 4 and 7 are separate on purpose. `authorize_minter` grants the ability to
mint a reputation NFT; `set_score_recorder` grants the ability to *change an
existing borrower's score*. Only one address holds the latter, because the score
is the input the LoanManager prices loans on and nothing on chain proves a
repayment happened other than the caller's own report.

---

## RemittanceNFT (`contracts/remittance_nft`)

| Function | Required Authorizer | Delegable? | Mutates | Emits | Gates | Reentrancy |
| --- | --- | --- | --- | --- | --- | --- |
| `initialize(admin)` | admin (first call) | No — single-shot | `Admin`, `AuthorizedMinter(admin)`, `AuthorizedMinters=[admin]`, `BurnThreshold=3`, `Version=2`, `Paused=false` | (init) | Whole contract: requires admin for all subsequent admin-only ops | n/a |
| `authorize_minter(minter)` | admin | n/a itself | `AuthorizedMinter(minter)`, `AuthorizedMinters` | `MntAuth` | Allows the address to mint / update / seize within explicitly delegated entry points | n/a |
| `revoke_minter(minter)` | admin | n/a itself | `AuthorizedMinter(minter)` removed; `AuthorizedMinters` rebuilt | `MntRev` | Removes mint/update/seize capability for the address | n/a |
| `upgrade(wasm_hash)` | admin | No | `Version` | `ContractUpgraded` + WASM swap | Contract bytecode identity | n/a |
| `migrate()` | admin | No | Defaults for any missing storage keys | (silent) | After upgrade | n/a |
| `pause` / `unpause` | admin | No | `Paused` | `Paused` / `Unpaused` | Blocks mint/admin_remint/update_score/seize_collateral/burn/transfer | n/a |
| `propose_admin(new)` | current admin | No | `ProposedAdmin` | `AdminProposed` | Two-step admin handover | n/a |
| `accept_admin` | `proposed_admin` | No | `Admin`, clears `ProposedAdmin` | `AdminTransferred(accept)` | Hands admin role to proposed recipient | n/a |
| `set_admin(new)` | current admin | No | `Admin` | `AdminTransferred(govern)` | Single-step, governance-only override | n/a |
| `mint(user, score, hash, uri, minter)` | admin OR authorized minter | Yes (via `authorize_minter`) | `Metadata(user)` | `Mint` | Creates borrower identity; blocks future first-time mints for `user` | n/a |
| `admin_remint(user, score, hash, uri)` | admin | No — strictly admin-only | `Metadata(user)`, `Burned(user)=false`, `RemintApproval(user)=consumed`, `Seized`, `TransferCooldown` cleared | ` AdmRemint` | Overrides the post-burn lockout; consumes one pre-issued approval | n/a |
| `approve_remint(user)` | admin | No | `RemintApproval(user)` | (silent) | Unlocks exactly one subsequent `admin_remint` | n/a |
| `set_score_recorder(recorder)` | admin | No | `ScoreRecorder` | `ScoreRecorderSet` | The single address permitted to move scores on the routine path | n/a |
| `update_score(user, amount, minter)` | the configured `ScoreRecorder`, or admin when `minter` is `None` | No — one recorder | `Metadata.score`, appends `ScoreHistory`, bumps TTLs | `ScoreUpd` | `UnauthorizedScoreRecorder` unless `minter` is the recorder; updates the credit tier the LoanManager prices on | n/a |
| `decrease_score(user, points, minter)` | the configured `ScoreRecorder`, or admin when `minter` is `None` | No — one recorder | `Metadata.score` floored at `MIN_CREDIT_SCORE` | `ScoreDec` | Panics on an unauthorised writer | n/a |
| `apply_score_delta(user, delta, minter)` | admin only — `minter` must be `None` | No | `Metadata.score` clamped to [0, MAX_SCORE] | `ScoreUpd` (+ `ADJ` history reason) | `UnauthorizedScoreRecorder` for any `Some(minter)`, including the recorder: this is the one score path with no economic rule behind it | n/a |
| `decrease_score(user, penalty, minter)` | admin OR auth minter | Yes | `Metadata.score` floored at `MIN_CREDIT_SCORE=300` | `ScoreDecr` + `PEN` history reason | Reduces credit tier; floor prevents under-flow reputation farming | n/a |
| `record_default(user, minter)` | admin OR auth minter | Yes | `DefaultCount(user)` ++; sets `Seized`; auto-burns after `BurnThreshold` | `Seized`, `NftBurned` | Gates new Loans/Collateral; eventual NFT destruction | n/a |
| `seize_collateral(user, minter)` | admin OR auth minter | Yes | `Seized(user)` | `Seized` | Blocks new loan requests + new collateral deposits (does not block repayment) | n/a |
| `burn(user, minter)` | admin OR auth minter | Yes | `Metadata/Score/ScoreHistory/Seized/RemintApproval/TransferCooldown` cleared; `Burned(user)=true` | `NftBurned` | Future mints require `BurnedRequiresApproval`; remint path is admin-only | n/a |
| `update_history_hash(user, hash, minter)` | admin OR auth minter | Yes | `Metadata.history_hash` | `HashUpd` | Anchors remittance-history commitment | n/a |
| `update_metadata_uri(user, uri, minter)` | admin OR auth minter | Yes | `Metadata.metadata_uri` | `UriUpd` | Off-chain IPFS swap | n/a |
| `transfer(from, to, minter)` | `from` AND (admin OR auth minter) | Yes (for the minter role) | `Metadata/ScoreHistory/DefaultCount/Seized/TransferCooldown` swapped | `Transfer` | Re-keys borrower identity; `TRANSFER_COOLDOWN_LEDGERS` blocks immediate retransfer | n/a |
| `get_*` views | none (read-only) | n/a | n/a | n/a | n/a | n/a |

---

## LoanManager (`contracts/loan_manager`)

The LoanManager contract auto-mints and updates credit via `NftClient` calls,
so it must be present in the RemittanceNFT `AuthorizedMinter` set
(established at `initialize`).  Every external token `transfer` is preceded
by `// CEI:` state commits — see inline comments on `approve_loan`,
`liquidate`, `refinance_loan`, and `repay`.

| Function | Required Authorizer | Delegable? | Mutates | Emits | Gates | Reentrancy |
| --- | --- | --- | --- | --- | --- | --- |
| `initialize(nft, pool, token, admin)` | (first call only) | No | `NftContract`, `LendingPool`, `Token`, `Admin`, lazy defaults | (init) | Whole contract | n/a |
| `request_loan(borrower, amount, term)` | `borrower` | No | `Loan(n)` (Pending), `LoanCounter` ++, `BorrowerLoans`, `BorrowerLoanCount` ++ | `LoanRequested` | Sets lifecycle state → Pause/Cascade handles cascades | CEI: state commit precedes no external I/O |
| `approve_loan(loan_id)` | admin | No | `Loan.status = Approved`, sets due-date/term/last_interest_ledger/last_late_fee_ledger; **then** asks the pool to `disburse` | `LoanApproved`, `LoanApprv`, pool `Disbursed` | Unlocks repayment; marks funds out of pool | CEI: state committed before the cross-contract call; the pool moves its own principal, because a LoanManager-initiated transfer out of the pool can never be authorised |
| `deposit_collateral(loan_id, amount)` | recorded `loan.borrower` | No | `Loan.collateral_amount` +=, **then** transfers borrower → contract | `CollateralDeposited` | Increases coverage ratio | CEI: external transfer is the last call |
| `release_collateral(loan_id)` | (admin-only entry, but `borrower` via the public path) | No | `Loan.collateral_amount = 0` **then** transfers contract → borrower | `CollateralReturned` / `CollateralReleased` | Releases escrowed collateral | CEI: state committed before transfer |
| `repay(borrower, loan_id, amount)` | `borrower` | No | Splits `amount` proportionally into principal/interest/latefee; bumps `principal_paid`, decrements balances; if fully repaid: marks `Loan.status = Repaid`, decrements `BorrowerLoanCount`, **then** transfers borrower → pool + releases collateral + credits the score via `update_score` (skipped when the payment is below the NFT's configured minimum, so a high floor cannot fail the repayment) | `LoanRepaid`, optionally `LateFeeCharged` | Closes loan; increased credit | CEI: full state commit precedes transfers; reentrancy on same loan hits `LoanNotActive` |
| `cancel_loan(borrower, loan_id)` | `borrower` | No | `Loan.status = Cancelled`; if collateral present, transfers back **after** state settle | `LoanCancelled`, optionally `CollateralReturned` | Closes pending loan | CEI-safe |
| `reject_loan(loan_id, reason)` | admin | No | `Loan.status = Rejected`; collateral returned post-commit | `LoanRejected`, optionally `CollateralReturned` | Closes pending loan | CEI-safe |
| `liquidate(liquidator, loan_id)` | `liquidator` | No | Under-collateralized loans: `Loan.status = Liquidated`, full debt recovery via proportional split to pool / bonus to liquidator / refund to borrower | `LoanLiquidated`, `CollateralLiquidated` | Closes loan; seizes undervalued collateral | CEI: `loan.collateral_amount = 0` and `Loan.status = Liquidated` committed before any `transfer`; re-entrant `liquidate` on the same id reads `LoanNotActive` |
| `purge_loan(loan_id)` | admin | No | Removes `Loan(loan_id)` and `Collateral(loan_id)` from persistent storage; decrements `BorrowerLoanCount` for Cancelled/Rejected loans | `LoanPurged` | Frees ledger slot | n/a |
| `extend_loan(borrower, loan_id, extra_ledgers)` | `borrower` | No | Extends `due_date`, increments `extension_count`, **then** collects extension fee | `LoanExtended` | Limited to MAX_EXTENSIONS; fee 1% of remaining principal | Reentrancy-safe (no cross-contract call besides token) |
| `refinance_loan(loan_id, new_amount, new_term)` | admin AND `borrower` | No | Settles accrued interest/late fees, adjusts principal, requests/returns the diff from the pool, updates `due_date` | `LoanRefinanced` | Resets loan leg | **Cross-contract calls present**: `approve_loan` audit checklist entry — see test `test_liquidate_is_cei_safe_against_reentrant_token` |
| `check_default(loan_id)` / `check_defaults(loan_ids)` | admin | No | Marks `Loan.status = Defaulted`; seizes collateral; **decrements REMITTANCE NFT SCORE** | `LoanDefaulted` | Closes loan; degrades credit | CEI: score penalties applied after state commit |
| `set_*` (config: rate, late_fee, term, liquidation, min_score, max_amount, min_repay, max_loans, oracle) | admin | No | Instance-storage keys for the relevant config | Per-call events (e.g. `MinScoreUpdated`, `InterestRateUpdated`) | Live configures the next request's eligibility and math | n/a |
| `set_rate_oracle(addr)` | admin | No | `RateOracle` instance key | `RateOracleUpdated` | Replaces rate source; bounded by min/max BPS | CEI: rate is read inside `request_loan` |
| `pause` / `unpause` | admin | No | `Paused`, `PausedAtLedger` | `Paused`, `Unpaused`, `ContractPaused`, `ContractUnpaused` | Blocks `request_loan`, `approve_loan`, `repay`, `deposit_collateral`, `release_collateral`, `liquidate`, `extend_loan`, `refinance_loan`; cascades if pool or NFT paused | n/a |
| `set_governance(governance)` | admin | No | `Governance` | `GovernanceSet` | From this point `set_admin` requires the governance contract's auth | n/a |
| `propose_admin` / `accept_admin` | admin / proposed admin | No | `ProposedAdmin`, `Admin` | `AdminProposed`, `AdminTransferred` | Two-step admin hand-off; works with or without governance configured | n/a |
| `set_admin(new_admin)` | configured governance, else current admin | No | `Admin`, clears `ProposedAdmin` | `AdminTransferred` (via = `admin` \| `governance`) | Hands admin role; this is the entry point `MultisigGovernance::finalize_admin_transfer` invokes | n/a |
| `upgrade(wasm_hash)` | admin | No | `Version` | `ContractUpgraded` + WASM swap | Contract bytecode identity | n/a |
| `view_*` | none (read-only) | n/a | n/a (bumps TTL only) | n/a | n/a | n/a |

---

## LendingPool (`contracts/lending_pool`)

| Function | Required Authorizer | Delegable? | Mutates | Emits | Gates | Reentrancy |
| --- | --- | --- | --- | --- | --- | --- |
| `initialize(admin)` | (first call only) | No | `Admin`, `Paused`, `WithdrawalCooldown`, `Version` | (init) | Whole contract | n/a |
| `deposit(provider, token, amount)` | `provider` | No | `Shares(provider, token)`, `DepositTimestamp`, `DepositorCount`, `TotalShares`, `TotalDeposits`; **then** pulls `amount` from `provider` | `Deposit(provider, token)` | Mints LP shares at current exchange rate | Reentrancy-safe: pre-transfer snapshot, post-transfer bookkeeping |
| `withdraw(provider, token, shares)` | `provider` | No | `Shares`, `DepositTimestamp`, `DepositorCount`, `TotalShares`, `TotalDeposits`; **then** pushes `assets` to `provider` | `Withdraw(provider, token)` | Burns LP shares; cooldown gating honored | Reentrancy-safe: state committed before token transfer |
| `emergency_withdraw(provider, token, shares)` | `provider` | No | Same as `withdraw`, **bypasses** cooldown and pause | `Withdraw` (same event) | Exit hatch when admin pause is in flight | Reentrancy-safe (bypasses `assert_not_paused`) |
| `pause` / `unpause` | admin | No | `Paused` | `PoolPaused`, `PoolUnpaused` | Blocks `deposit`, `withdraw` (but not `emergency_withdraw`) | n/a |
| `set_max_pool_size(token, max)` | admin | No | `MaxPoolSize(token)` | `DepositCapUpdated` | Caps tracked principal | n/a |
| `set_withdrawal_cooldown(ledgers)` | admin | No | `WithdrawalCooldown` | `WithdrawalCooldownUpdated` | Withdrawal pacing | n/a |
| `set_loan_manager(loan_manager)` | admin | No | `LoanManager` | `LoanManagerSet` | Grants the only role that may move principal out of the pool | n/a |
| `disburse(token, to, amount)` | configured LoanManager contract | No — auth is by contract address | `TotalOutstanding(token)` +=, **then** transfers pool → `to` | `Disbursed` | The only path by which principal leaves the pool | CEI: outstanding written before the transfer |
| `settle_outstanding(token, amount)` | configured LoanManager contract | No — auth is by contract address | `TotalOutstanding(token)` -= (saturating at 0) | `OutstandingSettled` | Retires principal on repayment, refinance-down, or default | n/a |
| `adjust_outstanding(token, delta)` | configured LoanManager contract | No — auth is by contract address | `TotalOutstanding(token)` | (silent) | LoanManager bookkeeping (net-delta form of the two above) | CEI-safe |
| `set_governance(governance)` | admin | No | `Governance` | `GovernanceSet` | From this point `set_admin` requires the governance contract's auth | n/a |
| `propose_admin` / `accept_admin` | admin / proposed admin | No | `ProposedAdmin`, `Admin` | `AdminProposed`, `AdminTransferred` | Two-step admin hand-off; works with or without governance configured | n/a |
| `set_admin(new_admin)` | configured governance, else current admin | No | `Admin`, clears `ProposedAdmin` | `AdminTransferred` (via = `admin` \| `governance`) | Hands admin role; this is the entry point `MultisigGovernance::finalize_admin_transfer` invokes | n/a |
| `upgrade(wasm_hash)` | admin | No | `Version` | `ContractUpgraded` + WASM swap | Contract bytecode identity | n/a |
| `view_*` | none | n/a | n/a | n/a | n/a | n/a |

---

## MultisigGovernance (`contracts/multisig_governance`)

This contract has **no native token custody** but updates the admin role on
the target ZizaLend contract.  Its cross-contract `invoke_contract` call in
`finalize_admin_transfer` is the highest-value integration point.

| Function | Required Authorizer | Delegable? | Mutates | Emits | Gates | Reentrancy |
| --- | --- | --- | --- | --- | --- | --- |
| `initialize(admin, target)` | (first call only) | No | `ADMIN`, `TARGET`, `VERSION`, `COUNT=0` | (init) | Whole contract | n/a |
| `propose_admin_transfer(proposed, signers, threshold, delay)` | current `ADMIN` | No | `PENDING` if absent; bumps `COUNT`; bumps `LAST_CANCELLED_AT` cooldown | `GovProp` | Future admin transfer lifecycle | n/a |
| `approve_transfer(signer)` | `signer` (must be in `signers`) | No | `PENDING.approvals[signer] = true` (idempotent) | `GovAppr` | Quorum progress | n/a |
| `finalize_admin_transfer(caller)` | `caller` (pub; anyone once both invariants hold) | No | Cross-contract `target.set_admin(new_admin)`; then commit `KEY_ADMIN`, `KEY_PENDING` cleared, `LAST_CANCELLED_AT` updated | `GovFin` | Hands admin | **Cross-contract**: invokes `set_admin` on the target.  Any non-idempotent behavior on `set_admin` would be headroom; `set_admin` here overwrites cleanly. |
| `cancel_admin_transfer` | current `ADMIN` | No | `PENDING.status = Cancelled`, bumps `LAST_CANCELLED_AT` | `GovCncl` | Re-proposal cooldown for 1 hour | n/a |
| `emergency_cancel_proposal(proposal_id, reason)` | current `ADMIN` | No | Same as `cancel_admin_transfer` but with ProposalCancelledEvent | `GovEmerg` | Same cooldown | Idempotent: re-running on a cancelled proposal is a no-op |
| `expire_proposal(caller)` | `caller` | No | Removes expired `PENDING` | `GovExp` | Clears stuck proposals | n/a |
| `upgrade(wasm_hash)` | current `ADMIN` | No | `VERSION` | `ContractUpgraded` + WASM swap | Bytecode identity | n/a |
| `view_*` | none | n/a | n/a | n/a | n/a | n/a |

---

## Audit checklist (audit-prep self-test)

| Risk Class | Mitigation in code | Verify via |
| --- | --- | --- |
| Auth bypass | Every state-changing entry point calls `require_auth()`; admin paths check the stored admin; minting paths check the `AuthorizedMinter` set (capped at `MAX_AUTHORIZED_MINTERS = 32`) while *score* paths are gated on the single configured `ScoreRecorder`, so no authorised minter can write the reputation the LoanManager prices on; `apply_score_delta` applies no economic rule and is therefore admin-only; remint is strictly admin-gated; principal can only leave the pool via `LoanManager`-authorised `disburse`; `set_admin` is governance-gated once `set_governance` is called. Note that contract-address auth is *implicit* (invoker-based), so tests must exercise cross-contract transfers under realistic auth rather than `mock_all_auths*` | `contracts/tests/tests/real_auth.rs`, `contracts/tests/tests/admin_model.rs`; unit tests `test_authorized_minter_*`; fuzz target `StealWithdraw` |
| Reentrancy | CEI: state committed before any `token_client.transfer` on `approve_loan`, `repay`, `cancel_loan`, `reject_loan`, `liquidate`, `deposit_collateral`, `extend_loan`, `refinance_loan`; cross-contract loan manager finalize in multisig hits a synchronous `set_admin` | Static read of each function; fuzz target `fuzz_target_1.rs`; integration test `test_liquidate_is_cei_safe_against_reentrant_token` |
| Integer overflow / DoS | `checked_mul` / `checked_div` / `checked_add` / `checked_rem` chains throughout; `MAX_RATIO_BPS = 10_000` caps; `MAX_PENALTY_MULTIPLIER = 2` caps debt ceiling; `MAX_LATE_FEE_CAP_BPS = 2500` | Integration test `test_interest_overflow_does_not_panic_loan`; fuzz targets assert `total_deposits` / `score` bounds |
| Score / reputation abuse | `MAX_SCORE = 850` ceiling; `MAX_SCORE_HISTORY_ENTRIES = 50` truncation; `MIN_CREDIT_SCORE = 300` floor; `MIN_SCORE_UPDATE_REPAYMENT = 100` to reject zero-point repayment updates; `MAX_DEFAULT_BURN_THRESHOLD = 1000`; `TRANSFER_COOLDOWN_LEDGERS = 17280` | Fuzz target invariants; integration test `test_authorized_minter_cannot_resurrect_burned_account` |
| Admin compromise | Multisig governance with 24h minimum timelock + 1h reproposal cooldown + 7-day proposal expiry; canonical `propose_admin / accept_admin` two-step on every contract | Multisig test suite; fuzz target `multisig_governance_fuzz.rs` |
| Permissioned-minter abuse | Minter list bounded at 32; per-user `MaxLoansPerBorrower = 3`; `BumpThreshold = 3` defaults for auto-burn on repeat default | Minter-limit test; replicate admin-remint semantics |

---

Maintained by: contracts/system team. Update this matrix when adding a new
public function, adding a new `AuthorizedMinter` style delegate, or
materializing a new cross-contract `invoke_contract` call.
