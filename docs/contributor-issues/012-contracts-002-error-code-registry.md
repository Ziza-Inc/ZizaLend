---
title: "Publish a single machine-readable registry of every contract error code"
area: contracts
difficulty: intermediate
labels: ["contracts", "documentation", "testing"]
---

## Context

Error codes are declared in four separate `pub enum` blocks (`NftError`, `LoanError`, `PoolError`, `GovernanceError`) and duplicated again in the backend's `ErrorCode`. Nothing checks that the three views agree, and nothing lets a client turn an on-chain `Error(Contract, #13)` into a name without hand-maintaining a map. This is the shared foundation for error handling on both sides of the API boundary.

## Task

- Add a registry keyed by contract name and numeric code, generated from the Rust sources rather than typed by hand
- Add a CI check that fails when a contract enum and the registry disagree in either direction
- Expose the registry to TypeScript consumers so the frontend and backend stop maintaining their own copies
- Document the mapping from contract code to HTTP status and error code in `docs/ERROR_CODES.md`

## Definition of Done

- Adding a new `#[contracterror]` variant without regenerating the registry fails CI
- The registry round-trips: `cargo test` passes and the TypeScript package typechecks against it

## Relevant files

- `contracts/*/src/lib.rs`
- `scripts/`
- `packages/types/`
- `docs/ERROR_CODES.md`
