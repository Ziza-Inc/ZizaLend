---
title: "Add integration tests for the notification system"
area: backend
difficulty: intermediate
labels: ["backend", "enhancement", "help wanted", "testing"]
---


## Description

The notification service (`backend/src/services/notificationService.ts`) handles email, SMS, and in-app notifications with SSE streaming, but lacks comprehensive integration tests covering the full notification lifecycle.

## Scope

The notification system covers:
- Creating notifications via `createNotification()` and `bulkCreateNotifications()`
- Reading notifications with filtering (status, type, date range)
- Marking notifications as read/archived
- SSE streaming for real-time delivery
- Email delivery via SendGrid (`backend/src/services/emailService.ts`)
- SMS delivery via Twilio (`backend/src/services/smsService.ts`)
- Notification preferences management
- Digest email generation and scheduling

## Requirements

Add integration tests that cover:
- Full create → read → mark as read → archive lifecycle
- Bulk notification creation and pagination
- SSE stream connection and event delivery
- Notification filtering by type, status, and date range
- Notification preferences update and enforcement
- Digest email generation for users with digest frequency set
- Error handling when email/SMS delivery fails

## Definition of Done

- Tests follow existing patterns in `backend/src/tests/` and `backend/src/__tests__/`
- All notification service public methods are covered
- Tests use mocked external services (SendGrid, Twilio) 
- `npm test` passes
- Test coverage for notification service improves measurably
