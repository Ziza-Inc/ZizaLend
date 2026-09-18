---
title: "Verify the SDK surface matches the OpenAPI operations"
area: packages/sdk
difficulty: intermediate
labels: ["github_actions", "sdk", "testing"]
---

## Context

`packages/sdk` implements an API client and `packages/openapi.json` describes the API. Nothing checks the two agree, so an endpoint added to the backend can go unimplemented in the SDK indefinitely, and a renamed field breaks consumers at runtime.

## Task

- Add a test that every operation in the spec has an SDK method
- Add a test that the SDK's request and response types are generated from the spec rather than hand-written
- Fail CI on drift

## Definition of Done

- Adding an operation without an SDK method fails CI
- Types are derived from the spec

## Relevant files

- `packages/sdk/`
- `packages/openapi.json`
- `.github/workflows/ci.yml`
