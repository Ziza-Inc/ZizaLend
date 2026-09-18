---
title: "Give the SDK a documented retry and timeout policy"
area: packages/sdk
difficulty: intermediate
labels: ["enhancement", "sdk", "typescript"]
---

## Context

The SDK wraps RPC reads and transaction submission. Consumers in the frontend and backend each currently layer their own retry behaviour on top, which means two policies, both undocumented, and no single place to reason about idempotency of submission.

## Task

- Add a configurable timeout and a bounded retry policy with backoff
- Make submission idempotent by transaction hash so a retry cannot double-submit
- Separate transient from terminal errors with typed error classes
- Document the policy in the SDK README

## Definition of Done

- A caller gets a typed transient error rather than a raw fetch failure
- Retrying a submission does not submit twice

## Relevant files

- `packages/sdk/src/client.ts`
- `packages/sdk/src/transactions.ts`
