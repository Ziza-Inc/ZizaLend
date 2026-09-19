# Demo and seeded data

`backend/src/seed/index.ts` writes a fixed set of synthetic rows so the interface has something to
render locally. Those rows are indistinguishable from real activity once they are in the database,
so two things have to be true whenever they are visible to someone who did not create them:

1. the seed script refuses to run against production, and
2. any deployment that does show seeded rows says so on the page.

This document is the inventory: what the script writes, how to tell whether a database has been
seeded, and how the frontend is meant to be configured when it has.

## What the script writes

| Table | Rows | Marker |
| --- | --- | --- |
| `user_profiles` | 5 | `public_key` begins with `GDEVUSER` (`GDEVUSERALICE…`, `GDEVUSERBOLA…`, `GDEVUSERCHIDI…`, `GDEVUSERDARA…`, `GDEVUSEREFE…`) |
| `scores` | 5 | one per seeded `user_profiles` row |
| `remittance_history` | 11 | `user_id` is one of the seeded keys; months `January`–`March` |
| `loan_history` | 4 | `loan_id` 1001–1004, statuses `Active`, `Repaid`, `Defaulted`, `Pending` |
| `contract_events` | 9 | `event_id` begins with `seed-loan-`; `tx_hash` begins with `seed-tx-`; `contract_id` is `CDDUMMYZizaLendCONTRACT…` |
| `notifications` | 5 | titles match the seeded loan activity (`Repayment Due Soon`, `Loan Approved`, …) |
| `indexer_state` | 1 | `last_indexed_cursor` is `seeded-dev-data` |

The data is anchored to a fixed date (`NOW` in the script) rather than to the current time, so the
same rows appear on every machine and in every screenshot.

`SYNTHETIC_SOURCE_MARKER` in `backend/src/seed/guard.ts` is the `seeded-dev-data` value above. It is
the cheapest way to answer "has this database been seeded?":

```sql
SELECT last_indexed_cursor FROM indexer_state ORDER BY id DESC LIMIT 1;
```

A result of `seeded-dev-data` means yes. Anything else — including `NULL` — means the indexer's own
cursor is the only thing recorded there.

## Seeding refuses to run against production

`assertSeedingAllowed()` runs before the script opens a transaction:

| `NODE_ENV` | Seeding |
| --- | --- |
| `development`, `dev`, `test`, `local`, unset | allowed |
| `production`, `prod` | **refused**, with no override |
| anything else (`staging`, `preview`, …) | refused unless `SEED_ALLOW_NON_DEVELOPMENT=true` |

There is deliberately no flag that permits production. A deployment that needs sample data has a
staging environment, and `SEED_ALLOW_NON_DEVELOPMENT` is the acknowledgement that a *deployed*,
non-production database is about to receive synthetic rows.

```bash
# local
npm --prefix backend run seed

# a deployed Testnet/staging instance, deliberately
NODE_ENV=staging SEED_ALLOW_NON_DEVELOPMENT=true npm --prefix backend run seed
```

The rules are tested in `backend/src/seed/__tests__/seedGuard.test.ts`, including the ordering
requirement that the check happens before `BEGIN`.

## Labelling seeded data in the interface

`NEXT_PUBLIC_DEMO_DATA=true` renders a banner at the top of every page saying the accounts, loans and
remittances are seeded sample activity. It is read by
`frontend/src/app/components/global_ui/DemoDataBanner.tsx` and rendered by `DashboardShell`.

Set it on any deployment whose database has been seeded, and leave it unset everywhere else — the
banner is not decoration, so a local `npm run dev` does not need it and a production deployment must
never have it.

| Deployment | Database | `NEXT_PUBLIC_DEMO_DATA` |
| --- | --- | --- |
| Local development | Seeded | unset (the developer ran the seed script themselves) |
| Deployed Testnet / staging demo | Seeded | `true` |
| Production | Real activity only | unset — and `NODE_ENV=production` refuses seeding in the first place |

Because `NEXT_PUBLIC_*` variables are inlined at build time, changing this value requires a frontend
rebuild, not a restart.

## What a seeded deployed instance shows

The staging deployment does not seed anything itself: `deploy-staging.yml` applies migrations and
nothing else. Its data comes from running this script against the staging database on purpose. When
database and frontend agree — `seeded-dev-data` in `indexer_state`, `NEXT_PUBLIC_DEMO_DATA=true` in
the build — the instance renders the banner over the five invented borrowers and lenders, the four
loans and their history, and its contract calls target Testnet contract IDs, not mainnet.

A reviewer looking at a seeded instance should assume every figure is synthetic:

- the five accounts are `GDEVUSER…` keys that hold no real balance,
- the contract events reference `CDDUMMYZizaLendCONTRACT…`, which is not a deployed contract,
- `loans 1001–1004` are the only loans in `loan_history` until real activity is indexed.

## Removing seeded data

```bash
# Delete the seeded rows and reset indexer_state
npm --prefix backend run seed:reset
```

`--reset` truncates `notifications`, `contract_events`, `loan_history`, `remittance_history`,
`scores` and `user_profiles`, and zeroes `indexer_state`. It is the same guard-gated path, so it
cannot run against production either. After a reset, also unset `NEXT_PUBLIC_DEMO_DATA` and rebuild
the frontend — an instance that shows the banner over an empty database is misleading in the other
direction.
