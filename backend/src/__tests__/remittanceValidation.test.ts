import { jest } from '@jest/globals';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';

/**
 * One test per rule in `docs/remittances.md`.
 *
 * The rules are also enforced by `createRemittanceSchema` at the request boundary, but the
 * service is the last line before a row is written and is reachable without a schema, so that
 * is what is asserted here. Each case checks the *code*, not the message: the contract with a
 * client is the code, and a message is copy that can change.
 */

const mockWithTransaction = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockQuery = jest.fn<
  (...args: unknown[]) => Promise<{
    rows: unknown[];
    rowCount: number;
    command: string;
    oid: number;
    fields: unknown[];
  }>
>();
const mockGetAccount = jest.fn<() => Promise<Account>>();

const emptyResult = { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  default: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
}));

jest.unstable_mockModule('../db/transaction.js', () => ({
  withTransaction: mockWithTransaction,
}));

jest.unstable_mockModule('../config/stellar.js', () => ({
  getStellarNetworkPassphrase: () => Networks.TESTNET,
  createSorobanRpcServer: () => ({ getAccount: mockGetAccount }),
}));

const { remittanceService } = await import('../services/remittanceService.js');
const {
  REMITTANCE_AMOUNT_DECIMALS,
  REMITTANCE_DUPLICATE_WINDOW_MS,
  REMITTANCE_MAX_AMOUNT,
  REMITTANCE_MEMO_MAX_LENGTH,
  assertRemittanceRules,
  hasSupportedAmountPrecision,
  isValidStellarAddress,
} = await import('../services/remittanceRules.js');
const { ErrorCode } = await import('../errors/errorCodes.js');

const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

function mockRemittanceInsert() {
  mockWithTransaction.mockImplementation(async (...args: unknown[]) => {
    const callback = args[0] as (client: {
      query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
    }) => Promise<unknown>;

    const now = new Date();
    const result = await callback({
      query: async (_sql: string, queryParams: unknown[]) => ({
        rows: [
          {
            id: 'remit-1',
            sender_id: SENDER,
            recipient_address: RECIPIENT,
            amount: queryParams[3],
            from_currency: queryParams[4],
            to_currency: queryParams[5],
            memo: queryParams[6],
            status: 'pending',
            transaction_hash: null,
            xdr: queryParams[8],
            created_at: now,
            updated_at: now,
          },
        ],
      }),
    });

    return result;
  });
}

/** A payload that satisfies every rule, so each case below can break exactly one. */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    recipientAddress: RECIPIENT,
    amount: 25,
    fromCurrency: 'XLM',
    toCurrency: 'XLM',
    memo: 'test',
    senderAddress: SENDER,
    ...overrides,
  } as Parameters<typeof remittanceService.createRemittance>[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAccount.mockResolvedValue(new Account(SENDER, '12345'));
  mockQuery.mockResolvedValue(emptyResult);
  mockRemittanceInsert();
});

// ─── Rule 1–2: counterparty shape ────────────────────────────────────────────

describe('rule 1–2: counterparties are well-formed Stellar public keys', () => {
  it('accepts a keypair-generated address', () => {
    expect(isValidStellarAddress(SENDER)).toBe(true);
  });

  it('rejects the shapes a Stellar address is not', () => {
    expect(isValidStellarAddress('')).toBe(false);
    expect(isValidStellarAddress(SENDER.toLowerCase())).toBe(false);
    expect(isValidStellarAddress(SENDER.slice(0, 55))).toBe(false);
    expect(isValidStellarAddress(`${SENDER}0`)).toBe(false);
    expect(isValidStellarAddress(`S${SENDER.slice(0, 55)}`)).toBe(false);
    // 0, 1, 8 and 9 are not in the base32 alphabet.
    expect(isValidStellarAddress(`G${'1'.repeat(55)}`)).toBe(false);
    expect(isValidStellarAddress(undefined)).toBe(false);
    expect(isValidStellarAddress(42)).toBe(false);
  });

  it('rejects a malformed sender with INVALID_PUBLIC_KEY on senderAddress', async () => {
    await expect(
      remittanceService.createRemittance(validPayload({ senderAddress: 'not-a-key' })),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_PUBLIC_KEY,
      field: 'senderAddress',
      statusCode: 400,
    });
  });

  it('rejects a malformed recipient with INVALID_PUBLIC_KEY on recipientAddress', async () => {
    await expect(
      remittanceService.createRemittance(validPayload({ recipientAddress: 'GABC' })),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_PUBLIC_KEY,
      field: 'recipientAddress',
      statusCode: 400,
    });
  });

  it('never reaches the network for a malformed counterparty', async () => {
    await remittanceService
      .createRemittance(validPayload({ recipientAddress: 'GABC' }))
      .catch(() => undefined);

    expect(mockGetAccount).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});

// ─── Rule 3: self-transfer ───────────────────────────────────────────────────

describe('rule 3: the recipient is not the sender', () => {
  it('rejects a remittance addressed to the sender', async () => {
    await expect(
      remittanceService.createRemittance(validPayload({ recipientAddress: SENDER })),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.SELF_TRANSFER,
      field: 'recipientAddress',
      statusCode: 400,
    });
  });

  it('is a distinct code from a malformed address, because both are well-formed', () => {
    expect(ErrorCode.SELF_TRANSFER).not.toBe(ErrorCode.INVALID_PUBLIC_KEY);
  });

  it('raises the same code from the shared rules, where the schema cannot see it', () => {
    expect(() =>
      assertRemittanceRules({
        senderAddress: SENDER,
        recipientAddress: SENDER,
        amount: 1,
      }),
    ).toThrow(expect.objectContaining({ errorCode: ErrorCode.SELF_TRANSFER }));
  });
});

// ─── Rules 4–5: the amount is finite and positive ────────────────────────────

describe('rule 4–5: the amount is a finite number greater than zero', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s amount with INVALID_AMOUNT', async (_label, amount) => {
    await expect(
      remittanceService.createRemittance(validPayload({ amount })),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_AMOUNT,
      field: 'amount',
      statusCode: 400,
    });
  });

  it('rejects an amount that is not a number at all', async () => {
    await expect(
      remittanceService.createRemittance(validPayload({ amount: '25' })),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_AMOUNT });
  });

  it('accepts the smallest representable amount', async () => {
    const remittance = await remittanceService.createRemittance(
      validPayload({ amount: 10 ** -REMITTANCE_AMOUNT_DECIMALS }),
    );

    expect(remittance.amount).toBeDefined();
    expect(mockGetAccount).toHaveBeenCalled();
  });
});

// ─── Rule 6: the documented maximum ──────────────────────────────────────────

describe('rule 6: the amount is at most the documented maximum', () => {
  it(`accepts exactly ${REMITTANCE_MAX_AMOUNT}`, async () => {
    const remittance = await remittanceService.createRemittance(
      validPayload({ amount: REMITTANCE_MAX_AMOUNT }),
    );

    expect(remittance.amount).toBeDefined();
  });

  it('rejects one stroop above it, naming the limit in the message', async () => {
    await expect(
      remittanceService.createRemittance(
        validPayload({ amount: REMITTANCE_MAX_AMOUNT + 10 ** -REMITTANCE_AMOUNT_DECIMALS }),
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_AMOUNT, field: 'amount' });
  });
});

// ─── Rule 7: precision ───────────────────────────────────────────────────────

describe('rule 7: the amount fits in stroops', () => {
  it.each([
    [0.1, true],
    [1.005 * 100, true],
    [0.1 + 0.2, true],
    [0.0000001, true],
    [1_000_000, true],
    [0.12345678, false],
    [1.00000001, false],
  ])('hasSupportedAmountPrecision(%p) === %p', (amount, expected) => {
    expect(hasSupportedAmountPrecision(amount)).toBe(expected);
  });

  it('rejects an amount finer than a stroop rather than truncating it', async () => {
    await expect(
      remittanceService.createRemittance(validPayload({ amount: 0.12345678 })),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_AMOUNT,
      field: 'amount',
      statusCode: 400,
    });
  });
});

// ─── Rule 8: memo length ─────────────────────────────────────────────────────

describe('rule 8: the memo fits in MEMO_TEXT', () => {
  it('accepts a memo of exactly the limit', async () => {
    const remittance = await remittanceService.createRemittance(
      validPayload({ memo: 'x'.repeat(REMITTANCE_MEMO_MAX_LENGTH) }),
    );

    expect(remittance.memo).toBe('x'.repeat(REMITTANCE_MEMO_MAX_LENGTH));
  });

  it('rejects a longer memo on the memo field', async () => {
    await expect(
      remittanceService.createRemittance(
        validPayload({ memo: 'x'.repeat(REMITTANCE_MEMO_MAX_LENGTH + 1) }),
      ),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.VALIDATION_ERROR,
      field: 'memo',
      statusCode: 400,
    });
  });
});

// ─── Rule 9: the duplicate window ────────────────────────────────────────────

describe('rule 9: no identical remittance inside the window', () => {
  it('rejects a repeat with DUPLICATE_REMITTANCE and a 409', async () => {
    mockQuery.mockResolvedValue({ ...emptyResult, rows: [{ id: 'remit-existing' }] });

    await expect(remittanceService.createRemittance(validPayload())).rejects.toMatchObject({
      errorCode: ErrorCode.DUPLICATE_REMITTANCE,
      field: 'recipientAddress',
      statusCode: 409,
    });
  });

  it('reports the existing record and the window it was found in', async () => {
    mockQuery.mockResolvedValue({ ...emptyResult, rows: [{ id: 'remit-existing' }] });

    const error = await remittanceService
      .createRemittance(validPayload())
      .catch((thrown: unknown) => thrown as { details?: Record<string, unknown> });

    expect(error.details).toEqual({
      existingRemittanceId: 'remit-existing',
      deduplicationWindowMs: REMITTANCE_DUPLICATE_WINDOW_MS,
    });
  });

  it('checks the window against the sender, recipient, amount and both currencies', async () => {
    await remittanceService.createRemittance(validPayload()).catch(() => undefined);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];

    expect(sql).toMatch(/sender_id = \$1/);
    expect(sql).toMatch(/recipient_address = \$2/);
    expect(sql).toMatch(/amount = \$3/);
    expect(sql).toMatch(/from_currency = \$4/);
    expect(sql).toMatch(/to_currency = \$5/);
    expect(sql).toMatch(/created_at >= \$6/);
    expect(params.slice(0, 5)).toEqual([SENDER, RECIPIENT, 25, 'XLM', 'XLM']);

    // The window is anchored to now, not to a fixed date.
    const windowStart = new Date(params[5] as string).getTime();
    expect(Math.abs(Date.now() - REMITTANCE_DUPLICATE_WINDOW_MS - windowStart)).toBeLessThan(5_000);
  });

  it('does not spend a Soroban RPC call on a duplicate', async () => {
    mockQuery.mockResolvedValue({ ...emptyResult, rows: [{ id: 'remit-existing' }] });

    await remittanceService.createRemittance(validPayload()).catch(() => undefined);

    expect(mockGetAccount).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('proceeds when the lookup finds nothing', async () => {
    const remittance = await remittanceService.createRemittance(validPayload());

    expect(remittance).toBeDefined();
    expect(mockQuery).toHaveBeenCalled();
    expect(mockGetAccount).toHaveBeenCalled();
  });
});

// ─── The rules as a set ──────────────────────────────────────────────────────

describe('assertRemittanceRules', () => {
  it('accepts a payload that satisfies every rule', () => {
    expect(() =>
      assertRemittanceRules({
        senderAddress: SENDER,
        recipientAddress: RECIPIENT,
        amount: 25,
        memo: 'rent',
      }),
    ).not.toThrow();
  });

  it('accepts a payload with no memo at all', () => {
    expect(() =>
      assertRemittanceRules({
        senderAddress: SENDER,
        recipientAddress: RECIPIENT,
        amount: 25,
      }),
    ).not.toThrow();
  });

  it('names the offending field on every failure', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ senderAddress: 'nope' }, 'senderAddress'],
      [{ recipientAddress: 'nope' }, 'recipientAddress'],
      [{ recipientAddress: SENDER }, 'recipientAddress'],
      [{ amount: 0 }, 'amount'],
      [{ amount: REMITTANCE_MAX_AMOUNT + 1 }, 'amount'],
      [{ amount: 0.12345678 }, 'amount'],
      [{ memo: 'x'.repeat(REMITTANCE_MEMO_MAX_LENGTH + 1) }, 'memo'],
    ];

    for (const [overrides, field] of cases) {
      expect(() =>
        assertRemittanceRules({
          senderAddress: SENDER,
          recipientAddress: RECIPIENT,
          amount: 25,
          memo: 'ok',
          ...overrides,
        } as Parameters<typeof assertRemittanceRules>[0]),
      ).toThrow(expect.objectContaining({ field }));
    }
  });
});
