---
title: "Update the contracts README for the current CLI and the current API"
area: docs
difficulty: beginner
labels: ["contracts", "documentation", "good first issue", "help wanted"]
---

## Context

`contracts/README.md` tells a reader to install `soroban-cli` and invokes entry points with signatures the contracts no longer have — `request_loan --borrower --nft_id --amount`, for example, when the contract takes `(borrower, amount, term)`. The document is a footpath into a broken deployment, and the number of readers who will install the wrong tool and then mis-call a function is not small.

## Task

- Replace the CLI installation with the current Stellar CLI
- Regenerate every invocation from the actual contract signatures
- Add the deployment wiring calls, since the contracts cannot operate without them
- Verify each command against the Testnet deployment

## Definition of Done

- Every command in the document runs as written
- No invocation shows an argument the contract does not take

## Relevant files

- `contracts/README.md`
