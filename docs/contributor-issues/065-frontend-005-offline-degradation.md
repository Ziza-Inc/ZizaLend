---
title: "Handle a Soroban RPC outage without appearing broken"
area: frontend
difficulty: intermediate
labels: ["enhancement", "frontend", "ux"]
---

## Context

When the RPC endpoint is unreachable the app currently has one failure mode, which is whatever the query library does by default. For a lending app the right degradation is specific: cached balances remain visible and clearly marked as stale, and actions are disabled with an explanation rather than failing after the user has signed.

## Task

- Distinguish a transient RPC failure from an authoritative failure
- Serve last-known data with an explicit staleness indicator and the time it was read
- Disable state-changing actions while the chain is unreachable, with the reason shown
- Test the outage path

## Definition of Done

- A user can still see their position during an outage
- No action is offered that cannot succeed

## Relevant files

- `frontend/src/app/`
- `frontend/src/app/lib/`
