---
title: "Cover liquidation of a loan whose remaining debt is dust"
area: contracts
difficulty: intermediate
labels: ["contracts", "testing"]
---

## Context

A loan can reach the default window with a remaining balance small enough that the liquidation bonus and the collateral seized do not cover the bookkeeping. The proportional split and the bonus arithmetic both round, and rounding on a near-zero balance is where accounting errors live.

## Task

- Add tests for liquidation where the outstanding debt is at and just below the minimum repayment floor
- Assert the pool's accounting is unchanged or changes by a documented, bounded amount
- Confirm no path can leave `total_outstanding` inconsistent with the sum of live loans

## Definition of Done

- Dust-sized liquidations either succeed with consistent accounting or are refused with a typed error
- A reconciliation test between `total_outstanding` and the loans themselves passes

## Relevant files

- `contracts/loan_manager/src/lib.rs`
- `contracts/lending_pool/src/lib.rs`
