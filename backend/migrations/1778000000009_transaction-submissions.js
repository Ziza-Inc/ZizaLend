/**
 * @param { import("node-pg-migrate").MigrationBuilder } @param pgm {import("node-pg-migrate").MigrationBuilder}
 */
export const up = (pgm) => {
  // The trigger below references update_updated_at_column(), but no earlier
  // migration creates it. Define it here (idempotent) so a fresh migrate up
  // from an empty schema works.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Renamed from `1778000000008_transaction-submissions`, which collided with
  // `1778000000008_quarantine-events`. The recorded name changed, so a database that
  // applied the old filename will run this one again; every step below is therefore
  // written to be a no-op when its end state already exists.
  pgm.createTable(
    'transaction_submissions',
    {
      id: {
        type: 'serial',
        primaryKey: true,
      },
      tx_hash: {
        type: 'varchar(64)',
        notNull: true,
        unique: true,
      },
      status: {
        type: 'varchar(50)',
        notNull: true,
      },
      submitted_at: {
        type: 'timestamp with time zone',
        notNull: true,
        default: pgm.func('NOW()'),
      },
      submitted_by: {
        type: 'varchar(56)',
        null: true,
      },
      transaction_type: {
        type: 'varchar(20)',
        notNull: true,
        default: 'loan',
      },
      result_xdr: {
        type: 'text',
        null: true,
      },
      created_at: {
        type: 'timestamp with time zone',
        notNull: true,
        default: pgm.func('NOW()'),
      },
      updated_at: {
        type: 'timestamp with time zone',
        notNull: true,
        default: pgm.func('NOW()'),
      },
    },
    { ifNotExists: true },
  );

  // Indexes for performance. The generated names depend only on the table and its
  // columns, so the first and any later run create and then skip the same names.
  pgm.createIndex('transaction_submissions', ['submitted_at'], { ifNotExists: true });
  pgm.createIndex('transaction_submissions', ['submitted_by'], { ifNotExists: true });
  pgm.createIndex('transaction_submissions', ['status'], { ifNotExists: true });
  pgm.createIndex('transaction_submissions', ['transaction_type'], { ifNotExists: true });

  // Trigger to update updated_at timestamp. `createTrigger` takes no `ifNotExists`,
  // so this is drop-then-create, which is idempotent.
  pgm.sql('DROP TRIGGER IF EXISTS update_updated_at ON transaction_submissions;');
  pgm.createTrigger('transaction_submissions', 'update_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'update_updated_at_column',
  });
};

/**
 * @param { import("node-pg-migrate").MigrationBuilder } @param pgm {import("node-pg-migrate").MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropTable('transaction_submissions');
};
