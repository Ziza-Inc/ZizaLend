---
title: "Document the score decay model and pin it with tests"
area: backend
difficulty: beginner
labels: ["backend", "documentation", "good first issue", "help wanted"]
---

## Context

`scoreDecayService` and its cron job implement a decay policy, and `docs/scoring-model.md` describes scoring. Whether the documented decay matches the implemented one — the interval, the floor, whether an inactive user decays to the floor or stops — has not been verified.

## Task

- Compare the documented decay policy with the implementation
- Reconcile any difference, or document the implementation and update the doc
- Add tests for the boundaries: exactly the decay interval, a user at the floor, a user with activity in the window

## Definition of Done

- The doc and the code agree, or the difference is stated
- Tests pin the floor and the interval

## Relevant files

- `backend/src/services/scoreDecayService.ts`
- `docs/scoring-model.md`
