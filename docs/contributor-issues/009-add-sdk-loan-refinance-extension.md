---
title: "Add SDK client methods for loan refinancing and extension"
area: infrastructure
difficulty: intermediate
labels: ["enhancement", "help wanted", "infrastructure", "sdk", "typescript"]
---


## Description

The TypeScript SDK at `packages/sdk/src/loans.ts` provides methods for the basic loan lifecycle (request, repay, cancel, liquidate) but is missing methods for **loan refinancing** and **loan extension**. These features exist in the backend API and Soroban contracts but aren't exposed through the SDK.

## Background

The loan manager contract supports:
- **Loan Refinancing** (`LoanRefinanced` event): Borrower can refinance a loan with new terms (amount, duration)
- **Loan Extension** (`LoanExtended` event): Borrower can extend the loan due date with an additional fee

The backend controllers handle these operations and the event indexer processes the related events, but the SDK doesn't provide a typed interface for them.

## Files to Reference

- `packages/sdk/src/loans.ts` — Existing loan methods to follow as patterns
- `packages/sdk/src/client.ts` — Base client for API calls
- `packages/sdk/src/types.ts` — Type definitions
- `backend/src/controllers/loanController.ts` — Backend API handlers
- `backend/src/services/eventIndexer.ts` — Event parsing for refinance/extension events

## Requirements

Add the following methods to the SDK `Loans` class:

### `refinanceLoan(loanId: string, newAmount: string, newTermLedgers: number): Promise<SimulateAndSubmitResult>`
- Simulates and submits a refinance transaction
- Validates that the loan is in an active state
- Returns the transaction result

### `extendLoan(loanId: string, additionalLedgers: number): Promise<SimulateAndSubmitResult>`
- Simulates and submits a loan extension
- Returns the transaction result

## Definition of Done

- New methods follow the SDK's existing patterns, types, and error handling
- TypeScript compilation passes in the SDK package
- SDK tests pass: `npm test` in `packages/sdk/`
- Methods are exported from the main SDK entry point
