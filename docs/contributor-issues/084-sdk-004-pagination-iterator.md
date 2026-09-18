---
title: "SDK: add a cursor iterator so consumers stop re-implementing pagination"
area: sdk
difficulty: intermediate
labels: ["enhancement", "sdk", "typescript"]
---

## Context

Four modules — `events`, `loans`, `remittances`, `transactions` — return a `page_info` object carrying `next_cursor`, and none of them offers a way to consume more than one page. Every consumer that needs the whole set writes the same loop, and each writes it slightly differently: some stop on a missing cursor, some on a short page, some on a cursor that repeats. A repeated cursor is the failure mode that matters, because a loop that stops only when the cursor is absent never terminates against a server that echoes the last one.

This is the SDK's job precisely because the correct loop is subtle and the consumer's version is not reviewed.

## Task

- Add an async iterator that yields items across pages until the cursor is exhausted
- Terminate on a missing cursor, a repeated cursor, and a configurable page-count ceiling
- Expose it for each paginated module without changing the existing single-page methods
- Test the repeated-cursor and the maximum-page cases, not only the happy path

## Definition of Done

- A consumer can iterate a full collection in one `for await` loop
- A server echoing the same cursor does not produce an infinite loop
- The existing single-page methods keep their signatures

## Relevant files

- `packages/sdk/src/events.ts`
- `packages/sdk/src/loans.ts`
- `packages/sdk/src/remittances.ts`
- `packages/sdk/src/transactions.ts`
