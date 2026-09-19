#!/usr/bin/env node
/**
 * Re-record migrations whose filenames changed after a database already ran them.
 *
 * Why this exists
 * ---------------
 * `node-pg-migrate` stores each applied migration's filename in `pgmigrations`, and it
 * refuses to run when a migration it has not seen sorts *before* one it has already
 * applied. Observed verbatim:
 *
 *     Not run migration 1777000000008_unique-loan-status-events is preceding already
 *     run migration 1777000000007_unique-loan-status-events
 *
 * That guard is correct — it is what stops history being rewritten in the middle of an
 * applied sequence — but its consequence is that renaming a migration is not something
 * `migrate up` can recover from by itself.
 *
 * Four migrations were renamed so that every timestamp prefix is unique and the order
 * between siblings is a property of the timestamp rather than of the alphabet (see
 * `scripts/check-migration-timestamps.mjs` for why that matters: one of the pairs joined
 * an index creation to a table rename). Every database that ran the old filenames
 * therefore has to have those names updated *before* its next `migrate up`.
 *
 * This script does exactly that and nothing else.
 *
 * It is idempotent, and safe to run unconditionally before every deploy:
 *   - a database that has never applied the old name is left alone;
 *   - a database already reconciled reports "already recorded" and no UPDATE is issued;
 *   - running it twice changes nothing the second time.
 *
 * Usage
 * -----
 *   node scripts/reconcile-migration-names.mjs             # apply
 *   node scripts/reconcile-migration-names.mjs --dry-run   # report, change nothing
 *
 * Reads DATABASE_URL — the same variable `node-pg-migrate` reads.
 */
import pg from 'pg';

/**
 * Every rename applied by the unique-timestamp change, old name to new name.
 *
 * Keep this list and the four filenames in `backend/migrations/` in step. A name listed
 * here that no longer exists is harmless (the "absent" branch reports it and moves on);
 * a rename that is missing from here is not, because the affected database will fail its
 * next `migrate up` with the order error above.
 */
const RENAMED_MIGRATIONS = [
  {
    from: '1777000000007_unique-loan-status-events',
    to: '1777000000008_unique-loan-status-events',
  },
  {
    from: '1778000000008_transaction-submissions',
    to: '1778000000009_transaction-submissions',
  },
  {
    from: '1786000000016_webhook-max-attempts',
    to: '1786000000017_webhook-max-attempts',
  },
  {
    from: '1788000000018_unified-contract-events',
    to: '1788000000019_unified-contract-events',
  },
];

const TABLE = 'pgmigrations';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    const tableExists = await client.query(
      `SELECT 1
         FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = $1`,
      [TABLE],
    );

    if (tableExists.rowCount === 0) {
      console.log(
        `No ${TABLE} table yet: this database has no applied migrations, so there is ` +
          'nothing to reconcile.',
      );
      return;
    }

    const { rows } = await client.query(`SELECT name FROM ${TABLE}`);
    const recorded = new Set(rows.map((row) => row.name));

    let changed = 0;

    for (const { from, to } of RENAMED_MIGRATIONS) {
      if (recorded.has(to)) {
        console.log(`already recorded  ${to}`);
        continue;
      }

      if (!recorded.has(from)) {
        console.log(`not applied here  ${from}`);
        continue;
      }

      if (dryRun) {
        console.log(`would update      ${from}  ->  ${to}`);
        changed += 1;
        continue;
      }

      await client.query(`UPDATE ${TABLE} SET name = $1 WHERE name = $2`, [to, from]);
      recorded.delete(from);
      recorded.add(to);
      console.log(`updated           ${from}  ->  ${to}`);
      changed += 1;
    }

    if (dryRun) {
      console.log(`\nDry run: ${changed} row(s) would be updated.`);
    } else if (changed === 0) {
      console.log('\nNothing to reconcile: every renamed migration is already recorded.');
    } else {
      console.log(`\nReconciled ${changed} renamed migration(s).`);
    }
  } finally {
    await client.end();
  }
}

await main();
