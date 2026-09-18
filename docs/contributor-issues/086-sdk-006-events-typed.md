---
title: "SDK: make `LoanEventRecord.eventType` a discriminated union"
area: sdk
difficulty: beginner
labels: ["enhancement", "sdk", "typescript"]
---

## Context

`LoanEventRecord` declares `eventType: string` and every other field as optional. The values are a closed set the contracts actually emit — the backend indexes a fixed list of event types — but the type says any string is valid, so a consumer cannot narrow on it and a typo in a comparison compiles. Making the record a discriminated union over `eventType` turns the payload fields that are currently optional-and-unchecked into fields that are present exactly for the variants that carry them.

## Task

- Enumerate the event types the contracts emit and the backend indexes
- Model the record as a union discriminated on `eventType`, with payload fields required per variant
- Keep a permissive fallback member for an unrecognised type so a new contract event does not break consumers
- Add a test that every emitted type is representable and that the fallback is reachable

## Definition of Done

- Switching on `eventType` narrows the payload without casts
- Adding an event type in the contracts without updating the union is caught by a test or a typecheck, not at runtime

## Relevant files

- `packages/sdk/src/events.ts`
- `contracts/*/src/events.rs`
- `backend/src/services/eventIndexer.ts`
