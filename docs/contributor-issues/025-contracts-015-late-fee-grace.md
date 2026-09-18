---
title: "Test the interaction between the grace period and the late-fee ledger marker"
area: contracts
difficulty: intermediate
labels: ["contracts", "testing"]
---

## Context

`approve_loan` sets `last_late_fee_ledger` to `due_date + grace_period_ledgers`, and late fees accrue from there. Changing the grace period after a loan is approved therefore changes when its late fee started, because the stored marker was computed from the old value rather than recomputed. Whether that is intended needs a decision and a test.

## Task

- Establish the intended semantics: is the grace period frozen at approval, or live?
- Add tests for both the live and frozen readings, whichever is chosen
- If frozen, document that changing the parameter does not affect existing loans; if live, ensure the accrual is consistent across the change

## Definition of Done

- The behaviour is explicit in code and in the doc comment
- A test pins the chosen semantics so a future refactor cannot change it silently

## Relevant files

- `contracts/loan_manager/src/lib.rs`
