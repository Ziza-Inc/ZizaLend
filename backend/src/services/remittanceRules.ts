/**
 * The acceptance rules for a remittance record.
 *
 * Remittance history feeds the credit score, so the values this API accepts reach credit
 * decisions. The rules therefore live here, as constants and pure predicates, and are
 * documented in `docs/remittances.md` — a rule that exists only inside a controller is one a
 * reviewer cannot check and a client cannot anticipate.
 *
 * They are enforced twice on purpose. `remittanceSchemas.ts` rejects the obvious cases at the
 * request boundary, before a handler runs and before any connection is taken. This module's
 * {@link assertRemittanceRules} re-checks every one of them in the service, which is the last
 * line before a row is written — and is also reachable directly, without a schema.
 *
 * Two rules can only be enforced here:
 *   - self-transfer, because the sender comes from the JWT rather than the body, so no single
 *     schema sees both addresses;
 *   - the duplicate window, because it needs the database.
 */
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/errorCodes.js';

/**
 * A Stellar public key: 56 characters, an ed25519 `G` prefix, and base32.
 *
 * This checks shape only. Whether the account exists, and whether it can hold the asset being
 * sent, is the network's business and is answered when the transaction is submitted.
 */
export const STELLAR_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;

/**
 * Decimal places an amount may carry.
 *
 * Stellar's smallest unit is one stroop — a ten-millionth — so a request that carries more
 * precision than this cannot be represented on the ledger. Rejecting it is better than
 * truncating it silently, which would record an amount the ledger never saw.
 */
export const REMITTANCE_AMOUNT_DECIMALS = 7;

/** Largest single remittance the API accepts, in the transfer currency. */
export const REMITTANCE_MAX_AMOUNT = 1_000_000;

/**
 * How long an identical remittance blocks another one.
 *
 * A one-minute window catches the double-tap and the retried request — the causes of a
 * duplicated credit event — without standing in the way of a genuine second payment.
 */
export const REMITTANCE_DUPLICATE_WINDOW_MS = 60_000;

/** Longest memo, in characters. Stellar's `MEMO_TEXT` limit is 28 bytes. */
export const REMITTANCE_MEMO_MAX_LENGTH = 28;

export interface RemittanceCandidate {
  senderAddress: string;
  recipientAddress: string;
  amount: number;
  memo?: string | undefined;
}

/** Whether a value is shaped like a Stellar public key. */
export function isValidStellarAddress(address: unknown): boolean {
  return typeof address === 'string' && STELLAR_ADDRESS_PATTERN.test(address);
}

/**
 * Whether an amount can be represented to the stroop.
 *
 * The tolerance is not decoration: decimal amounts are binary fractions, so `0.1 + 0.2` and
 * `1.005 * 100` land a few hundred-millionths off an integer, and an exact check would reject
 * amounts no user would call imprecise.
 */
export function hasSupportedAmountPrecision(amount: number): boolean {
  if (!Number.isFinite(amount)) return false;

  const scaled = amount * 10 ** REMITTANCE_AMOUNT_DECIMALS;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/**
 * Enforce every rule that does not need the database.
 *
 * Throws an `AppError` carrying the specific code for the rule that failed — never a generic
 * `VALIDATION_ERROR` — so a client can branch and surface the right copy without parsing a
 * message. The `field` names the offending input for the same reason.
 *
 * @see docs/remittances.md for the rules and the codes they raise.
 */
export function assertRemittanceRules(candidate: RemittanceCandidate): void {
  if (!isValidStellarAddress(candidate.senderAddress)) {
    throw AppError.badRequest(
      'Invalid Stellar sender address (must be 56 chars, start with G)',
      ErrorCode.INVALID_PUBLIC_KEY,
      'senderAddress',
    );
  }

  if (!isValidStellarAddress(candidate.recipientAddress)) {
    throw AppError.badRequest(
      'Invalid Stellar recipient address (must be 56 chars, start with G)',
      ErrorCode.INVALID_PUBLIC_KEY,
      'recipientAddress',
    );
  }

  if (candidate.senderAddress === candidate.recipientAddress) {
    throw AppError.badRequest(
      'A remittance cannot be sent to the sender address',
      ErrorCode.SELF_TRANSFER,
      'recipientAddress',
    );
  }

  if (typeof candidate.amount !== 'number' || !Number.isFinite(candidate.amount)) {
    throw AppError.badRequest('Amount must be a finite number', ErrorCode.INVALID_AMOUNT, 'amount');
  }

  if (candidate.amount <= 0) {
    throw AppError.badRequest('Amount must be greater than 0', ErrorCode.INVALID_AMOUNT, 'amount');
  }

  if (candidate.amount > REMITTANCE_MAX_AMOUNT) {
    throw AppError.badRequest(
      `Amount exceeds the maximum of ${REMITTANCE_MAX_AMOUNT}`,
      ErrorCode.INVALID_AMOUNT,
      'amount',
    );
  }

  if (!hasSupportedAmountPrecision(candidate.amount)) {
    throw AppError.badRequest(
      `Amount supports at most ${REMITTANCE_AMOUNT_DECIMALS} decimal places`,
      ErrorCode.INVALID_AMOUNT,
      'amount',
    );
  }

  if (candidate.memo !== undefined) {
    if (typeof candidate.memo !== 'string') {
      throw AppError.badRequest('Memo must be a string', ErrorCode.VALIDATION_ERROR, 'memo');
    }

    if (candidate.memo.length > REMITTANCE_MEMO_MAX_LENGTH) {
      throw AppError.badRequest(
        `Memo must be ${REMITTANCE_MEMO_MAX_LENGTH} characters or less`,
        ErrorCode.VALIDATION_ERROR,
        'memo',
      );
    }
  }
}
