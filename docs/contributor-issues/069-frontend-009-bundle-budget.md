---
title: "Enforce a bundle-size budget"
area: frontend
difficulty: beginner
labels: ["frontend", "good first issue", "help wanted", "infrastructure"]
---

## Context

The frontend has no size gate. Charts, a wallet SDK, and form libraries make it easy to add a large dependency and only discover the cost when the first-load experience degrades on a slow connection — which is the connection the target user has.

## Task

- Measure the current first-load bundle per route
- Add a CI check that fails when a route grows beyond a documented budget
- Enable the Next.js bundle analyser behind a script for diagnosing a failure

## Definition of Done

- The budget is derived from a measurement
- A deliberately added large dependency fails the check

## Relevant files

- `frontend/package.json`
- `.github/workflows/ci.yml`
