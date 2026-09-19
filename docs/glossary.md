# Glossary

Every domain and Stellar term this project uses without explaining it. One sentence each, with
a link when the detail matters. If a term is missing, that is a bug in this file — please open
an issue or a pull request.

Reading order for someone new: the **Money and ledgers** section first, then **Loans and
credit**, then the rest as you meet it.

---

## Money, accounts and ledgers

| Term | What it means here |
| --- | --- |
| **Stellar** | The public blockchain the protocol settles on; its "smart contracts" are called Soroban contracts. [Stellar docs](https://developers.stellar.org/docs) |
| **Ledger** | A batch of transactions the network agreed on, closed every ~5 seconds and identified by a sequence number. [Ledgers](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/ledgers) |
| **Ledger sequence** | The increasing number of a ledger; the project's clock, since `termLedgers` and due dates are counted in ledgers rather than seconds. [Ledger entries](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/ledgers) |
| **Ledger close time** | The timestamp at which a ledger closed, which is what `ledgerClosedAt` on an indexed event records. [Ledgers](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/ledgers) |
| **Stroop** | The smallest unit of an asset: one ten-millionth, so an amount carries at most 7 decimal places. [Assets](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets) |
| **XLM** | Stellar's native asset, used to pay fees; it is the one asset with no issuer. [Lumens](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/lumens) |
| **USDC / EURC** | Issued assets the pool can hold, identified by the issuer account as well as the code — the same code from a different issuer is a different asset. [Assets](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets) |
| **SAC (Stellar Asset Contract)** | The built-in contract that lets a Stellar asset be used from Soroban, which is why the pool refers to a token by contract address. [Asset contracts](https://developers.stellar.org/docs/tokens/stellar-asset-contract) |
| **Public key / address** | A 56-character base32 string starting with `G` that names an account; accounts sign with the matching secret key. [Keypairs](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts) |
| **ed25519** | The signature scheme Stellar keypairs use; a "signature" in this codebase is an ed25519 signature over a message. [Signatures](https://developers.stellar.org/docs/learn/encyclopedia/security/signatures-multisig) |
| **Base32** | The encoding of a public key, which is why valid addresses contain no `0`, `1`, `8` or `9`. [RFC 4648 §6](https://datatracker.ietf.org/doc/html/rfc4648#section-6) |
| **Sequence number** | A per-account counter that every transaction must match, which is why the API reads the sender's live account before building a transaction to sign. [Sequence numbers](https://developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/sequence-numbers) |
| **XDR** | Stellar's binary encoding of a transaction; what the API hands the wallet to sign, base64-encoded in JSON. [XDR](https://developers.stellar.org/docs/learn/encyclopedia/contract-development/types/fully-typed-xdr) |
| **Testnet** | The Stellar network this project deploys to, whose assets are worthless by design. [Networks](https://developers.stellar.org/docs/networks) |
| **Mainnet** | The Stellar network carrying real value; the target after Testnet, not yet used. [Networks](https://developers.stellar.org/docs/networks) |
| **Network passphrase** | The string hashed into a transaction's signature so that a Testnet signature is invalid on Mainnet. [Passphrases](https://developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/network-passphrases) |
| **Trustline** | An account's explicit opt-in to hold a given issued asset, which a recipient needs before it can be paid in USDC or EURC. [Trustlines](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#trustlines) |

## Soroban and contracts

| Term | What it means here |
| --- | --- |
| **Soroban** | Stellar's smart-contract platform; the four contracts in `contracts/` are Soroban contracts written in Rust. [Soroban](https://developers.stellar.org/docs/build/smart-contracts/overview) |
| **Smart contract** | A program deployed on-chain that can hold value and enforce its own rules with no operator. [Contracts](https://developers.stellar.org/docs/build/smart-contracts/overview) |
| **WASM** | The compiled form a Soroban contract is deployed as, which is why the build has a size budget. [WASM](https://webassembly.org/) |
| **Soroban RPC** | The HTTP interface used to read contract state, simulate calls and submit transactions; an outage degrades the app rather than breaking it. [RPC](https://developers.stellar.org/docs/data/apis/rpc) |
| **Simulation** | A dry run of a transaction that reports the resources it would consume and whether it would succeed, used to preview fees before signing. [Simulation](https://developers.stellar.org/docs/learn/encyclopedia/contract-development/contract-interactions/transaction-simulation) |
| **CPU instructions** | The resource Soroban charges for computation, and the unit the gas benchmarks in [GAS.md](./GAS.md) are measured in. [Fees](https://developers.stellar.org/docs/learn/encyclopedia/contract-development/contract-interactions/resource-limits-fees) |
| **TTL / state archival** | How long a contract's storage entry stays live; entries must be extended or their data is archived, so the contracts bump TTLs deliberately. [State archival](https://developers.stellar.org/docs/learn/encyclopedia/contract-development/storage/state-archival) |
| **Contract event** | A record a contract emits that off-chain software can read; the indexer turns these into the rows the API serves. [Events](https://developers.stellar.org/docs/learn/encyclopedia/contract-development/events) |
| **Pause flag** | A switch an admin can flip to stop a class of operations without upgrading the contract. [Security model](./SECURITY-MODEL.md) |

## Loans and credit

| Term | What it means here |
| --- | --- |
| **Remittance** | A cross-border transfer, typically a migrant worker sending money home; the protocol turns a verified history of them into credit. [Remittance rules](./remittances.md) |
| **Remittance history** | The recorded stream of a user's transfers, which is the evidence the score is derived from. [Scoring model](./scoring-model.md) |
| **Credit score** | A 300–850 number computed from remittance and repayment history; higher is safer to lend to. [Scoring model](./scoring-model.md) |
| **Score tier** | The band a score falls into (`bronze` through `platinum`), used to set terms and to show a borrower where they stand. [Scoring model](./scoring-model.md) |
| **Score decay** | The gradual loss of score while a user is inactive, so a stale history stops counting as strongly as a current one. [Scoring model](./scoring-model.md) |
| **Score reconciliation** | Recomputing a user's score from their recorded history; run on a schedule and by hand when history has been corrected. [Scoring model](./scoring-model.md) |
| **Borrower** | A user who has built a score and takes a loan against it. |
| **Lender** | A user who deposits an asset into the pool and earns the interest borrowers pay; also called a liquidity provider. |
| **Liquidity provider** | Another name for a lender — the party supplying the funds being lent. [Pool](./wiki/contract-state-machine.md) |
| **Loan** | A principal disbursed to a borrower, repayable with interest over a term, backed by collateral and by the borrower's score. |
| **Principal** | The amount lent, before interest, fees or repayments. |
| **Interest rate (`bps`)** | The rate charged on a loan, in basis points: 1200 bps is 12% a year. [Basis point](https://en.wikipedia.org/wiki/Basis_point) |
| **Loan term** | How long a loan runs, counted in ledgers rather than days so the deadline is a property of the chain, not of a server's clock. |
| **Collateral** | Value the borrower locks so a default is not a total loss; held by the loan-manager contract, not by the borrower's wallet. |
| **Loan manager** | The contract that owns the loan lifecycle — request, approve, repay, default — and calls the pool to move funds. [State machine](./wiki/contract-state-machine.md) |
| **Lending pool** | The contract holding lenders' deposits and disbursing principal on the loan manager's instruction. [State machine](./wiki/contract-state-machine.md) |
| **Disbursement** | The transfer of principal out of the pool to a borrower when a loan is approved. |
| **Pool share** | A lender's proportional claim on the pool, minted at deposit and burned at withdrawal so that yield accrues by share price rather than by balance. |
| **Share price** | The value of one pool share, which rises as interest is repaid and falls when a loss is written off. |
| **Utilisation** | The fraction of pooled deposits currently lent out; the higher it is, the less there is available to withdraw. |
| **Yield / APY** | What a lender earns, expressed as an annualised percentage. |
| **Grace period** | The window after a loan's due ledger during which being late is possible but not yet a default. |
| **Late fee** | A charge applied to a repayment made after the due ledger, recorded against the loan so it is visible in the ledger rather than hidden in a balance. |
| **Default window** | How long a loan may stay overdue before it can be defaulted and its collateral seized. |
| **Liquidation** | Selling seized collateral to repay a defaulted loan, and returning any surplus to the borrower. |
| **Dust** | A remaining debt so small it is below the fee needed to collect it; handled deliberately rather than left to strand a loan. |

## Protocol and operations

| Term | What it means here |
| --- | --- |
| **Remittance NFT** | The per-user, non-transferable record that stores a borrower's score and history hash on-chain, so the score is portable between applications. [State machine](./wiki/contract-state-machine.md) |
| **Governance** | The contract that makes privileged protocol changes, requiring a multisig approval and a timelock instead of a single admin key. [Access control](./contracts-ACCESS-CONTROL.md) |
| **Multisig** | An arrangement where several keys must sign before an action is authorised; a "3-of-N" rule needs three. [Signatures](https://developers.stellar.org/docs/learn/encyclopedia/security/signatures-multisig) |
| **Proposal** | A governance action waiting to be approved and executed, identified by an id. [Access control](./contracts-ACCESS-CONTROL.md) |
| **Quorum** | The number of approvals a proposal needs before it can be executed. |
| **Timelock** | The delay between a proposal being approved and being executable, so its effect is observable before it lands. |
| **Idempotency key** | A client-supplied header that lets a retried request return the first request's result instead of performing the action twice. [Idempotency](./wiki/api-idempotency.md) |
| **Indexer** | The off-chain service that reads contract events and writes them into Postgres, making on-chain history queryable. [Indexer sync](./wiki/indexer-sync-flow.md) |
| **Ledger reorganisation** | A ledger being replaced after it was observed, which is why ingestion is idempotent and keyed on the event id. [Indexer sync](./wiki/indexer-sync-flow.md) |
| **Webhook** | An HTTP callback the platform makes to a subscriber when an event happens, signed so the receiver can verify it came from us. [Webhooks](./webhooks.md) |
| **HMAC** | The keyed hash used to sign a webhook delivery, so a receiver can check both authenticity and integrity. [Webhook signatures](./wiki/webhook-signatures.md) |
| **JWT revocation** | Invalidating an issued token before it expires, so a logout is effective immediately rather than at expiry. [JWT revocation](./wiki/jwt-revocation.md) |
| **Error code** | A stable machine-readable identifier such as `INVALID_AMOUNT`, which clients switch on instead of parsing a message. [Error codes](./ERROR_CODES.md) |
| **Feature flag** | A variable that turns behaviour on without a deploy, such as the staging deployment gate. [Environment](./ENVIRONMENT.md) |

## Related

- [ARCHITECTURE.md](../ARCHITECTURE.md) — how the pieces above fit together.
- [docs/scoring-model.md](./scoring-model.md) — the scoring formula in full.
- [docs/SECURITY-MODEL.md](./SECURITY-MODEL.md) — trust boundaries and non-goals.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — where to start contributing.
