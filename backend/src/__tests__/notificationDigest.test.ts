import { jest } from '@jest/globals';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

await import('../db/connection.js');
const { notificationService } = await import('../services/notificationService.js');

const userId = 'GTESTUSER1111111111111111111111111111111111111111111111111';

/**
 * A row shaped the way the preference resolver reads it: the user's profile joined to an
 * optional `user_notification_preferences` row.
 *
 * `prefsUserId` present means the user has a row in the newer table and it wins; absent
 * means the `user_profiles` columns are used instead. The digest tests exercise both, and
 * a user whose email is switched off here is a muted user.
 */
const preferenceRow = (overrides: Record<string, unknown> = {}) => ({
  email: 'borrower@example.com',
  phone: null,
  email_enabled: true,
  sms_enabled: false,
  prefs_user_id: null,
  prefs_email_enabled: null,
  prefs_sms_enabled: null,
  prefs_phone: null,
  prefs_digest_frequency: null,
  ...overrides,
});

beforeEach(() => {
  mockQuery.mockReset();
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

describe('notification digest batching', () => {
  it('batches repayment notifications with digest mode off', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        preferenceRow({
          prefs_user_id: userId,
          prefs_email_enabled: true,
          prefs_digest_frequency: 'off',
        }),
      ],
    });

    const notifications = [
      { userId, message: 'Loan 1 due', loanId: 1 },
      { userId, message: 'Loan 2 due', loanId: 2 },
      { userId, message: 'Loan 3 due', loanId: 3 },
    ];

    const grouped = await notificationService.batchRepaymentNotificationsForDigest(notifications);

    expect(grouped.size).toBe(1);
    expect(grouped.has(`${userId}:immediate`)).toBe(true);
    expect(grouped.get(`${userId}:immediate`)).toHaveLength(3);
  });

  it('batches repayment notifications with daily digest mode', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        preferenceRow({
          prefs_user_id: userId,
          prefs_email_enabled: true,
          prefs_digest_frequency: 'daily',
        }),
      ],
    });

    const notifications = [
      { userId, message: 'Loan 1 due', loanId: 1 },
      { userId, message: 'Loan 2 due', loanId: 2 },
    ];

    const grouped = await notificationService.batchRepaymentNotificationsForDigest(notifications);

    expect(grouped.size).toBe(1);
    expect(grouped.has(`${userId}:daily`)).toBe(true);
    expect(grouped.get(`${userId}:daily`)).toHaveLength(2);
  });

  it('batches repayment notifications with weekly digest mode', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        preferenceRow({
          prefs_user_id: userId,
          prefs_email_enabled: true,
          prefs_digest_frequency: 'weekly',
        }),
      ],
    });

    const notifications = [
      { userId, message: 'Loan 1 due', loanId: 1 },
      { userId, message: 'Loan 2 due', loanId: 2 },
      { userId, message: 'Loan 3 due', loanId: 3 },
    ];

    const grouped = await notificationService.batchRepaymentNotificationsForDigest(notifications);

    expect(grouped.size).toBe(1);
    expect(grouped.has(`${userId}:weekly`)).toBe(true);
    expect(grouped.get(`${userId}:weekly`)).toHaveLength(3);
  });

  it('handles multiple users with different digest preferences', async () => {
    const user1 = 'GUSER1111111111111111111111111111111111111111111111111111';
    const user2 = 'GUSER2222222222222222222222222222222222222222222222222222';

    mockQuery
      .mockResolvedValueOnce({
        rows: [
          preferenceRow({
            prefs_user_id: user1,
            prefs_email_enabled: true,
            prefs_digest_frequency: 'daily',
          }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          preferenceRow({
            prefs_user_id: user2,
            prefs_email_enabled: true,
            prefs_digest_frequency: 'weekly',
          }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          preferenceRow({
            prefs_user_id: user1,
            prefs_email_enabled: true,
            prefs_digest_frequency: 'daily',
          }),
        ],
      });

    const notifications = [
      { userId: user1, message: 'Loan 1 due', loanId: 1 },
      { userId: user2, message: 'Loan 2 due', loanId: 2 },
      { userId: user1, message: 'Loan 3 due', loanId: 3 },
    ];

    const grouped = await notificationService.batchRepaymentNotificationsForDigest(notifications);

    expect(grouped.size).toBe(2);
    expect(grouped.get(`${user1}:daily`)).toHaveLength(2);
    expect(grouped.get(`${user2}:weekly`)).toHaveLength(1);
  });

  it('defaults to off when the user has no preferences row', async () => {
    // A profile row exists, so the user is contactable, but nothing has recorded a digest
    // frequency for them. Off is the documented default, which here means immediate.
    mockQuery.mockResolvedValue({
      rows: [preferenceRow()],
    });

    const notifications = [{ userId, message: 'Loan 1 due', loanId: 1 }];

    const grouped = await notificationService.batchRepaymentNotificationsForDigest(notifications);

    expect(grouped.has(`${userId}:immediate`)).toBe(true);
  });

  it('does not queue a user who has muted email', async () => {
    // The mute is recorded in the newer table and wins over the profile columns, which
    // still say email is on. A digest is delivered by email, so there is nothing to build.
    mockQuery.mockResolvedValue({
      rows: [
        preferenceRow({
          prefs_user_id: userId,
          prefs_email_enabled: false,
          prefs_digest_frequency: 'daily',
        }),
      ],
    });

    const notifications = [
      { userId, message: 'Loan 1 due', loanId: 1 },
      { userId, message: 'Loan 2 due', loanId: 2 },
    ];

    const grouped = await notificationService.batchRepaymentNotificationsForDigest(notifications);

    expect(grouped.size).toBe(0);
    expect(grouped.has(`${userId}:daily`)).toBe(false);
    expect(grouped.has(`${userId}:immediate`)).toBe(false);
  });

  it('does not queue a user whose email is disabled in their profile', async () => {
    mockQuery.mockResolvedValue({
      rows: [preferenceRow({ email_enabled: false })],
    });

    const notifications = [{ userId, message: 'Loan 1 due', loanId: 1 }];

    const grouped = await notificationService.batchRepaymentNotificationsForDigest(notifications);

    expect(grouped.size).toBe(0);
  });

  it('does not queue a user who has no email address on file', async () => {
    // The switch is on but there is nowhere to send it, which the gate treats the same
    // way as a mute: an enabled channel with no address is not a deliverable channel.
    mockQuery.mockResolvedValue({
      rows: [preferenceRow({ email: null })],
    });

    const notifications = [{ userId, message: 'Loan 1 due', loanId: 1 }];

    const grouped = await notificationService.batchRepaymentNotificationsForDigest(notifications);

    expect(grouped.size).toBe(0);
  });

  it('does not queue a user who has no profile row at all', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const notifications = [{ userId, message: 'Loan 1 due', loanId: 1 }];

    const grouped = await notificationService.batchRepaymentNotificationsForDigest(notifications);

    expect(grouped.size).toBe(0);
  });
});
