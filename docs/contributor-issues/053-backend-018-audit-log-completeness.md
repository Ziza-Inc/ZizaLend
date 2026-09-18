---
title: "Cover every privileged action with an audit log entry"
area: backend
difficulty: advanced
labels: ["backend", "security"]
---

## Context

`auditLogService` and the middleware exist. The property that matters is completeness: a privileged action — resolving a dispute, adjusting a score, changing governance state, pausing a contract — must produce an audit record even when the action fails partway. Partial coverage is worse than none, because the absence of a record reads as the absence of an action.

## Task

- Enumerate every privileged action and confirm each writes an audit entry
- Ensure the entry is written for failures as well as successes, with the reason
- Add a test asserting an entry is produced for each action in the list, so a new privileged action cannot be added silently

## Definition of Done

- The enumeration is exhaustive over the admin controllers
- A failed privileged action still produces a record

## Relevant files

- `backend/src/middleware/auditLog.ts`
- `backend/src/services/auditLogService.ts`
- `backend/src/controllers/admin`
