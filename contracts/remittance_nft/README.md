# ZizaLend Remittance NFT Contract

A non-transferable (with cooldown) reputation NFT that tracks a borrower's credit score, remittance history, and collateral status on-chain.

## Architecture

- **Score-based reputation**: Each NFT stores a credit score (0–850) that gates loan eligibility in the LoanManager.
- **History tracking**: Score changes are recorded with ledger timestamps, capped at the 50 most recent entries.
- **Authorized minters**: Only the admin and explicitly authorised contracts (e.g., LoanManager) can mint/update scores.
- **Seized flag**: Marks a borrower's collateral as seized, blocking new loan requests but allowing repayment of existing debt.
- **Auto-burn on repeated default**: After `burn_threshold` defaults, the NFT is automatically burned.
- **Admin remint**: Burned accounts can be recovered only via admin-gated `admin_remint()` with a prior `approve_remint()`.
- **Transfer with cooldown**: NFTs can be transferred between wallets with a 17,280-ledger cooldown between transfers.

## Key Invariants

1. **Score bounds**: Score never exceeds `MAX_SCORE` (850) and is bounded at `MIN_CREDIT_SCORE` (300) on decrease.
2. **No duplicate mints**: An address can only hold one NFT at a time.
3. **Burned is terminal**: `mint()` rejects burned addresses — recovery requires the admin-only `admin_remint()` path.
4. **Remint is single-use**: Each `approve_remint()` is consumed on use and cannot be reused.
5. **Seized ≠ burned**: A seized borrower can still repay loans and clear their debt; seized is cleared on burn/transfer/remint.
6. **Transfer moves all state**: Metadata, score history, default count, and seized flag all move atomically to the destination.
7. **Minter cap**: Maximum 32 authorised minters.
8. **Metadata URIs are allowlisted**: only `ipfs://` or `https://` URIs, at most `MAX_METADATA_URI_LEN` (256) bytes, are stored. Enforced on `mint`, `admin_remint`, and `update_metadata_uri`, so a stored URI is always resolvable and never an unbounded storage payload.

## Public Functions

| Function                                 | Auth                | Description                        |
| ---------------------------------------- | ------------------- | ---------------------------------- |
| `initialize(admin)`                      | —                   | One-time initialisation            |
| `mint(user, score, hash, uri, minter)`   | Admin/minter        | Create new NFT                     |
| `admin_remint(user, score, hash, uri)`   | Admin               | Recover burned account             |
| `burn(user, minter)`                     | Admin/minter        | Remove NFT                         |
| `update_score(user, amount, minter)`     | Admin/minter        | Increase score by repayment        |
| `decrease_score(user, points, minter)`   | Admin/minter        | Apply penalty                      |
| `apply_score_delta(user, delta, minter)` | Admin/minter        | Positive/negative score adjustment |
| `seize_collateral(user, minter)`         | Admin/minter        | Set seized flag                    |
| `record_default(user, minter)`           | Admin/minter        | Increment default counter          |
| `transfer(from, to, minter)`             | User + admin/minter | Move NFT between wallets           |
| `approve_remint(user)`                   | Admin               | Grant one-time remint approval     |
| `authorize_minter(minter)`               | Admin               | Add authorized minter              |
| `revoke_minter(minter)`                  | Admin               | Remove authorized minter           |

## View Functions

| Function                                 | Returns                                 |
| ---------------------------------------- | --------------------------------------- |
| `get_score(user)`                        | Current score (0 if no NFT)             |
| `get_metadata(user)`                     | `RemittanceMetadata` (score, hash, URI) |
| `get_metadata_uri(user)`                 | Metadata URI string                     |
| `is_seized(user)`                        | Whether collateral is seized            |
| `get_default_count(user)`                | Number of recorded defaults             |
| `get_score_history(user, offset, limit)` | Paginated score change history          |
| `get_transfer_cooldown_remaining(user)`  | Ledgers until next transfer             |
| `is_remint_approved(user)`               | Whether remint approval exists          |
| `is_authorized_minter(minter)`           | Whether address can mint                |
| `get_authorized_minters()`               | List of all authorized minters          |

## Events

`Mint`, `AdmRemint`, `NftBurned`, `ScoreUpd`, `ScoreDecr`, `Seized`, `Transfer`, `MntAuth`, `MntRev`, `UriUpd`, `HashUpd`, `Paused`, `Unpaused`, `AdminProposed`, `AdminTransferred`, `ContractUpgraded`.
