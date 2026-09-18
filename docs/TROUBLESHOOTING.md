# Troubleshooting Guide

Common issues encountered during ZizaLend development and how to resolve them.

---

## Frontend

### `Cannot find module 'next/jest'`

**Cause:** Dependencies not installed.

**Fix:**
```bash
cd frontend && npm install
```

### Build fails with `Module not found` errors

**Cause:** Missing or corrupted dependencies.

**Fix:**
```bash
cd frontend && rm -rf node_modules package-lock.json && npm install
```

### `TypeError: Cannot read properties of undefined (reading 'xxx')` at runtime

**Cause:** Environment variables are missing or incorrect.

**Fix:** Ensure your `.env` file has all required variables. Compare against `.env.example`:

```bash
diff <(grep -o '^[^#=]*' .env | sort) <(grep -o '^[^#=]*' .env.example | sort)
```

### Wallet connection fails

**Issue:** Freighter wallet not detected or connection timeout.

**Checks:**
1. Is [Freighter](https://freighter.app) installed and unlocked?
2. Is Freighter set to the correct network (Testnet vs Mainnet)?
3. Check browser console for CORS errors — ensure `NEXT_PUBLIC_API_URL` matches the backend origin.
4. Try clearing browser cache and reloading.

---

## Backend

### `ECONNREFUSED` on database connection

**Cause:** PostgreSQL is not running or the connection string is wrong.

**Checks:**
```bash
# Is Postgres running?
pg_isready

# Can you connect with the configured credentials?
psql "$DATABASE_URL"
```

**Docker:**
```bash
docker-compose up -d db
docker-compose logs db
```

### `Migrate: No migrations to run` but tables are missing

**Cause:** Migration history table exists but migrations were applied manually or from a different branch.

**Fix:**
```bash
# Force-mark all migrations as not run, then re-apply
npm run migrate:down -- --count 999
npm run migrate:up
```

### Redis connection failures

**Cause:** Redis not running.

**Fix (Docker):**
```bash
docker-compose up -d redis
```

**Fix (standalone):**
```bash
redis-server --daemonize yes
```

### Tests fail with timeouts

**Cause:** Tests require database or Redis connectivity but services are unavailable.

**Fix:** Ensure required services are running. For unit tests that don't need a database, run with a mock:

```bash
NODE_ENV=test npx jest --selectProjects=unit
```

### `Error: listen EADDRINUSE :::3001`

**Cause:** Another process is already using port 3001.

**Fix:**
```bash
# Find the process
lsof -i :3001

# Kill it
kill -9 <PID>
```

---

## Smart Contracts (Rust/Soroban)

### `cargo build` fails with wasm32 target errors

**Cause:** Missing WASM target.

**Fix:**
```bash
rustup target add wasm32-unknown-unknown
```

### Contract deployment fails with `Contract not found`

**Cause:** Contract not deployed, or wrong contract ID in environment configuration.

**Fix:**
1. Verify the contract ID matches the deployed contract:
   ```bash
   soroban contract id --network testnet --source <deployer>
   ```
2. Check `docs/deployed-contracts.md` for the expected contract IDs.
3. Ensure the contract ID is correctly set in your `.env` file.

### `transaction simulation failed: HostError` during contract interaction

**Cause:** Usually one of:
- Insufficient balance
- Contract not authorized for the operation
- Invalid arguments

**Debug:**
```bash
# Enable verbose Soroban logging
export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
soroban contract invoke --id <CONTRACT_ID> --network testnet --source <ACCOUNT> \
  --fn <FUNCTION> --arg <ARGS> --cost
```

---

## Docker / Infrastructure

### Container exits immediately

**Cause:** Missing environment variables or startup script failure.

**Fix:**
```bash
docker logs <container_name>
```

Common issues:
- `DATABASE_URL` not set
- `PORT` conflict
- Health check failing repeatedly

### Docker build fails with `no space left on device`

**Fix:**
```bash
docker system prune -af --volumes
```

### Staging deployment fails at health check

**Cause:** Service started but `/health` endpoint returns non-200.

**Debug:**
```bash
# SSH into the server
ssh <user>@<host>

# Check container logs
docker logs <container_name>

# Check if the port is listening
ss -tlnp | grep <port>
```

---

## CI/CD

### `supply-chain-audit` fails

**Cause:** A known malicious package was detected in `package-lock.json`.

**Fix:**
1. Check the CI output for which package triggered the alert.
2. Run `npm audit` locally to find the dependency chain.
3. Add an override in the relevant `package.json` or update the dependency.

### Migration check fails

**Cause:** A migration cannot be rolled back cleanly, or the `down` function has a bug.

**Fix:**
```bash
# Run locally with a test database
npm run migrate:down -- --count 1

# If the down migration fails, fix the down function and re-test.
```

---

## Performance

### Slow API responses

**Checks:**
1. Are database connection pool settings appropriate? Check `DB_CONN_TIMEOUT_MS` and `DB_STATEMENT_TIMEOUT_MS`.
2. Are frequent queries hitting the database without caching? Review Redis cache hit rates.
3. Are there missing database indexes? Review query plans with `EXPLAIN ANALYZE`.

### Frontend is slow to load

**Checks:**
1. Check the Next.js build output for large bundles.
2. Are images optimized? Use `next/image` with proper `width`/`height`.
3. Is code splitting working? Check that route segments are properly lazy-loaded.

---

## Getting Help

- **GitHub Issues:** [https://github.com/Ziza-Inc/ZizaLend/issues](https://github.com/Ziza-Inc/ZizaLend/issues)
- **Internal Wiki:** [docs/wiki/README.md](./wiki/README.md)
- **Architecture:** [ARCHITECTURE.md](../ARCHITECTURE.md)
- **Runbooks:** [docs/runbooks/](./runbooks/)
