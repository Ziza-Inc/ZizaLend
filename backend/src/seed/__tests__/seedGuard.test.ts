import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NON_DEVELOPMENT_OVERRIDE_VAR,
  SYNTHETIC_SOURCE_MARKER,
  assertSeedingAllowed,
  evaluateSeedEnvironment,
} from '../guard.js';

/**
 * The seed script writes rows that look exactly like real activity. These cases pin the rule that
 * keeps it out of a production database, and the ordering rule that keeps it from opening a
 * transaction before it has checked.
 */

function env(values: Record<string, string | undefined>): Record<string, string | undefined> {
  return values;
}

describe('evaluateSeedEnvironment', () => {
  it.each(['development', 'dev', 'test', 'local', 'DEVELOPMENT', ' development '])(
    'allows NODE_ENV=%p',
    (nodeEnv) => {
      const decision = evaluateSeedEnvironment(env({ NODE_ENV: nodeEnv }));

      expect(decision.allowed).toBe(true);
      expect(decision.local).toBe(true);
    },
  );

  it('treats an unset NODE_ENV as a local run, because that is what it is', () => {
    const decision = evaluateSeedEnvironment(env({}));

    expect(decision.allowed).toBe(true);
    expect(decision.local).toBe(true);
  });

  it.each(['production', 'prod', 'PRODUCTION', ' production '])(
    'refuses NODE_ENV=%p',
    (nodeEnv) => {
      const decision = evaluateSeedEnvironment(env({ NODE_ENV: nodeEnv }));

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Refusing to seed');
    },
  );

  it('refuses production even with the non-development override set', () => {
    // The override exists for a deployed Testnet instance. Production is not that case, and a flag
    // that could mean "yes, really, seed production" would defeat the point of the guard.
    const decision = evaluateSeedEnvironment(
      env({ NODE_ENV: 'production', [NON_DEVELOPMENT_OVERRIDE_VAR]: 'true' }),
    );

    expect(decision.allowed).toBe(false);
  });

  it('refuses a deployed non-production environment by default', () => {
    const decision = evaluateSeedEnvironment(env({ NODE_ENV: 'staging' }));

    expect(decision.allowed).toBe(false);
    expect(decision.local).toBe(false);
    expect(decision.reason).toContain(NON_DEVELOPMENT_OVERRIDE_VAR);
  });

  it.each(['staging', 'preview', 'demo'])(
    'allows NODE_ENV=%p only with the explicit override',
    (nodeEnv) => {
      const allowed = evaluateSeedEnvironment(
        env({ NODE_ENV: nodeEnv, [NON_DEVELOPMENT_OVERRIDE_VAR]: 'true' }),
      );

      expect(allowed.allowed).toBe(true);
      expect(allowed.local).toBe(false);
      // The reminder is part of the decision, not decoration: seeded rows on a deployed instance
      // have to be labelled on the frontend, and this is where an operator finds out.
      expect(allowed.reason).toContain('NEXT_PUBLIC_DEMO_DATA=true');
    },
  );

  it.each(['TRUE', ' true ', 'True'])('accepts %p, case and padding included', (value) => {
    // The override is read the same way `NODE_ENV` is, because an operator setting `TRUE` means
    // the same thing as one setting `true` and a guard that refused would only look broken.
    const decision = evaluateSeedEnvironment(
      env({ NODE_ENV: 'staging', [NON_DEVELOPMENT_OVERRIDE_VAR]: value }),
    );

    expect(decision.allowed).toBe(true);
  });

  it.each(['1', 'yes', 'on', 'false', ''])('does not accept %p as the override', (value) => {
    const decision = evaluateSeedEnvironment(
      env({ NODE_ENV: 'staging', [NON_DEVELOPMENT_OVERRIDE_VAR]: value }),
    );

    expect(decision.allowed).toBe(false);
  });
});

describe('assertSeedingAllowed', () => {
  it('returns the decision when the run may proceed', () => {
    expect(() => assertSeedingAllowed(env({ NODE_ENV: 'development' }))).not.toThrow();
    expect(assertSeedingAllowed(env({ NODE_ENV: 'test' })).local).toBe(true);
  });

  it('throws, so the process exits non-zero, against production', () => {
    expect(() => assertSeedingAllowed(env({ NODE_ENV: 'production' }))).toThrow(/Refusing to seed/);
  });
});

describe('the seed entry point', () => {
  /**
   * Reading the source rather than importing it: `src/seed/index.ts` calls `runSeed()` at module
   * scope and would connect to a database on import.
   */
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.ts'),
    'utf8',
  );

  it('checks the environment', () => {
    expect(source).toContain('assertSeedingAllowed()');
  });

  it('checks before it opens a transaction', () => {
    const guardAt = source.indexOf('assertSeedingAllowed()');
    const transactionAt = source.indexOf("query('BEGIN')");

    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(transactionAt).toBeGreaterThanOrEqual(0);
    expect(guardAt).toBeLessThan(transactionAt);
  });

  it('marks the rows it writes as seeded', () => {
    // `indexer_state.last_indexed_cursor` is how a reviewer confirms which database this script has
    // touched, and it is the marker the documentation points at. The value has to come from the
    // shared constant, or a rename here would silently stop matching the documented one.
    expect(source).toContain('SYNTHETIC_SOURCE_MARKER');
    expect(SYNTHETIC_SOURCE_MARKER).toBe('seeded-dev-data');
  });
});
