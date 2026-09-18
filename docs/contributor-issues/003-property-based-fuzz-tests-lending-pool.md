---
title: "Add property-based fuzz tests for the lending pool contract"
area: infrastructure
difficulty: intermediate
labels: ["contracts", "help wanted", "infrastructure", "rust", "testing"]
---


## Description

The project has an existing fuzz testing setup at `contracts/fuzz/` with Cargo configuration and a fuzz targets directory. However, the fuzz test suite for the `lending_pool` contract (`contracts/lending_pool/`) is incomplete. Adding property-based fuzz tests would help discover edge cases and invariant violations in the pool's deposit, withdraw, and yield distribution logic.

## Background

- Fuzz testing infrastructure already exists at `contracts/fuzz/`
- The `fuzz_targets/` directory contains existing targets to use as reference
- The project maintains a state machine diagram at `docs/wiki/contract-state-machine.md`
- Previous fuzz reports are available in `contracts/fuzz/reports/` for reference

## Requirements

- Add a new fuzz target for the `lending_pool` contract covering:
  - Deposit/withdraw round-trips (balance should always be conserved)
  - Pool share price invariants (share price should never decrease)
  - Yield distribution correctness
  - Emergency withdrawal scenarios
- Verify all existing contracts still compile with `cargo check`
- Document the new fuzz target's invariants

## Definition of Done

- New fuzz target compiles: `cargo check` passes in `contracts/fuzz/`
- Fuzz target runs without panicking on valid inputs
- Existing tests pass: `cargo test` passes in `contracts/`
- Invariants are documented
