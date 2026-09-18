---
title: "Validate webhook URLs against private address ranges"
area: backend
difficulty: advanced
labels: ["backend", "security"]
---

## Context

A subscriber supplies a webhook URL and the server makes a request to it. Without validation, a subscriber can point delivery at a metadata service or an internal address and use the server as a proxy into a private network.

## Task

- Reject non-HTTPS schemes and hostnames that resolve to loopback, link-local, or private ranges
- Re-resolve after each redirect and cap the redirect chain
- Apply a short timeout and a response size cap
- Test each rejected category

## Definition of Done

- A URL resolving to a private address is refused at subscription time and at delivery time
- A redirect to a private address is refused
- The checks have unit tests

## Relevant files

- `backend/src/services/webhookService.ts`
