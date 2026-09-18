---
title: "Define whether user data is deleted or anonymised, and implement it"
area: backend
difficulty: advanced
labels: ["backend", "documentation", "security"]
---

## Context

Financial records must be retained, but a user may ask for their data to be removed. The current schema has no stated policy: no deletion path, no tombstone, and no documented retention rule. Both a privacy request and an audit request land on undocumented behaviour.

## Task

- Write down the retention and deletion policy, distinguishing records that must be kept from data that may be removed
- Implement the chosen behaviour (anonymise identifiers, tombstone the account, keep the ledger of amounts)
- Ensure the retained records remain internally consistent
- Test that a deletion request leaves the financial history reconcilable

## Definition of Done

- The policy exists and the code implements it
- A test asserts that financial totals are unchanged by an account deletion

## Relevant files

- `docs/DATABASE.md`
- `backend/migrations/`
- `backend/src/controllers/userController.ts`
