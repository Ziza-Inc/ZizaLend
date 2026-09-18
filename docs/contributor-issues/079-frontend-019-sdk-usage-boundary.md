---
title: "Frontend: the app builds its own contracts calls instead of using a shared transaction layer"
area: frontend
difficulty: intermediate
labels: ["frontend", "sdk", "typescript"]
---

## Context

`packages/sdk` is an HTTP client for the backend API — it does not construct Soroban
transactions. The frontend therefore needs its own transaction layer, and it has one in
`frontend/src/app/utils/soroban.ts`: it builds invocations, encodes arguments, and assembles
transactions in the browser.

That makes the browser the *only* place where on-chain arguments are encoded, so the encoding
rules live in application code that no other consumer can use or test in isolation. The
deployment tooling now has exactly this logic in `scripts/scval.ts`, after a mis-typed argument
cost most of a day to diagnose: a `string` where an `Address` was expected produces
`UnreachableCodeReached`, an error that names a function *inside the contract* and gives no
hint that the caller is at fault. The browser has the same failure mode and no shared protection
against it.

## Task

- Extract the browser's Soroban transaction construction into a shared, tested module, the way
  `scripts/scval.ts` did for the server-side tooling
- Reuse the same argument-encoding rules rather than a second implementation, so a
  mis-typed argument is caught by a type or by a test rather than by a diagnostic event
- Cover each operation the app builds a transaction for
- Keep presentation concerns — copy, formatting, preview rendering — in the app

## Definition of Done

- The frontend contains no ad-hoc contract-argument encoding
- The encoding rules have tests that assert the produced `ScVal` type, including for an address
  and for an amount
- Adding an operation reuses the shared layer

## Relevant files

- `frontend/src/app/utils/soroban.ts`
- `scripts/scval.ts`
- `packages/sdk/src/`
