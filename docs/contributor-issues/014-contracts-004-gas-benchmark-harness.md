---
title: "Add a gas benchmark harness that records CPU instruction cost per entry point"
area: contracts
difficulty: advanced
labels: ["contracts", "infrastructure", "testing"]
---

## Context

Contract sizes are budgeted in CI (256 KiB per artifact) but *resource cost* is not measured anywhere. Soroban fees are driven by CPU instructions, ledger reads/writes, and bandwidth, and a change that keeps an artifact small can still multiply its instruction count — an unbounded loop added to `check_defaults`, for example. There is no baseline, so a regression in cost would ship unnoticed.

## Task

- Add a benchmark that runs each major entry point under `Env::default()` and captures `env.budget()` consumption
- Cover at minimum: `deposit`, `withdraw`, `request_loan`, `approve_loan`, `repay`, `mint`, `update_score`, `check_defaults`, `finalize_admin_transfer`
- Record a baseline and fail CI when a benchmark regresses beyond a documented tolerance
- Emit a human-readable table into `docs/GAS.md` on demand

## Definition of Done

- `cargo test --bench` or an equivalent harness runs locally and in CI
- A deliberately introduced regression (e.g. an extra storage write in `repay`) fails the check
- `docs/GAS.md` lists measured CPU instructions and read/write counts per entry point

## Relevant files

- `contracts/`
- `.github/workflows/ci.yml`
- `docs/GAS.md`
