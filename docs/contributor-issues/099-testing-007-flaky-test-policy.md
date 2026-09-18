---
title: "Detect and quarantine flaky tests"
area: testing
difficulty: intermediate
labels: ["github_actions", "testing"]
---

## Context

Tests that depend on external services, timing, or ordering can fail intermittently. Without a policy those failures are re-run until green, which trains contributors to ignore red, and that is how a real regression gets merged.

## Task

- Identify tests that have failed and passed on the same revision
- Quarantine them: tracked, excluded from the gate, with an owner and a deadline
- Never silently retry a failing test in CI

## Definition of Done

- No job retries a failing test invisibly
- Quarantined tests are listed with an owner

## Relevant files

- `.github/workflows/`
- `docs/TESTING.md`
