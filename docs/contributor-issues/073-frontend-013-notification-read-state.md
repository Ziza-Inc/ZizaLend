---
title: "Make notification read state consistent across tabs and devices"
area: frontend
difficulty: intermediate
labels: ["bug", "frontend", "ux"]
---

## Context

Notifications are fetched and cached across several hooks and stores, with backend filter indexes over status. Read state that is updated in one tab and not reflected in another, or that reverts on refetch, makes the unread badge untrustworthy — and an untrustworthy badge is one users learn to ignore.

## Task

- Ensure the read mutation writes to one source of truth and the caches derive from it
- Reconcile on window focus and on reconnect
- Add a test that a mark-as-read in one store instance is visible in another

## Definition of Done

- The unread count is identical in every open tab after a mutation
- A refetch does not resurrect a read notification

## Relevant files

- `frontend/src/app/stores/`
- `frontend/src/app/notifications/`
