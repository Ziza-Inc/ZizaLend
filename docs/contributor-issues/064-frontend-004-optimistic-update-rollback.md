---
title: "Roll back optimistic UI updates when a transaction fails"
area: frontend
difficulty: advanced
labels: ["bug", "frontend", "ux"]
---

## Context

Amounts and statuses are cached and reshaped in stores. An optimistic update that is not reverted on failure leaves the UI presenting a state that does not exist — a loan shown as repaid when the transaction was rejected. The user then acts on fiction, which is the worst class of UI bug for a financial application.

## Task

- Audit every optimistic write and confirm it has a rollback path on error and on timeout
- Prefer re-reading from the indexer or the chain after the transaction reaches a terminal state, rather than trusting the local mutation
- Add a test per optimistic write that simulates a terminal failure and asserts the store returns to the pre-action state

## Definition of Done

- Every optimistic update rolls back on failure
- A test fails if a new optimistic update is added without rollback

## Relevant files

- `frontend/src/app/stores/`
- `frontend/src/app/hooks/`
