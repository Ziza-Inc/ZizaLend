---
title: "SDK: type the API error code so consumers can branch exhaustively"
area: sdk
difficulty: intermediate
labels: ["enhancement", "sdk", "typescript"]
---

## Context

`ApiError` exposes `errorCode?: string`. The backend publishes a closed set of codes in `backend/src/errors/errorCodes.ts` with HTTP status, description, and suggested action for each, and `packages/types` already derives types from the OpenAPI document. Despite that, the SDK degrades the code to an optional string, so a consumer cannot handle the known cases exhaustively and any string comparison silently fails to match when a code is renamed.

The optionality is the second half of the problem: `errorCode` is `undefined` for any error that did not come through the backend's error handler, which is precisely the case a consumer needs to distinguish.

## Task

- Derive the error-code union from the shared registry rather than restating it
- Type `errorCode` as the union plus an explicit unknown member, so `undefined` becomes a named case rather than a missing field
- Add a narrowing helper consumers can switch on
- Add a test asserting every code the registry declares is representable

## Definition of Done

- A consumer switching on `errorCode` gets exhaustiveness checking
- Removing a code from the backend registry makes the SDK fail to typecheck
- `undefined` is handled explicitly rather than assumed away

## Relevant files

- `packages/sdk/src/client.ts`
- `packages/types/`
- `backend/src/errors/errorCodes.ts`
