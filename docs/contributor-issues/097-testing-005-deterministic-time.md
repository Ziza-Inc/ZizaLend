---
title: "Make every time-dependent test deterministic"
area: testing
difficulty: intermediate
labels: ["contracts", "testing"]
---

## Context

Tests advance the ledger with `env.ledger().with_mut`. Where interest, late fees, or a cooldown are involved, a test that depends on an implicit ledger advancement is passing for a reason the author did not choose, and adding an unrelated assertion changes the timing and breaks it.

## Task

- Audit the tests for implicit ledger dependence
- Make the ledger position explicit at every point where it matters
- Add a helper so advancing time is one clearly named call

## Definition of Done

- Each time-dependent test states the ledger it operates at
- Reordering assertions does not change the result

## Relevant files

- `contracts/*/src/test.rs`
- `contracts/tests/`
