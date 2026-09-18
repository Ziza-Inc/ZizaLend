---
title: "Require an idempotency key on every state-changing endpoint"
area: backend
difficulty: intermediate
labels: ["backend", "enhancement", "security"]
---

## Context

An idempotency middleware exists and a `transaction_submissions` table records submissions, but coverage across routes is not stated. Any endpoint that submits a transaction and lacks the middleware can be replayed by a retried client — a double-click, a proxy retry — and disburse twice.

## Task

- Enumerate every route that mutates on-chain state or creates a durable record
- Ensure each requires an idempotency key, and that a replayed key returns the original outcome rather than repeating the work
- Add a route-level test asserting the middleware is applied, so a new route cannot be added without it

## Definition of Done

- A test enumerating mutating routes fails when one lacks the middleware
- Replaying a request with the same key returns the first response and does not re-execute

## Relevant files

- `backend/src/middleware/idempotency.ts`
- `backend/src/routes/`
