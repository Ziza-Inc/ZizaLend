---
title: "Verify deployed bytecode against the repository build"
area: contracts
difficulty: intermediate
labels: ["contracts", "infrastructure"]
---

## Context

A deployment records contract addresses but nothing proves the deployed bytecode is the bytecode in this repository. A reviewer, or an operator after an incident, has to trust that the artifacts were built from the tagged revision. Soroban makes this checkable: the WASM hash is what `uploadContractWasm` installs, so a locally recomputed hash can be compared against the uploaded code.

## Task

- Extend the smoke test (or add a check) that recomputes each WASM hash and compares it with the on-chain contract's executable hash
- Fail loudly when the deployed code is not the built code
- Record the hashes in the deployment manifest

## Definition of Done

- Running the check against the Testnet deployment passes
- Changing a byte of a contract source makes the check fail

## Relevant files

- `scripts/smoke-testnet.ts`
- `scripts/soroban.ts`
