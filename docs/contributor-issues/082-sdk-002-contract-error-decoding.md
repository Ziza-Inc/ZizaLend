---
title: "Decode on-chain contract errors into typed SDK errors"
area: packages/sdk
difficulty: intermediate
labels: ["enhancement", "sdk", "typescript"]
---

## Context

A failed invocation surfaces as a generic simulation or submission error carrying a `Error(Contract, #n)` string. Consumers have to parse that text to know what happened. The registry work makes a proper mapping possible, and the SDK is where it belongs.

## Task

- Map numeric contract codes to named, typed errors
- Attach the reclaimable meaning: whether the failure is retryable and what the caller should do
- Expose the raw diagnostic so nothing is lost
- Add a test per contract code family

## Definition of Done

- A caller can branch on a typed error rather than parsing a string
- Unknown codes are surfaced as an explicit unknown-typed error, not swallowed

## Relevant files

- `packages/sdk/src/`
- `docs/ERROR_CODES.md`
