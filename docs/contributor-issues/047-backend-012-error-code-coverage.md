---
title: "Route every thrown error through a declared error code"
area: backend
difficulty: intermediate
labels: ["backend", "enhancement"]
---

## Context

A registry of API error codes exists with HTTP status and suggested action per code. The question is whether every failure a client can observe carries one, or whether some paths fall through to `INTERNAL_ERROR` — which tells an integrator nothing about how to react.

## Task

- Find every response the error handler can produce and check whether it names a specific code
- Replace generic throws with `AppError.withCode` where a specific cause is known
- Map on-chain contract error codes to API codes so a `Repay` failure is explicable rather than opaque
- Add a test that a transaction rejected by the contract returns a specific, documented code rather than a generic one

## Definition of Done

- Contract failures surface as specific API codes
- The set of codes the API can emit is enumerable from the registry

## Relevant files

- `backend/src/errors/`
- `backend/src/middleware/errorHandler.ts`
- `backend/src/services/sorobanService.ts`
