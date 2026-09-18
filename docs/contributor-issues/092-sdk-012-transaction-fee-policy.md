---
title: "Make the fee strategy explicit and configurable"
area: packages/sdk
difficulty: intermediate
labels: ["enhancement", "sdk"]
---

## Context

Transaction construction sets a fee. Whether that is a fixed fee, a simulated fee, or an inclusion-fee-based value determines whether a transaction is included during congestion and whether the user overpays. On Soroban, resource fees dominate, so a fixed legacy fee is likely wrong.

## Task

- Determine the correct fee strategy for Soroban: use the simulated resource fee plus a configured inclusion fee
- Expose both as configurable with documented defaults
- Verify against Testnet that a transaction built this way is included

## Definition of Done

- Fees are a documented, configurable policy
- A transaction with the default policy is included on Testnet

## Relevant files

- `packages/sdk/src/transactions.ts`
