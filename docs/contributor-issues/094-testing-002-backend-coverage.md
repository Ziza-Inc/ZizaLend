---
title: "Add coverage measurement and a threshold for the backend"
area: testing
difficulty: intermediate
labels: ["backend", "testing"]
---

## Context

The backend has an extensive test suite and no coverage measurement. The suite's breadth is evident; its shape is not. Line coverage by module is what shows which controller or service has no test at all, which is exactly what a reviewer wants to check.

## Task

- Add coverage measurement to the backend test run
- Report per-directory coverage
- Set a threshold that ratchets: it may only increase
- Publish a summary on the pull request

## Definition of Done

- Coverage is measured and reported per directory
- The threshold cannot be lowered without an explicit change

## Relevant files

- `backend/package.json`
- `.github/workflows/ci.yml`
