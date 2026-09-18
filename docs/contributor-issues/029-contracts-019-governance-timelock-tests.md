---
title: "Test the timelock boundary against the proposal TTL"
area: contracts
difficulty: intermediate
labels: ["contracts", "testing"]
---

## Context

The timelock must be long enough to be meaningful and short enough that a proposal can still be finalised before its TTL expires. `DelayTooLong` now bounds the upper end, but the boundary — a delay exactly equal to `PROPOSAL_TTL`, and one ledger less — is not pinned by a test.

## Task

- Add tests at the boundary: delay equal to TTL, TTL minus one, and TTL plus one
- Assert the derived relationship rather than the literal constants, so changing either constant cannot make the contract unusable without failing a test

## Definition of Done

- A test fails if a future change makes every proposal unfinalisable
- The relationship between the two constants is asserted directly

## Relevant files

- `contracts/multisig_governance/src/lib.rs`
