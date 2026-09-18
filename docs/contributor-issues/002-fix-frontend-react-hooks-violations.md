---
title: "Fix React Hooks violations in frontend components"
area: frontend
difficulty: beginner
labels: ["frontend", "good first issue", "help wanted", "react"]
---


## Description

The frontend codebase has several React Hooks violations that need to be fixed. These include conditional hook calls, missing dependencies in `useMemo`, and creating components during render.

## Specific Violations

### 1. Conditional Hooks in LoanDetailsPageClient
**File:** `frontend/src/app/[locale]/loans/[loanId]/LoanDetailsPageClient.tsx`

Hooks (`useState`, `useDepositCollateral`, `useReleaseCollateral`, `useOptimisticUI`, `useContractToast`) are called conditionally, violating the Rules of Hooks.

### 2. Component Created During Render
**File:** `frontend/src/app/[locale]/notifications/page.tsx` (line ~70-83)

An `Icon` component is created inside the render function body. Components should be defined outside of the render cycle.

### 3. Missing useMemo Dependencies
**File:** `frontend/src/app/[locale]/notifications/page.tsx`

A `useMemo` hook has missing dependencies in its dependency array.

### 4. setState Call in Effect
**File:** `frontend/src/app/[locale]/page.tsx`

Calling `setState` synchronously within an effect can trigger cascading re-renders.

## Requirements

- Refactor conditional hook calls so hooks are called unconditionally at the top level
- Move component definitions outside of render functions
- Add missing dependencies to `useMemo` dependency arrays
- Use `useCallback` or restructure effects to avoid cascading renders

## Definition of Done

- `npx eslint .` reports 0 React Hooks related errors
- `npm run typecheck` passes
- `npm test` passes
- All existing functionality remains intact
