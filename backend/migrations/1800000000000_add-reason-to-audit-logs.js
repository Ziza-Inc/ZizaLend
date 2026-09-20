/**
 * `status` alone cannot answer "why".
 *
 * A row with `status = 500` says a privileged action failed, and nothing about what went wrong.
 * That is the difference between an audit trail that supports an incident review and one that only
 * confirms an incident happened. The column is nullable because a successful action has no reason,
 * and inventing one ("ok") would put a value in it that nothing can meaningfully filter on.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumn('audit_logs', {
    reason: { type: 'text', notNull: false },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumn('audit_logs', 'reason');
};
