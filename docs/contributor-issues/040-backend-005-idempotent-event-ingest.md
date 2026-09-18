---
title: "Make event ingestion idempotent end to end and prove it with a test"
area: backend
difficulty: intermediate
labels: ["backend", "testing"]
---

## Context

Unique constraints were added to the event tables across several migrations, which suggests duplicate ingestion was observed. Whether the guarantee now holds for the whole pipeline — transport retry, indexer restart, manual re-run — is not covered by a test at the level where the duplicates appeared.

## Task

- Write a test that ingests the same event batch three times and asserts one row per event
- Cover the concurrent case: two workers processing the same ledger
- Assert the unique constraints produce a deterministic outcome rather than an unhandled error

## Definition of Done

- Replaying a batch does not change table counts
- The concurrent case is covered, not just the sequential one

## Relevant files

- `backend/src/services/eventIndexer.ts`
- `backend/src/__tests__/`
