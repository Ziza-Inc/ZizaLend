# ZizaLend Lending Pool Contract

A share-based (LP token) liquidity pool serving multiple token markets from a single contract instance.

## Architecture

- **Share-based accounting**: Every deposit mints LP shares at the current exchange rate. Yield is implicit in the share price — no separate `claim` step required.
- **Multi-token support**: One contract instance manages independent pools for different token addresses, but only for tokens the admin has registered with `allow_token`. A deposit is what creates a market, so the set of served assets is an admin decision, not a caller's.
- **Withdrawal cooldown**: Configurable per-token delay (in ledgers) between deposit and withdrawal.
- **Minimum hold time**: 1-ledger minimum prevents flash-loan-style deposit/withdraw cycles in the same transaction.
- **Donation-resistant share pricing**: Every share/asset conversion credits a virtual share and a virtual asset (the ERC-4626 offset), so tokens sent directly to the pool cannot be used to inflate the share price and round a later depositor out of their deposit.
- **Emergency pause**: Admin can pause deposits/withdrawals; `emergency_withdraw` bypasses both pause and cooldown but still enforces the one-ledger minimum hold time, so it cannot be used as a same-ledger flash exit.
- **Admin governance**: Two-step admin transfer (`propose` + `accept`) and immediate `set_admin`.
- **Upgradeable**: WASM-hash replacement with version tracking.

## Key Invariants

1. `total_pool_assets = idle_balance + total_outstanding`
2. `shares × (total_assets + 1) / (total_shares + 1)` always equals the depositor's proportional claim (including yield).
3. First depositor always receives a 1:1 share-to-asset allocation.
4. Subsequent depositors cannot dilute existing holders, and a balance donated directly to the pool cannot be redeemed back by whoever sent it.
5. Share price is monotonic non-decreasing (yield can only increase it).
6. `TotalDeposits` can never exceed `MaxPoolSize` when the cap is set. `TotalDeposits` is a principal *cost basis*, not an asset value: a redemption reduces it by the pro-rata principal of the burned shares.
7. Withdrawals can only reduce the idle balance — `total_outstanding` is only modified by `adjust_outstanding`.

Up to one unit of the asset is not attributable to any holder: the virtual position in the offset can never be redeemed. It stays in the pool and improves solvency rather than enriching anyone.

8. Only an admin-registered token can be deposited (`TokenNotAllowed` otherwise). Delisting a token (`disallow_token`) stops new deposits but leaves existing positions withdrawable, so an asset can never be delisted into a state where lenders cannot exit.

## Public Functions

| Function                                      | Description                              |
| --------------------------------------------- | ---------------------------------------- |
| `initialize(admin)`                           | One-time initialisation                  |
| `deposit(provider, token, amount)`            | Deposit tokens, receive LP shares        |
| `withdraw(provider, token, shares)`           | Redeem shares for underlying assets      |
| `emergency_withdraw(provider, token, shares)` | Bypass pause and cooldown; the minimum hold still applies |
| `collect_dust(token)`                         | Admin reclaims accumulated rounding dust |
| `set_max_pool_size(token, max)`               | Set deposit cap (0 = unlimited)          |
| `set_withdrawal_cooldown(ledgers)`            | Configure cooldown period                |
| `pause() / unpause()`                         | Emergency controls                       |
| `propose_admin(new_admin) / accept_admin()`   | Two-step admin transfer                  |
| `set_admin(new_admin)`                        | Immediate admin transfer                 |
| `upgrade(new_wasm_hash)`                      | Contract upgrade                         |

## View Functions

| Function                                       | Returns                                  |
| ---------------------------------------------- | ---------------------------------------- |
| `get_share_price(token)`                       | Current LP share price (1_000_000 = 1.0) |
| `get_deposit(provider, token)`                 | Underlying asset value of LP shares      |
| `get_shares(provider, token)`                  | Raw LP share balance                     |
| `get_depositor_yield(provider, token)`         | `(shares, current_asset_value)`          |
| `get_pool_stats(token)`                        | PoolStats struct with utilisation        |
| `get_total_deposits(token)`                    | Total tracked principal                  |
| `get_total_shares(token)`                      | Total LP shares outstanding              |
| `allow_token(token)`                           | Admin: register a market (required before any deposit) |
| `disallow_token(token)`                        | Admin: stop new deposits; positions stay withdrawable |
| `is_token_allowed(token)`                      | Whether a token has been registered       |
| `get_depositor_count(token)`                   | Unique depositor count                   |
| `get_accumulated_dust()`                       | Current rounding dust balance            |
| `get_max_pool_size(token)`                     | Deposit cap                              |
| `get_withdrawal_cooldown()`                    | Current cooldown period                  |
| `get_withdrawal_available_at(provider, token)` | Earliest withdrawal ledger               |
| `get_withdraw_cooldown_left(provider, token)`  | Ledgers remaining                        |

## Events

- `Deposit(provider, token, amount, shares)`
- `Withdraw(provider, token, amount, shares)`
- `YieldDistributed(token, amount)`
- `DustCollected(amount)`
- `DepositCapUpdated(token, old_cap, new_cap)`
- `WithdrawalCooldownUpdated(old, new)`
- `PoolPaused / PoolUnpaused`
- `AdminProposed / AdminTransferred`
- `ContractUpgraded`

## Errors

Every variant of `PoolError` in [`src/lib.rs`](src/lib.rs), with the condition
that raises it and whether a caller can usefully try again. Soroban reports these
on chain as `Error(Contract, #<code>)`, so the number is the stable part and the
name is the readable one.

The table is kept complete by `scripts/check-contract-error-docs.mjs`, which
fails CI when the enum and this table disagree in either direction.

| Code | Variant | Raised when | Retryable |
| ---: | --- | --- | --- |
| 1 | `AlreadyInitialized` | `initialize` is called on a contract that already has an admin | No |
| 2 | `NotInitialized` | A function that needs the admin runs before `initialize` | No |
| 3 | `ContractPaused` | The pool is paused and the operation is not `emergency_withdraw` | Yes, once an admin unpauses |
| 4 | `InvalidAmount` | `amount` or `shares` is zero or negative | No, without a valid amount |
| 5 | `PoolSizeExceeded` | A deposit would push `TotalDeposits` past the configured `MaxPoolSize` | Yes, after the cap is raised or other providers withdraw |
| 6 | `InsufficientBalance` | The provider holds fewer shares than `withdraw` was asked to burn | No |
| 7 | `InsufficientLiquidity` | The idle balance cannot cover the withdrawal; principal is lent out | Yes, once borrowers repay or providers deposit |
| 8 | *reserved* | Not raised. It was the withdrawal-cooldown violation code before the cooldown was reworked into `CooldownTooLong` (11). The number is held rather than reused so an error already decoded from a deployed ledger keeps its meaning | — |
| 9 | `InvalidMaxPoolSize` | `set_max_pool_size` is called with a negative value | No |
| 10 | `NoProposedAdmin` | `accept_admin` is called with no proposal outstanding | No |
| 11 | `CooldownTooLong` | `set_withdrawal_cooldown` exceeds the maximum the contract allows | No |
| 12 | `MinimumHoldTimeNotMet` | Shares have not been held for the minimum number of ledgers (flash-loan guard) | Yes, once the ledger has passed |
| 13 | `AmountBelowMinimum` | A deposit is below the configured minimum | Yes, with a larger amount |
| 14 | `LoanManagerNotSet` | A pool operation needs the LoanManager and none is configured | No, and not by the caller — an admin has to set it |
| 15 | *reserved* | Not raised. It was declared as `UnauthorizedLoanManager`, which nothing could raise: the gate is `loan_manager.require_auth()`, and `require_auth` aborts the host call rather than returning a value, so the variant was unreachable by construction | — |
| 16 | `TokenNotAllowed` | A deposit names a token the admin has not registered as a market | Yes, once an admin calls `allow_token` |
| 17 | `OutstandingOverflow` | `adjust_outstanding` would push the outstanding counter past `i128::MAX` | No |
| 18 | `OutstandingUnderflow` | `adjust_outstanding` would push the outstanding counter below zero | No |

"Retryable" means the same call can succeed later without the caller changing
anything but timing. A non-retryable code needs a different input, a different
caller, or an admin action — retrying it unchanged fails identically.
