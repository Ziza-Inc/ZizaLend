# Error codes

> **Generated file.** Do not edit it by hand: run
> `node scripts/generate-error-codes.mjs`. `node scripts/generate-error-codes.mjs --check`
> runs in CI and fails when this file is out of date, which is also how a duplicate or
> unassigned code is caught.

**113 codes** — 80 across four contracts, 33 on the API.

## Why this matters

A Soroban contract reports a failure as `Error(Contract, #13)`. That number is the entire
explanation the chain gives, so the name, the trigger, and the recovery all have to come
from documentation like this. On the API side the same applies to a code a client switches
on: a numeric status alone cannot distinguish "retry in a moment" from "this will never
succeed".

Codes are permanent. Once a variant has been deployed, its number is part of the ABI — a
reassignment silently changes the meaning of every log, alert, and client branch that
already refers to it. Add new codes; do not renumber old ones.

## Contract error codes

These are the `#[contracterror]` enums. Each is returned as `Error(Contract, <code>)`
inside a failed invocation, and simulation reports the code without needing a ledger.

| Contract | Enum | Codes |
|---|---|---:|
| RemittanceNFT | `NftError` | 21 |
| LoanManager | `LoanError` | 25 |
| LendingPool | `PoolError` | 14 |
| MultisigGovernance | `GovernanceError` | 20 |
| API | `ErrorCode` | 33 |

### RemittanceNFT — `NftError`

Declared in [`contracts/remittance_nft/src/lib.rs`](../contracts/remittance_nft/src/lib.rs).

Codes are contiguous.

| Code | Variant | Raised in | Guard / condition |
|---:|---|---|---|
| `1` | `AlreadyInitialized` | `initialize` | if env.storage().instance().has(&admin_key) |
| `2` | `NotInitialized` | `set_admin` | — |
| `3` | `UnauthorizedMinter` | `require_admin_or_authorized_minter` | if !is_authorized |
| `4` | `NftAlreadyExists` | `mint`, `admin_remint` | if env.storage().persistent().has(&metadata_key) |
| `5` | `BurnedRequiresApproval` | `mint` | if env.storage().persistent().has(&burned_key) |
| `6` | `NftNotFound` | `admin_remint`, `update_metadata_uri`, `update_score`, `decrease_score`, `apply_score_delta`, `update_history_hash`, `seize_collateral`, `burn`, `transfer` | if !env.storage().persistent().has(&burned_key) |
| `7` | `InvalidRepaymentAmount` | `update_score` | if repayment_amount <= 0 |
| `8` | `CollateralAlreadySeized` | `seize_collateral` | if env.storage().persistent().has(&seized_key) |
| `9` | `SelfTransfer` | `transfer` | if from == to |
| `10` | `DestinationOccupied` | `transfer` | if Self::has_any_remittance_state(&env, &to) |
| `11` | `TransferCooldownActive` | `transfer` | if env.ledger().sequence() < next_allowed_ledger |
| `12` | `InvalidThreshold` | `set_default_burn_threshold` | if threshold == 0 \|\| threshold > Self::MAX_ALLOWED_BURN_THRESHOLD |
| `13` | `ContractPaused` | `assert_not_paused` | if paused |
| `14` | `InvalidHistoryHash` | `update_history_hash` | if new_history_hash == BytesN::from_array(&env, &[0u8; 32]) |
| `15` | `NoProposedAdmin` | `accept_admin` | — |
| `16` | `RemintNotApproved` | `admin_remint` | if !env.storage().persistent().has(&remint_approval_key) |
| `17` | `BelowMinimum` | `update_score` | if repayment_amount < min_repayment |
| `18` | `InvalidMetadataUri` | `validate_metadata_uri` | if len == 0 \|\| len > Self::MAX_METADATA_URI_LEN |
| `19` | `MinterLimitReached` | `add_authorized_minter` | if minters.len() >= Self::MAX_AUTHORIZED_MINTERS |
| `20` | `UnauthorizedScoreRecorder` | `require_score_writer`, `apply_score_delta` | if addr != recorder |
| `21` | `CannotRevokeAdmin` | `revoke_minter` | if minter == admin |

### LoanManager — `LoanError`

Declared in [`contracts/loan_manager/src/lib.rs`](../contracts/loan_manager/src/lib.rs).

Codes are contiguous except for the explicitly reserved 24, 25, 26.

| Code | Variant | Raised in | Guard / condition |
|---:|---|---|---|
| `1` | `AlreadyInitialized` | `initialize` | if env.storage().instance().has(&DataKey::Admin) |
| `2` | `NotInitialized` | `request_loan`, `deposit_collateral`, `refinance_loan`, `set_default_window_ledgers`, `set_max_loan_amount`, `set_max_loans_per_borrower`, `set_admin`, `check_default` | if term < Self::min_term_ledgers(&env) \|\| term > Self::max_term_ledgers(&env) |
| `3` | `LoanNotFound` | `approve_loan`, `get_loan`, `get_loan_accrued`, `repay`, `deposit_collateral`, `release_collateral`, `is_liquidatable`, `get_loan_health`, `liquidate`, `cancel_loan`, `reject_loan`, `purge_loan`, `refinance_loan`, `check_default`, `extend_loan` | ── CHECKS ────────────────────────────────────────────────────────── |
| `4` | `InsufficientScore` | `request_loan`, `refinance_loan` | if score < min_score |
| `5` | `LoanNotPending` | `approve_loan`, `cancel_loan`, `reject_loan` | if loan.status != LoanStatus::Pending |
| `6` | `LoanNotActive` | `repay`, `deposit_collateral`, `liquidate`, `refinance_loan`, `check_default`, `extend_loan` | if loan.status != LoanStatus::Approved |
| `7` | `InvalidAmount` | `request_loan`, `repay`, `deposit_collateral`, `refinance_loan`, `set_max_loan_amount`, `set_max_loans_per_borrower` | if amount <= 0 |
| `8` | `MaxLoansReached` | `request_loan` | if active_loan_count >= max_loans_per_borrower |
| `9` | `ContractPaused` | `require_not_paused` | if paused |
| `10` | `InsufficientPoolLiquidity` | `approve_loan`, `refinance_loan` | if idle_liquidity < loan.amount |
| `11` | `LoanNotRepaid` | `release_collateral` | if loan.status != LoanStatus::Repaid |
| `12` | `LoanNotPastDue` | `check_default` | — |
| `13` | `RepaymentExceedsDebt` | `repay` | if amount > total_debt |
| `14` | `BorrowerMismatch` | `repay`, `cancel_loan`, `extend_loan` | if loan.borrower != borrower |
| `15` | `InvalidRate` | `validate_late_fee_rate`, `set_interest_rate`, `set_min_rate_bps`, `set_max_rate_bps` | if rate_bps > Self::MAX_LATE_FEE_CAP_BPS |
| `16` | `InvalidTerm` | `request_loan`, `approve_loan`, `refinance_loan`, `set_default_term`, `set_min_term_ledgers`, `set_max_term_ledgers`, `extend_loan` | if term == 0 |
| `17` | `LoanPastDue` | `repay`, `refinance_loan`, `extend_loan` | if current_ledger > default_ends |
| `18` | `NoProposedAdmin` | `accept_admin` | `propose_admin`, which is where the problem actually is. |
| `19` | `PoolPaused` | `require_not_paused` | if pool_client.is_paused() |
| `20` | `NftPaused` | `require_not_paused` | if nft_client.is_paused() |
| `21` | `InvalidConfiguration` | `validate_liquidation_threshold`, `validate_liquidation_bonus_bps`, `set_grace_period_ledgers`, `set_default_window_ledgers`, `set_min_score`, `set_min_rate_bps`, `set_max_rate_bps`, `extend_loan` | if (ratio_bps as i128) < Self::MIN_COLLATERAL_RATIO_BPS |
| `22` | `SeizedBorrower` | `request_loan`, `deposit_collateral` | if nft_client.is_seized(&borrower) |
| `23` | `AmountTooLarge` | `accrue_interest` | Calculate interest with high precision. Intermediate values are checked for overflow. |
| `27` | `LoanNotLiquidatable` | `liquidate` | if !Self::is_collateral_ratio_below_threshold( |
| `28` | `LoanNotPurgable` | `purge_loan` | — |

### LendingPool — `PoolError`

Declared in [`contracts/lending_pool/src/lib.rs`](../contracts/lending_pool/src/lib.rs).

Codes are contiguous except for the explicitly reserved 8, 15.

| Code | Variant | Raised in | Guard / condition |
|---:|---|---|---|
| `1` | `AlreadyInitialized` | `initialize` | if env.storage().instance().has(&DataKey::Admin) |
| `2` | `NotInitialized` | `set_admin` | — |
| `3` | `ContractPaused` | `assert_not_paused` | if paused |
| `4` | `InvalidAmount` | `redeem_shares`, `deposit`, `disburse`, `settle_outstanding` | if shares <= 0 |
| `5` | `PoolSizeExceeded` | `deposit` | if total.checked_add(amount).expect("overflow") > max |
| `6` | `InsufficientBalance` | `redeem_shares` | if cur_shares < shares |
| `7` | `InsufficientLiquidity` | `redeem_shares`, `disburse` | if assets_to_return > idle_balance |
| `9` | `InvalidMaxPoolSize` | `set_max_pool_size` | if max < 0 |
| `10` | `NoProposedAdmin` | `accept_admin` | — |
| `11` | `CooldownTooLong` | `set_withdrawal_cooldown` | if ledgers > Self::MAX_WITHDRAWAL_COOLDOWN_LEDGERS |
| `12` | `MinimumHoldTimeNotMet` | `assert_share_held_for_minimum_ledgers` | trap, and `PoolError::MinimumHoldTimeNotMet` was declared but never raised. |
| `13` | `AmountBelowMinimum` | `deposit` | if amount < Self::MIN_DEPOSIT_AMOUNT |
| `14` | `LoanManagerNotSet` | `require_loan_manager` | — |
| `16` | `TokenNotAllowed` | `deposit` | if !Self::token_is_allowed(&env, &token) |

### MultisigGovernance — `GovernanceError`

Declared in [`contracts/multisig_governance/src/lib.rs`](../contracts/multisig_governance/src/lib.rs).

Codes are contiguous.

| Code | Variant | Raised in | Guard / condition |
|---:|---|---|---|
| `4001` | `AlreadyInitialized` | `initialize` | if env.storage().instance().has(&KEY_ADMIN) |
| `4002` | `NotInitialized` | `read_admin` | ── Private helpers ─────────────────────────────────────────────────────── |
| `4003` | `TargetNotSet` | `finalize_admin_transfer`, `get_target` | Get target early to prevent archiving issues in tests |
| `4004` | `NoPendingTransfer` | `approve_transfer`, `finalize_admin_transfer`, `cancel_admin_transfer`, `emergency_cancel_proposal`, `expire_proposal`, `get_pending_transfer`, `get_approval_count`, `get_signers`, `get_threshold`, `has_approved` | ── Cancel ──────────────────────────────────────────────────────────────── |
| `4005` | `TransferAlreadyPending` | `propose_admin_transfer` | if pending.status == ProposalStatus::Active |
| `4006` | `ThresholdExceedsSignerCount` | `propose_admin_transfer` | if threshold > unique_signers.len() |
| `4007` | `ThresholdTooLow` | `propose_admin_transfer` | if threshold < 1 |
| `4008` | `TooManySigners` | `propose_admin_transfer` | if signers.len() > MAX_SIGNERS |
| `4009` | `SignerNotAllowed` | `approve_transfer` | if !is_valid |
| `4010` | `TimelockNotElapsed` | `finalize_admin_transfer` | if now < pending.executable_after |
| `4011` | `ThresholdNotMet` | `finalize_admin_transfer` | if approval_count < pending.threshold |
| `4012` | `DelayTooShort` | `propose_admin_transfer` | if delay_seconds < MIN_TIMELOCK_SECONDS |
| `4013` | `EmptySignerList` | `propose_admin_transfer` | if signers.is_empty() |
| `4014` | `ReproposalCooldownActive` | `propose_admin_transfer` | if now < last_cancelled_at.saturating_add(REPROPOSAL_COOLDOWN_SECONDS) |
| `4015` | `ProposalExpired` | `finalize_admin_transfer` | if now >= expiry_time |
| `4016` | `ProposalNotExpired` | `expire_proposal` | if now < expiry_time |
| `4017` | `ProposalIdMismatch` | `emergency_cancel_proposal` | if pending.id != proposal_id |
| `4018` | `ProposalNotActive` | `approve_transfer`, `finalize_admin_transfer`, `expire_proposal` | if pending.status != ProposalStatus::Active |
| `4019` | `DuplicateSigner` | `propose_admin_transfer` | entries to avoid any ambiguity in quorum semantics. |
| `4020` | `DelayTooLong` | `propose_admin_transfer` | if delay_seconds > MAX_TIMELOCK_SECONDS |
## API error codes

### API error codes — `ErrorCode`

Declared in [`backend/src/errors/errorCodes.ts`](../backend/src/errors/errorCodes.ts) with metadata for each code. The registry is what gives an integrator something to act on; a code the API can return without an entry here is a code whose meaning a client has to guess.

| Code | HTTP | Meaning | What a client should do |
|---|---:|---|---|
| `ACCESS_DENIED` | 403 | Access to this resource is denied | Contact support if you believe this is an error |
| `BLOCKCHAIN_ERROR` | 500 | A blockchain operation failed | Please try again later or contact support |
| `BORROWER_MISMATCH` | 403 | The borrower public key does not match the authenticated user | Ensure the borrower public key matches your wallet |
| `CHALLENGE_EXPIRED` | 401 | The challenge message has expired (valid for 5 minutes) | Request a new challenge and sign it |
| `CONFLICT` | 409 | The request conflicts with the current state of the resource | Review the resource state and retry |
| `DATABASE_ERROR` | 500 | A database error occurred | Please try again later or contact support |
| `DUPLICATE_REQUEST` | 409 | This request has already been processed | Check if the operation was already completed |
| `EXTERNAL_SERVICE_ERROR` | 500 | An external service failed to respond | Please try again later or contact support |
| `FORBIDDEN` | 403 | You do not have permission to access this resource | Ensure you have the required permissions |
| `INSUFFICIENT_BALANCE` | 400 | The account has insufficient balance for this operation | Deposit more funds or reduce the amount |
| `INTERNAL_ERROR` | 500 | An unexpected error occurred on the server | Please try again later or contact support |
| `INVALID_AMOUNT` | 400 | The provided amount is invalid or not a positive number | Provide a valid positive number for the amount field |
| `INVALID_CHALLENGE` | 400 | The challenge message format is invalid | Request a new challenge and retry |
| `INVALID_JSON` | 400 | The request body could not be parsed as JSON | Send a well-formed JSON body and retry |
| `INVALID_LOAN_ID` | 400 | The provided loan ID is invalid | Provide a valid numeric loan ID |
| `INVALID_PUBLIC_KEY` | 400 | The provided Stellar public key format is invalid |  |
| `INVALID_SIGNATURE` | 400 | The provided cryptographic signature is invalid | Sign the challenge message with your wallet and retry |
| `INVALID_TX_XDR` | 400 | The provided transaction XDR is invalid or malformed | Provide a valid signed transaction XDR |
| `LOAN_ALREADY_REPAID` | 400 | This loan has already been fully repaid | No further action is needed for this loan |
| `LOAN_NOT_ACTIVE` | 400 | This loan is not in an active state | Verify the loan status and try again |
| `LOAN_NOT_FOUND` | 404 | The specified loan does not exist | Verify the loan ID and try again |
| `METHOD_NOT_ALLOWED` | 405 | The HTTP method is not supported for this resource | Use a supported HTTP method for this endpoint |
| `MISSING_FIELD` | 400 | A required field was not provided in the request | Check the request body and include all required fields |
| `NOT_FOUND` | 404 | The requested resource does not exist | Verify the resource ID and try again |
| `PAYLOAD_TOO_LARGE` | 413 | The request body exceeds the maximum allowed size | Reduce the payload size and retry |
| `POOL_NOT_FOUND` | 404 | The specified pool does not exist | Verify the pool address and try again |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests. Please try again later | Wait before making another request |
| `SERVICE_UNAVAILABLE` | 503 | A required dependency is unavailable | Please try again later |
| `TOKEN_EXPIRED` | 401 | The JWT token has expired | Log in again to obtain a new token |
| `TOKEN_INVALID` | 401 | The JWT token is invalid or malformed | Log in again to obtain a new token |
| `UNAUTHORIZED` | 401 | Authentication is required to access this resource | Provide valid authentication credentials |
| `USER_NOT_FOUND` | 404 | The specified user does not exist | Verify the user ID and try again |
| `VALIDATION_ERROR` | 400 | Request validation failed | Review the validation errors and correct the input |
