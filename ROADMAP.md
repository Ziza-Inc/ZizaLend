# ZizaLend Roadmap

> **Status:** Beta — Core lending protocol is functional on Stellar testnet. Ready for community testing and audit preparation.

---

## Phase 1: Core Lending Protocol ✅

*Completed and deployed on Stellar testnet.*

| Milestone | Status |
|-----------|--------|
| 4 Soroban smart contracts (NFT, Loan Manager, Lending Pool, Governance) | ✅ |
| Credit scoring engine with on-chain/off-chain sync | ✅ |
| Express.js API with 50+ REST endpoints | ✅ |
| Next.js 16 frontend with borrower & lender dashboards | ✅ |
| Event indexer with real-time SSE streaming | ✅ |
| Webhook delivery with HMAC signing and exponential backoff | ✅ |
| Multi-channel notifications (in-app, email, SMS) | ✅ |
| RBAC authentication (borrower, lender, admin) | ✅ |
| CI/CD pipeline with 6 workflow types | ✅ |
| Fuzz testing (5 targets across all contracts) | ✅ |
| Docker Compose local development environment | ✅ |
| TypeScript SDK with typed client | ✅ |

---

## Phase 2: Production Hardening 🔜

*Required before mainnet launch.*

| Priority | Item | Effort | Notes |
|----------|------|--------|-------|
| 🔴 | **Oracle integration** | 2-3 weeks | Price feeds needed for LTV calculations, liquidation thresholds. Soroban doesn't have a native oracle — requires integration with Band Protocol, Pyth, or a custom Stellar-based oracle. |
| 🔴 | **Credit scoring formula documentation** | Completed | See [`docs/scoring-model.md`](docs/scoring-model.md) |
| 🔴 | **Integration tests with real Postgres + Redis** | 2 weeks | Current 322 backend tests use heavy mocking. Need tests that spin up real dependencies. |
| 🟡 | **Rate limiting hardening** | 1 week | Tiered rate limits should be tested under load. Load testing script exists but needs a staging environment. |
| 🟡 | **Sentry alerting rules** | 2 days | Configure alert thresholds for error rates, indexer lag, queue backpressure. |
| 🟡 | **TypeScript strictness cleanup** | Completed | All 23 `@typescript-eslint/no-explicit-any` warnings resolved. |
| 🟢 | **Smart contract audit** | External | Formal audit by a Soroban-focused security firm before mainnet. |
| 🟢 | **Deploy to Stellar mainnet** | 1 week | Contract deployment, environment config, smoke tests. |

---

## Phase 3: Feature Expansion

*Enhancements that unlock the full product vision.*

### Q3 2026

- **Multi-collateral support**: Accept additional collateral types beyond Remittance NFTs (e.g., liquidity pool tokens, stablecoins)
- **Loan refinancing & extension UI**: The contract functions exist — build the frontend wizard for modifying active loans mid-cycle
- **Lender yield charts**: Interactive history with timeframe selectors (1D, 1W, 1M, 1Y)
- **Bulk loan operations**: Admin tools for batch approvals, rejections, and dispute resolution
- **Gamification release**: Full Kingdom dashboard, XP tracking, quest system, NFT achievement stamps

### Q4 2026

- **Cross-chain remittance verification**: Use Stellar's built-in interoperability to verify remittances from other chains
- **Credit score portability**: Allow users to export their score NFT to other DeFi protocols on Stellar
- **Governance token**: Community-owned protocol with on-chain voting for rate adjustments, pool parameters
- **Mobile app**: React Native wrapper for the core lending flow (wallet, request, repay)

---

## Phase 4: Ecosystem & Scale

*Long-term vision for protocol maturity.*

- **Liquidity mining incentives**: Reward early liquidity providers with token incentives
- **Underwriting DAO**: Community-driven loan approval for high-value borrowers
- **Credit scoring API**: Expose scoring endpoints for third-party developers (KYC-free credit checks)
- **Multi-pool architecture**: Isolated risk pools for different asset classes, geographies, or risk profiles
- **Regulatory compliance**: Integrate with on-chain identity solutions for jurisdictions that require KYC

---

## Known Gaps & Honest Assessment

These are areas the project needs before it can be called production-ready:

1. **No oracle integration** — Any lending protocol needs reliable price feeds. If a loan's collateral is denominated in a different asset than the loan, you need on-chain prices for LTV monitoring. This is the single biggest gap.

2. **Test coverage is wide but shallow** — 322 backend tests, but they mock DB, Redis, and Stellar RPC. The real failure modes (chain reorgs, RPC timeouts, nonce collisions, indexer race conditions) aren't tested. Integration tests with real infrastructure would catch these.

3. **Scoring model is untested at scale** — The algorithm (base 500 + repayment deltas − default penalties − decay) is logical but hasn't been validated against real-world repayment data. The tier thresholds may need tuning after mainnet data collection.

4. **Deploy pipeline needs a live staging environment** — The deploy workflow builds and pushes images but the actual deployment to a server requires SSH secrets that are only available in the organization's GitHub Secrets. An external contributor can't fully validate the deployment flow.

---

## How to Contribute

See the [Contributing Guide](CONTRIBUTING.md) and [open issues](https://github.com/Ziza-Inc/ZizaLend/issues) for ways to help. Beginner-friendly tasks are tagged [`good first issue`](https://github.com/Ziza-Inc/ZizaLend/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
