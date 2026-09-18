---
title: "Publish a versioning and compatibility policy for the workspace packages"
area: packages/sdk
difficulty: beginner
labels: ["documentation", "good first issue", "sdk"]
---

## Context

Three workspace packages are consumed by the frontend, the backend, and external users. There is no stated policy on what constitutes a breaking change, how versions move, or how a consumer pins a compatible set. Without one, consumers cannot safely upgrade.

## Task

- Write the policy: what is breaking, how versions increment, what a consumer pins
- State whether the packages are published to a registry, and if not, how a consumer is expected to use them
- Reference the policy from each package README

## Definition of Done

- Each package README links to the policy
- The policy answers what a consumer should pin

## Relevant files

- `docs/`
- `packages/*/README.md`
