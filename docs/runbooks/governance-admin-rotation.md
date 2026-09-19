# Governance Admin Rotation Runbook

Covers what to do when a contract's admin changes unexpectedly, when a signer key
is suspected of being compromised, and when governance itself is unreachable and
the admin has to be rotated through the escape hatch.

**Symptoms:** an `AdminProposed` or `AdminTransferred` event fired and nobody
expected it; a governance signer key may be compromised; the governance contract
cannot be reached and the admin must still be rotated.

## Preconditions

| Requirement | Notes |
| --- | --- |
| Access to the current contract admin secret key | Required for the escape-hatch path in every case |
| Access to the governance contract's admin key **and** enough signer keys to meet the threshold | Required for the governance path |
| The deployed contract IDs | [`docs/deployed-contracts.md`](../deployed-contracts.md), or [`scripts/deployments/testnet.json`](../../scripts/deployments/testnet.json) for Testnet |
| A Stellar CLI configured for the network | `stellar network add` / `stellar contract invoke` |

**Elevated privileges:** yes. The escape-hatch path needs the contract admin
secret key; the governance path needs the governance admin key plus a signer
quorum. Neither is available to a normal operator, and neither should be handed
out to resolve a single incident.

**Expected outcome:** exactly one `AdminTransferred` event, `via` equal to
`governance` for the intended path or `accept` for the escape hatch, and the new
admin confirmed on all three contracts.

---

## 1. Read the event before acting

Every governable contract emits two relevant events:

| Event | Topics | Data | Meaning |
| --- | --- | --- | --- |
| `AdminProposed` | `AdminProposed`, current admin | proposed admin | A two-step rotation was started |
| `AdminTransferred` | `AdminTransferred`, `via` | `(previous_admin, new_admin)` | The admin changed |

`via` is the field that matters: `governance` means `set_admin` was authorised by
the governance contract, `admin` means the current admin called `set_admin`
directly, and `accept` means `accept_admin` completed a two-step proposal.

Do not "fix" anything until you know which of these you are looking at. An
unexpected `AdminProposed` that has not been accepted is a proposal, not a
breach — but it is the first half of one, and the proposed admin can complete it
at any time.

## 2. Unexpected `AdminProposed` — confirm or cancel

The two-step path is authorised by the **current admin** for the proposal and by
the **proposed admin** for the acceptance. So a proposal you did not expect means
the current admin key was used.

1. Identify the current admin from the event's topic. Compare it against the
   recorded admin in [`docs/deployed-contracts.md`](../deployed-contracts.md).
2. If the current admin is legitimate but nobody proposed the transfer, treat the
   admin key as compromised and go to step 4.
3. If the current admin is not the address you expected, the key was already
   rotated once. Go to step 4 immediately.
4. **There is no `cancel_proposed_admin` on the target contracts.** A proposal
   stays until it is accepted or overwritten by another `propose_admin`. The only
   ways to neutralise it are to re-propose a different admin from the current
   admin key, or to rotate the admin through governance. Decide which in step 3
   of section 4.

## 3. Rotate through governance (the intended path)

Use this whenever the governance contract is reachable and the signer set is
intact. It is the only path that does not rest on a single key.

1. **Propose.** From the governance contract's admin key:

   ```
   propose_admin_transfer(proposed_admin, signers, threshold, delay_seconds)
   ```

   `signers` must include the new admin, `threshold` must be within
   `[1, len(signers)]`, and `delay_seconds` must be at least 24 hours
   (`MIN_TIMELOCK_SECONDS = 86_400`). The maximum is the proposal TTL minus those
   24 hours — a timelock at or beyond the proposal's own expiry can never be
   executed, and the contract refuses it rather than accepting a proposal that is
   already unsatisfiable.

2. **Approve.** Each signer calls:

   ```
   approve_transfer(signer)
   ```

   `get_approval_count()` and `get_threshold()` tell you how far along you are.

3. **Wait out the timelock.** `get_timelock_remaining()` returns the seconds left;
   it reads 0 once the window has elapsed.

4. **Finalize.** Once the timelock has elapsed and the approval count meets the
   threshold, anyone may call:

   ```
   finalize_admin_transfer(caller)
   ```

   This performs a cross-contract call to `set_admin` on the target contract,
   which verifies that the caller really is the governance contract.

5. **Verify.** An `AdminTransferred` with `via = governance` must appear on the
   target contract, and `get_current_admin()` on the governance contract must
   report the new admin.

To abandon a proposal before it is finalized, call `cancel_admin_transfer()` from
the governance admin.

## 4. Rotate through the escape hatch (governance unreachable)

The contracts keep `propose_admin` / `accept_admin` available to the current
admin **even after `set_governance`**. That is deliberate — see
[SECURITY-MODEL.md](../SECURITY-MODEL.md#admin-escape-hatch) — because a
governance module that cannot be bypassed is one that can permanently strand a
contract if its signers lose their keys.

Use it only when governance genuinely cannot act, and say so in the incident
record. Every use is a single key exercising authority that a quorum was supposed
to hold.

1. **Propose.** From the current admin key:

   ```
   propose_admin(proposed_admin)
   ```

   This emits `AdminProposed`. Confirm it before continuing: on a live incident,
   an `AdminProposed` nobody expected is also an attack signature.

2. **Accept.** From the **proposed admin** key:

   ```
   accept_admin()
   ```

   This emits `AdminTransferred` with `via = accept`.

3. **Verify** that the target contract's admin is the new address, and that
   `get_governance()` still returns the governance contract — the escape hatch
   changes who the admin is, not whether governance is configured.

4. **Re-establish governance.** If the reason for using the hatch was a lost
   signer set, redeploy the governance contract, re-run `set_governance` on all
   three contracts from the new admin, and confirm the admin no longer needs to
   act alone. A contract left governed but with a single-key recovery path that
   was recently used is the state an attacker wants to find it in.

## 5. Compromised signer key

If a signer key is compromised but the admin key is intact, the fastest safe
action is **not** to rotate the admin. Rotate the signer set instead, through a
governance action that replaces the signers and updates the threshold atomically.

> **Gap:** `MultisigGovernance` currently has no signer-rotation entry point —
> signers and the threshold are fixed at `initialize`. Tracked as issue #51. Until
> it exists, the only way to remove a compromised signer is to redeploy the
> governance contract and re-run the admin hand-off on all three targets, which
> means a window in which the admin key is the only authority. Plan that window
> deliberately; do not improvise it during an incident.

If the compromised key is the **admin** key, or a signer key plus enough of the
others to meet the threshold, treat it as a full compromise: rotate the admin
through governance (section 3) and assume every admin action since the compromise
is untrusted.

## 6. When this runbook stops being enough

Escalate to the security process in [SECURITY.md](../../SECURITY.md) — not the
public issue tracker — when any of the following is true:

- An `AdminTransferred` with an unexpected `via` or an unexpected new admin.
- The admin key or a signer quorum is believed compromised.
- Governance cannot act and the escape hatch is the only remaining path.
- The deployed contract's admin does not match
  [`docs/deployed-contracts.md`](../deployed-contracts.md).
