/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by `scripts/generate-sdk-error-codes.mjs` from the backend registry at
 * `backend/src/errors/errorCodes.ts`. Run `npm run generate:error-codes` from the
 * repository root after changing a code; CI fails when this file is out of date.
 */

/** Every error code the API can return, in registry order. */
export const API_ERROR_CODES = [
  'INVALID_AMOUNT',
  'INVALID_PUBLIC_KEY',
  'SELF_TRANSFER',
  'INVALID_SIGNATURE',
  'INVALID_CHALLENGE',
  'MISSING_FIELD',
  'VALIDATION_ERROR',
  'INVALID_JSON',
  'PAYLOAD_TOO_LARGE',
  'MISSING_IDEMPOTENCY_KEY',
  'INVALID_IDEMPOTENCY_KEY',
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'CHALLENGE_EXPIRED',
  'FORBIDDEN',
  'ACCESS_DENIED',
  'METHOD_NOT_ALLOWED',
  'NOT_FOUND',
  'LOAN_NOT_FOUND',
  'USER_NOT_FOUND',
  'POOL_NOT_FOUND',
  'CONFLICT',
  'DUPLICATE_REQUEST',
  'DUPLICATE_REMITTANCE',
  'RATE_LIMIT_EXCEEDED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'DATABASE_ERROR',
  'EXTERNAL_SERVICE_ERROR',
  'BLOCKCHAIN_ERROR',
  'BORROWER_MISMATCH',
  'INSUFFICIENT_BALANCE',
  'LOAN_ALREADY_REPAID',
  'LOAN_NOT_ACTIVE',
  'INVALID_LOAN_ID',
  'INVALID_TX_XDR',
] as const;

/** A code the API actually returns. */
export type KnownApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * The code reported for a failure that did not come through the backend error handler —
 * a transport failure, an unparseable body, or a response from something other than the
 * API. It is a named member rather than `undefined` so that a `switch` on the code has to
 * handle it, and so that "the server did not say" is distinguishable from "the client
 * forgot to read it".
 */
export const UNKNOWN_API_ERROR = 'UNKNOWN_API_ERROR' as const;

/**
 * The type of `ApiError.errorCode`. Switching on it with no `default` is exhaustive over
 * every code the backend can emit plus the unknown case.
 */
export type ApiErrorCode = KnownApiErrorCode | typeof UNKNOWN_API_ERROR;

/**
 * Narrow to a code the backend declares.
 *
 * This is what lets a consumer separate the known cases from the unknown one at a single
 * point instead of comparing against a list that can drift.
 */
export function isKnownApiErrorCode(value: unknown): value is KnownApiErrorCode {
  return (
    typeof value === 'string' &&
    (API_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Normalise a raw `errorCode` from a response body into the union.
 *
 * Anything that is not a code the registry declares becomes the unknown member, so a
 * consumer never has to handle an arbitrary string from the wire.
 */
export function toApiErrorCode(value: unknown): ApiErrorCode {
  return isKnownApiErrorCode(value) ? value : UNKNOWN_API_ERROR;
}
