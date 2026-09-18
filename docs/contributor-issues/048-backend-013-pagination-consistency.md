---
title: "Make pagination consistent across list endpoints"
area: backend
difficulty: intermediate
labels: ["backend", "documentation", "enhancement"]
---

## Context

List endpoints return collections of loans, remittances, notifications, and events. Whether they share a pagination contract — the parameter names, the cursor or offset semantics, the response envelope, the maximum page size — is unclear, and inconsistency forces every client to special-case each endpoint.

## Task

- Define one pagination contract and document it
- Apply it to every list endpoint
- Enforce a maximum page size and reject or clamp a larger request deliberately
- Add a test per endpoint asserting the envelope shape and the clamp

## Definition of Done

- All list endpoints share the documented envelope
- A page-size above the maximum is handled consistently and documented

## Relevant files

- `backend/src/controllers/`
- `docs/`
- `packages/openapi.json`
