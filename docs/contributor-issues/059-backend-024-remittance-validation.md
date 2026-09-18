---
title: "Validate remittance amounts and counterparties against documented rules"
area: backend
difficulty: beginner
labels: ["backend", "good first issue", "help wanted"]
---

## Context

`remittanceService` records remittance history that feeds the credit score, so the values it accepts directly influence credit decisions. The validation rules — allowed amount range, self-transfer, duplicate submission within a window — need to be written down and enforced at the boundary rather than reconstructed from the code.

## Task

- Write down the acceptance rules for a remittance record
- Enforce them in schema validation and again in the service, since the service is the last line before persistence
- Add tests per rule

## Definition of Done

- Each documented rule has a test
- A rejected record produces a specific error code rather than a generic validation failure

## Relevant files

- `backend/src/services/remittanceService.ts`
- `backend/src/schemas/`
