---
title: "Document precisely what each pause flag blocks"
area: contracts
difficulty: beginner
labels: ["contracts", "documentation", "good first issue", "help wanted"]
---

## Context

`LoanManager` returns `ContractPaused`, `PoolPaused`, and `NftPaused` from different checks, and the pool has its own pause. Which operations each flag halts — and in particular whether repayment is ever blocked, since blocking repayment during an incident traps borrowers into default — is not stated anywhere.

## Task

- Produce a table of operation against pause flag showing allowed or blocked
- Confirm repayment and withdrawal are never blocked by a pause, or document why a specific case is blocked
- Add a test per cell of the table that can be exercised

## Definition of Done

- The table exists in the docs and matches the code
- A test asserts repayment still works while the pool is paused

## Relevant files

- `contracts/*/src/lib.rs`
- `docs/contracts-ACCESS-CONTROL.md`
