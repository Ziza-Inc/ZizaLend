---
title: "Verify the rate limiter behaves correctly across instances"
area: backend
difficulty: intermediate
labels: ["backend", "security", "testing"]
---

## Context

Rate limiting is backed by Redis and there are two middleware modules for it. Behind more than one instance, correctness depends on the limiter being atomic; a read-then-write implementation lets N instances each allow a full window's quota, multiplying the effective limit by the instance count.

## Task

- Confirm the increment path is atomic (a single `INCR`-style operation, or a Lua script)
- Add a test asserting the limit holds when requests are issued concurrently against the same key
- Document the failure mode when Redis is unavailable: fail open or closed, and why

## Definition of Done

- The concurrent test shows no over-admission
- The Redis-outage behaviour is documented and matches the code

## Relevant files

- `backend/src/middleware/rateLimitMiddleware.ts`
- `backend/src/services/rateLimitService.ts`
