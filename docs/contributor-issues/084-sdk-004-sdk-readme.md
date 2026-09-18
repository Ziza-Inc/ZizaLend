---
title: "Write an SDK README with a working quick start"
area: packages/sdk
difficulty: beginner
labels: ["documentation", "good first issue", "help wanted", "sdk"]
---

## Context

The SDK package is published as a workspace package and has no README. A developer evaluating the project cannot see how to construct a client, how to call an operation, or how errors are raised, without reading the source.

## Task

- Add a README with install, client construction, one read, one signed operation, and error handling
- Make every snippet compilable, and verify the snippets build
- Document the environment it expects (RPC URL, network passphrase)

## Definition of Done

- Every code block in the README compiles
- A reader can go from nothing to a call without reading source

## Relevant files

- `packages/sdk/README.md`
