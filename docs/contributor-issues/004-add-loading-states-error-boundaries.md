---
title: "Add loading states and error boundaries to frontend loan components"
area: frontend
difficulty: beginner
labels: ["enhancement", "frontend", "good first issue", "help wanted", "ux"]
---


## Description

Several loan-related frontend components lack loading states and error boundaries, leading to a poor user experience when data is being fetched or when errors occur. Components should show skeleton loaders during data fetching and gracefully handle errors with retry options.

## Components to Update

- `frontend/src/app/components/loan/LoanHealth.tsx`
- `frontend/src/app/components/loan-wizard/LoanApplicationWizard.tsx`
- `frontend/src/app/[locale]/loans/[loanId]/LoanDetailsPageClient.tsx`
- `frontend/src/app/components/ui/LoanTimeline.tsx`

## Requirements

- Add skeleton loading states (use the existing `Skeleton` component at `frontend/src/app/components/ui/Skeleton.tsx`)
- Wrap each component in an error boundary (use the existing `ErrorBoundary` component at `frontend/src/app/components/global_ui/ErrorBoundary.tsx`)
- Add retry functionality when data fetching fails
- Ensure smooth transitions between loading, error, and success states using the existing `framer-motion` setup

## Design References

- Existing UI components should be reused for consistency (Button, Card, EmptyState, Tooltip)
- Follow patterns established in existing components like `WalletConnectionModal`

## Definition of Done

- All specified components have loading states
- Error boundaries are in place with retry options
- No visual regressions in existing tests
- `npm test` passes
