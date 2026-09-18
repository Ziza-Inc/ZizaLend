---
title: "Route all contract calls through the SDK package"
area: frontend
difficulty: intermediate
labels: ["frontend", "typescript"]
---

## Context

The SDK package exposes typed clients, and the frontend also has its own Soroban utility. Two implementations of transaction building is how the two drift: a change to argument encoding or to the governance wiring has to be made twice, and the second time is forgotten.

## Task

- Move transaction construction out of the frontend and into the SDK
- Keep only presentation concerns in the app
- Add a test in the SDK package for each operation, so the frontend inherits the coverage

## Definition of Done

- The frontend contains no direct contract-argument construction
- Argument encoding is tested once, in the SDK

## Relevant files

- `frontend/src/app/utils/soroban.ts`
- `packages/sdk/src/`
