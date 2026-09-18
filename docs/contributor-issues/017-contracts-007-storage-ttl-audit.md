---
title: "Audit and test TTL extension for every persistent storage key"
area: contracts
difficulty: advanced
labels: ["contracts", "security"]
---

## Context

Soroban archives persistent entries whose TTL is not extended. The contracts call `bump_persistent_ttl` and `bump_instance_ttl` in many places, but nothing verifies that *every* persistent key is bumped on every write path — a missed key means a loan, score, or share balance silently disappears after the TTL elapses while the contract still reads it as absent.

## Task

- Enumerate every `DataKey` variant stored persistently and confirm each is bumped on write and on read-heavy paths
- Add a test that advances the ledger far enough to archive an entry and asserts the contract behaviour is either correct or an explicit, documented error
- Document the chosen TTL policy in the contract README

## Definition of Done

- Every persistent key has a documented TTL policy
- Forgotten keys would be caught by a test rather than by a production incident

## Relevant files

- `contracts/*/src/lib.rs`
