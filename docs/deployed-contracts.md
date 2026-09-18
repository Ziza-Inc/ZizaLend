# Deployed Contract Registry

This is the single source of truth for deployed Soroban contract IDs across all networks.
Update this file whenever a contract is (re-)deployed.

> **Secrets note**: contract IDs are public addresses — safe to commit. Never commit secret/admin keys here.

The machine-readable equivalent of the Testnet table is
[`scripts/deployments/testnet.json`](../scripts/deployments/testnet.json), which the deploy
script writes and the smoke test reads. If the two ever disagree, the manifest is what is
actually deployed.

---

## Testnet (`Test SDF Network ; September 2015`)

RPC: `https://soroban-testnet.stellar.org`
Explorer: `https://stellar.expert/explorer/testnet`

Deployed **2026-09-18** from commit `2fdf96d`.

| Contract | Contract ID |
|---|---|
| `remittance_nft` | `CA7XGN4FUHQAEJMYQVOWJE6J4P75QWEQSTW3L6X2HRGILQAHKKRBHZQ2` |
| `lending_pool` | `CBOMMNN4L62O64ZZP2HYGURSJNPY3CDYR6DAIG342PSST3V6XSCOE3UJ` |
| `loan_manager` | `CDMZDO7YLWX7B6BXP5IJP6B5BRTLGSVQIRX3NLXU44GKFOYSPCZ5ER4F` |
| `multisig_governance` → LoanManager | `CCME5YVLAAPKJDVINV6AIN7JLZBIWMUIQPH5FKYRW7OFXBLDZLCEYGXL` |
| `multisig_governance` → LendingPool | `CB5NXI2DY6JUEV7APIX6E5OKA3D5NXUCX6Q7CN4BPV3MGV3FYI3PKHGV` |
| `multisig_governance` → RemittanceNFT | `CAWSRFL2WUD5WIYFABOVZJOG3V3VI7IYHLWCWDY2HRRVYAEWHS6TLUVE` |
| token (native XLM Stellar Asset Contract) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

Admin (deployer) account: `GD7FY2HPGH6TQGUHTKPHXZRQV6ZTSKRKGABLSHAH7SDUM22YBMRV6B5Y`.

WASM hashes uploaded by this deployment: `remittance_nft`
`b8006fe19c6564f191144142cb2b6c685f9933967eb14fbacd287cfc84611b26`, `lending_pool`
`42cc29505936…`, `loan_manager` `277d4dab4dcb…`, `multisig_governance` `14c2968e39a6…`.
Recomputing a hash from a local build and comparing it against the uploaded code is how you
confirm the deployed bytecode is the reviewed bytecode.

### Protocol parameters set at deploy time

These are operating limits, not protocol constants. They are applied by step 5 of
`scripts/deploy.ts` from the `parameters` block in `scripts/deploy-config.json`, and each one
is skipped on a re-run when the on-chain value already matches.

| Parameter | Value | Why |
|---|---|---|
| `max_loan_amount` | 1,000,000,000 stroops (100 XLM) | The compile-time default is 50,000 stroops — 0.005 XLM — so every realistic request would be rejected as `InvalidAmount`. |
| `max_pool_size` (per token) | 10,000,000,000 stroops (1,000 XLM) | Bounds a single market's exposure on a shared Testnet. |
| `min_repayment_amount` | 10,000 stroops | The floor below which a partial repayment is treated as rounding dust. Interest accrues continuously, so a borrower repaying the quoted total leaves a residual of about one ledger of interest; with a floor of zero that residual is a real balance and the loan never reaches `Repaid`. |
| `min_score` | 500 | A borrower below this is refused at `request_loan`. |
| `interest_rate_bps` | 1,200 (12% per term) | |
| `default_term_ledgers` | 17,280 (~1 day at 5s ledgers) | |
| withdrawal cooldown | 1,440 ledgers (~2 hours) | **Left at the deployed default.** Not lowered for demonstration: it is the flash-loan guard, and weakening it to make a demo look better would be the wrong trade. |
| minimum share hold | 1 ledger | **Left at the deployed default.** |

### Verifying the deployment

The deployment is checked by an end-to-end smoke test rather than by inspection:

```bash
cd scripts
SECRET_KEY=<admin secret> npx ts-node smoke-testnet.ts testnet
```

It funds a fresh lender and borrower through friendbot, then runs the real journey against
these addresses and asserts every post-condition:

```
✅ wiring            all roles resolve to the expected addresses
✅ deposit           share-backed deposit into the pool
✅ withdrawal guard  an immediate withdrawal is refused
✅ credit identity   borrower minted with a score above the floor
✅ loan approval     approved for the term the borrower signed for
✅ repayment         loan reaches Repaid
✅ score credited    the repayment moved the borrower's score
✅ withdrawal        the lender exits with their principal
```

`deploy.ts` proves the contracts exist and are wired. That is a strictly weaker claim than
"the protocol works", and the smoke test is what closes the gap.

### Environment variables that consume these IDs

#### Backend (`backend/.env`)

| Contract | Env var |
|---|---|
| `loan_manager` | `LOAN_MANAGER_CONTRACT_ID` |
| `lending_pool` | `LENDING_POOL_CONTRACT_ID` |
| `remittance_nft` | `REMITTANCE_NFT_CONTRACT_ID` |
| `multisig_governance` (governs the LoanManager) | `MULTISIG_GOVERNANCE_CONTRACT_ID` |
| `multisig_governance` (governs the LendingPool) | `POOL_GOVERNANCE_CONTRACT_ID` |
| `multisig_governance` (governs the RemittanceNFT) | `NFT_GOVERNANCE_CONTRACT_ID` |
| token | `POOL_TOKEN_ADDRESS` |

There is one governance instance per governed contract, because `finalize_admin_transfer`
invokes `set_admin` on the single target the instance was initialised with. `GET /version`
reports all three so the wiring can be verified from the running service.

#### Frontend (`frontend/.env`)

The frontend does not resolve contract IDs for its read paths; it calls the backend API,
which uses the backend vars above. The deploy script still writes `NEXT_PUBLIC_*` IDs into
`frontend/.env.local` for the paths that build transactions in the browser.

---

## Futurenet

No contracts deployed yet.

---

## Mainnet

**Deliberately not deployed.** Mainnet migration is out of scope for this revision: it
requires an audit, a funded mainnet admin key held by an operational process, and a
governance hand-off rehearsal. The Testnet deployment above is the verification target.

---

## Updating this file

1. Build for the `wasm32v1-none` target — see [`contracts/README.md`](../contracts/README.md)
   for why the general Wasm target cannot be deployed to Soroban.
2. Deploy via `SECRET_KEY=… npx ts-node scripts/deploy.ts testnet`. The script is idempotent,
   so a partial run can be re-run to completion.
3. Update the table above, and commit `scripts/deployments/testnet.json` with it.
4. Run the smoke test and paste its result into the pull request.
