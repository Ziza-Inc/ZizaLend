---
title: "Test the pool against first-depositor share inflation"
area: contracts
difficulty: advanced
labels: ["contracts", "security", "testing"]
---

## Context

Share price is derived from `total_pool_assets` over `total_shares`. The classic attack on this shape is a first depositor minting one share and then donating assets to inflate the share price so that later depositors round down to zero shares. `calc_shares_to_mint` returns `InvalidAmount` when the result is zero, which blocks one variant, but the rounding direction and the donation path need explicit adversarial tests.

## Task

- Write tests that reproduce the inflation attempt at several magnitudes
- Confirm whether a donation to the pool can move the share price, and document the answer
- If a loss is possible for a subsequent depositor, quantify the maximum and decide whether the mitigation belongs in code or in documentation

## Definition of Done

- Tests exist for the donation and rounding-down cases
- The behaviour is either demonstrably safe or documented with a bounded worst case

## Relevant files

- `contracts/lending_pool/src/lib.rs`
- `contracts/tests/`
