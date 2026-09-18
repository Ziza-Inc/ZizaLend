---
title: "Shut down cleanly on SIGTERM without abandoning in-flight transactions"
area: backend
difficulty: intermediate
labels: ["backend", "infrastructure"]
---

## Context

A container restart sends SIGTERM and then kills the process. If the server stops accepting connections but does not drain in-flight requests, a request that has already submitted a transaction may not have written its own record of the outcome, leaving the database and the chain inconsistent until a reconciliation job notices.

## Task

- Stop accepting new connections on SIGTERM and drain in-flight requests with a bounded grace period
- Close the database pool and the Redis client after the drain
- Log anything abandoned, with the identifiers needed to reconcile it
- Test the shutdown sequence

## Definition of Done

- A request in flight during shutdown completes and records its outcome
- The process exits non-zero when it had to abandon work

## Relevant files

- `backend/src/index.ts`
