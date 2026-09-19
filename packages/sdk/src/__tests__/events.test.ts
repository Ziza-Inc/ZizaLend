import {
  CANONICAL_EVENT_TYPES,
  LEGACY_EVENT_TYPE_ALIASES,
  isKnownLoanEventRecord,
  isLoanEventType,
  type KnownLoanEventRecord,
  type LoanEventRecord,
  type LoanEventType,
} from '../events.js';

/** The fields every record carries, so each fixture below only states what is specific to it. */
function base(eventId: string) {
  return {
    eventId,
    ledger: 1_234_567,
    ledgerClosedAt: '2026-01-01T12:00:00.000Z',
    txHash: 'a'.repeat(64),
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
}

/**
 * Reads the payload a type carries, narrowing on `eventType`.
 *
 * The annotations are the assertion: `bps` and `termLedgers` are declared `number`, not
 * `number | undefined`, so this function stops typechecking the moment either becomes optional
 * on `LoanApproved`. `typecheck` runs in CI, so the narrowing cannot silently regress.
 */
function describeKnownRecord(record: KnownLoanEventRecord): string {
  switch (record.eventType) {
    case 'LoanApproved': {
      const bps: number = record.interestRateBps;
      const termLedgers: number = record.termLedgers;
      const borrower: string = record.address;
      return `loan ${record.loanId} approved for ${borrower} at ${bps}bps for ${termLedgers} ledgers`;
    }
    case 'LoanRepaid': {
      const amount: string = record.amount;
      return `loan ${record.loanId} repaid ${amount}`;
    }
    case 'LoanLiquidated': {
      // Optional on purpose: a liquidation with nothing left over omits it.
      const refund: string | undefined = record.borrowerRefund;
      return `loan ${record.loanId} liquidated, refund ${refund ?? 'none'}`;
    }
    case 'CollateralReleased': {
      const borrower: string = record.address;
      return `collateral for loan ${record.loanId} released to ${borrower}`;
    }
    case 'ProposalCancelled':
      return `proposal cancelled by ${record.address}`;
    case 'PoolPaused':
      // No payload beyond the common fields, and no payload field is in scope here.
      return `pool paused at ledger ${record.ledger}`;
    default:
      return `${record.eventType} at ledger ${record.ledger}`;
  }
}

/**
 * The documented way to get exact narrowing from a record off the wire: rule the fallback out
 * with the type guard, then switch. No cast, and the assignment is what proves it.
 */
function describeRecord(record: LoanEventRecord): string {
  if (!isKnownLoanEventRecord(record)) {
    return `${record.eventType} at ledger ${record.ledger}`;
  }

  // The guard did the narrowing, so this needs no cast. `typecheck` fails if it stops working.
  const known: KnownLoanEventRecord = record;
  return describeKnownRecord(known);
}

describe('LoanEventRecord', () => {
  it('narrows to the payload a type actually carries', () => {
    const approved: LoanEventRecord = {
      ...base('evt-1'),
      eventType: 'LoanApproved',
      loanId: 42,
      address: 'GBORROWER',
      interestRateBps: 1_200,
      termLedgers: 17_280,
    };

    expect(describeRecord(approved)).toBe(
      'loan 42 approved for GBORROWER at 1200bps for 17280 ledgers',
    );
  });

  it('keeps optional payload fields optional', () => {
    const liquidated: LoanEventRecord = {
      ...base('evt-2'),
      eventType: 'LoanLiquidated',
      loanId: 7,
      address: 'GBORROWER',
      amount: '1000',
    };

    expect(describeRecord(liquidated)).toBe('loan 7 liquidated, refund none');

    const withRefund: LoanEventRecord = { ...liquidated, borrowerRefund: '25' };
    expect(describeRecord(withRefund)).toBe('loan 7 liquidated, refund 25');
  });

  it('accepts a type that carries nothing but the common fields', () => {
    const paused: LoanEventRecord = { ...base('evt-3'), eventType: 'PoolPaused' };
    expect(describeRecord(paused)).toBe('pool paused at ledger 1234567');
  });

  it('documents what a bare switch gives without the guard', () => {
    // A bare switch still rules out every *other* variant. It does not rule out the fallback,
    // whose `eventType` is `string`, so the payload fields the fallback also declares stay
    // `| undefined`. Declaring that explicitly is the assertion: if the fallback ever stopped
    // diluting these, the annotation would become an error and this comment would need updating.
    const approved: LoanEventRecord = {
      ...base('evt-6'),
      eventType: 'LoanApproved',
      loanId: 1,
      address: 'GBORROWER',
      interestRateBps: 900,
      termLedgers: 100,
    };

    if (approved.eventType === 'LoanApproved') {
      const maybeLoanId: number | undefined = approved.loanId;
      const maybeBps: number | undefined = approved.interestRateBps;

      expect(maybeLoanId).toBe(1);
      expect(maybeBps).toBe(900);
      // And `amount` is not in scope at all: only `LoanRepaid` and friends declare it.
      expect('amount' in approved).toBe(false);
    }
  });

  it('reaches the fallback for an unrecognised type', () => {
    // Not a canonical type and not a legacy alias: exactly what a contract event added after
    // this union was written looks like.
    const unknown: LoanEventRecord = {
      ...base('evt-4'),
      eventType: 'SomethingEmittedLater',
      loanId: 9,
      amount: '5',
    };

    expect(isLoanEventType(unknown.eventType)).toBe(false);
    expect(describeRecord(unknown)).toBe('SomethingEmittedLater at ledger 1234567');
  });

  it('reaches the fallback for a legacy alias, which is not a canonical type', () => {
    const legacy: LoanEventRecord = { ...base('evt-5'), eventType: 'Mint', address: 'GOWNER' };

    expect(isLoanEventType(legacy.eventType)).toBe(false);
    expect(describeRecord(legacy)).toBe('Mint at ledger 1234567');
    // The alias still tells a consumer what the record means.
    expect(LEGACY_EVENT_TYPE_ALIASES[legacy.eventType]).toBe('NFTMinted');
  });
});

describe('isLoanEventType', () => {
  it('accepts every modelled type', () => {
    for (const eventType of CANONICAL_EVENT_TYPES) {
      expect(isLoanEventType(eventType)).toBe(true);
    }
  });

  it('rejects everything else', () => {
    expect(isLoanEventType('mint')).toBe(false);
    expect(isLoanEventType('')).toBe(false);
    expect(isLoanEventType('LoanRepaid ')).toBe(false);
    expect(isLoanEventType('SomethingEmittedLater')).toBe(false);
  });
});

describe('CANONICAL_EVENT_TYPES', () => {
  it('lists every type once', () => {
    const unique = new Set(CANONICAL_EVENT_TYPES);
    expect(unique.size).toBe(CANONICAL_EVENT_TYPES.length);
  });

  it('lists only non-empty names', () => {
    for (const eventType of CANONICAL_EVENT_TYPES) {
      expect(eventType).toMatch(/^[A-Za-z]+$/);
    }
  });
});

describe('LEGACY_EVENT_TYPE_ALIASES', () => {
  it('maps every short symbol to a canonical type', () => {
    for (const [alias, canonical] of Object.entries(LEGACY_EVENT_TYPE_ALIASES)) {
      expect(alias).toMatch(/^[A-Za-z]+$/);
      expect(isLoanEventType(canonical)).toBe(true);
    }
  });

  it('does not shadow a canonical name, so narrowing stays unambiguous', () => {
    for (const alias of Object.keys(LEGACY_EVENT_TYPE_ALIASES)) {
      expect(isLoanEventType(alias)).toBe(false);
    }
  });

  it('collapses the three governance cancellation symbols onto one type', () => {
    const targets = ['GovCncl', 'GovEmerg', 'GovExp'].map(
      (alias) => LEGACY_EVENT_TYPE_ALIASES[alias],
    );
    expect(targets).toEqual(['ProposalCancelled', 'ProposalCancelled', 'ProposalCancelled']);
  });
});

describe('LoanEventType', () => {
  it('narrows a wire value to the union without a cast', () => {
    const raw = 'LoanRequested';
    expect(isLoanEventType(raw)).toBe(true);
    // Narrowing the string is what lets it be assigned to the union without a cast.
    if (isLoanEventType(raw)) {
      const typed: LoanEventType = raw;
      expect(typed).toBe('LoanRequested');
    }
  });
});
