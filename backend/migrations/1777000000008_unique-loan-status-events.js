/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Renamed from `1777000000007_unique-loan-status-events`, which collided with
  // `1777000000007_loan-events-composite-indexes` and left the order between them
  // decided by alphabetical luck. The timestamp is now unique and the effective
  // order is unchanged.
  //
  // Because the recorded name changed, a database that already applied the old
  // filename will run this one again, so every step here is a no-op on the second
  // pass: the dedupe deletes nothing once the duplicates are gone, and the index
  // creation is guarded.
  //
  // Keep the earliest status event per (loan_id, event_type) before enforcing uniqueness.
  pgm.sql(`
    DELETE FROM loan_events le
    USING (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY loan_id, event_type
            ORDER BY ledger ASC, id ASC
          ) AS row_num
        FROM loan_events
        WHERE loan_id IS NOT NULL
          AND event_type IN ('LoanApproved', 'LoanDefaulted')
      ) ranked
      WHERE ranked.row_num > 1
    ) duplicates
    WHERE le.id = duplicates.id
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS loan_events_unique_status_event_per_loan
    ON loan_events (loan_id, event_type)
    WHERE loan_id IS NOT NULL
      AND event_type IN ('LoanApproved', 'LoanDefaulted')
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS loan_events_unique_status_event_per_loan');
};
