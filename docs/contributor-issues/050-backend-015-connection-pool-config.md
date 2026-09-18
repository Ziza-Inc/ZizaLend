---
title: "Make database pool sizing explicit and configurable"
area: backend
difficulty: beginner
labels: ["backend", "good first issue", "help wanted", "infrastructure"]
---

## Context

The database connection is created in `db/connection.ts`. Pool size, idle timeout, and connection timeout determine behaviour under load and during a database restart. Hard-coded values are invisible to the operator who has to tune them, and unset ones default to a shared-library value that is often wrong for a containerised deployment.

## Task

- Make pool size, idle timeout, and connection timeout configurable through the environment
- Document each with a sensible default, a unit, and the symptom of setting it too low or too high
- Add the variables to `docs/ENVIRONMENT.md` and the `.env.example` so the env-docs check stays green

## Definition of Done

- The env-docs check passes
- Connection exhaustion produces a logged, typed error rather than an unhandled rejection

## Relevant files

- `backend/src/db/connection.ts`
- `docs/ENVIRONMENT.md`
- `backend/.env.example`
