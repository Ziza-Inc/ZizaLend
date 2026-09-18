---
title: "Verify the transaction preview matches what execution does"
area: backend
difficulty: advanced
labels: ["backend", "bug", "documentation"]
---

## Context

A simulation controller and `docs/TRANSACTION_PREVIEW.md` exist, and the frontend shows a preview before the user signs. A preview that differs from the executed result is worse than no preview: it invites the user to sign something they did not agree to. Preview drift is most likely for accrued interest, which changes between the simulation ledger and the execution ledger.

## Task

- Compare simulated output against executed output for each previewable operation on Testnet
- Quantify and document the expected difference for time-dependent values
- If a preview can be materially wrong, present it as an estimate with the assumption stated, rather than as a fixed number
- Add a test that compares simulation and execution for a deterministic operation

## Definition of Done

- The documentation states which fields are exact and which are estimates
- A deterministic operation's preview matches execution exactly

## Relevant files

- `backend/src/controllers/simulationController.ts`
- `docs/TRANSACTION_PREVIEW.md`
