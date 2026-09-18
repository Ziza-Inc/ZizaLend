<div align="center">
  <img src="https://img.shields.io/badge/Zizalend-DeFi%20Lending-7C3AED?style=for-the-badge&logo=stellar&labelColor=0D0D12" alt="Zizalend" />

  <h3><strong>Every transfer builds your future</strong></h3>

  <!-- CI / Quality Gates + License -->

<a href="https://github.com/Ziza-Inc/ZizaLend/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ziza-Inc/ZizaLend/ci.yml?branch=main&label=CI&logo=github&style=flat-square" alt="CI" /></a>
<a href="https://github.com/Ziza-Inc/ZizaLend/actions/workflows/codeql.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ziza-Inc/ZizaLend/codeql.yml?branch=main&label=CodeQL&logo=github&style=flat-square" alt="CodeQL" /></a>
<a href="https://github.com/Ziza-Inc/ZizaLend/actions/workflows/deploy-staging.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ziza-Inc/ZizaLend/deploy-staging.yml?branch=main&label=Deploy%20Staging&logo=docker&style=flat-square" alt="Deploy Staging" /></a>
<a href="https://github.com/Ziza-Inc/ZizaLend/actions/workflows/commitlint.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ziza-Inc/ZizaLend/commitlint.yml?branch=main&label=Commitlint&logo=conventionalcommits&style=flat-square" alt="Commitlint" /></a>
<a href="LICENSE"><img src="https://img.shields.io/github/license/Ziza-Inc/ZizaLend?style=flat-square&color=blue" alt="License: ISC" /></a>

  <!-- Tech Stack (versions verified against package.json / Cargo.toml / CI) -->
  <br/>
  <img src="https://img.shields.io/badge/Node-22-339933?style=flat-square&logo=nodedotjs" alt="Node.js 22" />
  <img src="https://img.shields.io/badge/Rust-stable-CE412B?style=flat-square&logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=nextdotjs" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express" alt="Express 5" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-316192?style=flat-square&logo=postgresql" alt="PostgreSQL 16" />
  <img src="https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis" alt="Redis 7" />
  <img src="https://img.shields.io/badge/Soroban-WASM-7C3AED?style=flat-square&logo=stellar" alt="Soroban WASM" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome" />
  <img src="https://img.shields.io/badge/Conventional_Commits-1.0.0-fe5196?style=flat-square&logo=conventionalcommits" alt="Conventional Commits" />

<br/><br/>
<strong><a href="ARCHITECTURE.md">Architecture</a> • <a href="docs/DEVELOPMENT.md">Development</a> • <a href="docs/TESTING.md">Testing</a> • <a href="docs/wiki/README.md">Wiki</a> • <a href="CONTRIBUTING.md">Contributing</a> • <a href="SECURITY.md">Security</a> • <a href="ROADMAP.md">Roadmap</a></strong>
</div>

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [Quick Start](#-quick-start)
- [Documentation](#-documentation)
- [Testing](#-testing)
- [Security](#-security)
- [Contributing](#-contributing)
- [Project Structure](#-project-structure)

---

## 🌍 Overview

**Zizalend** gives the world's 280 million migrant workers something traditional finance never could: **a credit score they can take anywhere.**

Every remittance you send home is proof of your reliability. Zizalend captures that proof on the Stellar blockchain, turns it into a verifiable on-chain credit identity, and unlocks access to fair, collateralized loans — no credit bureau, no bank branch, no discrimination. Just the financial reputation you've already earned.

Lenders provide liquidity to transparent, on-chain pools and earn real yield backed by real repayment history. Not algorithms. Not guesswork. **Real people. Real trust. Real returns.**

```mermaid
flowchart LR
    B["👤 Migrant Worker"] -->|"Sends Remittances"| R["📊 Credit Score"]
    R -->|"Mints"| N["🪪 Remittance NFT"]
    N -->|"Locks as"| C["Collateral"]
    C -->|"Access"| L["🏦 Loan from Pool"]
    L -->|"Funded by"| P["💰 Lenders"]
    P -->|"Earn"| Y["📈 Yield"]
```

> 💡 **Why Stellar?** Stellar's sub-second finality, near-zero fees (< $0.001), and built-in remittance corridors make it the ideal chain for real-world financial inclusion.

---

## ✨ Key Features

### 🏃 For Borrowers

| Feature                  | Description                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| **Credit Building**      | Convert remittance history into an on-chain credit score (300–850) — no traditional bureau required |
| **NFT Identity**         | Mint a Remittance NFT — your portable, verifiable credit identity on Stellar                        |
| **Fair Rates**           | Transparent, non-predatory interest rates tied to your score tier, not your zip code                |
| **Score Tiers**          | Progress through 5 tiers: Seed (15%) → Bronze → Silver → Gold → Platinum (5%)                       |
| **Self-Custody**         | Full control via any Stellar wallet (Freighter, Albedo) — keys never leave your device              |
| **Loan Lifecycle**       | Refinance, extend, and repay loans with real-time status updates via SSE                            |
| **Multi-Channel Alerts** | In-app, email (SendGrid), and SMS (Twilio) notifications with granular preferences                  |

### 💰 For Lenders

| Feature                  | Description                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- |
| **Transparent Yield**    | Earn interest by providing liquidity to on-chain lending pools                      |
| **Pool Analytics**       | Real-time utilization rates, stability scores, risk tiers, and yield projections    |
| **Position Tracking**    | Monitor deployed capital, accrued yield, and transaction history with CSV export    |
| **Yield Charts**         | Interactive earnings visualization with 1D/1W/1M/All timeframe toggles              |
| **Emergency Withdrawal** | Always maintain access to funds via exit hatch when pools are paused                |
| **Risk Visibility**      | All collateral is verifiable on-chain remittance proofs — no black-box underwriting |

### 🎮 Gamification & Engagement

| Feature               | Description                                                                        |
| --------------------- | ---------------------------------------------------------------------------------- |
| **Kingdom Dashboard** | Financial growth mapped to a city-building progression experience                  |
| **XP & Achievements** | Earn XP through loans, repayments, liquidity provision — over 7 achievement types  |
| **Quest System**      | "Whale Migration" (deploy liquidity), "Iron Resolve" (maintain position), and more |
| **Level Progression** | 7 levels: Peasant → Merchant → Knight → Baron → Duke → Prince → King               |
| **NFT Stamps**        | Earn "Early Adopter" and "Trusted" stamps on your Digital Passport                 |

---

## 🏗 System Architecture

> **Deployment target:** All four contracts compile to <256 KiB WASM and target the Stellar testnet before mainnet. The live contract addresses are tracked in **[docs/deployed-contracts.md](docs/deployed-contracts.md)** — keep that file the single source of truth whenever a deployment runs.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Users (Browsers / Wallets)                   │
└────────────────┬────────────────────────────────┬────────────────┘
                 │                                │
    ┌────────────▼──────────┐      ┌──────────────▼──────────────┐
    │   Next.js Frontend    │      │    Express.js Backend API   │
    │   • React 19          │      │    • Credit Scoring         │
    │   • Tailwind CSS 4    │      │    • Event Indexer          │
    │   • Freighter/Albedo  │◄────►│    • Webhook Delivery       │
    │   • i18n (EN/ES/TL)   │      │    • Notification Service   │
    │   • PWA Support       │      │    • Swagger/OpenAPI        │
    └────────────┬──────────┘      └──────────────┬──────────────┘
                 │                                │
                 │        ┌───────────────────────▼────────┐
                 │        │      PostgreSQL + Redis          │
                 │        │   (Metadata, Cache, Sessions)    │
                 │        └───────────────────────┬────────┘
                 │                                │
    ┌────────────▼────────────────────────────────▼────────────┐
    │                 Stellar Network (Soroban)                  │
    │                                                           │
    │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
    │  │ RemittanceNFT │  │ Loan Manager │  │ Lending Pool   │  │
    │  │ • Credits     │◄►│ • Lifecycle  │◄►│ • Deposits     │  │
    │  │ • Scores      │  │ • Approvals  │  │ • Withdrawals  │  │
    │  │ • Collateral  │  │ • Repayments │  │ • Yield        │  │
    │  └──────────────┘  └──────┬───────┘  └────────────────┘  │
    │                           │                               │
    │                    ┌──────▼───────┐                        │
    │                    │Multisig Gov  │                        │
    │                    │• Proposals   │                        │
    │                    │• Timelock    │                        │
    │                    │• Admin       │                        │
    │                    └──────────────┘                        │
    └───────────────────────────────────────────────────────────┘
```

### 📦 Smart Contracts

Four Soroban (Rust) smart contracts power the protocol:

| Contract                                                 | Description                  | Key Functions                                                               | Events                                                         |
| -------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **[RemittanceNFT](contracts/remittance_nft/)**           | Credit identity & collateral | `mint`, `update_score`, `seize_collateral`, `transfer`                      | `Mint`, `ScoreUpd`, `Seized`, `Transfer`                       |
| **[LoanManager](contracts/loan_manager/)**               | Full loan lifecycle          | `request_loan`, `approve_loan`, `repay`, `liquidate`, `refinance`, `extend` | `LoanRequested`, `LoanApproved`, `LoanRepaid`, `LoanDefaulted` |
| **[LendingPool](contracts/lending_pool/)**               | Liquidity + safety           | `deposit`, `withdraw`, `emergency_withdraw`, `adjust_outstanding`           | `Deposit`, `Withdraw`, `YieldDistributed`, `DepositCapReached` |
| **[MultisigGovernance](contracts/multisig_governance/)** | Admin with timelock          | `propose_admin_transfer`, `approve_transfer`, `finalize`, `cancel`          | `GovProp`, `GovAppr`, `GovFin`, `GovCncl`                      |

### ⚙️ Backend Services

| Service                  | Description                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Event Indexer**        | Polls Soroban RPC, persists events to PostgreSQL, dispatches webhooks with HMAC signing                                       |     | **Indexer Manager** | Orchestrates indexer instances with retry, backoff, sync checkpoints, and quarantine handling |
| **Soroban RPC Client**   | Typed Stellar RPC wrapper with cached contract metadata and method invocation helpers                                         |
| **Database Connector**   | Postgres connection pool with pg-format escaping and migration runner (internal)                                              |
| **Credit Scoring**       | Calculates and updates scores based on repayment history with score decay                                                     |
| **Score Decay Job**      | Cron-driven score erosion for inactive borrowers — keeps the on-chain tier accurate                                           |
| **Remittance Service**   | Remittance ingestion, validation, and history-hash computation for credit provenance                                          |
| **Yield History**        | Lender-style time-series of pool yield, APR, and per-share returns                                                            |
| **Webhook Engine**       | Delivers events to subscribed URLs with exponential backoff retry (configurable max attempts)                                 |
| **Notification Service** | Multi-channel (in-app SSE, email via SendGrid, SMS via Twilio) with per-type preferences                                      |
| **SSE Streaming**        | Real-time Server-Sent Events for live UI updates on loan status and score changes                                             |
| **Score Reconciliation** | Periodic on-chain/off-chain score sync with optional auto-correction                                                          |
| **Default Checker**      | Scheduled cron job for detecting and processing loan defaults                                                                 |
| **Cache Layer**          | Redis-backed caching for scores, pool data, contract metadata (configurable TTLs)                                             |
| **Job Metrics**          | Prometheus-compatible metrics for indexer health, job latency, and throughput                                                 |     | **Rate Limiting**   | Tiered (anon / authed / admin) Redis sliding window with `Retry-After` headers                |
| **RBAC**                 | JWT authentication with role-based access control (borrower, lender, admin), scope-bound permissions, and JWT revocation list |
| **Audit Logging**        | Immutable audit trail for all admin and governance actions                                                                    |

### 🎨 Frontend Pages

| Page                    | Description                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------- |
| **Landing / Dashboard** | Wallet connection (Freighter, Albedo), portfolio overview, quick actions            |
| **Borrower Portfolio**  | Credit score gauge, NFT status, active loans, repayment tracking                    |
| **Request Loan**        | Single-page loan application: amount, collateral NFT, terms, signature              |
| **Repay**               | One-click repay flow with on-chain transaction preview and partial-payment support  |
| **Loans**               | Loan list with status/score/amount filters and CSV export                           |
| **Lender Portfolio**    | Pool cards with utilization bars, risk badges, deposit/withdraw flows, yield charts |
| **Analytics**           | Borrower and lender statistics, score history charts, portfolio breakdowns          |
| **Kingdom**             | Gamification dashboard: city-building, XP, quests, achievements                     |
| **Loan Details**        | Timeline view, health status, repayment progress, collateral actions                |
| **Wallet**              | Stellar address, token balances (Horizon), transaction history, QR codes            |
| **Send Remittance**     | Cross-border transfer with transaction preview and fee estimation                   |
| **Liquidations**        | Defaulted loans surfaced for admin collateral seizure workflow                      |
| **Activity**            | Full transaction history with filters, search, and CSV export                       |
| **Notifications**       | Real-time SSE stream, granular preferences, digest configuration                    |
| **Admin / Governance**  | Dispute management, multisig proposals, loan oversight                              |
| **UI Demo**             | Component playground used for design-system docs and visual QA                      |
| **Settings**            | Profile, wallet, notification preferences, theme (light/dark/system), language      |

### 📘 TypeScript SDK

- **`packages/types/`** — Auto-generated TypeScript types from OpenAPI 3.0 spec
- **`packages/sdk/`** — Typed HTTP client with JWT auth, retry logic, and error handling
- SDK modules: `auth`, `loans`, `notifications`, `scores`, `remittances`, `pools`, `simulation`, `admin`, `events`, `indexer`, `transactions`, `user`, `health`
- Event stream subscriptions (Server-Sent Events) with auto-reconnect and per-action filters
- Server-to-server admin client with API key authentication for automated workflows

---

## 🛠 Tech Stack

### Frontend

| Technology             | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| **Next.js 16**         | React framework — App Router, Server Components, Turbopack |
| **React 19**           | UI library with compiler, hooks, Suspense                  |
| **Tailwind CSS 4**     | Utility-first styling with CSS-first configuration         |
| **TypeScript 5**       | Type safety across the entire codebase                     |
| **Stellar Wallet Kit** | Freighter, Albedo, and WalletConnect integration           |
| **Zustand**            | Lightweight state management with persist middleware       |
| **TanStack Query**     | Server state management and caching                        |
| **next-intl**          | Internationalization (English, Spanish, Tagalog)           |
| **Recharts**           | Charting for yield and performance dashboards              |
| **Framer Motion**      | Animation library for micro-interactions                   |
| **Serwist**            | PWA support with service workers                           |
| **Sentry**             | Error tracking and performance monitoring                  |

### Backend

| Technology                | Purpose                                        |
| ------------------------- | ---------------------------------------------- |
| **Node.js 22**            | JavaScript runtime                             |
| **Express.js 5**          | HTTP framework with middleware pipeline        |
| **TypeScript 5**          | Type safety with strict mode                   |
| **PostgreSQL**            | Primary database with connection pooling       |
| **Redis**                 | Caching, rate limiting, session store          |
| **Zod**                   | Runtime request validation with type inference |
| **node-pg-migrate**       | Database migration framework (27 migrations)   |
| **Winston**               | Structured logging with multiple transports    |
| **Swagger / OpenAPI 3.0** | API documentation and SDK code generation      |
| **JWT**                   | Stateless authentication with refresh support  |
| **Prometheus**            | Metrics exposition for monitoring              |
| **Sentry**                | Error tracking across frontend and backend     |
| **SendGrid + Twilio**     | Email and SMS notification delivery            |

### Smart Contracts

| Technology      | Purpose                                                             |
| --------------- | ------------------------------------------------------------------- |
| **Rust**        | Contract language with memory safety                                |
| **Soroban SDK** | Stellar's smart contract framework                                  |
| **WASM**        | WebAssembly compilation (< 256 KiB budget per contract)             |
| **Cargo Fuzz**  | Property-based fuzz testing — 5 fuzz targets across all 4 contracts |

### DevOps & CI

| Technology            | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| **Docker & Compose**  | Local development and staging deployment           |
| **GitHub Actions**    | CI/CD — 6 workflow types, 9+ job types             |
| **GHCR**              | Container registry for staging images              |
| **Trivy**             | Vulnerability scanning (HIGH + CRITICAL) in CI/CD  |
| **CodeQL**            | Static analysis for JavaScript/TypeScript and Rust |
| **Commitlint**        | Conventional Commits enforcement                   |
| **Dependency Review** | Automated dependency change auditing               |

---

## 🚀 Quick Start

### Prerequisites

```bash
node -v        # Node ≥ 22 required (CI runs on Node 22)
docker --version
rustup target add wasm32v1-none
```

### Docker (Recommended)

```bash
git clone https://github.com/Ziza-Inc/ZizaLend.git
cd ZizaLend
cp backend/.env.example backend/.env
docker compose up --build
```

| Service            | URL                        |
| ------------------ | -------------------------- |
| Frontend           | http://localhost:3000      |
| Backend API        | http://localhost:3001      |
| API Docs (Swagger) | http://localhost:3001/docs |
| PostgreSQL         | localhost:5432             |
| Redis              | localhost:6380             |

### Manual Setup

<details>
<summary><strong>Backend</strong></summary>

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL
npm run migrate:up
npm run dev
```

| Script               | Description                      |
| -------------------- | -------------------------------- |
| `npm run dev`        | Start dev server with hot reload |
| `npm run build`      | Compile TypeScript               |
| `npm test`           | Run test suite                   |
| `npm run lint`       | ESLint check                     |
| `npm run typecheck`  | TypeScript type checking         |
| `npm run migrate:up` | Apply database migrations        |
| `npm run seed`       | Seed development data            |

</details>

<details>
<summary><strong>Frontend</strong></summary>

```bash
cd frontend
npm install
npm run dev
```

| Script              | Description                     |
| ------------------- | ------------------------------- |
| `npm run dev`       | Start dev server with Turbopack |
| `npm run build`     | Production build                |
| `npm test`          | Run 190 unit tests              |
| `npm run lint`      | Prettier code style check       |
| `npm run typecheck` | TypeScript type checking        |
| `npm run test:e2e`  | Playwright E2E tests            |

</details>

<details>
<summary><strong>Smart Contracts</strong></summary>

```bash
cd contracts
cargo build --target wasm32v1-none --release
cargo test

# Fuzz testing
cd contracts/fuzz
cargo fuzz run lending_pool_fuzz
```

</details>

---

## 📚 Documentation

| Resource                                                                 | Description                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **[Development Guide](docs/DEVELOPMENT.md)**                             | Setup, workflow, and code quality across all components                  |
| **[Architecture](ARCHITECTURE.md)**                                      | System architecture with diagrams, data flow, security model             |
| **[Testing Guide](docs/TESTING.md)**                                     | Testing strategy, commands, and CI pipeline                              |
| **[SDK Documentation](packages/sdk/README.md)**                          | TypeScript SDK usage, modules, and examples                              |
| **[docs/wiki/](docs/wiki/README.md)**                                    | Technical wiki — contract state machine, indexer sync, frontend patterns |
| **[docs/adr/](docs/adr/)**                                               | Architecture Decision Records (contracts, event indexer, auth model)     |
| **[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)**                           | Complete environment variable reference                                  |
| **[docs/webhooks.md](docs/webhooks.md)**                                 | Webhook integration with HMAC signature verification                     |
| **[docs/deployed-contracts.md](docs/deployed-contracts.md)**             | Contract IDs on testnet/mainnet                                          |
| **[docs/contracts-ACCESS-CONTROL.md](docs/contracts-ACCESS-CONTROL.md)** | Permission matrix for all 4 contracts                                    |
| **[docs/runbooks/](docs/runbooks/)**                                     | Operational runbooks (indexer recovery, staging deployment)              |
| **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**                   | Common issues and resolutions                                            |
| **[DESIGN.md](docs/DESIGN.md)**                                               | UI/UX design spec with component specifications                          |
| **[ROADMAP.md](ROADMAP.md)**                                             | Product roadmap and planned features                                     |
| **[Swagger UI](http://localhost:3001/docs)**                             | Interactive API documentation (dev only)                                 |

---

## 🧪 Testing

```mermaid
flowchart LR
    subgraph Backend["Backend"]
        B1["51 Suites"] --> B2["322+ Tests"]
        B3["Jest + Supertest"]
    end
    subgraph Frontend["Frontend"]
        F1["19 Suites"] --> F2["190 Unit Tests"]    F3["11 E2E Specs"] --> F4["Playwright"]
    end
    subgraph Contracts["Contracts"]
        C1["Rust Tests"] --> C2["Unit + Integration"]
        C3["5 Fuzz Targets"]
    end
```

```bash
# Backend
cd backend && npm test

# Frontend unit + E2E
cd frontend && npm test
cd frontend && npm run test:e2e

# Smart contracts
cd contracts && cargo test

# Fuzz testing — 5 property-based targets across all 4 contracts
cd contracts/fuzz && cargo fuzz run lending_pool_fuzz
```

See **[FUZZING_README.md](contracts/FUZZING_README.md)** for comprehensive fuzz testing documentation including invariant definitions, campaign scripts, and coverage analysis.

---

## 🔒 Security

### Defense in Depth

| Layer              | Protections                                                                        |
| ------------------ | ---------------------------------------------------------------------------------- |
| **User**           | Wallet custody (private keys never stored), hardware wallet support                |
| **Application**    | Zod validation, tiered rate limiting, CORS, CSP headers, CSRF tokens               |
| **Smart Contract** | Access control matrix, CEI pattern, integer overflow protection, reentrancy guards |
| **Network**        | TLS/HTTPS, Stellar BFT consensus, transaction signing                              |
| **CI/CD**          | CodeQL, Trivy, Dependency Review, Supply Chain Audit, Commitlint                   |

### Smart Contract Security Highlights

- **Access Control**: Every public function requires explicit `require_auth()`. Admin operations gated by stored admin address. Minter operations limited to `AuthorizedMinter` set (max 32 addresses).
- **CEI Pattern**: All state mutations committed before cross-contract token transfers — prevents reentrancy.
- **Integer Safety**: All arithmetic uses `checked_mul`/`checked_div`/`checked_add` chains with hard caps (`MAX_RATIO_BPS = 10_000`, `MAX_PENALTY_MULTIPLIER = 2`).
- **Governance Timelock**: Admin transfers require multisig proposal with 24-hour minimum timelock, 1-hour reproposal cooldown, and 7-day expiry.

See **[SECURITY.md](SECURITY.md)** and **[contracts-ACCESS-CONTROL.md](docs/contracts-ACCESS-CONTROL.md)** for the full security model.

---

## 🤝 Contributing

We welcome contributions! See **[CONTRIBUTING.md](CONTRIBUTING.md)** for detailed guidelines.

### Quick Start

1. Fork → Clone → Branch (`feat/amazing-feature`)
2. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
3. Open a Pull Request — CI will validate automatically

### Good First Issues

Browse [good first issues](https://github.com/Ziza-Inc/ZizaLend/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) with detailed specs at **[docs/contributor-issues/](docs/contributor-issues/)**.

### Branch Conventions

| Prefix      | Purpose                  |
| ----------- | ------------------------ |
| `feat/`     | New features             |
| `fix/`      | Bug fixes                |
| `docs/`     | Documentation            |
| `refactor/` | Code refactoring         |
| `perf/`     | Performance improvements |
| `chore/`    | Maintenance tasks        |

---

## 📋 Project Structure

```
ZizaLend/
├── backend/                   # Express.js API (Node 22, TypeScript)
│   ├── src/
│   │   ├── controllers/       # Route handlers (13 controllers)
│   │   ├── services/          # Business logic (16 services)
│   │   ├── schemas/           # Zod validation schemas
│   │   ├── config/            # Environment configuration
│   │   ├── routes/            # Express route definitions
│   │   ├── errors/            # Custom error classes
│   │   ├── cron/              # Scheduled jobs
│   │   └── utils/             # Utilities (logger, cache, pagination)
│   ├── migrations/            # Database migrations (27 files)
│   └── tests/                 # Integration tests
├── frontend/                  # Next.js 16 (React 19)
│   ├── src/
│   │   ├── app/               # App Router pages (15 routes)
│   │   ├── components/        # React components (UI, wallet, gamification)
│   │   ├── hooks/             # Custom React hooks
│   │   ├── stores/            # Zustand state stores (8 stores)
│   │   └── lib/               # Utilities (Stellar, CSV, metadata)
│   └── e2e/                   # Playwright E2E tests (11 spec files)
├── contracts/                 # Soroban Rust smart contracts
│   ├── remittance_nft/        # Credit identity NFT
│   ├── loan_manager/          # Loan lifecycle
│   ├── lending_pool/          # Liquidity pool
│   ├── multisig_governance/   # Governance timelock
│   └── fuzz/                  # Property-based fuzz testing
├── packages/
│   ├── types/                 # Auto-generated types from OpenAPI
│   └── sdk/                   # Typed API client SDK
├── scripts/                   # Deployment and utility scripts
├── docs/                      # Documentation, ADRs, wiki, runbooks
└── .github/                   # CI/CD workflows, issue templates
```

---

## 📊 Project Stats

| Metric            | Value                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| Smart Contracts   | 4 Soroban (Rust) contracts                                             |     | Backend Services    | 18 service modules (17 user-facing + 1 internal connector), 13 controllers |
| API Endpoints     | 50+ REST endpoints                                                     |     | Database Migrations | 34 versioned migrations                                                    |
| Backend Tests     | 51 suites, 322 tests                                                   |
| Frontend Tests    | 19 suites, 190 unit tests                                              |
| E2E Tests         | 11 Playwright spec files                                               |
| Fuzz Targets      | 5 property-based targets                                               |
| CI Workflows      | 6 types (CI, CodeQL, Deploy, Dependency Review, Commitlint, Load Test) |
| Supported Locales | English, Spanish, Tagalog                                              |

---

## 📄 License

ISC License — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>Built on <a href="https://stellar.org">Stellar</a> • Powered by <a href="https://soroban.stellar.org">Soroban</a></sub>
  <br/>
  <sub>Zizalend — Every transfer builds your future</sub>
</div>
