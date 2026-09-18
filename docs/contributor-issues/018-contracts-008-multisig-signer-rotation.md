---
title: "Add signer-set rotation to MultisigGovernance"
area: contracts
difficulty: advanced
labels: ["contracts", "enhancement"]
---

## Context

Signers and the approval threshold are fixed at `initialize`. The only way to change the signer set is to redeploy the governance contract and re-run the admin hand-off, which means the addresses recorded across the three governed contracts all change. A governance module that cannot rotate its own keys is difficult to operate: a single compromised signer key cannot be removed.

## Task

- Add a governance action that replaces the signer set and updates the threshold atomically
- Require the existing threshold to approve the rotation — a single signer must not be able to reshape the set that constrains them
- Enforce `threshold <= signer_count` and the existing signer-count ceiling
- Emit an event carrying the old and new signer sets

## Definition of Done

- A rotation approved by fewer than the current threshold is refused
- A rotation that would produce `threshold > signer_count` is refused
- `cargo test` covers rotation, refusal, and the boundary values

## Relevant files

- `contracts/multisig_governance/src/lib.rs`
