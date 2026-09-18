---
title: "Document the full `PoolError` and `NftError` ranges in the contract READMEs"
area: contracts
difficulty: beginner
labels: ["contracts", "documentation", "good first issue", "help wanted"]
---

## Context

Each contract README describes behaviour but not the error codes a caller can receive. `contracts/remittance_nft/README.md` and `contracts/lending_pool/README.md` list entry points without saying which errors each can return, so integrators have to read the Rust to find out whether a failure is retryable or terminal.

## Task

- Add an error table to each contract README: code, name, trigger, and whether it is retryable
- Regenerate the table from the enum rather than transcribing it by hand, or add a check that the table is complete

## Definition of Done

- Every `#[contracterror]` variant appears exactly once in the README it belongs to
- Markdown table renders correctly on GitHub

## Relevant files

- `contracts/*/README.md`
- `docs/ERROR_CODES.md`
