/**
 * @zizalend/sdk
 *
 * Typed API client for the Zizalend protocol.
 *
 * Usage:
 * ```ts
 * import { Zizalend } from '@zizalend/sdk';
 *
 * const api = new Zizalend({ baseUrl: 'http://localhost:3001/api/v1' });
 *
 * // Auth
 * const { token } = await api.auth.authenticate(publicKey, signer);
 *
 * // Loans
 * const loans = await api.loans.list();
 *
 * // Pool
 * const stats = await api.pool.getStats();
 * ```
 */

import { Client } from "./client.js";
export {
  Client,
  ApiError,
  RequestDeadlineExceededError,
  parseRetryAfterMs,
} from "./client.js";
export type {
  ClientConfig,
  ApiResponse,
  ResponseHeadersLike,
} from "./client.js";

// The error-code union and its helpers, generated from the backend registry so a consumer
// can branch on `ApiError.errorCode` exhaustively instead of comparing against strings.
export {
  API_ERROR_CODES,
  UNKNOWN_API_ERROR,
  isKnownApiErrorCode,
  toApiErrorCode,
} from "./errorCodes.generated.js";
export type {
  ApiErrorCode,
  KnownApiErrorCode,
} from "./errorCodes.generated.js";

// ClientConfig is used as a constructor parameter type in the Zizalend class.
// With isolatedModules, the type-only export above doesn't create a local binding,
// so we need an explicit type import here.
type _ClientConfig = import("./client.js").ClientConfig;

import { Auth } from "./auth.js";
export { Auth, readTokenExpiryMs, TOKEN_EXPIRY_SKEW_MS } from "./auth.js";
export type { ChallengeMessage, LoginData, VerifyData } from "./auth.js";

import { Health } from "./health.js";
export { Health } from "./health.js";
export type {
  HealthCheckResponse,
  DeepHealthCheckResponse,
  VersionResponse,
} from "./health.js";

import { User } from "./user.js";
export { User } from "./user.js";
export type { UserProfile, UpdateUserProfileInput } from "./user.js";

import { Loans } from "./loans.js";
export { Loans } from "./loans.js";
export type {
  BorrowerLoan,
  BorrowerLoansResponse,
  LoanDetailsSummary,
  LoanDetailsResponse,
  UnsignedTransactionResponse,
  RepayTransactionResponse,
  SubmittedTransactionResponse,
  BuildRepayTxParams,
  BuildLoanRequestTxParams,
  LoanConfig,
  BorrowerLoansPage,
} from "./loans.js";

import { Pool } from "./pool.js";
export { Pool } from "./pool.js";
export type {
  PoolStats,
  DepositorPortfolio,
  SharePriceResponse,
  BuildPoolTxParams,
} from "./pool.js";

import { Scores } from "./scores.js";
export { Scores } from "./scores.js";
export type {
  UserScore,
  ScoreBreakdownResponse,
  ScoreBreakdownMetrics,
  ScoreHistoryEntry,
  ScoreUpdateResponse,
} from "./scores.js";

import { Notifications } from "./notifications.js";
export { Notifications } from "./notifications.js";
export type {
  Notification as ZizaNotification,
  NotificationsData,
  NotificationPreferences,
} from "./notifications.js";

import { Remittances } from "./remittances.js";
export { Remittances } from "./remittances.js";
export type {
  Remittance,
  RemittanceResponse,
  CreateRemittanceInput,
  PaginatedRemittancesResponse,
} from "./remittances.js";

import { Transactions } from "./transactions.js";
export { Transactions } from "./transactions.js";
export type {
  Transaction as ZizaTransaction,
  TransactionsResponse,
} from "./transactions.js";

import { Events } from "./events.js";
export {
  Events,
  CANONICAL_EVENT_TYPES,
  LEGACY_EVENT_TYPE_ALIASES,
  isKnownLoanEventRecord,
  isLoanEventType,
} from "./events.js";
export type {
  LoanEventRecord,
  LoanEventRecordBase,
  LoanEventPayloads,
  LoanEventType,
  KnownLoanEventRecord,
  UnrecognisedLoanEventRecord,
  PaginatedEventsResponse,
  EventStreamStatusResponse,
} from "./events.js";

import { Indexer } from "./indexer.js";
export { Indexer } from "./indexer.js";
export type {
  IndexerStatusData,
  WebhookSubscription,
  CreateWebhookSubscriptionInput,
  WebhookDelivery,
  ReindexResult,
  DefaultCheckRunResult,
} from "./indexer.js";

import { Admin } from "./admin.js";
export { Admin } from "./admin.js";
export type { AuditLogEntry, LoanDispute } from "./admin.js";

import { Simulation } from "./simulation.js";
export { Simulation } from "./simulation.js";
export type {
  RemittanceHistoryResponse,
  SimulatePaymentResponse,
} from "./simulation.js";

// Cursor pagination.
export { iteratePages, collectPages, DEFAULT_MAX_PAGES } from "./pagination.js";
export type { IteratorPage, PaginatorOptions } from "./pagination.js";

/**
 * Zizalend API client — the main entry point.
 *
 * Provides typed access to all API modules.
 */
export class Zizalend {
  public readonly auth: Auth;
  public readonly health: Health;
  public readonly user: User;
  public readonly loans: Loans;
  public readonly pool: Pool;
  public readonly scores: Scores;
  public readonly notifications: Notifications;
  public readonly remittances: Remittances;
  public readonly transactions: Transactions;
  public readonly events: Events;
  public readonly indexer: Indexer;
  public readonly admin: Admin;
  public readonly simulation: Simulation;

  constructor(config: _ClientConfig) {
    const client = new Client(config);

    this.auth = new Auth(client);
    this.health = new Health(client);
    this.user = new User(client);
    this.loans = new Loans(client);
    this.pool = new Pool(client);
    this.scores = new Scores(client);
    this.notifications = new Notifications(client);
    this.remittances = new Remittances(client);
    this.transactions = new Transactions(client);
    this.events = new Events(client);
    this.indexer = new Indexer(client);
    this.admin = new Admin(client);
    this.simulation = new Simulation(client);
  }
}

export default Zizalend;
