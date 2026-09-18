---
title: "Type the event surface in the SDK"
area: packages/sdk
difficulty: intermediate
labels: ["enhancement", "sdk", "typescript"]
---

## Context

`packages/sdk/src/events.ts` and `indexer.ts` exist. If the event payloads are typed as `unknown` or loosely, consumers get no help and a changed topic or payload shape is discovered at runtime in production.

## Task

- Define a discriminated union over event kind with the payload for each
- Provide a narrowing helper so a consumer handles all cases exhaustively
- Add a test that an unknown event kind is rejected rather than silently dropped

## Definition of Done

- Consumers get compile-time exhaustiveness over event kinds
- Adding an event kind without updating the union fails to compile at the consumer

## Relevant files

- `packages/sdk/src/events.ts`
