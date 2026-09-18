---
title: "Decide and document whether collateral is enforced at approval or only at liquidation"
area: contracts
difficulty: intermediate
labels: ["contracts", "documentation", "security"]
---

## Context

`Loan` carries `collateral_amount`, `deposit_collateral` and `release_collateral` exist, and `InsufficientCollateral` is a declared error — but `approve_loan` disburses without requiring any collateral to have been deposited. The risk model therefore depends entirely on `is_liquidatable` and the liquidation path. That may be deliberate; nothing says so.

## Task

- Write down the intended model: is this an uncollateralised, score-based loan with optional collateral, or is a collateral ratio meant to be enforced?
- If optional, remove or re-document `InsufficientCollateral` so the error surface matches the behaviour
- If enforced, add the check and the tests for it

## Definition of Done

- No declared error is unreachable in every code path
- The README and the doc comments describe the same risk model the code implements

## Relevant files

- `contracts/loan_manager/src/lib.rs`
- `contracts/loan_manager/README.md`
