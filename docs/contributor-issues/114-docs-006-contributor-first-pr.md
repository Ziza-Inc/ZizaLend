---
title: "Make the first-pull-request path concrete and verified"
area: docs
difficulty: beginner
labels: ["documentation", "good first issue", "help wanted"]
---

## Context

The contributing guide describes the workflow. Whether the described steps actually work from a clean clone — the exact commands, the exact Node and Rust versions, the environment file, the database, and the first test run — is the difference between a guide and a guess.

## Task

- Follow the guide from a clean clone and fix every step that does not work as written
- Add the expected output of the key commands so a contributor can tell success from failure
- Time the path and simplify whatever dominates it

## Definition of Done

- A contributor following the guide reaches a passing test suite without improvising
- Every command's expected output is shown

## Relevant files

- `CONTRIBUTING.md`
- `docs/DEVELOPMENT.md`
