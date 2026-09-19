#!/usr/bin/env node
/**
 * Fail when two migrations share a timestamp prefix.
 *
 * Why this is a gate and not a convention
 * --------------------------------------
 * `node-pg-migrate` orders migrations by filename, so two files sharing a prefix are
 * ordered by whatever the rest of the name happens to sort as. That is luck, and the
 * cost of losing the luck is not cosmetic: `1788000000018_add-loan-events-missing-indexes`
 * creates indexes on `loan_events` while its sibling — `1788000000018_unified-contract-events`
 * before the change that introduced this check, `1788000000019_unified-contract-events` after
 * it — *renames that table*. Only the alphabet ('a' before 'u') kept them in the working
 * order.
 * Renaming either file for any unrelated reason, or adding a third with the same prefix,
 * silently reorders them and the migration then fails — or worse, half-applies.
 *
 * A tie that resolves correctly today is indistinguishable from a tie that resolves
 * correctly by accident, so the tie itself is what gets rejected. Every timestamp must be
 * unique, which makes the order a property of the data rather than of the sort.
 *
 * On renaming a migration that may already be applied
 * ---------------------------------------------------
 * A rename changes the name recorded in `pgmigrations`, so a database that applied the old
 * name will run the renamed file again on its next deploy. Renaming is therefore only safe
 * when the migration is idempotent — either it already was, or the edit made it so. That is
 * why the four files consolidated by the change that introduced this check each carry a note
 * explaining how they tolerate a second run.
 *
 * Usage
 * -----
 *   node scripts/check-migration-timestamps.mjs            # check the migrations directory
 *   node scripts/check-migration-timestamps.mjs --json     # machine-readable, for CI summaries
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, "..", "backend", "migrations");

/** The `node-pg-migrate` convention: a numeric timestamp, an underscore, then a name. */
const PREFIX_PATTERN = /^(\d+)_/;

async function main() {
  const asJson = process.argv.includes("--json");

  let entries;
  try {
    entries = await fs.readdir(MIGRATIONS_DIR);
  } catch (error) {
    console.error(`Could not read ${MIGRATIONS_DIR}: ${error.message}`);
    process.exit(1);
  }

  // Sorted exactly as node-pg-migrate sorts them, so the reported order is the real one.
  const migrations = entries.filter((file) => file.endsWith(".js")).sort();

  if (migrations.length === 0) {
    console.error(`No migrations found in ${MIGRATIONS_DIR}.`);
    process.exit(1);
  }

  const byPrefix = new Map();
  const malformed = [];

  for (const file of migrations) {
    const match = PREFIX_PATTERN.exec(file);
    if (!match) {
      malformed.push(file);
      continue;
    }
    const prefix = match[1];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(file);
  }

  const collisions = [...byPrefix.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([prefix, files]) => ({ prefix, files }));

  if (asJson) {
    console.log(
      JSON.stringify(
        { checked: migrations.length, collisions, malformed },
        null,
        2,
      ),
    );
    process.exit(collisions.length === 0 && malformed.length === 0 ? 0 : 1);
  }

  if (malformed.length > 0) {
    console.error("Migrations must be named `<numeric-timestamp>_<name>.js`:");
    for (const file of malformed) console.error(`  ${file}`);
    console.error("");
  }

  if (collisions.length > 0) {
    console.error(
      `Found ${collisions.length} migration timestamp collision(s) in backend/migrations/:\n`,
    );
    for (const { prefix, files } of collisions) {
      console.error(`  ${prefix}_ is shared by ${files.length} files:`);
      // The order shown is the order node-pg-migrate will apply them in, which is the
      // thing a reader needs to confirm is the intended one.
      files.forEach((file, index) =>
        console.error(`    ${index + 1}. ${file}`),
      );
      console.error(
        "    The order above is decided by the rest of the filename, not by the timestamp.\n",
      );
    }
    console.error(
      "Give each file a unique timestamp. To preserve the effective order, bump the\n" +
        "later file(s) to a value between the shared prefix and the next migration, and\n" +
        "make sure the renamed migration still tolerates being run again on a database\n" +
        "that already applied it under its previous name.\n",
    );
  }

  if (malformed.length > 0 || collisions.length > 0) {
    process.exit(1);
  }

  console.log(
    `All ${migrations.length} migration timestamps are unique ` +
      `(${byPrefix.size} distinct prefixes).`,
  );
}

await main();
