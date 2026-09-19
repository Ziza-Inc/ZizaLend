import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };
const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

// Held in variables rather than declared inline so the dispatch tests can assert that a
// muted user produces no call at all, which is the property this suite exists to pin.
const mockSendgridSend = jest
  .fn<(payload: unknown) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockTwilioMessagesCreate = jest
  .fn<() => Promise<{ sid: string }>>()
  .mockResolvedValue({ sid: 'SM_test' });

jest.unstable_mockModule('twilio', () => ({
  default: jest.fn(() => ({ messages: { create: mockTwilioMessagesCreate } })),
}));

jest.unstable_mockModule('@sendgrid/mail', () => ({
  default: { setApiKey: jest.fn(), send: mockSendgridSend },
}));

const { notificationService } = await import('../notificationService.js');

describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createNotification', () => {
    it('sets actionUrl from loanId when not explicitly provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            user_id: 'user1',
            type: 'loan_approved',
            title: 'Loan Approved',
            message: 'Your loan has been approved',
            loan_id: 42,
            action_url: '/loans/42',
            read: false,
            status: 'unread',
            created_at: new Date('2026-05-28T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            email: null,
            phone: null,
            email_enabled: false,
            sms_enabled: false,
          },
        ],
        rowCount: 1,
      });

      const notification = await notificationService.createNotification({
        userId: 'user1',
        type: 'loan_approved',
        title: 'Loan Approved',
        message: 'Your loan has been approved',
        loanId: 42,
      });

      expect(notification.actionUrl).toBe('/loans/42');
      const insertCall = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(insertCall[1]).toContain('/loans/42');
    });

    it('uses explicit actionUrl over loanId when provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            user_id: 'user2',
            type: 'repayment_confirmed',
            title: 'Remittance Sent',
            message: 'Remittance submitted',
            loan_id: null,
            action_url: '/remittances/99',
            read: false,
            status: 'unread',
            created_at: new Date('2026-05-28T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            email: null,
            phone: null,
            email_enabled: false,
            sms_enabled: false,
          },
        ],
        rowCount: 1,
      });

      const notification = await notificationService.createNotification({
        userId: 'user2',
        type: 'repayment_confirmed',
        title: 'Remittance Sent',
        message: 'Remittance submitted',
        actionUrl: '/remittances/99',
      });

      expect(notification.actionUrl).toBe('/remittances/99');
    });

    it('returns null actionUrl when neither loanId nor actionUrl provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 3,
            user_id: 'user3',
            type: 'score_changed',
            title: 'Score Changed',
            message: 'Your score changed',
            loan_id: null,
            action_url: null,
            read: false,
            status: 'unread',
            created_at: new Date('2026-05-28T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            email: null,
            phone: null,
            email_enabled: false,
            sms_enabled: false,
          },
        ],
        rowCount: 1,
      });

      const notification = await notificationService.createNotification({
        userId: 'user3',
        type: 'score_changed',
        title: 'Score Changed',
        message: 'Your score changed',
      });

      expect(notification.actionUrl).toBeUndefined();
    });
  });

  describe('notifyAdmins', () => {
    const originalAdminWallets = process.env.ADMIN_WALLETS;
    const originalAdminEmail = process.env.ADMIN_EMAIL;

    afterEach(() => {
      if (originalAdminWallets === undefined) {
        delete process.env.ADMIN_WALLETS;
      } else {
        process.env.ADMIN_WALLETS = originalAdminWallets;
      }
      if (originalAdminEmail === undefined) {
        delete process.env.ADMIN_EMAIL;
      } else {
        process.env.ADMIN_EMAIL = originalAdminEmail;
      }
    });

    const makeNotificationRow = (userId: string, loanId: number | null) => ({
      id: 1,
      user_id: userId,
      type: 'loan_defaulted',
      title: 'Loan Default',
      message: 'A loan has defaulted',
      loan_id: loanId,
      action_url: loanId != null ? `/loans/${loanId}` : null,
      read: false,
      status: 'unread',
      created_at: new Date('2026-05-28T12:00:00.000Z'),
    });

    it('inserts a notification for each wallet in ADMIN_WALLETS without querying role', async () => {
      process.env.ADMIN_WALLETS = 'wallet1,wallet2';
      delete process.env.ADMIN_EMAIL;

      mockQuery
        .mockResolvedValueOnce({
          rows: [makeNotificationRow('wallet1', 99)],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [makeNotificationRow('wallet2', 99)],
          rowCount: 1,
        });

      await notificationService.notifyAdmins({
        title: 'Loan Default',
        message: 'A loan has defaulted',
        loanId: 99,
      });

      const sqls = (mockQuery.mock.calls as [string, unknown[]][]).map((c) => c[0]);
      expect(sqls.some((s) => s.includes('WHERE role'))).toBe(false);
      expect(mockQuery).toHaveBeenCalledTimes(2);

      const params0 = (mockQuery.mock.calls[0]?.[1] ?? []) as unknown[];
      const params1 = (mockQuery.mock.calls[1]?.[1] ?? []) as unknown[];
      expect(params0[0]).toBe('wallet1');
      expect(params1[0]).toBe('wallet2');
    });

    it('does nothing when ADMIN_WALLETS is unset', async () => {
      delete process.env.ADMIN_WALLETS;
      delete process.env.ADMIN_EMAIL;

      await notificationService.notifyAdmins({
        title: 'Test',
        message: 'Test',
      });

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('does nothing when ADMIN_WALLETS is empty or whitespace-only', async () => {
      process.env.ADMIN_WALLETS = ' , , ';
      delete process.env.ADMIN_EMAIL;

      await notificationService.notifyAdmins({
        title: 'Test',
        message: 'Test',
      });

      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // ── The preference gate, per channel ────────────────────────────────────────
  //
  // Every one of these goes through `createNotification`, which is the only route from a
  // notification to an outbound email or SMS. The point is not that the switch is read —
  // that was already true for email and SMS — but that a muted user produces no send at
  // all, on either channel, including the channel the old inline condition forgot.
  describe('external dispatch honours preferences', () => {
    const DISPATCH_ENV = [
      'FROM_EMAIL',
      'SENDGRID_API_KEY',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER',
    ] as const;

    const savedEnv = new Map<string, string | undefined>();

    beforeEach(() => {
      for (const key of DISPATCH_ENV) savedEnv.set(key, process.env[key]);
      // Configured, so a send that is attempted actually reaches the mocked client and a
      // skipped send is distinguishable from an unconfigured one.
      process.env.FROM_EMAIL = 'notifications@zizalend.test';
      process.env.SENDGRID_API_KEY = 'SG.test';
      process.env.TWILIO_ACCOUNT_SID = 'AC_test';
      process.env.TWILIO_AUTH_TOKEN = 'token';
      process.env.TWILIO_PHONE_NUMBER = '+15550000000';
      mockSendgridSend.mockClear();
      mockTwilioMessagesCreate.mockClear();
    });

    afterEach(() => {
      for (const key of DISPATCH_ENV) {
        const original = savedEnv.get(key);
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
      }
    });

    /** A profile row as the resolver reads it, joined to an optional preferences row. */
    const profileRow = (overrides: Record<string, unknown> = {}) => ({
      email: 'borrower@example.com',
      phone: '+15551234567',
      email_enabled: true,
      sms_enabled: true,
      prefs_user_id: null,
      prefs_email_enabled: null,
      prefs_sms_enabled: null,
      prefs_phone: null,
      prefs_digest_frequency: null,
      ...overrides,
    });

    /** Queue the INSERT that createNotification performs, then the preference read. */
    const queueNotification = (userId: string, prefs: Record<string, unknown> | null) => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            user_id: userId,
            type: 'repayment_due',
            title: 'Repayment due',
            message: 'Your repayment is due',
            loan_id: 1,
            action_url: '/loans/1',
            read: false,
            status: 'unread',
            created_at: new Date('2026-05-28T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      });
      mockQuery.mockResolvedValueOnce({
        rows: prefs ? [prefs] : [],
        rowCount: prefs ? 1 : 0,
      });
    };

    it('sends nothing on either channel when the user has muted both', async () => {
      queueNotification('muted', profileRow({ email_enabled: false, sms_enabled: false }));

      await notificationService.createNotification({
        userId: 'muted',
        type: 'repayment_due',
        title: 'Repayment due',
        message: 'Your repayment is due',
      });

      expect(mockSendgridSend).not.toHaveBeenCalled();
      expect(mockTwilioMessagesCreate).not.toHaveBeenCalled();
    });

    it('honours a mute recorded in the preferences table over the profile columns', async () => {
      // The profile still says both channels are on. The newer table is authoritative, so
      // the mute wins — this is the precedence that stops the two tables disagreeing.
      queueNotification(
        'prefers-new-table',
        profileRow({
          prefs_user_id: 'prefers-new-table',
          prefs_email_enabled: false,
          prefs_sms_enabled: false,
        }),
      );

      await notificationService.createNotification({
        userId: 'prefers-new-table',
        type: 'repayment_due',
        title: 'Repayment due',
        message: 'Your repayment is due',
      });

      expect(mockSendgridSend).not.toHaveBeenCalled();
      expect(mockTwilioMessagesCreate).not.toHaveBeenCalled();
    });

    it('emails a user who has email on and SMS off', async () => {
      queueNotification('email-only', profileRow({ sms_enabled: false }));

      await notificationService.createNotification({
        userId: 'email-only',
        type: 'loan_approved',
        title: 'Approved',
        message: 'Your loan was approved',
      });

      expect(mockSendgridSend).toHaveBeenCalledTimes(1);
      expect(mockTwilioMessagesCreate).not.toHaveBeenCalled();
    });

    it('emails and texts a user who has both on for a time-critical type', async () => {
      queueNotification('both-on', profileRow());

      await notificationService.createNotification({
        userId: 'both-on',
        type: 'loan_defaulted',
        title: 'Default',
        message: 'Your loan has defaulted',
      });

      expect(mockSendgridSend).toHaveBeenCalledTimes(1);
      expect(mockTwilioMessagesCreate).toHaveBeenCalledTimes(1);
    });

    it('does not text for a type that is not SMS-eligible even when SMS is on', async () => {
      queueNotification('sms-but-routine', profileRow());

      await notificationService.createNotification({
        userId: 'sms-but-routine',
        type: 'loan_approved',
        title: 'Approved',
        message: 'Your loan was approved',
      });

      expect(mockSendgridSend).toHaveBeenCalledTimes(1);
      expect(mockTwilioMessagesCreate).not.toHaveBeenCalled();
    });

    it('sends nothing when the user has no profile row', async () => {
      queueNotification('ghost', null);

      await notificationService.createNotification({
        userId: 'ghost',
        type: 'repayment_due',
        title: 'Repayment due',
        message: 'Your repayment is due',
      });

      expect(mockSendgridSend).not.toHaveBeenCalled();
      expect(mockTwilioMessagesCreate).not.toHaveBeenCalled();
    });

    it('does not text a user whose SMS switch is on but who has no phone number', async () => {
      queueNotification('no-phone', profileRow({ phone: null }));

      await notificationService.createNotification({
        userId: 'no-phone',
        type: 'repayment_due',
        title: 'Repayment due',
        message: 'Your repayment is due',
      });

      expect(mockSendgridSend).toHaveBeenCalledTimes(1);
      expect(mockTwilioMessagesCreate).not.toHaveBeenCalled();
    });
  });
});
