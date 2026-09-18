---
title: "Give every data surface explicit loading, empty, and error states"
area: frontend
difficulty: beginner
labels: ["frontend", "good first issue", "help wanted", "ux"]
---

## Context

Skeleton components exist. Whether every screen uses one, and whether every screen distinguishes 'no data yet' from 'could not load data', is unverified. The distinction matters: a failed load shown as an empty list tells a user they have no loans when in fact the request failed.

## Task

- Audit each data surface for all three states
- Make the error state distinguishable from the empty state, with a retry action
- Add a test or story per surface

## Definition of Done

- No surface renders an empty state on a failed request
- Every surface has a retry affordance on error

## Relevant files

- `frontend/src/app/components/skeletons/`
- `frontend/src/app/`
