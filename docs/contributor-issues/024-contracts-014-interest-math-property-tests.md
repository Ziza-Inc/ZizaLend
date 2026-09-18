---
title: "Property-test the interest and late-fee arithmetic for monotonicity"
area: contracts
difficulty: intermediate
labels: ["contracts", "testing"]
---

## Context

Interest accrual uses a high-precision numerator with a per-term denominator. The arithmetic is covered by example tests, but the invariants that matter are properties: the debt never decreases as the ledger advances, accruing twice over the same interval equals accruing once, and the residual dust never makes a fully repaid loan read as unpaid.

## Task

- Add property tests for monotonicity, additivity, and the dust invariant
- Include the boundary cases: zero elapsed ledgers, a single ledger, and the full term
- Keep the rejection of overflow as a typed error, and test it

## Definition of Done

- The property tests run in `cargo test` and in CI
- Asserting the loan's debt at successive ledgers never decreases holds

## Relevant files

- `contracts/loan_manager/src/lib.rs`
- `contracts/fuzz/`
