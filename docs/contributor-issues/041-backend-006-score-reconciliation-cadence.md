---
title: "Schedule and monitor score reconciliation"
area: backend
difficulty: intermediate
labels: ["backend", "enhancement"]
---

## Context

`scoreReconciliationService` exists to bring the backend's view of a score back in line with the chain. Nothing states how often it runs, what it does on divergence, or how an operator learns that it has been diverging. A reconciliation job nobody watches is indistinguishable from one that is broken.

## Task

- Document the cadence and the action taken on divergence
- Emit a metric and a log line with the divergence magnitude
- Alert when divergence is non-zero for more than a configured window
- Test the divergent and converged paths

## Definition of Done

- Divergence is observable without reading logs by hand
- A test covers both a converging and a stubbornly divergent case

## Relevant files

- `backend/src/services/scoreReconciliationService.ts`
- `backend/src/cron/`
