---
title: "Map every API error code to localised copy"
area: frontend
difficulty: intermediate
labels: ["enhancement", "frontend", "typescript"]
---

## Context

The backend returns machine-readable error codes precisely so the UI can render a message the user understands. The app is localised under `[locale]`, so every code needs a translation in every configured locale, and a code with no translation currently falls back to whatever raw string the server sent.

## Task

- Consume the shared error-code registry rather than a hand-written switch
- Add a translation entry per code per locale, with a test asserting none are missing
- Fall back to a generic, localised message rather than to the server's English text
- Add an error boundary path that shows the code so a support request can include it

## Definition of Done

- A test fails when a registry code has no translation
- No user-visible surface renders a raw server error string

## Relevant files

- `frontend/src/app/`
- `packages/types/`
