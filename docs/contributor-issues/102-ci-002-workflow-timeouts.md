---
title: "Set a timeout on every workflow job"
area: ci-cd
difficulty: beginner
labels: ["ci-cd", "github_actions", "good first issue", "help wanted", "infrastructure"]
---

## Context

Some jobs declare `timeout-minutes` and some do not. An un-timeouted job that hangs — a test waiting on a socket, a step waiting for input — consumes the default six hours of runner time and holds the pull request open. A short, explicit timeout turns a hang into a fast, attributable failure.

## Task

- Add an appropriate `timeout-minutes` to every job across all workflows
- Set values from observed durations rather than arbitrarily
- Note the reason in a comment for any job that needs to be generous

## Definition of Done

- No job relies on the default timeout
- The values are supported by observed run durations

## Relevant files

- `.github/workflows/`
