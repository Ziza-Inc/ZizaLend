---
title: "Share validation rules between the form and the backend"
area: frontend
difficulty: intermediate
labels: ["enhancement", "frontend", "typescript"]
---

## Context

Amount and term validation exists in the request-loan wizard and again in the backend schema. When the two diverge the user is told a value is fine and then rejected by the server, or is blocked from a value the server would have accepted. The contract enforces a third set of limits.

## Task

- Move the shared rules into `packages/types` so one definition serves the form and the schema
- Surface the on-chain limits (minimum and maximum amount, term window) in the UI rather than hard-coding them
- Add a test asserting a value accepted by the form is accepted by the backend schema

## Definition of Done

- No validation rule is defined twice
- The form states the current on-chain limits rather than a stale constant

## Relevant files

- `frontend/src/app/components/loan-wizard/`
- `backend/src/schemas/`
- `packages/types/`
