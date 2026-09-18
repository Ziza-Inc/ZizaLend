# Deployed Contract Registry

This is the single source of truth for deployed Soroban contract IDs across all networks.
Update this file whenever a contract is (re-)deployed.

> **Secrets note**: contract IDs are public addresses — safe to commit. Never commit secret/admin keys here.

---

## Testnet (`Test SDF Network ; September 2015`)

RPC: `https://soroban-testnet.stellar.org`  
Explorer: `https://stellar.expert/explorer/testnet`

| Contract | Contract ID | Deploy Date | Version / Commit |
|---|---|---|---|
| `loan_manager` | _not yet recorded_ | — | — |
| `lending_pool` | _not yet recorded_ | — | — |
| `remittance_nft` | _not yet recorded_ | — | — |
| `multisig_governance` | _not yet recorded_ | — | — |
| `token` (USDC-like pool token) | _not yet recorded_ | — | — |

> **How to fill this in**: after running `scripts/deploy.ts`, copy the printed contract IDs into the table above and open a PR. Include the deploy date (YYYY-MM-DD) and the short git commit SHA or release tag.

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
| `token` | `POOL_TOKEN_ADDRESS` |

There is one governance instance per governed contract, because
`finalize_admin_transfer` invokes `set_admin` on the single target the instance was
initialised with. `GET /version` reports all three so the wiring can be verified
from the running service.

#### Frontend (`frontend/.env`)

The frontend does not resolve contract IDs for its read paths; it calls the backend
API, which uses the backend vars above. The deploy script still writes
`NEXT_PUBLIC_*` IDs into `frontend/.env.local` for the paths that build transactions
in the browser.

---

## Futurenet

No contracts deployed yet.

---

## Mainnet

No contracts deployed yet.

---

## Updating this file

1. Deploy (or redeploy) via `scripts/deploy.ts`.
2. Copy the contract IDs from the deploy output into the relevant table row.
3. Set the same IDs in your local `backend/.env` (and CI secrets for staging/production).
4. Commit the updated table in the same PR as any contract change.
