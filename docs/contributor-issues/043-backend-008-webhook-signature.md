---
title: "Sign webhook deliveries and document verification"
area: backend
difficulty: advanced
labels: ["backend", "documentation", "security"]
---

## Context

Webhooks are delivered with retries and a delivery log, but the consumer has no stated way to verify that a delivery came from ZizaLend rather than from an attacker who learned the endpoint URL. Without a signature, a consumer must either trust the URL or fetch state independently.

## Task

- Sign the payload with a per-subscription secret (HMAC over a canonical body plus a timestamp)
- Include the timestamp to prevent replay and document the tolerance window
- Document the verification procedure with a worked example in Node and in Python
- Test that a tampered body and a stale timestamp are rejected

## Definition of Done

- A consumer following the docs can reject a forged delivery
- Replay outside the tolerance is rejected
- Example code in the docs is runnable

## Relevant files

- `backend/src/services/webhookService.ts`
- `docs/webhooks.md`
