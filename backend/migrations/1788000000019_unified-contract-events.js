/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const up = (pgm) => {
  // Renamed from `1788000000018_unified-contract-events`, which collided with
  // `1788000000018_add-loan-events-missing-indexes`. That collision mattered more than
  // a cosmetic tie: the other migration creates indexes on `loan_events` and this one
  // *renames that table*, so only the alphabetical accident of 'a' before 'u' kept the
  // two from running the other way round and failing. The timestamp is now unique and
  // the effective order is unchanged.
  //
  // Because the recorded name changed, a database that applied the old filename will
  // run this one again, so every step is written to reach the same end state whether or
  // not it has already been applied.

  // 1. Rename the table, unless an earlier run already did it.
  pgm.sql(`
    DO $$
    BEGIN
      IF to_regclass('contract_events') IS NULL
         AND to_regclass('loan_events') IS NOT NULL THEN
        ALTER TABLE loan_events RENAME TO contract_events;
      END IF;
    END
    $$;
  `);

  // 2. Rename the column (Postgres keeps index definitions pointing at it), again only
  //    if the rename has not happened yet.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'contract_events'
          AND column_name = 'borrower'
      ) THEN
        ALTER TABLE contract_events RENAME COLUMN borrower TO address;
      END IF;
    END
    $$;
  `);

  // 3. Make address nullable (for events like YieldDistributed that may not have a
  //    user address). "DROP NOT NULL" is a no-op when it is already dropped.
  pgm.sql('ALTER TABLE contract_events ALTER COLUMN address DROP NOT NULL;');

  // 4. Rename indexes to match the new table and column names. pgm.renameIndex
  // doesn't exist in older node-pg-migrate versions, so use raw SQL with
  // IF EXISTS guards so the migration is idempotent regardless of which
  // indexes the earlier schema created.
  pgm.sql(`
    ALTER INDEX IF EXISTS idx_loan_events_borrower_event_type RENAME TO idx_contract_events_address_event_type;
    ALTER INDEX IF EXISTS idx_loan_events_loan_id_event_type RENAME TO idx_contract_events_loan_id_event_type;
    ALTER INDEX IF EXISTS idx_loan_events_event_type_loan_id RENAME TO idx_contract_events_event_type_loan_id;
    ALTER INDEX IF EXISTS idx_loan_events_ledger RENAME TO idx_contract_events_ledger;
    ALTER INDEX IF EXISTS idx_loan_events_pool_deposits_withdraws RENAME TO idx_contract_events_pool_deposits_withdraws;
    ALTER INDEX IF EXISTS loan_events_event_type_index RENAME TO contract_events_event_type_index;
    ALTER INDEX IF EXISTS loan_events_borrower_index RENAME TO contract_events_address_index;
    ALTER INDEX IF EXISTS loan_events_loan_id_index RENAME TO contract_events_loan_id_index;
    ALTER INDEX IF EXISTS loan_events_ledger_index RENAME TO contract_events_ledger_index;
    ALTER INDEX IF EXISTS loan_events_tx_hash_index RENAME TO contract_events_tx_hash_index;
  `);

  // 5. Create a view for backward compatibility with existing code that still queries
  //    'loan_events'. "CREATE OR REPLACE" so a second run replaces the identical view
  //    rather than failing with "relation already exists".
  pgm.sql(`
    CREATE OR REPLACE VIEW loan_events AS
    SELECT
      id,
      event_id,
      event_type,
      loan_id,
      address AS borrower,
      amount,
      ledger,
      ledger_closed_at,
      tx_hash,
      contract_id,
      topics,
      value,
      created_at
    FROM contract_events;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS loan_events');

  pgm.renameColumn('contract_events', 'address', 'borrower');
  pgm.alterColumn('contract_events', 'borrower', { notNull: true });

  pgm.renameTable('contract_events', 'loan_events');

  pgm.sql(`
    ALTER INDEX IF EXISTS idx_contract_events_address_event_type RENAME TO idx_loan_events_borrower_event_type;
    ALTER INDEX IF EXISTS idx_contract_events_loan_id_event_type RENAME TO idx_loan_events_loan_id_event_type;
    ALTER INDEX IF EXISTS idx_contract_events_event_type_loan_id RENAME TO idx_loan_events_event_type_loan_id;
    ALTER INDEX IF EXISTS idx_contract_events_ledger RENAME TO idx_loan_events_ledger;
    ALTER INDEX IF EXISTS idx_contract_events_pool_deposits_withdraws RENAME TO idx_loan_events_pool_deposits_withdraws;
    ALTER INDEX IF EXISTS contract_events_event_type_index RENAME TO loan_events_event_type_index;
    ALTER INDEX IF EXISTS contract_events_address_index RENAME TO loan_events_borrower_index;
    ALTER INDEX IF EXISTS contract_events_loan_id_index RENAME TO loan_events_loan_id_index;
    ALTER INDEX IF EXISTS contract_events_ledger_index RENAME TO loan_events_ledger_index;
    ALTER INDEX IF EXISTS contract_events_tx_hash_index RENAME TO loan_events_tx_hash_index;
  `);
};
