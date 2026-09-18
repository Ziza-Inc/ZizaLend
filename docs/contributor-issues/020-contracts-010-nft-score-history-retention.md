---
title: "Bound the growth of per-user score history"
area: contracts
difficulty: intermediate
labels: ["contracts", "security"]
---

## Context

`get_score_history` returns a per-user list that is appended to on every score movement. There is no cap or pruning. A user whose score moves often accumulates unbounded persistent storage, and the read path returns the whole list, so both storage rent and read cost grow without limit.

## Task

- Cap the retained history and document the retention rule (ring buffer, or first N plus last M)
- Keep the most recent entries, since those are what a lender or UI displays
- Emit an event when entries are pruned so the change is observable off-chain

## Definition of Done

- Storage per user is bounded regardless of activity
- `get_score_history` returns the most recent entries within the cap
- Tests cover the empty, exactly-full, and over-cap cases

## Relevant files

- `contracts/remittance_nft/src/lib.rs`
