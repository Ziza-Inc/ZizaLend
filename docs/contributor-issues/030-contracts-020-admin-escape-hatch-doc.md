---
title: "Document the admin escape hatch and its risk in the security model"
area: contracts
difficulty: beginner
labels: ["contracts", "documentation", "good first issue", "help wanted"]
---

## Context

After `set_governance`, a contract's `set_admin` accepts only the governance contract's authorisation — but `propose_admin`/`accept_admin` remains available to the current admin as a two-step recovery path if governance becomes unreachable. That is a deliberate trade-off with a real consequence: the admin key can still rotate the admin without governance. It should be stated where operators will find it.

## Task

- Document the escape hatch, why it exists, and what it means for the trust model
- State the mitigation: monitoring on the `AdminProposed` and `AdminAccepted` events
- Reference it from the governance and security docs so the two do not contradict each other

## Definition of Done

- `docs/SECURITY-MODEL.md` and the governance runbook describe the hatch consistently
- An operator reading only the security model would know to alert on those events

## Relevant files

- `docs/SECURITY-MODEL.md`
- `docs/runbooks/`
- `contracts/*/README.md`
