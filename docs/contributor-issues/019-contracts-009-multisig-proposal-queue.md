---
title: "Allow more than one pending governance proposal"
area: contracts
difficulty: advanced
labels: ["contracts", "enhancement"]
---

## Context

The contract stores a single pending transfer. A proposal with a long timelock occupies the only slot for its entire lifetime, so a second, more urgent hand-off cannot even be proposed until the first is cancelled or expires. Operationally this serialises governance on the slowest decision.

## Task

- Move to a keyed queue of proposals with an id, while keeping the existing single-proposal surface working for compatibility or migrating it deliberately
- Enforce a maximum number of concurrent proposals so storage stays bounded
- Keep the proposal-expiry semantics from the current implementation

## Definition of Done

- Two proposals with different targets can be pending at once
- Expiry still frees the slot
- A dedicated test proves the queue cannot exceed its bound

## Relevant files

- `contracts/multisig_governance/src/lib.rs`
