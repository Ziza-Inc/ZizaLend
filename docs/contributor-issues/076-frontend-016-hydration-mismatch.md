---
title: "Eliminate hydration mismatches in wallet-dependent UI"
area: frontend
difficulty: intermediate
labels: ["bug", "frontend"]
---

## Context

Wallet address, connection state, and anything read from `localStorage` differ between the server render and the first client render. React resolves the mismatch by discarding the server HTML, which costs a visible flash and logs an error in the console that masks real problems.

## Task

- Find every component that reads wallet, storage, or time during render
- Render a stable placeholder on the server and resolve on the client, or defer the subtree with the documented patterns
- Add an e2e assertion that the console contains no hydration error on the main flows

## Definition of Done

- The main flows produce no hydration warning
- No full-page flash on first load

## Relevant files

- `frontend/src/app/components/`
- `frontend/src/app/providers/`
