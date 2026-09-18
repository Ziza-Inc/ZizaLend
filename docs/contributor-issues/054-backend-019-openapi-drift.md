---
title: "Detect drift between the OpenAPI spec and the implemented routes"
area: backend
difficulty: intermediate
labels: ["backend", "documentation", "github_actions"]
---

## Context

`packages/openapi.json` is generated from the Swagger definitions and both are type-generated into `packages/types`. CI validates that the spec is well-formed JSON, which is a much weaker property than matching the routes: a route can be added, or its response changed, while the spec stays valid and wrong.

## Task

- Add a check that every registered route appears in the spec with a matching method and path
- Fail when a route is missing, and when the spec declares a route that is not registered
- Regenerate the derived TypeScript types in CI and fail if the result differs from the committed file

## Definition of Done

- Adding a route without updating the spec fails CI
- The generated types are reproducible: regenerating produces no diff

## Relevant files

- `.github/workflows/ci.yml`
- `scripts/dump-swagger.mjs`
- `packages/openapi.json`
