---
title: "SDK: honour `Retry-After` instead of guessing the backoff"
area: sdk
difficulty: intermediate
labels: ["bug", "sdk"]
---

## Context

The backend's rate limiters are configured with `standardHeaders: true`, so a 429 response carries a `Retry-After` header stating how long the caller must wait. The client ignores it and always sleeps `2^attempt * 200ms` — 200ms, 400ms, 800ms for the default `maxRetries: 3`. Against the simulation limiter's one-minute window, all three retries fire while the window is still closed and the caller receives a rate-limit error that waiting would have avoided. Against a one-second `Retry-After`, the client over-waits for whatever the header asked for.

On a network whose capacity is shared, this also means every client converges on the same short retry schedule and re-hammers the limiter in lockstep, which is the opposite of what the header is for.

## Task

- Read `Retry-After` on a 429 or 503 and wait the stated interval, capped by a documented maximum
- Add jitter so independent clients do not retry in lockstep
- Fall back to exponential backoff when the header is absent or unparseable
- Test both header forms: delta-seconds and an HTTP-date

## Definition of Done

- A 429 carrying `Retry-After: 60` is not retried after 200ms
- Both header formats are parsed and covered by a test
- The cap and the jitter are documented

## Relevant files

- `packages/sdk/src/client.ts`
- `packages/sdk/README.md`
