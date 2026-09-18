---
title: "Write an accounting invariant suite that runs against every test scenario"
area: testing
difficulty: advanced
labels: ["contracts", "testing"]
---

## Context

The contracts maintain `total_outstanding`, `total_deposits`, `total_shares`, and per-loan state. The invariant that ties them together — funds in equals funds out plus what is owed — is asserted in individual tests, not continuously. An invariant checked after every scenario in the suite catches the case a scenario author did not think to assert.

## Task

- Add a shared assertion that reconciles the pool's accounting with the sum of live loans
- Call it at the end of every scenario in the contract test suite
- Include the share-price and deposit-total relationship

## Definition of Done

- The assertion runs in the existing suite without modification to each test
- An intentionally corrupted accounting mutation is caught

## Relevant files

- `contracts/tests/`
- `contracts/*/src/test.rs`
