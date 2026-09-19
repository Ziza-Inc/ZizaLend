/**
 * Refuses to seed anything but a development database.
 *
 * `npm run seed` writes five invented users, four loans, eleven remittances, nine contract events
 * and five notifications. Run against a production database, those rows are indistinguishable from
 * real activity to anyone reading the dashboard — and the project's central claim is that the
 * figures shown are real. A guard in the script is the only place that can be enforced before a
 * single row is written.
 *
 * The environment is read from `NODE_ENV`, which the backend already uses to decide whether to
 * enable Swagger and whether to apply development log defaults. There is deliberately no flag that
 * permits production: a deployment that needs sample data has a staging environment, and
 * `SEED_ALLOW_NON_DEVELOPMENT` is the explicit acknowledgement for that case.
 */

/** Written to `indexer_state.last_indexed_cursor`, so seeded rows can be traced back to this script. */
export const SYNTHETIC_SOURCE_MARKER = 'seeded-dev-data';

const PRODUCTION_ENVIRONMENTS = new Set(['production', 'prod']);
const LOCAL_ENVIRONMENTS = new Set(['development', 'dev', 'test', 'local']);

/** Set to exactly `true` to seed a deployed non-production instance such as Testnet staging. */
export const NON_DEVELOPMENT_OVERRIDE_VAR = 'SEED_ALLOW_NON_DEVELOPMENT';

export interface SeedEnvironmentDecision {
  /** Whether the seed script may proceed. */
  allowed: boolean;
  /** Whether `NODE_ENV` names an environment the seed script is intended for. */
  local: boolean;
  /** Human-readable explanation, used as the thrown message and as the log line when allowed. */
  reason: string;
}

function read(env: Record<string, string | undefined>, key: string): string {
  return (env[key] ?? '').trim();
}

/**
 * Decide whether seeding is permitted, without side effects.
 *
 * Exported separately from {@link assertSeedingAllowed} so the rules can be tested as data rather
 * than by invoking a function that terminates the process.
 */
export function evaluateSeedEnvironment(
  env: Record<string, string | undefined> = process.env,
): SeedEnvironmentDecision {
  const nodeEnv = read(env, 'NODE_ENV').toLowerCase();

  if (PRODUCTION_ENVIRONMENTS.has(nodeEnv)) {
    return {
      allowed: false,
      local: false,
      reason:
        `Refusing to seed: NODE_ENV is "${nodeEnv}". This script writes synthetic users, loans, ` +
        'remittances and notifications, which cannot be told apart from real activity once they ' +
        'are in the database. Seed a development or staging database instead.',
    };
  }

  if (LOCAL_ENVIRONMENTS.has(nodeEnv) || nodeEnv === '') {
    return {
      allowed: true,
      local: true,
      reason:
        nodeEnv === ''
          ? 'NODE_ENV is unset, so this is treated as a local development run.'
          : `NODE_ENV is "${nodeEnv}", which is a local environment.`,
    };
  }

  // Anything else — "staging", "preview", a custom name — is a deployed instance. Seeding it is
  // legitimate (the Testnet demo runs on seeded data) but has to be a deliberate choice, so it
  // needs the override rather than falling through as "not production, therefore fine".
  const override = read(env, NON_DEVELOPMENT_OVERRIDE_VAR).toLowerCase();

  if (override === 'true') {
    return {
      allowed: true,
      local: false,
      reason:
        `NODE_ENV is "${nodeEnv}" and ${NON_DEVELOPMENT_OVERRIDE_VAR}=true, so seeding is allowed. ` +
        'The data written is synthetic: set NEXT_PUBLIC_DEMO_DATA=true on the frontend that reads ' +
        'this database so the interface says so.',
    };
  }

  return {
    allowed: false,
    local: false,
    reason:
      `Refusing to seed: NODE_ENV is "${nodeEnv}", which is not a local environment. If this is a ` +
      `deployed instance that is meant to show sample data, set ${NON_DEVELOPMENT_OVERRIDE_VAR}=true ` +
      'and set NEXT_PUBLIC_DEMO_DATA=true on the frontend, so the seeded rows are labelled in the UI.',
  };
}

/**
 * Throwing guard for the seed entry point. Returns the decision when the run may proceed, so the
 * caller can log why it was allowed.
 */
export function assertSeedingAllowed(
  env: Record<string, string | undefined> = process.env,
): SeedEnvironmentDecision {
  const decision = evaluateSeedEnvironment(env);

  if (!decision.allowed) {
    throw new Error(decision.reason);
  }

  return decision;
}
