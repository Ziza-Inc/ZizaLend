# Gas and resource benchmarks

> **Generated file.** Do not edit by hand: run
> `cd scripts && SECRET_KEY=<admin secret> npx ts-node benchmark-gas.ts testnet`.

## What is measured, and how

Soroban charges for CPU instructions and for ledger I/O (bytes read and written).
Both are reported by the host on simulation, which is also how a wallet estimates a fee
before signing. Each operation below was simulated against the deployed Testnet
contracts, and the preceding steps were submitted so the measurement is taken against a
real loan rather than a synthetic call.

**These numbers are state-dependent, not constants.** The cost of a repayment grows with
the interest accrued, and the cost of a mint is higher for a borrower with no existing
NFT. The state each row was measured against is recorded in the notes.

The figures are **not a CI gate.** Testnet resource cost drifts with ledger load and
protocol version, and a threshold that failed on drift would be a flaky check that
teaches people to ignore it. `check-wasm-size.mjs` gates binary size instead, which is
deterministic and the part a contributor can actually control.

Measured: 2026-09-18T14:11:57.850Z · network `testnet` · source revision `local`

## Transaction costs

| Operation | Contract | CPU instructions | Read + write bytes | Min resource fee (stroops) |
|---|---|---:|---:|---:|
| `mint` <br/>_worst case: a first mint, with no existing NFT_ | RemittanceNFT | 1,070,760 | 296 | 75,966 |
| `update_score` <br/>_credit event: a 50 XLM repayment, score scaled by amount_ | RemittanceNFT | 1,190,512 | 564 | 72,624 |
| `deposit` <br/>_100 XLM into an empty pool — mints shares_ | LendingPool | 1,865,971 | 1,868 | 108,701 |
| `request_loan` <br/>_10 XLM over the default term_ | LoanManager | 5,159,066 | 2,656 | 215,930 |
| `approve_loan` <br/>_approval is what moves the principal out of the pool_ | LoanManager | 4,854,523 | 2,244 | 35,370 |
| `get_loan_accrued` <br/>_read path — simulated only_ | LoanManager | 1,284,071 | 0 | 17,306 |
| `get_loan` <br/>_read path — simulated only_ | LoanManager | 1,105,565 | 0 | 17,147 |
| `get_pool_stats` <br/>_read path — simulated only_ | LendingPool | 1,058,040 | 0 | 15,408 |
| `get_score` <br/>_read path — simulated only_ | RemittanceNFT | 779,283 | 0 | 13,608 |
| `repay` <br/>_full repayment: interest accrual, score credit, and pool settlement_ | LoanManager | 7,402,455 | 3,080 | 70,028 |

### Summary

- **6 state-changing operations**, 21,543,287 CPU instructions in total.
- **Most expensive:** `repay` at 7,402,455 instructions.
- **4 read operations**, which cost CPU and memory on simulation but never reach a ledger.

For scale: Soroban's per-transaction instruction limit is 100,000,000, so the most
expensive operation here uses a small single-digit percentage of the budget available.

## Contract binary size

Size matters independently of per-call cost: every deploy uploads the WASM once, and
it is the figure a contributor can directly influence by adding or removing code.

| Contract | WASM size (bytes) |
|---|---:|
| `loan_manager` | 88,942 |
| `remittance_nft` | 49,164 |
| `lending_pool` | 48,627 |
| `multisig_governance` | 31,434 |

## Reproducing

```bash
cd scripts
SECRET_KEY=<admin secret> npx ts-node benchmark-gas.ts testnet
```
