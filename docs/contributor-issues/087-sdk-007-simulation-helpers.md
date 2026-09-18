---
title: "Expose transaction preview through a documented SDK helper"
area: packages/sdk
difficulty: intermediate
labels: ["enhancement", "sdk"]
---

## Context

Preview of a transaction's effect is the strongest safety feature in the product: it is what lets a user see the consequence before signing. It is currently reachable only through an internal path, so any consumer wanting to show a preview reimplements the assembly-and-simulate sequence.

## Task

- Add a helper that takes an operation and returns the simulated effect in the same shape the UI displays
- Document which fields are exact and which are ledger-dependent estimates
- Test it against a deterministic operation

## Definition of Done

- A consumer can render a preview with one helper call
- The helper's documentation states the accuracy of each field

## Relevant files

- `packages/sdk/src/simulation.ts`
- `docs/TRANSACTION_PREVIEW.md`
