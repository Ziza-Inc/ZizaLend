---
title: "Add bounded retry with backoff around Soroban RPC calls"
area: backend
difficulty: intermediate
labels: ["backend", "enhancement"]
---

## Context

`sorobanService` talks to a remote RPC endpoint. Public Soroban RPC nodes return transient errors — a lagging node, a rate limit, a refused connection, a transaction not yet visible to `getTransaction` — and a single attempt turns any of those into a user-visible failure. The submission path already polls, but the read paths do not retry.

## Task

- Add a shared, bounded retry helper with exponential backoff and jitter
- Apply it to read and simulate calls; keep submission idempotent by transaction hash so a retry cannot double-submit
- Return a typed error after the final attempt, distinguishing transient from terminal failures
- Add tests with a stubbed transport failing N times and then succeeding

## Definition of Done

- A transport that fails twice then succeeds results in a successful call
- A permanently failing transport produces one typed error after a bounded number of attempts
- No retry path can submit the same transaction twice

## Relevant files

- `backend/src/services/sorobanService.ts`
- `backend/src/utils/`
