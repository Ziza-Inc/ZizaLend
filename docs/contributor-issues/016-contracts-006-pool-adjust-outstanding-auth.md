---
title: "Narrow or document the authorisation on `adjust_outstanding`"
area: contracts
difficulty: intermediate
labels: ["contracts", "security"]
---

## Context

`LendingPool::adjust_outstanding(token, delta)` mutates the pool's accounting of deployed principal. Its authorisation must be exactly one caller — the LoanManager — or any authorised address can move the pool's view of its own balance. Whether that is enforced by `require_auth` on a stored address, by implicit contract auth, or not at all is not obvious from the function.

## Task

- State the intended authorisation in a doc comment and enforce exactly that
- Add a test where a non-LoanManager address attempts the call and is refused
- Confirm the refusal is a typed error, not a panic

## Definition of Done

- A direct call from an arbitrary address fails
- The LoanManager path still works end to end
- The doc comment and the code agree

## Relevant files

- `contracts/lending_pool/src/lib.rs`
- `contracts/loan_manager/src/lib.rs`
