# Development Guide

Central guide for setting up and developing across all ZizaLend components.

## Prerequisites

| Tool | Minimum Version | Check |
|------|----------------|-------|
| Node.js | ≥ 22 | `node -v` |
| npm | ≥ 10 | `npm -v` |
| Docker | ≥ 24 | `docker --version` |
| Docker Compose | ≥ 2 | `docker compose version` |
| Rust | stable (1.75+) | `rustc --version` |
| WASM target | wasm32v1-none | `rustup target list --installed` |

### Install WASM Target

```bash
rustup target add wasm32v1-none
```

## Quick Start (Docker)

The fastest way to get everything running:

```bash
git clone https://github.com/Ziza-Inc/ZizaLend.git
cd ZizaLend
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001 |
| API Docs (Swagger) | http://localhost:3001/docs |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6380 |

## Manual Setup

### 1. Clone and Install

```bash
git clone https://github.com/Ziza-Inc/ZizaLend.git
cd ZizaLend
```

### 2. Environment Variables

Each service has an `.env.example` with documented defaults:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

The canonical reference for all environment variables is [docs/ENVIRONMENT.md](ENVIRONMENT.md).

### 3. Backend

```bash
cd backend
npm install

# Start PostgreSQL and Redis (if not using the Docker from root)
docker compose up -d db redis

# Apply migrations
npm run migrate:up

# Seed development data
npm run seed

# Start dev server
npm run dev
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

### 5. Smart Contracts

```bash
cd contracts

# Build WASM binaries
cargo build --workspace --target wasm32v1-none --release

# Run tests
cargo test -- --test-threads=1

# Run Clippy
cargo clippy --all-targets --all-features -- -D warnings

# Run fuzz tests
cd fuzz
cargo fuzz run lending_pool_fuzz
```

## Repository Structure

```
ZizaLend/
├── backend/                   # Express.js API (Node 22, TypeScript)
│   ├── src/
│   │   ├── controllers/       # Route handlers (13 controllers)
│   │   ├── services/          # Business logic (16 services)
│   │   ├── schemas/           # Zod validation schemas
│   │   ├── config/            # Environment configuration
│   │   ├── routes/            # Express route definitions
│   │   ├── middleware/        # Express middleware
│   │   ├── errors/            # Custom error classes
│   │   └── utils/             # Utilities (logger, cache, pagination)
│   ├── migrations/            # Database migrations (34 files)
│   └── __tests__/             # Integration tests
├── frontend/                  # Next.js 16 (React 19)
│   ├── src/app/
│   │   ├── [locale]/          # Localized routes (en/es/tl)
│   │   ├── components/        # React components
│   │   ├── hooks/             # Custom React hooks
│   │   ├── stores/            # Zustand state stores
│   │   └── utils/             # Utility functions
│   └── e2e/                   # Playwright E2E tests
├── contracts/                 # Soroban Rust contracts
│   ├── remittance_nft/        # Credit identity NFT
│   ├── loan_manager/          # Loan lifecycle
│   ├── lending_pool/          # Liquidity pool
│   ├── multisig_governance/   # Governance timelock
│   └── fuzz/                  # Property-based fuzz tests
├── packages/
│   ├── types/                 # Generated OpenAPI types
│   └── sdk/                   # Typed API client SDK
├── scripts/                   # Deployment and utility scripts
├── docs/                      # Documentation, ADRs, wiki, runbooks
└── .github/                   # CI/CD workflows
```

## Development Workflow

### Branch Naming

| Prefix | Purpose |
|--------|---------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation |
| `refactor/` | Code refactoring |
| `perf/` | Performance improvements |
| `chore/` | Maintenance tasks |

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

Valid scopes: `frontend`, `backend`, `contracts`, `scripts`, `docs`, `readme`, `e2e`, `sdk`, `infra`, `ci`, `deps`, `release`

### Pre-Commit

Husky runs `lint-staged` on staged files:

```bash
# Frontend: ESLint + Prettier
# Automatically runs on git commit
```

### Pre-PR Checklist

Before opening a pull request:

- [ ] All tests pass (`npm test` / `cargo test`)
- [ ] Linting passes (`npm run lint` / `cargo clippy`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Build succeeds (`npm run build` / `cargo build`)
- [ ] New features have tests
- [ ] Environment variable changes are reflected in `.env.example` and `docs/ENVIRONMENT.md`
- [ ] Commit messages follow Conventional Commits

## Code Quality

### TypeScript (Frontend + Backend)

```bash
# Lint
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format
npm run format

# Type check
npm run typecheck
```

### Rust (Contracts)

```bash
# Format check
cargo fmt --all -- --check

# Lint with Clippy
cargo clippy --all-targets --all-features -- -D warnings

# Format auto-fix
cargo fmt --all
```

## Database

### Migrations

Migrations live in `backend/migrations/` and use `node-pg-migrate`:

```bash
# Apply all pending migrations
npm run migrate:up

# Roll back last batch
npm run migrate:down

# Create a new migration
npm run migrate:create -- <migration-name>
```

Migrations run in filename order. The CI pipeline validates:
- Migrate up from empty schema
- Roll all back (reversibility check)
- Migrate up again (idempotency check)

### Schema Documentation

Full database schema with tables, columns, indexes, and historical renames is at [docs/DATABASE.md](DATABASE.md).

## Testing

See [docs/TESTING.md](TESTING.md) for the complete testing guide.

Quick reference:

| Component | Command | Framework |
|-----------|---------|-----------|
| Backend | `cd backend && npm test` | Jest + Supertest |
| Frontend unit | `cd frontend && npm test` | Jest + React Testing Library |
| Frontend E2E | `cd frontend && npm run test:e2e` | Playwright |
| Contracts | `cd contracts && cargo test` | Rust test |
| Contracts fuzz | `cd contracts/fuzz && cargo fuzz run` | Cargo Fuzz |

## API Documentation

Interactive Swagger UI is available at `http://localhost:3001/docs` when the backend is running.

The raw OpenAPI 3.0 spec is at `packages/openapi.json` and is auto-generated from route definitions and Zod schemas.

## Key Architecture Concepts

| Concept | Documentation |
|---------|--------------|
| System architecture | [ARCHITECTURE.md](../ARCHITECTURE.md) |
| Contract state machine | [docs/wiki/contract-state-machine.md](wiki/contract-state-machine.md) |
| Indexer sync flow | [docs/wiki/indexer-sync-flow.md](wiki/indexer-sync-flow.md) |
| JWT auth model | [docs/SECURITY-MODEL.md](SECURITY-MODEL.md) |
| Frontend patterns | [docs/wiki/frontend-patterns.md](wiki/frontend-patterns.md) |
| API idempotency | [docs/wiki/api-idempotency.md](wiki/api-idempotency.md) |
| Webhook signatures | [docs/wiki/webhook-signatures.md](wiki/webhook-signatures.md) |

## Staging Deployment

Staging uses Docker Compose with GHCR images. See [docs/runbooks/README.md](runbooks/README.md) for the full staging deployment runbook.

## Troubleshooting

See [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.

## Resources

- [ARCHITECTURE.md](../ARCHITECTURE.md) — System architecture
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Contribution guidelines
- [ROADMAP.md](../ROADMAP.md) — Product roadmap
- [docs/wiki/README.md](wiki/README.md) — Technical wiki
- [docs/adr/README.md](adr/README.md) — Architecture Decision Records
