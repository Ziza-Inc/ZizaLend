---
title: "Use one money-formatting path and avoid floating-point amounts"
area: frontend
difficulty: intermediate
labels: ["bug", "frontend"]
---

## Context

Stellar amounts are integers in stroops with seven decimal places, and `i128` can exceed JavaScript's safe integer range for aggregate values. Formatting that goes through a `number` loses precision, and two formatting helpers that round differently produce a UI where the pool total does not equal the sum of the rows.

## Task

- Centralise amount formatting on a bigint-safe helper
- Never convert a contract amount to a `number` for arithmetic
- Format for display only at the last moment, with an explicit locale and precision
- Add tests with values beyond `Number.MAX_SAFE_INTEGER`

## Definition of Done

- Aggregate totals equal the sum of their rows at any magnitude
- No arithmetic in the app uses a `number` for an on-chain amount

## Relevant files

- `frontend/src/app/utils/`
- `frontend/src/app/components/charts/`
