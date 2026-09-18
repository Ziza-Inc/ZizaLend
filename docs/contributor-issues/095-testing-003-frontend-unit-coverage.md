---
title: "Add coverage measurement for the frontend unit tests"
area: testing
difficulty: beginner
labels: ["frontend", "testing"]
---

## Context

The frontend has a Jest suite and no coverage report. Unit tests for hooks, stores, and formatters are where the arithmetic and the state transitions are verified, and those are the parts a UI refactor silently breaks.

## Task

- Enable coverage collection for the Jest project
- Report per-directory and set an initial threshold
- Add a test for the money-formatting helpers specifically

## Definition of Done

- Coverage is reported and enforced at a documented level
- The formatting helpers — where precision loss would be silent — are covered

## Relevant files

- `frontend/jest.config.js`
- `frontend/package.json`
