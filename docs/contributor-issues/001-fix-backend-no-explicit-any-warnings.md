---
title: "Fix 24 `@typescript-eslint/no-explicit-any` warnings across backend"
area: backend
difficulty: beginner
labels: ["backend", "good first issue", "help wanted", "type improvement"]
---


## Description

The backend TypeScript codebase has 24 `@typescript-eslint/no-explicit-any` warnings that should be replaced with proper types. This is a great first issue for learning the backend codebase and TypeScript patterns used in ZizaLend.

## Scope

Files with warnings:
- `backend/src/controllers/loanController.ts` (1)
- `backend/src/cron/scoreDecayJob.ts` (1)
- `backend/src/db/connection.ts` (2)
- `backend/src/middleware/requestLogger.ts` (1)
- `backend/src/utils/logger.ts` (6)
- `backend/src/services/__tests__/eventIndexer.test.ts` (7)
- `backend/src/__tests__/integration/loanDisputeFlow.test.ts` (1)
- `backend/src/__tests__/loanDispute.test.ts` (1)
- `backend/src/__tests__/requestId.test.ts` (1)
- `backend/src/__tests__/version.test.ts` (2)

## Requirements

- Replace each `any` with the appropriate specific type (e.g., `unknown`, `Record<string, unknown>`, proper interface)
- Only use `any` where truly unavoidable (e.g., `catch` blocks)
- Run `npm run lint` to verify no new warnings are introduced

## Definition of Done

- `npm run lint` reports 0 errors and 0 warnings
- `npm run typecheck` passes
- `npm test` passes
