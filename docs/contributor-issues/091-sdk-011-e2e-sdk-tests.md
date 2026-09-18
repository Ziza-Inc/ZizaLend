---
title: "Add an integration test that exercises the SDK against a running backend"
area: packages/sdk
difficulty: advanced
labels: ["sdk", "testing"]
---

## Context

SDK unit tests mock the transport, so they verify the SDK against its own assumptions rather than against the service. An integration test that constructs a client against a locally running backend would catch a changed field name, an altered envelope, or a renamed operation at the point of change.

## Task

- Add an integration suite that starts the backend (or uses a compose service) and drives the SDK through the main flows
- Cover the authenticated flow, a paginated list, and a typed error
- Wire it into CI behind the existing services

## Definition of Done

- The suite runs in CI against the compose backend
- Renaming a field in the backend breaks an SDK test

## Relevant files

- `packages/sdk/src/__tests__/`
- `docker-compose.yml`
- `.github/workflows/ci.yml`
