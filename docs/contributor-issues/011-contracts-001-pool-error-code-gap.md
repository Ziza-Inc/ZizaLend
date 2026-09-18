---
title: "LendingPool: close the gap at error code 8, or document why it is reserved"
area: contracts
difficulty: beginner
labels: ["contracts", "good first issue", "help wanted"]
---

## Context

`PoolError` in `lending_pool/src/lib.rs` numbers its variants 1-7 then jumps to 9. `InvalidMaxPoolSize = 9` follows `InsufficientLiquidity = 7`, so code 8 is unassigned. Nothing documents whether it was removed, reserved, or simply skipped. Because Soroban reports `Error(Contract, #8)` numerically, a client decoding that error today gets no name at all, and the gap invites a future contributor to reuse 8 for an unrelated condition, silently changing the meaning of any log or alert that filtered on it.

## Task

- Decide and record the intent: either add a variant that fills the gap, or add a `// 8 is reserved` comment with the reason it must not be reused
- If a variant is added, give it a real check that returns it — do not add an unreachable code path
- Add a test asserting every code in the enum is unique and that the numbering is contiguous or explicitly documented as sparse

## Definition of Done

- `cargo test` passes
- `cargo clippy -- -D warnings` passes
- The enum carries a comment explaining the numbering, so the decision survives the next reader

## Relevant files

- `contracts/lending_pool/src/lib.rs`
