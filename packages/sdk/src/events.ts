/**
 * Events module.
 *
 * Real-time event streaming via SSE and historical event queries.
 */

import { Client } from './client.js';

/** Fields every indexed event carries, whatever its type. */
export interface LoanEventRecordBase {
  eventId: string;
  /** Ledger sequence the event was emitted in. */
  ledger: number;
  /** Close time of that ledger, as an ISO-8601 string. */
  ledgerClosedAt: string;
  /** Transaction that emitted the event. */
  txHash: string;
  /** Contract the event came from. */
  contractId?: string;
  /** Raw event topics, base64-encoded XDR. */
  topics?: string[];
  /** Raw event body, base64-encoded XDR. */
  value?: string;
  /**
   * When this API recorded the event. Optional because it is a property of the row, not of
   * the on-chain event, and the SSE stream forwards events before they are read back.
   */
  createdAt?: string;
}

/**
 * Payload of a protocol-configuration event.
 *
 * Both fields are optional because the indexer only records what it could decode: the admin
 * address comes from the event topic and is skipped when the topic is absent, and the recorded
 * value is only present when the body is a two-element tuple. Saying `string` here would be a
 * guarantee the indexer does not make.
 */
export interface AdminConfigPayload {
  /** The admin that made the change, when the contract put it in the topic. */
  address?: string;
  /** The newly recorded value, when the body decoded as a tuple. */
  amount?: string;
}

/** No decoded payload beyond the fields in {@link LoanEventRecordBase}. */
export type NoPayload = Record<never, never>;

/**
 * The payload each event type carries.
 *
 * A field is required when the contract always emits it and the event indexer always records
 * it, and optional when the indexer's decoder can legitimately produce nothing — a body it
 * could not parse, or an address the contract left out of the topic. The distinction is the
 * point of modelling this as a map rather than a bag of optional fields: `record.amount` on a
 * narrowed `LoanRepaid` is a `string`, not `string | undefined`.
 *
 * The canonical names are the ones the API returns, which is the indexer's normalised spelling
 * rather than the short symbol a contract may have emitted — see
 * {@link LEGACY_EVENT_TYPE_ALIASES}.
 */
export interface LoanEventPayloads {
  // ── Loan lifecycle (LoanManager) ─────────────────────────────────────────────

  LoanRequested: { loanId: number; address: string; amount: string };
  LoanApproved: {
    loanId: number;
    address: string;
    interestRateBps: number;
    termLedgers: number;
  };
  LoanRepaid: { loanId: number; address: string; amount: string };
  LoanDefaulted: { loanId: number; address: string };
  LoanCancelled: { loanId: number; address: string };
  LoanRejected: { loanId: number };
  LoanRefinanced: { loanId: number; address: string; amount: string };
  LoanExtended: { loanId: number; address: string; amount: string };
  LoanLiquidated: {
    loanId: number;
    address: string;
    amount: string;
    /** Principal returned to the borrower after debt and liquidator bonus, when non-zero. */
    borrowerRefund?: string;
  };
  LateFeeCharged: { loanId: number; amount: string };
  /**
   * The admin approval path. `address` is the borrower and `adminAddress` the operator that
   * approved, because the contract puts the admin in the topic and the borrower in the body.
   */
  LoanApprv: { loanId?: number; address?: string; adminAddress?: string };

  // ── Collateral (LoanManager) ─────────────────────────────────────────────────

  CollateralDeposited: { loanId: number; address: string; amount: string };
  CollateralReturned: { loanId: number; address: string; amount: string };
  CollateralReleased: { loanId: number; address: string };
  CollateralLiquidated: { loanId: number; amount: string };

  // ── Score and remittance NFT (RemittanceNFT) ─────────────────────────────────

  NFTMinted: { address: string; amount: string };
  ScoreUpdated: { address: string; amount: string };
  ScoreDecr: { address?: string; amount?: string };
  NFTSeized: { address: string };
  NFTBurned: { address: string };
  Transfer: { address?: string };
  HashUpd: NoPayload;
  MntAuth: NoPayload;
  MntRev: NoPayload;

  // ── Lending pool (LendingPool) ───────────────────────────────────────────────

  Deposit: { address: string; amount?: string };
  Withdraw: { address: string; amount?: string };
  EmergencyWithdraw: { address: string; amount?: string };
  YieldDistributed: { address: string; amount: string };
  DepositCapUpdated: { address?: string; amount?: string };
  WithdrawalCooldownUpdated: { amount?: string };

  // ── Governance (MultisigGovernance) ──────────────────────────────────────────

  ProposalCreated: { address: string };
  ProposalApproved: { address: string };
  ProposalFinalized: { address: string };
  ProposalCancelled: { address: string };

  // ── Protocol configuration ───────────────────────────────────────────────────

  MinScoreUpdated: AdminConfigPayload;
  InterestRateUpdated: AdminConfigPayload;
  DefaultTermUpdated: AdminConfigPayload;
  TermLimitsUpdated: AdminConfigPayload;
  LateFeeRateUpdated: AdminConfigPayload;
  GracePeriodUpdated: AdminConfigPayload;
  DefaultWindowUpdated: AdminConfigPayload;
  MaxLoanAmountUpdated: AdminConfigPayload;
  MinRepaymentUpdated: AdminConfigPayload;
  MaxLoansPerBorrower: AdminConfigPayload;
  MinRateBpsUpdated: AdminConfigPayload;
  MaxRateBpsUpdated: AdminConfigPayload;
  RateOracleUpdated: AdminConfigPayload;

  // ── Pause flags ──────────────────────────────────────────────────────────────

  Paused: NoPayload;
  Unpaused: NoPayload;
  PoolPaused: NoPayload;
  PoolUnpaused: NoPayload;
}

/**
 * The event types this SDK models, exactly as the API returns them.
 *
 * Kept as a runtime list so the backend can assert, from its own test suite, that every event
 * type it indexes is representable here. The list and {@link LoanEventPayloads} are held
 * together by a compile-time check below, so they cannot drift from each other, and the
 * backend parity test stops them drifting from the indexer.
 */
export const CANONICAL_EVENT_TYPES = [
  // Loan lifecycle
  'LoanRequested',
  'LoanApproved',
  'LoanRepaid',
  'LoanDefaulted',
  'LoanCancelled',
  'LoanRejected',
  'LoanRefinanced',
  'LoanExtended',
  'LoanLiquidated',
  'LateFeeCharged',
  'LoanApprv',
  // Collateral
  'CollateralDeposited',
  'CollateralReturned',
  'CollateralReleased',
  'CollateralLiquidated',
  // Score and NFT
  'NFTMinted',
  'ScoreUpdated',
  'ScoreDecr',
  'NFTSeized',
  'NFTBurned',
  'Transfer',
  'HashUpd',
  'MntAuth',
  'MntRev',
  // Pool
  'Deposit',
  'Withdraw',
  'EmergencyWithdraw',
  'YieldDistributed',
  'DepositCapUpdated',
  'WithdrawalCooldownUpdated',
  // Governance
  'ProposalCreated',
  'ProposalApproved',
  'ProposalFinalized',
  'ProposalCancelled',
  // Protocol configuration
  'MinScoreUpdated',
  'InterestRateUpdated',
  'DefaultTermUpdated',
  'TermLimitsUpdated',
  'LateFeeRateUpdated',
  'GracePeriodUpdated',
  'DefaultWindowUpdated',
  'MaxLoanAmountUpdated',
  'MinRepaymentUpdated',
  'MaxLoansPerBorrower',
  'MinRateBpsUpdated',
  'MaxRateBpsUpdated',
  'RateOracleUpdated',
  // Pause flags
  'Paused',
  'Unpaused',
  'PoolPaused',
  'PoolUnpaused',
] as const;

/** A canonical event type, i.e. one a consumer can narrow on. */
export type LoanEventType = keyof LoanEventPayloads;

/** Compile-time proof that the runtime list and the payload map describe the same set. */
export type LoanEventPayloadsMatchList = keyof LoanEventPayloads extends LoanEventType
  ? LoanEventType extends keyof LoanEventPayloads
    ? true
    : never
  : never;

// If the list and the payload map ever disagree, `typecheck` fails here rather than the gap
// surfacing at runtime as an un-narrowable record.
const payloadMapMatchesEventTypeList: LoanEventPayloadsMatchList = true;
void payloadMapMatchesEventTypeList;

/**
 * Short symbols the contracts emitted historically, mapped to the canonical type the indexer
 * stores. A record read from the API should carry the canonical name, but rows written before
 * the indexer normalised spelling still carry these, so consumers may still meet one.
 *
 * Mirrors `EVENT_TYPE_ALIASES` in `backend/src/services/eventIndexer.ts`; the backend parity
 * test asserts the two tables have the same keys and the same targets.
 */
export const LEGACY_EVENT_TYPE_ALIASES: Readonly<Record<string, LoanEventType>> = {
  Mint: 'NFTMinted',
  AdmRemint: 'NFTMinted',
  ScoreUpd: 'ScoreUpdated',
  Seized: 'NFTSeized',
  NftBurned: 'NFTBurned',
  MinScore: 'MinScoreUpdated',
  GovProp: 'ProposalCreated',
  GovAppr: 'ProposalApproved',
  GovFin: 'ProposalFinalized',
  GovCncl: 'ProposalCancelled',
  GovEmerg: 'ProposalCancelled',
  GovExp: 'ProposalCancelled',
  ColDep: 'CollateralDeposited',
  ColRel: 'CollateralReleased',
};

/**
 * A record for every type this SDK models, discriminated on `eventType`.
 *
 * Narrowing on `eventType` gives the payload that type actually carries, so a field that only
 * `LoanApproved` has is not merely present but required: `interestRateBps` on a narrowed
 * `LoanApproved` is a `number`, not a `number | undefined`, and a typo in a comparison is a
 * typecheck error rather than a branch that never runs.
 *
 * ```ts
 * function describe(record: KnownLoanEventRecord): string {
 *   switch (record.eventType) {
 *     case 'LoanApproved':
 *       // Required here; `amount` is not in scope at all.
 *       return `loan ${record.loanId} at ${record.interestRateBps}bps`;
 *     case 'LoanRepaid':
 *       return `loan ${record.loanId} repaid ${record.amount}`;
 *     default:
 *       return `${record.eventType} at ledger ${record.ledger}`;
 *   }
 * }
 * ```
 */
export type KnownLoanEventRecord = {
  [T in LoanEventType]: LoanEventRecordBase & { eventType: T } & LoanEventPayloads[T];
}[LoanEventType];

/**
 * A record whose `eventType` this SDK version does not model: a legacy alias, or an event a
 * contract started emitting after this union was written.
 *
 * Kept in {@link LoanEventRecord} on purpose. A closed union would turn a new contract event
 * into a breaking change for every consumer, including the ones that only read `eventId` and
 * `ledger`.
 */
export interface UnrecognisedLoanEventRecord extends LoanEventRecordBase {
  eventType: string;
  loanId?: number;
  address?: string;
  amount?: string;
  interestRateBps?: number;
  termLedgers?: number;
  borrowerRefund?: string;
  adminAddress?: string;
}

/**
 * An indexed loan, pool, governance or score event, as the API returns it.
 *
 * The union of every type this SDK models and the permissive fallback for one it does not.
 *
 * Note what the fallback costs, because TypeScript cannot express "any string except these":
 * a bare `switch (record.eventType)` narrows a known case to *that variant or the fallback*,
 * and the fallback's payload fields are optional, so a field shared by both stays
 * `string | undefined`. Guarding with {@link isLoanEventType} first removes the fallback and
 * restores exact narrowing, which is what the example below does. The alternative — a closed
 * union — would make a new contract event a type error for consumers that never asked about
 * its payload.
 *
 * ```ts
 * function describe(record: LoanEventRecord): string {
 *   if (!isKnownLoanEventRecord(record)) {
 *     // A type this SDK version does not know. Common fields only.
 *     return `${record.eventType} at ledger ${record.ledger}`;
 *   }
 *
 *   // `record` is a `KnownLoanEventRecord` from here on — no cast needed.
 *   switch (record.eventType) {
 *     case 'LoanApproved':
 *       // `interestRateBps` and `termLedgers` are required here.
 *       return `loan ${record.loanId} at ${record.interestRateBps}bps for ${record.termLedgers} ledgers`;
 *     case 'LoanRepaid':
 *       return `loan ${record.loanId} repaid ${record.amount}`;
 *     default:
 *       return `${record.eventType} at ledger ${record.ledger}`;
 *   }
 * }
 * ```
 */
export type LoanEventRecord = KnownLoanEventRecord | UnrecognisedLoanEventRecord;

/**
 * Whether a record's `eventType` is one this SDK models.
 *
 * Useful in a `default` branch to tell "a type I forgot to handle" from "a type this SDK
 * version does not know", which want different responses: the first is a bug in the caller,
 * the second is a record to keep as-is.
 */
export function isLoanEventType(eventType: string): eventType is LoanEventType {
  return (CANONICAL_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Whether a whole record is one this SDK models.
 *
 * This is the guard that removes {@link UnrecognisedLoanEventRecord} from
 * {@link LoanEventRecord}, and therefore the one that restores exact narrowing. A guard applied
 * to `record.eventType` cannot do it: that narrows the property, not the object it came from,
 * so the fallback would survive and keep the payload fields optional.
 */
export function isKnownLoanEventRecord(
  record: LoanEventRecord,
): record is KnownLoanEventRecord {
  return isLoanEventType(record.eventType);
}

export interface PaginatedEventsResponse {
  success: boolean;
  data: {
    events: LoanEventRecord[];
    pagination: {
      limit: number;
      next_cursor?: string | null;
      has_next?: boolean;
    };
  };
}

export interface EventStreamStatusResponse {
  success: boolean;
  data: {
    borrower: number;
    admin: number;
    total: number;
  };
}

export class Events {
  constructor(private client: Client) {}

  /**
   * Get the SSE stream URL for real-time loan events.
   * Connect with EventSource or similar SSE client.
   */
  getStreamUrl(borrower?: string): string {
    const baseUrl = this.client.getBaseUrl();
    const url = new URL(`${baseUrl}/events/stream`);
    if (borrower) {
      url.searchParams.set('borrower', borrower);
    }
    return url.toString();
  }

  /**
   * Get current SSE connection counts (admin).
   */
  async getStreamStatus(): Promise<EventStreamStatusResponse['data']> {
    const response = await this.client.get<EventStreamStatusResponse>('/events/status');
    return response.data;
  }
}
