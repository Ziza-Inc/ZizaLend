---
title: "Backfill architecture decision records for the decisions already made"
area: docs
difficulty: intermediate
labels: ["documentation"]
---

## Context

An `docs/adr/` directory exists. Decisions that shaped this system — fail-closed token allowlists, a single score recorder rather than an authorised-minter path, one governance instance per governed contract, per-token dust accounting — are visible in the code and in commit messages but not recorded as decisions with their alternatives.

## Task

- Write a decision record for each significant decision already reflected in the code
- Record the alternatives considered and why they were rejected
- Link each record from the code it explains

## Definition of Done

- Each record states the decision, the alternatives, and the consequence
- The directory index lists them

## Relevant files

- `docs/adr/`
