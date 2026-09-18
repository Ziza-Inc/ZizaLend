---
title: "Define what the SDK health helper checks and what a consumer should do with it"
area: packages/sdk
difficulty: beginner
labels: ["documentation", "good first issue", "help wanted", "sdk"]
---

## Context

`health.ts` exists. A health helper that reports a boolean is not actionable; a consumer needs to know which dependency failed, whether the failure is transient, and whether to retry or to stop.

## Task

- Return a structured status: per-dependency state, the checked revision, and the time of the check
- Document the recommended reaction to each state
- Test against an unreachable dependency

## Definition of Done

- A consumer can distinguish 'chain unreachable' from 'database unreachable'
- The recommended reaction is documented

## Relevant files

- `packages/sdk/src/health.ts`
