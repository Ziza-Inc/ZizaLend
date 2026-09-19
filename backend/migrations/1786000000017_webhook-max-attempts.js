/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Renamed from `1786000000016_webhook-max-attempts`, which collided with
  // `1786000000016_ensure-loan-events-loan-id-index`. The recorded name changed, so a
  // database that applied the old filename will run this one again; `ifNotExists`
  // makes the column addition a no-op on that second pass rather than an
  // "column already exists" failure.
  pgm.addColumn(
    'webhook_subscriptions',
    {
      max_attempts: {
        type: 'integer',
        notNull: true,
        default: 5,
      },
    },
    { ifNotExists: true },
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumn('webhook_subscriptions', 'max_attempts');
};
