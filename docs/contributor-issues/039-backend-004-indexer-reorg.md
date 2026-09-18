---
title: "Handle ledger reorganisation in the event indexer"
area: backend
difficulty: advanced
labels: ["backend", "bug", "security"]
---

## Context

Stellar ledgers are closed and final in practice, but an indexer that records the last processed ledger and resumes from it can still mis-handle a gap: if the RPC node's latest ledger moves backwards, or a cursor is stored before the corresponding events are committed, events are skipped and a loan's history is silently incomplete.

## Task

- Confirm the cursor is advanced only after the events for that ledger are committed
- Detect a backwards-moving head and refuse to continue rather than skipping
- Add a reconciliation pass that compares indexed events against on-chain state and reports divergence
- Test the restart, gap, and backwards-head cases

## Definition of Done

- An interrupted indexer resumes without skipping an event
- Divergence is reported rather than silently accepted

## Relevant files

- `backend/src/services/eventIndexer.ts`
- `backend/src/services/indexerManager.ts`
