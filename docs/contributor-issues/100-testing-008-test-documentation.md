---
title: "Document how to run each test layer, and what each layer is for"
area: testing
difficulty: beginner
labels: ["documentation", "good first issue", "help wanted", "testing"]
---

## Context

There are guest tests, integration tests that cross contracts, fuzz targets, backend unit and integration tests, frontend unit tests, and Playwright end-to-end tests. `docs/TESTING.md` exists but predates several of them. A contributor needs to know which layer to add a test to, and how to run just that layer quickly.

## Task

- Document each layer: purpose, command, expected duration, what it can and cannot catch
- State where a new test belongs
- Give the fastest useful command for iterating on one contract

## Definition of Done

- A contributor can pick the right layer from the document alone
- Every command in the document runs as written

## Relevant files

- `docs/TESTING.md`
