# ZizaLend Multisig Governance Contract

A multi-signature timelock governance contract for admin transfer of any ZizaLend protocol contract.

## Architecture

- **Propose → Approve → Finalize** workflow for admin transfers.
- **Timelock**: Minimum 24-hour delay before any transfer can be finalised.
- **Multi-sig quorum**: Configurable threshold of N-of-M signers must approve.
- **TTL expiry**: Proposals expire after 7 days if not finalised.
- **Cooldown**: 1-hour reproposal cooldown after cancellation prevents rapid re-proposals.
- **Emergency cancel**: Admin can forcefully cancel any active proposal.

## Workflow

```
1. Propose: Admin calls propose_admin_transfer(new_admin, signers, threshold, delay)
2. Approve: Each signer calls approve_transfer(signer)
3. Finalize: Anyone calls finalize_admin_transfer(caller) once:
   - Timelock elapsed (≥24h from proposal)
   - Threshold met (≥ approvals)
   - TTL not expired (<7 days)
```

## Key Invariants

1. **Timelock ≥ 24h**: `delay_seconds` must be ≥ `MIN_TIMELOCK_SECONDS` (86,400).
2. **Timelock ≤ 6 days**: `delay_seconds` must be ≤ `MAX_TIMELOCK_SECONDS` (518,400 =
   the 7-day TTL minus the 24 h minimum). A timelock at or past the proposal's own expiry
   can never be executed, so it is refused at proposal time instead of occupying the
   single proposal slot until an operator cancels it.
3. **Threshold ≤ signers**: Threshold cannot exceed the number of signers.
3. **Threshold ≥ 1**: Empty thresholds are rejected.
4. **Max 20 signers**: Prevents storage/gas abuse.
5. **No duplicate signers**: Explicitly enforced at proposal time.
6. **Single active proposal**: Only one `Active` proposal at a time.
7. **TTL = 7 days**: Proposals expire after `PROPOSAL_TTL_SECONDS` (604,800 seconds).
8. **Approvals are idempotent**: Duplicate calls from the same signer don't double-count.
9. **CEI pattern**: Cross-contract `set_admin` call happens _before_ local state cleanup.

## Public Functions

| Function                                                       | Auth   | Description                          |
| -------------------------------------------------------------- | ------ | ------------------------------------ |
| `initialize(admin, target)`                                    | —      | One-time initialisation              |
| `propose_admin_transfer(new_admin, signers, threshold, delay)` | Admin  | Create proposal                      |
| `approve_transfer(signer)`                                     | Signer | Record approval                      |
| `finalize_admin_transfer(caller)`                              | Anyone | Execute transfer when conditions met |
| `cancel_admin_transfer()`                                      | Admin  | Cancel active proposal               |
| `emergency_cancel_proposal(id, reason)`                        | Admin  | Force cancel with reason             |
| `expire_proposal(caller)`                                      | Anyone | Clean up expired proposal            |

## View Functions

| Function                   | Returns                          |
| -------------------------- | -------------------------------- |
| `get_admin()`              | Current admin address            |
| `get_target()`             | Target contract address          |
| `has_pending_transfer()`   | Whether active proposal exists   |
| `get_pending_transfer()`   | Full `PendingTransfer` struct    |
| `get_approval_count()`     | Number of approvals received     |
| `get_timelock_remaining()` | Seconds until timelock expires   |
| `get_signers()`            | List of current proposal signers |
| `get_threshold()`          | Current approval threshold       |
| `has_approved(signer)`     | Whether signer has approved      |
| `get_proposal_count()`     | Total proposals created          |

## Events

`GovProp`, `GovAppr`, `GovFin`, `GovCncl`, `GovEmerg`, `GovExp`
