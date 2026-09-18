---
title: "SDK: bound the total time a request can take, not just each attempt"
area: sdk
difficulty: intermediate
labels: ["enhancement", "sdk", "typescript"]
---

## Context

`timeoutMs` applies per attempt and `maxRetries` multiplies it. With the README's own example configuration of `timeoutMs: 30000` and the default `maxRetries: 3`, a single logical request can occupy 120 seconds plus backoff before it reports anything. A caller has no way to express "give up after five seconds", which is the constraint that actually matters for a UI that must stay responsive.

## Task

- Add a total-deadline option that bounds the whole operation including backoff
- Stop retrying when the remaining budget cannot accommodate another attempt plus its backoff
- Report clearly that the deadline expired rather than reporting the last transport error, which misattributes a policy decision to the network
- Test that a deadline shorter than one attempt's timeout still fails promptly

## Definition of Done

- A caller can bound total latency in one option
- The error names the deadline rather than the underlying transport failure
- Tests cover the deadline expiring during backoff

## Relevant files

- `packages/sdk/src/client.ts`
- `packages/sdk/README.md`
