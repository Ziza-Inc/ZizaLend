---
title: "Honour per-user notification preferences on every dispatch path"
area: backend
difficulty: intermediate
labels: ["backend", "bug"]
---

## Context

A `user_notification_preferences` table and migration exist. Whether every dispatch path consults it — including the retry processor and any broadcast — determines whether muting means muted, or merely means muted for the paths that were remembered.

## Task

- Trace every call site that delivers a notification and confirm the preference is checked before delivery
- Centralise the check so a new dispatch path inherits it
- Add a test per channel asserting a muted user receives nothing

## Definition of Done

- A muted user receives no notification on any channel
- A new dispatch path cannot bypass the check without a test failing

## Relevant files

- `backend/src/services/notificationService.ts`
- `backend/src/services/webhookRetryProcessor.ts`
