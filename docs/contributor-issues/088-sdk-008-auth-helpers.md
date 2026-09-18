---
title: "Document and test the challenge-response authentication flow in the SDK"
area: packages/sdk
difficulty: intermediate
labels: ["documentation", "sdk", "testing"]
---

## Context

`auth.ts` implements signing a challenge and exchanging it for a session. The flow is security-sensitive: the challenge must be single-use, bound to the requesting key, and time-limited. Those properties are the ones worth documenting and testing explicitly, because they are what prevents a replayed signature from authenticating an attacker.

## Task

- Document the flow end to end, including what the server binds the challenge to
- Add tests that a replayed challenge, a challenge signed by a different key, and an expired challenge are all refused
- Document the clock-skew tolerance

## Definition of Done

- Three negative tests exist and pass against the real server
- The flow is documented well enough to be reimplemented by a third party

## Relevant files

- `packages/sdk/src/auth.ts`
- `backend/src/services/authService.ts`
