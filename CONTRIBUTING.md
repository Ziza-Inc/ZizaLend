# Contributing to ZizaLend

First off, thank you for considering contributing to ZizaLend! It's people like you who make ZizaLend a powerful tool for providing fair lending access to migrant workers worldwide.

This document provides a set of guidelines for contributing to ZizaLend and its packages. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Development Workflow](#development-workflow)
- [Branching Strategy](#branching-strategy)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Standards](#pull-request-standards)
- [Environment Variables](#environment-variables)
- [Testing Requirements](#testing-requirements)
- [Style Guides](#style-guides)

## Code of Conduct

By participating in this project, you agree to maintain a respectful, inclusive, and harassment-free environment for everyone. We are committed to providing a welcoming experience for contributors of all backgrounds and skill levels.

## Development Workflow

We follow a **Feature-Branch-to-Main** workflow. All development work should happen in feature branches and be merged into `main` via Pull Requests.

### Architecture & Contributor Wiki

If you're new to the codebase, start with:
- `docs/glossary.md` (every domain and Stellar term the project uses, one sentence each — remittance, score, stroop, SAC, ledger, and the rest, so no term sends you out of the repository)
- `docs/wiki/README.md` (high-level contributor wiki)
- `ARCHITECTURE.md` (system overview)
- `docs/deployed-contracts.md` (testnet/mainnet contract IDs and the env vars that consume them).

```mermaid
graph TD
    Main[main branch] -->|Checkout| Feat[feat/your-feature]
    Feat -->|Commits| Feat
    Feat -->|Push| Remote[Remote Branch]
    Remote -->|Open PR| PR[Pull Request]
    PR -->|Review & CI| Merge[Merged to main]
    Merge --> Main
```

### Steps to Contribute

1. **Fork & Clone**: Fork the repository and clone it locally.
2. **Branch**: Create a new branch from the latest `main`.
3. **Develop**: Implement your changes, following code style and quality standards.
4. **Test**: Ensure all tests pass (see [Testing Requirements](#testing-requirements)).
5. **Commit**: Use [Conventional Commits](#commit-message-guidelines).
6. **Push & PR**: Push your branch and open a Pull Request against `main`.

## Branching Strategy

Follow these naming conventions for your branches:

| Type | Prefix | Example |
| :--- | :--- | :--- |
| **Feature** | `feat/` | `feat/lender-dashboard` |
| **Bug Fix** | `fix/` | `fix/nft-minting-error` |
| **Docs** | `docs/` | `docs/update-api-guide` |
| **Refactor** | `refactor/` | `refactor/loan-logic` |
| **Performance**| `perf/` | `perf/optimize-queries` |
| **Maintenance**| `chore/` | `chore/update-deps` |

## Commit Message Guidelines

We strictly follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

**Format**: `<type>(<scope>): <subject>`

### Common Types:

- **feat**: A new feature (corresponds to `MINOR` in Semantic Versioning).
- **fix**: A bug fix (corresponds to `PATCH` in Semantic Versioning).
- **docs**: Documentation only changes.
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, etc).
- **refactor**: A code change that neither fixes a bug nor adds a feature.
- **perf**: A code change that improves performance.
- **test**: Adding missing tests or correcting existing tests.
- **chore**: Changes to the build process or auxiliary tools and libraries.

**Example**: `feat(contracts): add flash loan prevention to lending pool`

## Pull Request Standards

When opening a PR, ensure your description includes:
- **Linked Issue**: Close the relevant issue (e.g., `Closes #123`).
- **Description**: A clear summary of the changes.
- **Testing**: Evidence that the changes were tested.
- **Checklist**:
    - [ ] Code follows project style guides.
    - [ ] Tests have been added/updated and pass.
    - [ ] Documentation has been updated.
    - [ ] Commit messages follow standards.

## Environment Variables

Before setting up the project locally, review the full environment variable reference in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md). Each `.env.example` file contains a pointer to this canonical reference. If you add a new environment variable, update both the relevant `.env.example` and the table in `ENVIRONMENT.md`.

## Testing Requirements

Before submitting, verify your changes by running:

### Frontend (Next.js/React)
```bash
cd frontend
npm run lint
npm run test
```

### Backend (Node/Express)
```bash
cd backend
npm run lint
npm run test
```

### Contracts (Soroban/Rust)
```bash
cd contracts
cargo fmt --check
cargo clippy
cargo test
```

## Required Checks

Every pull request into `main` has to pass the checks below before it can merge.
Each row says what the check actually verifies and the command that reproduces it
on a clean checkout, so a red check is a command you can run rather than a
message you have to guess at.

Jobs live in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) unless the
table says otherwise. Everything runs on Node 22 — the version pinned in
[`.nvmrc`](.nvmrc) — so run `nvm use` first if you manage Node with nvm.

| Check | What it verifies | Reproduce locally |
| :--- | :--- | :--- |
| `supply-chain-audit` | No lockfile contains a known-malicious package, and every dependency's licence is on the allowlist | `node scripts/check-dependency-review-scope.mjs` |
| `backend` | Backend lint, build and typecheck, the migrations apply, and the Jest suite passes against PostgreSQL 16 and Redis 7 | `cd backend && npm ci && npm run lint && npm run build && npm run typecheck && npm run migrate:up && npm test` with the [backend environment](#environment-for-the-backend-suite) exported |
| `migration-paths` | Reports whether the pull request touched `backend/migrations/**`; this is the gate for `migration-check` | — (a paths filter, not a command) |
| `migration-check` | Migrations apply from an empty schema, roll back one at a time, apply again, and a renamed migration is refused and then reconciled | `node scripts/check-migration-timestamps.mjs`, then the migrate up/down loop in `ci.yml` |
| `frontend` | Frontend lint (Prettier), i18n key completeness plus a negative check that the i18n checker can fail, typecheck, Jest, `next build`, and the per-route bundle budget | `cd frontend && npm ci && npm run lint && npm run i18n:check && npm run typecheck && npm test && npm run build && npm run check:bundle-size` |
| `frontend-paths` | Reports whether the pull request touched `frontend/**`; this is the gate for `e2e` | — (a paths filter, not a command) |
| `e2e` | Playwright runs the chromium project end to end | `cd frontend && npx playwright install --with-deps chromium && npx playwright test --project=chromium` |
| `packages` | The OpenAPI types regenerate cleanly, the SDK error-code union matches `backend/src/errors/errorCodes.ts`, and both packages typecheck and build | `cd packages/types && npm install && npm run generate && npm run typecheck && npm run build`, then `cd ../sdk && npm install && node ../../scripts/generate-sdk-error-codes.mjs --check && npm run typecheck && npm run build` |
| `scripts-typecheck` | The deploy scripts typecheck, and the quarantine ledger is still honest | `cd scripts && npm ci && npm run typecheck`, then `node scripts/check-quarantine.mjs` from the repository root |
| `backend-format` | Backend sources are Prettier-formatted | `cd backend && npm ci && npm run format:check` |
| `shell-check` | Every `*.sh` in the repository parses | `find . -name '*.sh' -not -path './node_modules/*' -exec bash -n {} \;` |
| `conflict-check` | No unresolved merge-conflict markers are committed | `grep -rE '^(<<<<<<<\|=======\|>>>>>>>)' --include='*.ts' --include='*.tsx' --include='*.rs' --include='*.js' --include='*.md' --include='*.json' .` |
| `openapi-check` | `packages/openapi.json` is well-formed and carries both an `openapi` version and an `info.title` | `node -e "JSON.parse(require('fs').readFileSync('packages/openapi.json','utf8'))"` |
| `env-docs-check` | Every variable in the `.env.example` files appears in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | `node scripts/check-env-docs.mjs` |
| `issue-backlog` | The drafts in `docs/contributor-issues/` validate and the backlog index is current | `node scripts/publish-issues.mjs --validate-only --check-index` |
| `contracts` | Rust formatting, Clippy with warnings denied, the contract test suite, a release WASM build, the per-contract size budgets, tarpaulin coverage at or above 75%, and that the fuzz targets still compile | `cd contracts && cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test -- --test-threads=1 && cargo build --workspace --target wasm32v1-none --release --exclude zizalend-integration-tests`, then `node scripts/check-wasm-size.mjs` from the repository root |

### Checks from other workflows

| Check | Workflow | What it verifies | Reproduce locally |
| :--- | :--- | :--- | :--- |
| `commitlint` | [`commitlint.yml`](.github/workflows/commitlint.yml) | Every commit on the branch follows Conventional Commits, with a scope listed in [`commitlint.config.js`](commitlint.config.js) | `npx commitlint --from origin/main --to HEAD` |
| `dependency-review` | [`dependency-review.yml`](.github/workflows/dependency-review.yml) | Dependencies added by the pull request are licence-compatible and free of known advisories | — (runs on GitHub only) |
| `analyze` | [`codeql.yml`](.github/workflows/codeql.yml) | CodeQL static analysis | — (runs on GitHub only) |
| `loadtest` | [`loadtest.yml`](.github/workflows/loadtest.yml) | k6 scenarios against a deployed environment | — (needs a live environment) |

### Environment for the backend suite

The `backend` job supplies these itself. Export the same values before running
the suite locally so you reproduce the job rather than a different configuration:

```bash
export NODE_ENV=test
export DATABASE_URL=postgres://pguser:pgpass@localhost:5432/ZizaLend_test
export REDIS_URL=redis://localhost:6379
export JWT_SECRET=test_jwt_secret
export STELLAR_RPC_URL=https://rpc.test.invalid
export STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
```

The `backend` job in [`ci.yml`](.github/workflows/ci.yml) also passes the four
contract IDs and the pool token address; copy them from there if a test needs
them. [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) explains what each variable
means.

### When a check fails

- **`backend`, `frontend` or `contracts`** — re-run the single step named in the
  failing job rather than the whole job. The commands above are the ones CI runs.
- **`frontend` bundle budget** — `npm run analyze` writes a treemap showing what
  the route is made of. If the growth is intended, raise that route's entry in
  `frontend/bundle-budget.json` in the same pull request and say why.
- **`migration-check`** — never rename a migration that has already been applied.
  Add a new one instead, or run `npm run migrate:reconcile` to record a rename
  that has already shipped.
- **`issue-backlog`** — `node scripts/publish-issues.mjs --validate-only` names
  the malformed draft and the field it is missing.
- **`commitlint`** — amend the message rather than the code. The scopes are
  listed in [`commitlint.config.js`](commitlint.config.js).

## Style Guides

- **TypeScript**: Use functional components and hooks. Prefer `interface` over `type`. Ensure strict typing.
- **Rust**: Follow standard Rust naming conventions and maintain idiomatic code.

---
Thank you for contributing to ZizaLend! 🚀
