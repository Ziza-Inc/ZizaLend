---
title: "Resolve duplicate migration timestamps that make ordering ambiguous"
area: backend
difficulty: intermediate
labels: ["backend", "bug", "infrastructure"]
---

## Context

Three pairs of migrations share a timestamp prefix: `1777000000007_*`, `1778000000008_*`, `1786000000016_*`, and `1788000000018_*`. `node-pg-migrate` orders by the full filename, so the tie is broken alphabetically today. That is luck rather than design: renaming either file, or adding a third with the same prefix, can reorder migrations and change which unique constraint is applied first.

## Task

- Identify each duplicate pair and determine whether the current order is required
- Rename so every timestamp is unique, preserving the effective order
- Add a CI check that fails when two migrations share a timestamp prefix
- Confirm the roll-back-and-forward check in CI still passes

## Definition of Done

- No two files in `backend/migrations/` share a prefix
- A duplicate prefix fails a check rather than relying on alphabetical order
- `npm run migrate:up`, down, and up again all succeed from an empty schema

## Relevant files

- `backend/migrations/`
- `.github/workflows/ci.yml`
