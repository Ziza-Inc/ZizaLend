import { AppError } from '../AppError.js';
import { ErrorCode, ERROR_CODE_REGISTRY, getDefaultErrorCodeForStatus } from '../errorCodes.js';

describe('AppError', () => {
  describe('badRequest', () => {
    it('defaults to VALIDATION_ERROR rather than a misleading INVALID_AMOUNT code', () => {
      const err = AppError.badRequest('Loan ID is required');

      expect(err.statusCode).toBe(400);
      expect(err.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
      expect(err.isOperational).toBe(true);
    });

    it('honours an explicitly supplied error code and field', () => {
      const err = AppError.badRequest('Invalid loan ID', ErrorCode.INVALID_LOAN_ID, 'loanId');

      expect(err.errorCode).toBe(ErrorCode.INVALID_LOAN_ID);
      expect(err.field).toBe('loanId');
    });

    it('still allows amount-specific errors to opt in explicitly', () => {
      const err = AppError.badRequest(
        'Amount must be positive',
        ErrorCode.INVALID_AMOUNT,
        'amount',
      );

      expect(err.errorCode).toBe(ErrorCode.INVALID_AMOUNT);
      expect(err.field).toBe('amount');
    });
  });

  describe('status semantics', () => {
    it('marks 4xx errors as fail and 5xx as error', () => {
      expect(AppError.notFound().status).toBe('fail');
      expect(AppError.forbidden().status).toBe('fail');
      expect(AppError.internal().status).toBe('error');
    });

    it('flags internal errors as non-operational so they are reported to Sentry', () => {
      expect(AppError.internal().isOperational).toBe(false);
    });
  });

  describe('withCode', () => {
    it('derives status code, message, and error code from the registry', () => {
      const err = AppError.withCode(ErrorCode.POOL_NOT_FOUND);

      expect(err.statusCode).toBe(ERROR_CODE_REGISTRY[ErrorCode.POOL_NOT_FOUND].httpStatus);
      expect(err.message).toBe(ERROR_CODE_REGISTRY[ErrorCode.POOL_NOT_FOUND].message);
      expect(err.errorCode).toBe(ErrorCode.POOL_NOT_FOUND);
    });

    it('allows overriding the message while keeping registry metadata', () => {
      const err = AppError.withCode(ErrorCode.CONFLICT, 'Loan already exists');

      expect(err.message).toBe('Loan already exists');
      expect(err.statusCode).toBe(409);
    });
  });

  describe('getDefaultErrorCodeForStatus', () => {
    it.each([
      [400, ErrorCode.VALIDATION_ERROR],
      [401, ErrorCode.UNAUTHORIZED],
      [403, ErrorCode.FORBIDDEN],
      [404, ErrorCode.NOT_FOUND],
      [405, ErrorCode.METHOD_NOT_ALLOWED],
      [409, ErrorCode.CONFLICT],
      [413, ErrorCode.PAYLOAD_TOO_LARGE],
      [429, ErrorCode.RATE_LIMIT_EXCEEDED],
      [500, ErrorCode.INTERNAL_ERROR],
      [503, ErrorCode.SERVICE_UNAVAILABLE],
    ])('maps status %i to %s', (status, expected) => {
      expect(getDefaultErrorCodeForStatus(status)).toBe(expected);
    });
  });
});
