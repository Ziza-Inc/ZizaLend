---
title: "Cancel superseded runs to stop wasting runner time"
area: ci-cd
difficulty: beginner
labels: ["ci-cd", "github_actions", "good first issue", "help wanted", "infrastructure"]
---

## Context

Pushing three times in a minute starts three full CI runs, and only the last matters. Without a concurrency group keyed by branch, all three consume runners and confuse the pull request's check status.

## Task

- Add a concurrency group per workflow keyed by ref, with cancel-in-progress
- Keep the behaviour on the default branch so a main run is never cancelled by a later one in a way that loses a required check

## Definition of Done

- Pushing twice cancels the first run
- A main-branch run is not cancelled by an unrelated push

## Relevant files

- `.github/workflows/`
