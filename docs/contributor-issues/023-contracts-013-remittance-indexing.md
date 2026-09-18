---
title: "Add event indexing guidance and a schema for every contract event"
area: contracts
difficulty: intermediate
labels: ["contracts", "documentation", "infrastructure"]
---

## Context

The backend indexer captures contract events, but there is no single description of the event surface: topic layout, whether an address is indexed, and the payload shape. The indexer therefore has to be kept in step with the contracts by reading them, and a changed topic silently stops matching.

## Task

- Document every emitted event with its topics and payload in one place
- Add a test that fails when an event is published with a topic the documentation does not list
- Note for each event whether the indexer depends on it, so a change can be assessed

## Definition of Done

- Every `env.events().publish` call site is represented in the documentation
- A new event with no documentation entry fails a test

## Relevant files

- `contracts/*/src/events.rs`
- `docs/`
- `backend/src/services/eventIndexer.ts`
