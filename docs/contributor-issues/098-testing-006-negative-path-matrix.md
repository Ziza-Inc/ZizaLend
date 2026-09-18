---
title: "Build a negative-path matrix for every entry point"
area: testing
difficulty: advanced
labels: ["contracts", "security", "testing"]
---

## Context

Each entry point has failure modes: not initialised, paused, unauthorised caller, invalid argument, wrong state. Whether every combination is covered by a test is not known, and the unauthorised-caller and wrong-state cells are the ones that matter for security. A matrix makes the gaps visible.

## Task

- Enumerate entry points against failure categories
- Mark covered and uncovered cells
- Fill the uncovered security-relevant cells
- Add the matrix to the test documentation so new entry points extend it

## Definition of Done

- The matrix exists and is kept current
- Every entry point has an unauthorised-caller test

## Relevant files

- `contracts/`
- `docs/TESTING.md`
