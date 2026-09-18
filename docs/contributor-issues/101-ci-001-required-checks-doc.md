---
title: "Document the required checks and how to satisfy them"
area: ci-cd
difficulty: beginner
labels: ["ci-cd", "documentation", "github_actions", "good first issue", "help wanted"]
---

## Context

Branch protection requires a set of status checks. A contributor whose pull request is blocked by a check needs to know what it verifies and how to fix it; today the check names are only visible on the pull request, and some have no explanation anywhere.

## Task

- List every required check, what it verifies, and how to run it locally
- Link each to the workflow file and the failing step
- Add the list to the contributing guide

## Definition of Done

- Every required check appears in the document
- A contributor can reproduce each locally

## Relevant files

- `CONTRIBUTING.md`
- `docs/DEVELOPMENT.md`
