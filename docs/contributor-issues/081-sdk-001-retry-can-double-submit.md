---
title: "SDK: a retried POST can submit the same transaction twice"
area: sdk
difficulty: advanced
labels: ["bug", "sdk", "security", "typescript"]
---

## Context

`Client.request()` retries on any error that is not an `ApiError`, and the README states this plainly: "The client automatically retries on transient failures (HTTP 429, 502, 503, 504) and network errors, with exponential backoff." The problem is the *network error* half. A request that times out is not a request that failed: the server may have received it, processed it, and written a transaction, and only the response was lost. Retrying it re-executes the work.

For `GET` that is harmless. For the state-changing endpoints — submitting a signed transaction, creating a loan, marking a notification read — it is a double submission. The client also never sends an idempotency key, so the backend's replay protection cannot engage even where it exists.

## Task

- Make the retry policy aware of the HTTP method: retry idempotent methods freely, and retry others only when the request carries a replay key
- Generate an idempotency key per logical operation and send it on every attempt of that operation (the client already accepts caller-supplied headers)
- Add a test that a POST whose first attempt times out, and whose second attempt succeeds, results in exactly one server-side effect
- Document the guarantee, including what happens when the server does not support the key

## Definition of Done

- A network-timeout retry of a state-changing request cannot produce two effects
- The behaviour is documented in the SDK README's Retry Behavior section, which currently makes no distinction between methods
- A test covers the timeout-then-success sequence

## Relevant files

- `packages/sdk/src/client.ts`
- `packages/sdk/README.md`
- `backend/src/middleware/idempotency.ts`
