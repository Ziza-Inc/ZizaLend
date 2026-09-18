---
title: "Make the governance quorum configurable at initialization without redeploying"
area: contracts
difficulty: intermediate
labels: ["contracts", "enhancement"]
---

## Context

Each of the three governed contracts needs its own governance instance because an instance names exactly one target. The signer set and threshold are supplied at `initialize` and are immutable, so changing the operator's signer keys across the whole deployment means redeploying three contracts and re-running three hand-offs. Operators need a supported way to do this.

## Task

- Add a rotation path (see the signer-rotation issue) and verify it works for the three-instance topology
- Document the operational procedure, including what happens if one instance is rotated and another is not
- Add a script or runbook step that rotates all three and verifies the result

## Definition of Done

- The runbook can be followed without reading the Rust
- A dry run on Testnet leaves all three instances with the same new signer set

## Relevant files

- `contracts/multisig_governance/src/lib.rs`
- `docs/runbooks/`
- `scripts/`
