---
title: "Bound the work `check_defaults` does per invocation"
area: contracts
difficulty: advanced
labels: ["contracts", "security"]
---

## Context

`check_defaults(loan_ids)` takes an unbounded `Vec<u32>` and processes every element in one transaction. Resource limits are per-transaction, so a caller can pass a vector large enough that the transaction cannot complete: the batch fails as a whole, and no loan in it is processed. The per-loan isolation work in the default pipeline means one bad loan no longer aborts the batch, but the *length* of the batch is still an unbounded input.

## Task

- Cap the number of loans processed in a single call and return the number actually processed
- Document the cap and the reason for it
- Add a test at the boundary: exactly `MAX` succeeds, `MAX + 1` is handled deterministically rather than consuming unbounded resources

## Definition of Done

- A call with an oversized vector cannot exhaust the transaction budget
- The existing per-loan isolation tests still pass
- The cap is a named constant, not a magic number inline

## Relevant files

- `contracts/loan_manager/src/lib.rs`
