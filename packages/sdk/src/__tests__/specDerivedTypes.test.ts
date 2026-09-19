import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { components } from '@zizalend/types';

import { BorrowerLoan } from '../loans.js';
import { PoolStats } from '../pool.js';
import { UserScore } from '../scores.js';
import { Notification } from '../notifications.js';
import { Remittance } from '../remittances.js';
import { Transaction } from '../transactions.js';
import { UserProfile } from '../user.js';
import { AuditLogEntry } from '../admin.js';

/**
 * The SDK's request and response types are derived from the OpenAPI spec.
 *
 * Two layers, because neither alone is enough:
 *
 * 1. A compile-time check that the public types are *the same type* as the spec's schema. The
 *    annotations below are only accepted when the two are assignable in both directions, so a
 *    hand-written interface that has drifted — a field dropped, a union widened, a nullable
 *    missed — stops compiling.
 * 2. A source-level check that they are *declared* as spec aliases rather than merely compatible.
 *    A copy that happens to match today would pass layer 1 and drift again tomorrow, so the
 *    declaration itself is what this asserts.
 *
 * The spec is read from disk rather than imported: `@zizalend/types` is generated at build time
 * and is not committed, and importing it for the type layer is what keeps that from mattering.
 */

const HERE = __dirname;
const SDK_SRC = path.join(HERE, '..');
const SPEC_PATH = path.join(SDK_SRC, '..', '..', '..', 'packages', 'openapi.json');

/**
 * Every type this package exports as an alias into the spec, and the module it lives in.
 *
 * The value is the schema name in `packages/openapi.json`. Where the SDK's name differs from the
 * spec's — `LoginData` against `AuthLoginData` — the spec name is what is listed.
 */
const SPEC_DERIVED: Record<string, Record<string, string>> = {
  'loans.ts': {
    BorrowerLoan: 'BorrowerLoan',
    BorrowerLoansResponse: 'BorrowerLoansResponse',
    LoanSummaryEvent: 'LoanSummaryEvent',
    LoanDetailsSummary: 'LoanDetailsSummary',
    LoanDetailsResponse: 'LoanDetailsResponse',
    UnsignedTransactionResponse: 'UnsignedTransactionResponse',
    RepayTransactionResponse: 'RepayTransactionResponse',
    SubmittedTransactionResponse: 'SubmittedTransactionResponse',
  },
  'pool.ts': {
    PoolStats: 'PoolStats',
    PoolStatsResponse: 'PoolStatsResponse',
    DepositorPortfolio: 'DepositorPortfolio',
    DepositorPortfolioResponse: 'DepositorPortfolioResponse',
    SharePriceResponse: 'SharePriceResponse',
    UnsignedTransactionResponse: 'UnsignedTransactionResponse',
    SubmittedTransactionResponse: 'SubmittedTransactionResponse',
  },
  'scores.ts': {
    UserScore: 'UserScore',
    ScoreBreakdownMetrics: 'ScoreBreakdownMetrics',
    ScoreHistoryEntry: 'ScoreHistoryEntry',
    ScoreBreakdownResponse: 'ScoreBreakdownResponse',
    ScoreUpdateResponse: 'ScoreUpdateResponse',
  },
  'notifications.ts': {
    Notification: 'Notification',
    NotificationsData: 'NotificationsData',
    NotificationsResponse: 'NotificationsResponse',
    NotificationPreferences: 'NotificationPreferences',
  },
  'remittances.ts': {
    Remittance: 'Remittance',
    RemittanceResponse: 'RemittanceResponse',
    CreateRemittanceInput: 'CreateRemittanceInput',
    PaginatedRemittancesResponse: 'PaginatedRemittancesResponse',
    SubmittedTransactionResponse: 'SubmittedTransactionResponse',
  },
  'transactions.ts': {
    Transaction: 'Transaction',
    TransactionsResponse: 'TransactionsResponse',
  },
  'health.ts': {
    HealthCheckResponse: 'HealthCheckResponse',
    DeepHealthCheckResponse: 'DeepHealthCheckResponse',
    VersionResponse: 'VersionResponse',
  },
  'user.ts': {
    UserProfile: 'UserProfile',
    UpdateUserProfileInput: 'UpdateUserProfileInput',
  },
  'auth.ts': {
    ChallengeMessage: 'ChallengeMessage',
    ChallengeResponse: 'AuthChallengeResponse',
    LoginData: 'AuthLoginData',
    LoginResponse: 'AuthLoginResponse',
    VerifyData: 'AuthVerifyData',
    VerifyResponse: 'AuthVerifyResponse',
  },
  'indexer.ts': {
    IndexerStatusData: 'IndexerStatusData',
    IndexerStatusResponse: 'IndexerStatusResponse',
    WebhookSubscription: 'WebhookSubscription',
    CreateWebhookSubscriptionInput: 'CreateWebhookSubscriptionInput',
    WebhookDelivery: 'WebhookDelivery',
    ReindexResult: 'ReindexResult',
    DefaultCheckRunResult: 'DefaultCheckRunResult',
  },
  'admin.ts': {
    AuditLogEntry: 'AuditLogEntry',
    LoanDispute: 'LoanDispute',
  },
};

function specSchemaNames(): Set<string> {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
    components: { schemas: Record<string, unknown> };
  };
  return new Set(Object.keys(spec.components.schemas));
}

function readModule(file: string): string {
  return readFileSync(path.join(SDK_SRC, file), 'utf8');
}

/**
 * Layered on purpose: the alias must name the right schema, and the module must not also carry a
 * hand-written declaration of the same type. `export type X = A` followed by `export interface X`
 * would be a duplicate-identifier error rather than a silent fallback, but an `interface` that
 * replaced the alias outright would compile and is the case worth catching.
 */
function declaresAlias(source: string, sdkName: string, schemaName: string): boolean {
  const alias = new RegExp(
    `export type ${sdkName}\\b[^;]*\\bcomponents\\s*\\[\\s*["']schemas["']\\s*\\]\\s*\\[\\s*["']${schemaName}["']\\s*\\]`,
  );
  const handWritten = new RegExp(`export interface ${sdkName}\\b`);

  return alias.test(source) && !handWritten.test(source);
}

describe('spec-derived SDK types', () => {
  const schemaNames = specSchemaNames();

  it('names only schemas the spec actually defines', () => {
    // A typo here would be a compile error in the module, but this catches the map itself going
    // stale in a way that silently stops checking a type.
    const unknown: string[] = [];

    for (const [file, types] of Object.entries(SPEC_DERIVED)) {
      for (const [sdkName, schemaName] of Object.entries(types)) {
        if (!schemaNames.has(schemaName)) unknown.push(`${file}: ${sdkName} -> ${schemaName}`);
      }
    }

    expect(unknown).toEqual([]);
  });

  it.each(Object.entries(SPEC_DERIVED))(
    'declares every public type in %s as an alias into the spec',
    (file, types) => {
      const source = readModule(file);
      const missing = Object.entries(types)
        .filter(([sdkName, schemaName]) => !declaresAlias(source, sdkName, schemaName))
        .map(([sdkName]) => sdkName);

      expect(missing).toEqual([]);
    },
  );

  it('fails the check when a type is hand-written again', () => {
    // Guards the assertion helper: a regex that matched nothing would make every case above pass.
    const handWritten = 'export interface BorrowerLoan {\n  loanId: number;\n}';
    const aliased = "export type BorrowerLoan = components['schemas']['BorrowerLoan'];";

    expect(declaresAlias(aliased, 'BorrowerLoan', 'BorrowerLoan')).toBe(true);
    expect(declaresAlias(handWritten, 'BorrowerLoan', 'BorrowerLoan')).toBe(false);
    expect(declaresAlias(aliased, 'BorrowerLoan', 'BorrowerLoansResponse')).toBe(false);
    expect(
      declaresAlias("export type LoginData = components['schemas']['AuthLoginData'];", 'LoginData', 'AuthLoginData'),
    ).toBe(true);
  });

  it('agrees with the spec at the type level, not only by declaration', () => {
    // `MutuallyAssignable` is `false` unless each type accepts the other, so a hand-written
    // interface that dropped a required field, widened a union or missed a `null` makes the
    // corresponding `expectTrue` below a compile error. A `.toBe(true)` assertion could not do
    // this — it would only fail at runtime, after the drift had already shipped.
    type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

    const loanMatches: MutuallyAssignable<BorrowerLoan, components['schemas']['BorrowerLoan']> =
      true;
    const statsMatch: MutuallyAssignable<PoolStats, components['schemas']['PoolStats']> = true;
    const scoreMatches: MutuallyAssignable<UserScore, components['schemas']['UserScore']> = true;
    const notificationMatches: MutuallyAssignable<
      Notification,
      components['schemas']['Notification']
    > = true;
    const remittanceMatches: MutuallyAssignable<Remittance, components['schemas']['Remittance']> =
      true;
    const transactionMatches: MutuallyAssignable<
      Transaction,
      components['schemas']['Transaction']
    > = true;
    const profileMatches: MutuallyAssignable<UserProfile, components['schemas']['UserProfile']> =
      true;
    const auditMatches: MutuallyAssignable<AuditLogEntry, components['schemas']['AuditLogEntry']> =
      true;

    expect([
      loanMatches,
      statsMatch,
      scoreMatches,
      notificationMatches,
      remittanceMatches,
      transactionMatches,
      profileMatches,
      auditMatches,
    ]).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});
