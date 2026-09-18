---
title: "Verify dependency review covers every lockfile"
area: ci-cd
difficulty: intermediate
labels: ["ci-cd", "github_actions", "security"]
---

## Context

The repository has separate lockfiles for the backend, frontend, scripts, and the root workspace. A dependency review action that inspects only the default path misses the others, so a vulnerable or licence-incompatible dependency added to the backend would not be flagged.

## Task

- Confirm the review covers every lockfile and every ecosystem present (npm, cargo)
- Configure a licence allowlist deliberately rather than accepting the default
- Test the check with a deliberately rejected dependency

## Definition of Done

- A dependency added to any package is reviewed
- The licence policy is explicit

## Relevant files

- `.github/workflows/dependency-review.yml`
