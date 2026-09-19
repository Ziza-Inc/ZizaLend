import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule('../../middleware/metrics.js', () => ({
  refreshWebhookRetryQueueDepth: jest.fn(),
}));

jest.unstable_mockModule('../jobMetricsService.js', () => ({
  jobMetricsService: {
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  },
}));

const { WebhookService, getRetryDelayMs } = await import('../webhookService.js');

const MAX_RETRY_ATTEMPTS = 4;

function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    subscription_id: 1,
    callback_url: 'https://hook.example.com/callback',
    secret: null,
    event_id: 'evt-001',
    event_type: 'LoanApproved',
    payload: { eventId: 'evt-001', eventType: 'LoanApproved', loanId: 42 },
    attempt_count: 0,
    ...overrides,
  };
}

describe('WebhookRetryProcessor', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('processRetries', () => {
    it('handles no pending deliveries gracefully', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await WebhookService.processRetries();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM webhook_deliveries'),
        expect.any(Array),
      );
    });

    it('retries a pending delivery successfully', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        status: 200,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const row = deliveryRow({ attempt_count: 1 });
      mockQuery
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://hook.example.com/callback',
        expect.objectContaining({ method: 'POST' }),
      );

      const updateCall = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateCall[0]).toContain('UPDATE webhook_deliveries');
      expect(updateCall[1]?.[0]).toBe(2); // attempt_count = 1 + 1
      expect(updateCall[1]?.[1]).toBe(200); // last_status_code
      expect(updateCall[1]?.[2]).toBeInstanceOf(Date); // delivered_at
    });

    it('schedules backoff retry on failure', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: false,
        status: 503,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const row = deliveryRow({ attempt_count: 0 });
      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      mockQuery
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const updateCall = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateCall[0]).toContain('UPDATE webhook_deliveries');
      expect(updateCall[1]?.[0]).toBe(1); // attempt_count
      expect(updateCall[1]?.[1]).toBe(503); // last_status_code
      expect(updateCall[1]?.[2]).toBe('Webhook returned status 503');
      expect(updateCall[1]?.[3]).toEqual(new Date(now + getRetryDelayMs(1))); // next_retry_at
    });

    it('sets next_retry_at with progressive backoff on multiple failures', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: false,
        status: 500,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const row = deliveryRow({ attempt_count: 2 });
      mockQuery
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      const updateCall = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateCall[1]?.[0]).toBe(3); // attempt_count = 2 + 1
      expect(updateCall[1]?.[3]).toEqual(new Date(now + getRetryDelayMs(3)));

      // Backoff should increase with each attempt
      expect(getRetryDelayMs(1)).toBe(5 * 60 * 1000);
      expect(getRetryDelayMs(2)).toBe(15 * 60 * 1000);
      expect(getRetryDelayMs(3)).toBe(45 * 60 * 1000);
    });
  });

  // Webhooks are not governed by user notification preferences: a subscription has no
  // owner column, and it carries its own `is_active` switch alongside its own
  // `event_types`. That switch is the mute, and it has to stop queued retries as well as
  // new events — the join to `webhook_subscriptions` selected nothing from the
  // subscription, so deactivating one left every delivery already queued still flowing.
  describe('inactive subscriptions', () => {
    it('filters the retry selection on is_active', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await WebhookService.processRetries();

      const sql = (mockQuery.mock.calls[0]?.[0] ?? '') as string;
      // The join must still exist — it is what makes the filter expressible — and it must
      // actually filter, or a deactivated subscription keeps receiving its backlog.
      expect(sql).toMatch(/JOIN webhook_subscriptions\s+ws/);
      expect(sql.replace(/\s+/g, ' ')).toContain('ws.is_active = true');
    });

    it('delivers nothing when no subscription is active', async () => {
      // The filter is in the database, so an inactive subscription produces no candidate
      // rows at all and no HTTP request is made.
      const fetchMock = jest.fn<() => Promise<unknown>>();
      global.fetch = fetchMock as unknown as typeof global.fetch;
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await WebhookService.processRetries();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('circuit-breaker behavior (max attempts)', () => {
    it('permanently fails delivery after max retry attempts', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: false,
        status: 500,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      // attempt_count = MAX_RETRY_ATTEMPTS - 1 means next attempt will hit the limit
      const row = deliveryRow({ attempt_count: MAX_RETRY_ATTEMPTS - 1 });
      mockQuery
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const updateCall = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateCall[1]?.[0]).toBe(MAX_RETRY_ATTEMPTS); // attempt_count = MAX
      expect(updateCall[1]?.[1]).toBe(500); // last_status_code
      // next_retry_at should be null (permanently failed)
      expect(updateCall[1]?.[3]).toBeNull();
    });

    it('does not pick up deliveries at max attempts (circuit open)', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        status: 200,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      // attempt_count >= MAX_RETRY_ATTEMPTS should be filtered out by the query
      mockQuery.mockResolvedValueOnce({
        rows: [deliveryRow({ attempt_count: MAX_RETRY_ATTEMPTS })],
      });

      await WebhookService.processRetries();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('subscriber isolation', () => {
    it('processes remaining deliveries when one delivery fails', async () => {
      let callCount = 0;
      const fetchMock = jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: false, status: 500 };
        }
        return { ok: true, status: 200 };
      }) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const row1 = deliveryRow({
        id: 1,
        subscription_id: 1,
        callback_url: 'https://degraded.example.com/callback',
        attempt_count: 1,
      });
      const row2 = deliveryRow({
        id: 2,
        subscription_id: 2,
        callback_url: 'https://healthy.example.com/callback',
        attempt_count: 1,
      });

      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      mockQuery
        .mockResolvedValueOnce({ rows: [row1, row2] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://degraded.example.com/callback');
      expect(fetchMock.mock.calls[1]?.[0]).toBe('https://healthy.example.com/callback');

      // Both deliveries should have been processed (one failed, one succeeded)
      expect(mockQuery).toHaveBeenCalledTimes(3);
      const updateCalls = mockQuery.mock.calls.filter((call) =>
        (call[0] as string).includes('UPDATE'),
      );
      expect(updateCalls).toHaveLength(2);
    });

    it('continues processing other deliveries even after a network error on one', async () => {
      let callCount = 0;
      const fetchMock = jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Network timeout');
        }
        return { ok: true, status: 200 };
      }) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const row1 = deliveryRow({
        id: 1,
        subscription_id: 1,
        callback_url: 'https://failing.example.com/callback',
        attempt_count: 0,
      });
      const row2 = deliveryRow({
        id: 2,
        subscription_id: 2,
        callback_url: 'https://good.example.com/callback',
        attempt_count: 0,
      });

      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      mockQuery
        .mockResolvedValueOnce({ rows: [row1, row2] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Both deliveries should have been updated in DB
      const updateCalls = mockQuery.mock.calls.filter((call) =>
        (call[0] as string).includes('UPDATE'),
      );
      expect(updateCalls).toHaveLength(2);
    });
  });

  describe('retryWebhookDelivery edge cases', () => {
    it('handles network timeout errors gracefully', async () => {
      const fetchMock = jest.fn(async () => {
        throw new Error('fetch failed');
      }) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.retryWebhookDelivery(
        1,
        1,
        'https://hook.example.com/callback',
        undefined,
        'evt-001',
        'LoanApproved',
        { eventId: 'evt-001' },
        0,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const updateCall = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(updateCall[0]).toContain('UPDATE webhook_deliveries');
      expect(updateCall[1]?.[0]).toBe(1); // attempt_count
      expect(updateCall[1]?.[1]).toBe('fetch failed'); // last_error
      expect(updateCall[1]?.[2]).toEqual(new Date(now + getRetryDelayMs(1))); // next_retry_at
    });
  });
});
