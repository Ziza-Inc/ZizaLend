---
title: "Prove cache invalidation for state that changes on-chain"
area: backend
difficulty: advanced
labels: ["backend", "bug"]
---

## Context

The cache layer has key helpers and a TTL. Cached loan and pool data becomes wrong the moment a transaction lands, and an indexer lag makes the window longer than any TTL. A user who just repaid can be shown an outstanding balance, which reads as the payment having failed.

## Task

- Enumerate cached entities and identify what invalidates each
- Invalidate on the event that changes the entity rather than relying on TTL alone
- Add a test that a state-changing flow leaves no stale cached entry for the entity it changed

## Definition of Done

- A post-transaction read never serves pre-transaction data
- The invalidation points are listed in one place

## Relevant files

- `backend/src/services/cacheService.ts`
- `backend/src/utils/cacheKeys.ts`
