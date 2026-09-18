---
title: "Audit every query for tenant and ownership scoping"
area: backend
difficulty: advanced
labels: ["backend", "security"]
---

## Context

Loan and remittance reads are scoped by the authenticated wallet in some controllers, and `loanAccess` middleware exists. A single unscoped query — a route that looks up by id without checking ownership — leaks another user's financial history.

## Task

- Enumerate every query that reads a user-owned row and confirm the ownership predicate is present
- Prefer a shared helper that cannot be called without the owner, so the check is hard to omit
- Add tests that fetch another user's loan, remittance, and notification and assert 403 or 404

## Definition of Done

- Every user-owned read path has an ownership test
- Adding a new user-owned table has an obvious place to put the scoping

## Relevant files

- `backend/src/controllers/`
- `backend/src/middleware/loanAccess.ts`
