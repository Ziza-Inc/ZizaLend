---
title: "Add event emission verification tests for Soroban smart contracts"
area: infrastructure
difficulty: advanced
labels: ["contracts", "help wanted", "infrastructure", "rust", "testing"]
---


## Description

The Soroban smart contracts emit events for key lifecycle actions (loan requests, approvals, repayments, defaults, etc.), but there are no dedicated tests that verify all expected events are actually emitted with the correct data. Adding event emission tests would improve contract reliability and serve as living documentation of the event schema.

## Background

The backend event indexer at `backend/src/services/eventIndexer.ts` parses over 30 different event types. These events are the foundation of the off-chain system:
- Notifications depend on events
- Webhooks depend on events  
- Score updates depend on events
- Audit logs depend on events

If events are missing or malformed, the entire off-chain system breaks silently.

## Contracts to Cover

- `contracts/lending_pool/` — Events: `Deposit`, `Withdraw`, `YieldDistributed`, `EmergencyWithdraw`, `DepositCapUpdated`, `PoolPaused`, `PoolUnpaused`
- `contracts/loan_manager/` — Events: `LoanRequested`, `LoanApproved`, `LoanRepaid`, `LoanDefaulted`, `LoanRefinanced`, `LoanExtended`, `LoanCancelled`, `LoanRejected`, `LateFeeCharged`, `CollateralDeposited`, `CollateralReleased`, `CollateralLiquidated`, `CollateralReturned`
- `contracts/remittance_nft/` — Events: `NFTMinted`, `ScoreUpdated`, `NFTSeized`, `NFTBurned`
- `contracts/multisig_governance/` — Events: `ProposalCreated`, `ProposalApproved`, `ProposalFinalized`, `ProposalCancelled`

## Requirements

For each contract, add tests that:
- Perform a contract operation (e.g., submit a loan request)
- Capture the emitted events using Soroban's test framework
- Verify the event type, topic values, and data payload match expectations
- Test both success and failure cases (no event should be emitted on failure)
- Follow existing test patterns in each contract's `test.rs` file

## Definition of Done

- All 30+ event types are verified in at least one test each
- `cargo test` passes in `contracts/`
- Events for failure/error paths are verified as NOT emitted
- Event documentation can be generated from the tests
