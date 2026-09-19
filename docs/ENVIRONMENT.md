# Environment Variable Reference

This document lists every environment variable used by the ZizaLend platform. Each table covers one package.

---

## Backend (`backend/`)

| Variable | Dev | Staging | Prod | Default | Description | Source |
|---|---|---|---|---|---|---|
| `LOG_LEVEL` | — | — | — | `debug` (dev) / `info` (other envs) | Winston log level override (`error`, `warn`, `info`, `http`, `debug`). Falls back to the `NODE_ENV` default when unset or invalid. | `backend/src/utils/logger.ts` |
| `CORS_ALLOWED_ORIGINS` | ✓ | ✓ | ✓ | `http://localhost:3000,http://localhost:3001` | Comma-separated origins allowed by CORS | `backend/src/config/index.ts` |
| `FRONTEND_URL` | ✓ | ✓ | ✓ | `http://localhost:3000` | Frontend base URL used for links | `backend/src/config/index.ts` |
| `PORT` | ✓ | ✓ | ✓ | `3001` | HTTP port the API listens on | `backend/src/index.ts` |
| `DATABASE_URL` | ✓ | ✓ | ✓ | `postgres://postgres:postgres@db:5432/ZizaLend` | PostgreSQL connection string | `backend/src/db/connection.js` |
| `DB_CONN_TIMEOUT_MS` | — | ✓ | ✓ | `10000` | Pool connection timeout in ms; pool.connect() rejects instead of hanging | `backend/src/db/connection.ts` |
| `DB_STATEMENT_TIMEOUT_MS` | — | ✓ | ✓ | `30000` | Per-query statement_timeout in ms; a stuck query never holds a connection indefinitely | `backend/src/db/connection.ts` |
| `REDIS_URL` | — | ✓ | ✓ | `redis://redis:6379` | **Optional.** Redis connection string for the response cache, distributed locks and rate limiting. When unset the service uses an in-process store: it still boots and serves traffic, but cache entries and rate-limit counters are per-instance and are discarded on restart. Set it for multi-instance deployments. | `backend/src/utils/kvStore.ts` |
| `CACHE_DRIVER` | — | — | — | `auto` | Which key-value store backs the cache and rate limiter: `auto` (Redis when `REDIS_URL` is set, otherwise the in-process store), `redis` (hard requirement — startup fails without `REDIS_URL`), or `memory` (force the in-process store). | `backend/src/utils/kvStore.ts` |
| `STELLAR_NETWORK` | ✓ | ✓ | ✓ | `testnet` | Stellar network name (`testnet`, `mainnet`) | `backend/src/config/stellar.ts` |
| `STELLAR_RPC_URL` | ✓ | ✓ | ✓ | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint | `backend/src/config/stellar.ts` |
| `STELLAR_NETWORK_PASSPHRASE` | ✓ | ✓ | ✓ | `Test SDF Network ; September 2015` | Network passphrase for transaction signing | `backend/src/config/stellar.ts` |
| `LOAN_MANAGER_CONTRACT_ID` | ✓ | ✓ | ✓ | — | Deployed loan manager contract address | `backend/src/config/stellar.ts` |
| `REMITTANCE_NFT_CONTRACT_ID` | ✓ | ✓ | ✓ | — | Deployed remittance NFT contract address | `backend/src/config/contracts.ts` |
| `LENDING_POOL_CONTRACT_ID` | ✓ | ✓ | ✓ | — | Deployed lending pool contract address | `backend/src/config/stellar.ts` |
| `MULTISIG_GOVERNANCE_CONTRACT_ID` | ✓ | ✓ | ✓ | — | Governance instance that governs the LoanManager (reported by `GET /version`) | `backend/src/config/contracts.ts` |
| `POOL_GOVERNANCE_CONTRACT_ID` | ✓ | ✓ | ✓ | — | Governance instance that governs the LendingPool | `backend/src/app.ts` |
| `NFT_GOVERNANCE_CONTRACT_ID` | ✓ | ✓ | ✓ | — | Governance instance that governs the RemittanceNFT | `backend/src/app.ts` |
| `POOL_TOKEN_ADDRESS` | ✓ | ✓ | ✓ | — | Pool token contract address | `backend/src/config/stellar.ts` |
| `STELLAR_USDC_ISSUER` | — | ✓ | ✓ | — | USDC asset issuer address | `backend/src/config/stellar.ts` |
| `STELLAR_EURC_ISSUER` | — | ✓ | ✓ | — | EURC asset issuer address | `backend/src/config/stellar.ts` |
| `STELLAR_PHP_ISSUER` | — | ✓ | ✓ | — | PHP asset issuer address | `backend/src/config/stellar.ts` |
| `LOAN_MANAGER_ADMIN_SECRET` | ✓ | ✓ | ✓ | — | Admin secret key for loan manager operations | `backend/src/config/stellar.ts` |
| `SCORE_RECONCILIATION_SOURCE_SECRET` | — | ✓ | ✓ | — | Secret key for score reconciliation operations | `backend/src/services/scoreService.ts` |
| `LOAN_MIN_SCORE` | ✓ | ✓ | ✓ | — | Minimum credit score to request a loan. **Required, no default** — startup fails without it and outside 300–850. | `backend/src/config/loanConfig.ts` |
| `LOAN_MAX_AMOUNT` | ✓ | ✓ | ✓ | — | Maximum loan amount in USD. **Required, no default** — range 1–1000000. | `backend/src/config/loanConfig.ts` |
| `LOAN_INTEREST_RATE_PERCENT` | ✓ | ✓ | ✓ | — | Annual interest rate percentage. **Required, no default** — range 1–100. | `backend/src/config/loanConfig.ts` |
| `CREDIT_SCORE_THRESHOLD` | ✓ | ✓ | ✓ | — | Threshold for loan approval score. **Required, no default** — range 300–850. | `backend/src/config/loanConfig.ts` |
| `SCORE_DELTA_REPAY` | ✓ | ✓ | ✓ | `15` | Magnitude of the score increase on timely repayment. Must be a positive integer. | `backend/src/services/sorobanService.ts` |
| `SCORE_DELTA_DEFAULT` | ✓ | ✓ | ✓ | `50` | Magnitude of the score penalty on default. Must be a positive integer. | `backend/src/services/sorobanService.ts` |
| `SCORE_DELTA_LATE` | ✓ | ✓ | ✓ | `5` | Magnitude of the score penalty on late payment. Must be a positive integer. | `backend/src/services/sorobanService.ts` |
| `INDEXER_POLL_INTERVAL_MS` | ✓ | ✓ | ✓ | `30000` | Event indexer poll interval in milliseconds | `backend/src/config/indexer.ts` |
| `INDEXER_BATCH_SIZE` | ✓ | ✓ | ✓ | `100` | Events fetched per poll cycle | `backend/src/config/indexer.ts` |
| `INDEXER_HEALTH_LAG_LIMIT` | ✓ | ✓ | ✓ | `100` | Maximum ledger lag before `/health/deep` reports the indexer as degraded | `backend/src/services/healthService.ts` |
| `DEFAULT_CHECK_INTERVAL_MS` | ✓ | ✓ | ✓ | `1800000` | Default checker interval (30 min) | `backend/src/services/defaultChecker.ts` |
| `DEFAULT_CHECK_MAX_LOANS_PER_RUN` | ✓ | ✓ | ✓ | `500` | Max loans processed per default check run | `backend/src/services/defaultChecker.ts` |
| `DEFAULT_CHECK_BATCH_SIZE` | ✓ | ✓ | ✓ | `25` | Loans per batch during default check | `backend/src/services/defaultChecker.ts` |
| `DEFAULT_CHECK_BATCH_TIMEOUT_MS` | ✓ | ✓ | ✓ | `300000` | Timeout per batch (5 min) | `backend/src/services/defaultChecker.ts` |
| `DEFAULT_CHECK_CONCURRENCY` | ✓ | ✓ | ✓ | `3` | Concurrent check workers | `backend/src/services/defaultChecker.ts` |
| `DEFAULT_CHECK_POLL_ATTEMPTS` | ✓ | ✓ | ✓ | `30` | Max poll attempts per check | `backend/src/services/defaultChecker.ts` |
| `DEFAULT_CHECK_POLL_SLEEP_MS` | ✓ | ✓ | ✓ | `1000` | Sleep between poll attempts | `backend/src/services/defaultChecker.ts` |
| `LOAN_TERM_LEDGERS` | ✓ | ✓ | ✓ | `17280` | Default loan term in ledgers (~30 days) | `backend/src/config/loans.ts` |
| `SCORE_RECONCILIATION_INTERVAL_MS` | ✓ | ✓ | ✓ | `3600000` | Score reconciliation interval | `backend/src/config/scores.ts` |
| `SCORE_RECONCILIATION_MAX_BORROWERS_PER_RUN` | ✓ | ✓ | ✓ | `500` | Max borrowers per reconciliation run | `backend/src/config/scores.ts` |
| `SCORE_RECONCILIATION_BATCH_SIZE` | ✓ | ✓ | ✓ | `25` | Borrowers per batch in reconciliation | `backend/src/config/scores.ts` |
| `SCORE_RECONCILIATION_AUTOCORRECT_ENABLED` | ✓ | ✓ | ✓ | `false` | Enable automatic score correction | `backend/src/config/scores.ts` |
| `SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD` | ✓ | ✓ | ✓ | `50` | Max points auto-corrected per run | `backend/src/config/scores.ts` |
| `JWT_SECRET` | ✓ | ✓ | ✓ | `your-super-secret-jwt-key-change-in-production` | JWT signing/verification secret | `backend/src/middleware/jwtAuth.ts` |
| `INTERNAL_API_KEY` | ✓ | ✓ | ✓ | `change-me` | API key for internal endpoints | `backend/src/middleware/auth.ts` |
| `ADMIN_WALLETS` | ✓ | ✓ | ✓ | — | Comma-separated Stellar public keys granted the `admin` role (`admin:all` scope). **Security-critical**: any wallet listed here receives full admin privileges. Unlisted wallets default to `borrower`. | `backend/src/auth/rbac.ts` |
| `LENDER_WALLETS` | ✓ | ✓ | ✓ | — | Comma-separated Stellar public keys granted the `lender` role (`read:loans`, `read:pool` scopes). Unlisted wallets default to `borrower`. | `backend/src/auth/rbac.ts` |
| `EXPOSE_STACK_TRACES` | — | — | — | `false` | When `"true"`, include stack traces in error responses. **Never enable in production.** | `backend/src/middleware/errorHandler.ts` |
| `JWT_COOKIE_NAME` | ✓ | ✓ | ✓ | `ZizaLend_jwt` | Name of the HTTP cookie used to transport the JWT token | `backend/src/middleware/jwtAuth.ts` |
| `WEBHOOK_REQUEST_TIMEOUT_MS` | ✓ | ✓ | ✓ | `30000` | Outgoing webhook request timeout | `backend/src/services/webhookService.ts` |
| `SENTRY_DSN` | — | ✓ | ✓ | — | Sentry DSN for backend error tracking | `backend/src/app.ts` |
| `NOTIFICATION_RETENTION_DAYS` | ✓ | ✓ | ✓ | `90` | Days to keep unread notifications | `backend/src/services/notificationService.ts` |
| `READ_NOTIFICATION_RETENTION_DAYS` | ✓ | ✓ | ✓ | `30` | Days to keep read notifications | `backend/src/services/notificationService.ts` |
| `SENDGRID_API_KEY` | — | ✓ | ✓ | — | SendGrid API key for email | `backend/src/services/emailService.ts` |
| `FROM_EMAIL` | — | ✓ | ✓ | — | Sender email address | `backend/src/services/emailService.ts` |
| `ADMIN_EMAIL` | — | ✓ | ✓ | — | Admin notification email | `backend/src/services/notificationService.ts` |
| `ADMIN_WEBHOOK_URL` | — | ✓ | ✓ | — | Admin notification webhook URL | `backend/src/services/notificationService.ts` |
| `TWILIO_ACCOUNT_SID` | — | ✓ | ✓ | — | Twilio account SID for SMS | `backend/src/services/smsService.ts` |
| `TWILIO_AUTH_TOKEN` | — | ✓ | ✓ | — | Twilio auth token | `backend/src/services/smsService.ts` |
| `TWILIO_PHONE_NUMBER` | — | ✓ | ✓ | — | Twilio sender phone number | `backend/src/services/smsService.ts` |

---

## Frontend (`frontend/`)

| Variable                           | Dev | Staging | Prod | Default                                   | Description                                            | Source                                      |
| ---------------------------------- | --- | ------- | ---- | ----------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `NEXT_PUBLIC_API_URL`              | ✓   | ✓       | ✓    | `http://localhost:3001`                   | Backend API base URL                                   | `frontend/src/app/hooks/useApi.ts`          |
| `NEXT_PUBLIC_APP_URL`              | ✓   | ✓       | ✓    | `https://ZizaLend.com`                   | Public-facing app URL used for absolute links          | `frontend/src/lib/canonicalUrl.ts`          |
| `NEXT_PUBLIC_SENTRY_DSN`           | —   | ✓       | ✓    | —                                         | Sentry DSN for frontend error tracking                 | `frontend/src/sentry.client.config.ts`      |
| `SENTRY_DSN`                       | —   | ✓       | ✓    | —                                         | Sentry DSN server-side                                 | `frontend/src/sentry.server.config.ts`      |
| `SENTRY_ORG`                       | —   | ✓       | ✓    | —                                         | Sentry organization slug                               | `frontend/sentry.client.config.ts`          |
| `SENTRY_PROJECT`                   | —   | ✓       | ✓    | —                                         | Sentry project slug                                    | `frontend/sentry.client.config.ts`          |
| `SENTRY_AUTH_TOKEN`                | —   | ✓       | ✓    | —                                         | Sentry auth token for source maps                      | `frontend/next.config.ts`                   |
| `NODE_ENV`                         | ✓   | ✓       | ✓    | `development`                             | Node environment (`development`, `test`, `production`) | `next.config.ts`                            |
| `NEXT_PUBLIC_STELLAR_EXPLORER_URL` | ✓   | ✓       | ✓    | `https://stellar.expert/explorer/testnet` | Stellar explorer base URL for transaction links        | `frontend/src/components/ui/TxHashLink.tsx` |
| `NEXT_PUBLIC_HORIZON_URL`         | ✓   | ✓       | ✓    | `https://horizon-testnet.stellar.org`     | Stellar Horizon URL for wallet/account lookups        | `frontend/src/app/[locale]/wallet/page.tsx` |
| `NEXT_PUBLIC_STELLAR_RPC_URL`     | ✓   | ✓       | ✓    | `https://soroban-testnet.stellar.org`     | Soroban RPC endpoint for contract interaction         | `frontend/src/app/hooks/useApi.ts`          |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | ✓ | ✓       | ✓    | `Test SDF Network ; September 2015`       | Stellar network passphrase for transaction signing    | `frontend/src/app/hooks/useApi.ts`          |
| `NEXT_PUBLIC_MANAGER_CONTRACT_ID`  | ✓   | ✓       | ✓    | —                                         | Loan manager contract ID for Soroban calls            | `frontend/src/app/hooks/useApi.ts`          |
| `NEXT_PUBLIC_LOAN_MANAGER_CONTRACT_ID` | ✓ | ✓     | ✓    | —                                         | Alias for NEXT_PUBLIC_MANAGER_CONTRACT_ID             | `frontend/src/app/hooks/useApi.ts`          |
| `NEXT_PUBLIC_NFT_CONTRACT_ID`      | ✓   | ✓       | ✓    | —                                         | Remittance NFT contract ID                            | `frontend/src/app/hooks/useApi.ts`          |
| `NEXT_PUBLIC_POOL_CONTRACT_ID`     | ✓   | ✓       | ✓    | —                                         | Lending pool contract ID                              | `scripts/deploy.ts`                         |
| `NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID` | ✓ | ✓       | ✓    | —                                         | Governance instance for the LoanManager (written by the deploy script) | `scripts/deploy.ts`                         |
| `NEXT_PUBLIC_POOL_GOVERNANCE_CONTRACT_ID` | ✓ | ✓  | ✓    | —                                         | Governance instance for the LendingPool                | `scripts/deploy.ts`                         |
| `NEXT_PUBLIC_NFT_GOVERNANCE_CONTRACT_ID` | ✓ | ✓    | ✓    | —                                         | Governance instance for the RemittanceNFT              | `scripts/deploy.ts`                         |

---

## Contracts / Scripts (`contracts/`, `scripts/`)

| Variable                     | Dev | Staging | Prod | Default                               | Description                                | Source              |
| ---------------------------- | --- | ------- | ---- | ------------------------------------- | ------------------------------------------ | ------------------- |
| `SOROBAN_RPC_URL`            | ✓   | ✓       | ✓    | `https://soroban-testnet.stellar.org` | RPC URL for contract deployment            | `scripts/deploy.ts` |
| `SOROBAN_NETWORK_PASSPHRASE` | ✓   | ✓       | ✓    | `Test SDF Network ; September 2015`   | Network passphrase for contract operations | `scripts/deploy.ts` |
| `SOROBAN_ACCOUNT`            | ✓   | ✓       | ✓    | —                                     | Deployer account secret key                | `scripts/deploy.ts` |
| `DEPLOY_CONFIG_PATH`         | —   | ✓       | ✓    | `scripts/deploy-config.json`          | Path to deploy configuration               | `scripts/deploy.ts` |

---

## `.env.example` vs `ENVIRONMENT.md` Drift

A CI job (`env-docs-check`) runs on every PR to ensure the keys listed in `.env.example` files are present in this document. The check performs a sorted diff and fails if any key is missing from either side.

To update this document after adding a new environment variable:

1. Add the variable to the relevant `.env.example` file.
2. Add a row to the table above with all columns filled.
3. The CI job will pass automatically.
