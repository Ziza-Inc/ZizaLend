import {
  ApiError,
  Client,
  DEFAULT_MAX_RETRY_DELAY_MS,
  RequestDeadlineExceededError,
  parseRetryAfterMs,
} from '../client.js';

/** Minimal stand-in for `Response.headers`, which a JSON mock does not otherwise carry. */
function headersWith(retryAfter: string): { get(name: string): string | null } {
  return {
    get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter : null),
  };
}

// ─── ApiError ─────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('creates an error with status code and message', () => {
    const err = new ApiError('Not found', 404, 'NOT_FOUND');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
    expect(err.errorCode).toBe('NOT_FOUND');
  });

  it('isAuthError returns true for 401', () => {
    expect(new ApiError('', 401).isAuthError).toBe(true);
    expect(new ApiError('', 403).isAuthError).toBe(false);
  });

  it('isRateLimited returns true for 429', () => {
    expect(new ApiError('', 429).isRateLimited).toBe(true);
    expect(new ApiError('', 503).isRateLimited).toBe(false);
  });

  it('isNotFound returns true for 404', () => {
    expect(new ApiError('', 404).isNotFound).toBe(true);
    expect(new ApiError('', 400).isNotFound).toBe(false);
  });

  it('isValidationError returns true for 400 + VALIDATION_ERROR', () => {
    expect(new ApiError('', 400, 'VALIDATION_ERROR').isValidationError).toBe(true);
    expect(new ApiError('', 400, 'INVALID_AMOUNT').isValidationError).toBe(false);
    expect(new ApiError('', 500).isValidationError).toBe(false);
  });

  it('stores optional field and details', () => {
    const details = { min: 0, max: 100 };
    const err = new ApiError('Invalid amount', 400, 'INVALID_AMOUNT', 'amount', details);
    expect(err.field).toBe('amount');
    expect(err.details).toEqual(details);
  });
});

// ─── Client Construction ─────────────────────────────────────────────────────

describe('Client', () => {
  describe('constructor', () => {
    it('normalizes baseUrl by stripping trailing slash', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001/api/v1/' });
      expect(client.getBaseUrl()).toBe('http://localhost:3001/api/v1');
    });

    it('applies defaults for timeout and maxRetries', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001' });
      expect(client['config'].timeoutMs).toBe(60000);
      expect(client['config'].maxRetries).toBe(3);
    });

    it('accepts custom timeout and maxRetries', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001', timeoutMs: 5000, maxRetries: 0 });
      expect(client['config'].timeoutMs).toBe(5000);
      expect(client['config'].maxRetries).toBe(0);
    });
  });

  // ─── Auth Token Management ──────────────────────────────────────────────────

  describe('token management', () => {
    it('starts without a token', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001' });
      expect(client.hasToken()).toBe(false);
    });

    it('setToken stores a token', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001' });
      client.setToken('my-jwt');
      expect(client.hasToken()).toBe(true);
    });

    it('setToken(undefined) clears the token', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001', token: 'initial' });
      expect(client.hasToken()).toBe(true);
      client.setToken(undefined);
      expect(client.hasToken()).toBe(false);
    });
  });

  // ─── API Key Management ─────────────────────────────────────────────────────

  describe('API key management', () => {
    it('starts without API key', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001' });
      expect(client.hasApiKey()).toBe(false);
    });

    it('setApiKey stores and clears the key', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001' });
      expect(client.hasApiKey()).toBe(false);
      client.setApiKey('sk-test');
      expect(client.hasApiKey()).toBe(true);
      client.setApiKey(undefined);
      expect(client.hasApiKey()).toBe(false);
    });
  });

  // ─── URL Building ───────────────────────────────────────────────────────────

  describe('buildUrl', () => {
    it('builds a simple path', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001/api/v1' });
      const url = client['buildUrl']('/health');
      expect(url).toBe('http://localhost:3001/api/v1/health');
    });

    it('appends query parameters', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001/api/v1' });
      const url = client['buildUrl']('/loans', { limit: 20, status: 'active' });
      expect(url).toBe('http://localhost:3001/api/v1/loans?limit=20&status=active');
    });

    it('skips undefined query parameters', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001' });
      const url = client['buildUrl']('/score/user123', { limit: undefined, cursor: undefined });
      expect(url).toBe('http://localhost:3001/score/user123');
    });

    it('handles boolean query parameters', () => {
      const client = new Client({ baseUrl: 'http://localhost:3001' });
      const url = client['buildUrl']('/test', { flag: true });
      expect(url).toBe('http://localhost:3001/test?flag=true');
    });
  });

  // ─── executeFetch (headers, auth) ───────────────────────────────────────────

  describe('executeFetch', () => {
    const mockFetch = jest.fn();

    beforeEach(() => {
      jest.resetAllMocks();
      global.fetch = mockFetch;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
    });

    it('sends Content-Type header', async () => {
      const client = new Client({ baseUrl: 'http://localhost:3001' });
      await client['executeFetch']('http://localhost:3001/test', { method: 'GET' });

      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('includes Bearer token when set', async () => {
      const client = new Client({ baseUrl: 'http://localhost:3001', token: 'my-jwt' });
      await client['executeFetch']('http://localhost:3001/test', { method: 'GET' });

      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer my-jwt');
    });

    it('includes API key when set', async () => {
      const client = new Client({ baseUrl: 'http://localhost:3001', apiKey: 'sk-test' });
      await client['executeFetch']('http://localhost:3001/test', { method: 'GET' });

      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-test');
    });

    it('merges caller-supplied headers', async () => {
      const client = new Client({ baseUrl: 'http://localhost:3001' });
      await client['executeFetch']('http://localhost:3001/test', {
        method: 'GET',
        headers: { 'X-Custom': 'val' },
      });

      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('val');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('aborts after timeout', async () => {
      jest.useFakeTimers();

      // Mock that rejects when the signal is aborted
      mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = opts.signal as AbortSignal;
          if (signal.aborted) {
            reject(new DOMException('The operation was aborted', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      });

      const client = new Client({ baseUrl: 'http://localhost:3001', timeoutMs: 100 });

      const fetchPromise = client['executeFetch']('http://localhost:3001/test', { method: 'GET' });
      jest.advanceTimersByTime(100);

      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      expect(opts.signal?.aborted).toBe(true);

      await expect(fetchPromise).rejects.toThrow();
      jest.useRealTimers();
    });

    it('passes the signal to fetch', async () => {
      const client = new Client({ baseUrl: 'http://localhost:3001' });
      await client['executeFetch']('http://localhost:3001/test', { method: 'GET' });

      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ─── Retry Logic ────────────────────────────────────────────────────────────

  describe('request retry logic', () => {
    const mockFetch = jest.fn();

    beforeEach(() => {
      jest.resetAllMocks();
      jest.useFakeTimers();
      global.fetch = mockFetch;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('succeeds on first attempt', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { score: 750 } }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001' });
      const result = await client.get('/score/test');
      expect(result).toEqual({ success: true, data: { score: 750 } });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 503 and succeeds on second attempt', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ success: false, message: 'Service Unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { score: 750 } }),
        });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });

      // Start the request (it will wait on the sleep between retries)
      const requestPromise = client.get('/score/test');

      // Advance past the 200ms backoff
      await jest.advanceTimersByTimeAsync(1000);

      const result = await requestPromise;
      expect(result).toEqual({ success: true, data: { score: 750 } });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 400', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Bad request' },
        }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });

      await expect(client.get('/test')).rejects.toThrow(ApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retry
    });

    it('does not retry on 401', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });

      await expect(client.get('/test')).rejects.toThrow(ApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 404', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Not found' },
        }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });

      await expect(client.get('/test')).rejects.toThrow(ApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 (rate limited)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({
            success: false,
            error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too fast' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });

      const requestPromise = client.get('/test');
      await jest.advanceTimersByTimeAsync(1000);

      await expect(requestPromise).resolves.toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all retries on 503', async () => {
      // Use real timers for deterministic retry behavior
      jest.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          success: false,
          error: { code: 'EXTERNAL_SERVICE_ERROR', message: 'Down' },
        }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 2 });

      await expect(client.get('/test')).rejects.toThrow(ApiError);
      expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('retries on network error', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });

      const requestPromise = client.get('/test');
      await jest.advanceTimersByTimeAsync(1000);

      await expect(requestPromise).resolves.toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('respects maxRetries=0 (no retries)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ success: false, message: 'Down' }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 0 });

      await expect(client.get('/test')).rejects.toThrow(ApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // ─── Replay safety ──────────────────────────────────────────────────────────
    //
    // A request whose response was lost is not a request that did not happen. These pin the
    // property that makes retrying a state-changing request acceptable at all: every attempt of
    // one `request()` call carries the *same* replay key, and a call that carries none is not
    // retried.

    /** The `Idempotency-Key` sent on the Nth fetch attempt, or undefined. */
    const keyOf = (attempt: number): string | undefined => {
      const call = mockFetch.mock.calls[attempt] as [string, RequestInit] | undefined;
      const headers = call?.[1]?.headers as Record<string, string> | undefined;
      return headers?.['Idempotency-Key'];
    };

    it('reuses one Idempotency-Key across the timeout-then-success sequence of a POST', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { loanId: 42 } }),
        });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });

      const requestPromise = client.post('/loans', { amount: 100 });
      await jest.advanceTimersByTimeAsync(1000);
      await expect(requestPromise).resolves.toBeDefined();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Two attempts, one operation: a server that deduplicates on the key sees a replay of the
      // request it already processed rather than a second loan.
      expect(keyOf(0)).toBeDefined();
      expect(keyOf(1)).toBe(keyOf(0));
      expect(new Set([keyOf(0), keyOf(1)]).size).toBe(1);
    });

    it('reuses one Idempotency-Key across the attempts of a transient 503 on a PATCH', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ success: false, message: 'Service Unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });

      const requestPromise = client.patch('/notifications/7', { read: true });
      await jest.advanceTimersByTimeAsync(1000);
      await expect(requestPromise).resolves.toBeDefined();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(keyOf(1)).toBe(keyOf(0));
    });

    it('does not retry a POST when the client may not mint a replay key', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      const client = new Client({
        baseUrl: 'http://localhost:3001',
        maxRetries: 3,
        autoIdempotencyKey: false,
      });

      await expect(client.post('/loans', { amount: 100 })).rejects.toThrow(TypeError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(keyOf(0)).toBeUndefined();
    });

    it('retries a POST that the caller supplied its own replay key for', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        });

      // The caller asserting its backend honours the key is what opts this in when
      // `autoIdempotencyKey` is off.
      const client = new Client({
        baseUrl: 'http://localhost:3001',
        maxRetries: 3,
        autoIdempotencyKey: false,
      });

      const requestPromise = client.post(
        '/loans',
        { amount: 100 },
        { headers: { 'Idempotency-Key': 'caller-supplied-key' } },
      );
      await jest.advanceTimersByTimeAsync(1000);
      await expect(requestPromise).resolves.toBeDefined();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(keyOf(0)).toBe('caller-supplied-key');
      expect(keyOf(1)).toBe('caller-supplied-key');
    });

    it('retries an idempotent method without adding a replay key', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });

      const requestPromise = client.put('/loans/1', { amount: 100 });
      await jest.advanceTimersByTimeAsync(1000);
      await expect(requestPromise).resolves.toBeDefined();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // PUT replaces, so repeating it is not a second effect and needs no key.
      expect(keyOf(0)).toBeUndefined();
    });

    it('keeps a caller-supplied key even when the client mints keys by default', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });
      await client.post('/loans', { amount: 1 }, { headers: { 'Idempotency-Key': 'mine' } });

      expect(keyOf(0)).toBe('mine');
    });

    it('generates a distinct key per logical operation, not per client', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });
      await client.post('/loans', { amount: 1 });
      await client.post('/loans', { amount: 2 });

      expect(keyOf(0)).toBeDefined();
      expect(keyOf(1)).toBeDefined();
      expect(keyOf(1)).not.toBe(keyOf(0));
    });
  });

  // ─── HTTP Method Helpers ────────────────────────────────────────────────────

  describe('HTTP method helpers', () => {
    const mockFetch = jest.fn();

    beforeEach(() => {
      jest.resetAllMocks();
      global.fetch = mockFetch;
    });

    it('get() sends GET', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001' });
      await client.get('/test');
      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(opts.method).toBe('GET');
    });

    it('post() sends POST with JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001' });
      await client.post('/test', { key: 'value' });
      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(opts.method).toBe('POST');
      expect(opts.body).toBe('{"key":"value"}');
    });

    it('post() omits body when undefined', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001' });
      await client.post('/test');
      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(opts.method).toBe('POST');
      expect(opts.body).toBeUndefined();
    });

    it('put() sends PUT with JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001' });
      await client.put('/test', { key: 'value' });
      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(opts.method).toBe('PUT');
    });

    it('patch() sends PATCH with JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001' });
      await client.patch('/test', { key: 'value' });
      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(opts.method).toBe('PATCH');
    });

    it('delete() sends DELETE', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001' });
      await client.delete('/test');
      const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(opts.method).toBe('DELETE');
    });

    it('raw() returns Response directly', async () => {
      const mockResponse = { ok: true, status: 200, body: null };
      mockFetch.mockResolvedValue(mockResponse);

      const client = new Client({ baseUrl: 'http://localhost:3001' });
      const result = await client.raw('/events/stream');
      expect(result).toBe(mockResponse);
    });
  });

  // ─── parseRetryAfterMs ──────────────────────────────────────────────────────

  describe('parseRetryAfterMs', () => {
    // A fixed clock, because an HTTP-date has one-second resolution and "now" with
    // milliseconds in it would make the expected value drift.
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);

    it('reads the delta-seconds form', () => {
      expect(parseRetryAfterMs(headersWith('60'), now)).toBe(60_000);
      expect(parseRetryAfterMs(headersWith('1'), now)).toBe(1_000);
      expect(parseRetryAfterMs(headersWith('  120  '), now)).toBe(120_000);
    });

    it('reads the HTTP-date form', () => {
      expect(parseRetryAfterMs(headersWith('Thu, 01 Jan 2026 12:00:05 GMT'), now)).toBe(5_000);
    });

    it('clamps a date that has already passed to zero', () => {
      expect(parseRetryAfterMs(headersWith('Thu, 01 Jan 2026 11:59:00 GMT'), now)).toBe(0);
    });

    it('returns null for a header it cannot parse, so the caller backs off instead', () => {
      expect(parseRetryAfterMs(headersWith('soon'), now)).toBeNull();
      expect(parseRetryAfterMs(headersWith(''), now)).toBeNull();
      expect(parseRetryAfterMs(headersWith('-5'), now)).toBeNull();
      expect(parseRetryAfterMs(headersWith('1.5'), now)).toBeNull();
    });

    it('returns null when there are no headers at all', () => {
      expect(parseRetryAfterMs(undefined, now)).toBeNull();
      expect(parseRetryAfterMs(null, now)).toBeNull();
      expect(parseRetryAfterMs({ get: () => null }, now)).toBeNull();
    });
  });

  // ─── Retry-After ────────────────────────────────────────────────────────────

  describe('Retry-After', () => {
    const mockFetch = jest.fn();

    beforeEach(() => {
      jest.resetAllMocks();
      jest.useFakeTimers();
      global.fetch = mockFetch;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('does not retry a 429 after 200ms when the server asked for a minute', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: headersWith('60'),
        json: async () => ({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED' } }),
      });

      const client = new Client({
        baseUrl: 'http://localhost:3001',
        maxRetries: 1,
        maxRetryDelayMs: 5_000,
      });

      const settled = client.get('/test').catch((error: unknown) => error);

      // The old schedule slept 200ms and hammered the limiter while its window was shut.
      await jest.advanceTimersByTimeAsync(250);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(4_800);
      await expect(settled).resolves.toBeInstanceOf(ApiError);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('caps an hour-long Retry-After at maxRetryDelayMs', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        headers: headersWith('3600'),
        json: async () => ({ success: false }),
      });

      const client = new Client({
        baseUrl: 'http://localhost:3001',
        maxRetries: 1,
        maxRetryDelayMs: 2_000,
      });

      const settled = client.get('/test').catch((error: unknown) => error);

      await jest.advanceTimersByTimeAsync(1_999);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(2);
      await expect(settled).resolves.toBeInstanceOf(ApiError);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('honours an HTTP-date Retry-After as well as delta-seconds', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      const retryAt = new Date(Date.now() + 3_000).toUTCString();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: headersWith(retryAt),
        json: async () => ({ success: false }),
      });

      const client = new Client({
        baseUrl: 'http://localhost:3001',
        maxRetries: 1,
        maxRetryDelayMs: 10_000,
      });

      const settled = client.get('/test').catch((error: unknown) => error);

      // An HTTP-date has one-second resolution, so the wait is just under three seconds.
      await jest.advanceTimersByTimeAsync(2_000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(2_000);
      await expect(settled).resolves.toBeInstanceOf(ApiError);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('jitters an honoured Retry-After upwards rather than downwards', async () => {
      // `Retry-After` is a floor: the recorded call time must never precede the interval the
      // server asked for, or every client returns before the window reopens.
      jest.spyOn(Math, 'random').mockReturnValue(0.999);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: headersWith('1'),
        json: async () => ({ success: false }),
      });

      const client = new Client({
        baseUrl: 'http://localhost:3001',
        maxRetries: 1,
        maxRetryDelayMs: 10_000,
      });

      const settled = client.get('/test').catch((error: unknown) => error);

      await jest.advanceTimersByTimeAsync(1_000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(300);
      await expect(settled).resolves.toBeInstanceOf(ApiError);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('falls back to exponential backoff when the header is absent', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 3 });

      const requestPromise = client.get('/test');

      // Equal jitter with random() === 0 is exactly half the window, so the first wait is 100ms.
      await jest.advanceTimersByTimeAsync(99);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(2);
      await expect(requestPromise).resolves.toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Total deadline ────────────────────────────────────────────────────────

  describe('total deadline', () => {
    const mockFetch = jest.fn();

    beforeEach(() => {
      jest.resetAllMocks();
      jest.useFakeTimers();
      global.fetch = mockFetch;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('bounds every attempt and the backoff between them, not just one attempt', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ success: false, message: 'Down' }),
      });

      const client = new Client({
        baseUrl: 'http://localhost:3001',
        maxRetries: 5,
        totalTimeoutMs: 1_000,
      });

      const settled = client.get('/test').catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(10_000);
      const error = await settled;

      expect(error).toBeInstanceOf(RequestDeadlineExceededError);
      expect(error).not.toBeInstanceOf(ApiError);
      expect((error as RequestDeadlineExceededError).totalTimeoutMs).toBe(1_000);
      // `maxRetries: 5` alone would allow six attempts; the deadline cut it short.
      expect(mockFetch.mock.calls.length).toBeLessThan(6);
      expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    });

    it('stops retrying when the backoff alone cannot fit in the remaining budget', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: headersWith('60'),
        json: async () => ({ success: false }),
      });

      const client = new Client({
        baseUrl: 'http://localhost:3001',
        maxRetries: 3,
        totalTimeoutMs: 5_000,
      });

      const settled = client.get('/test').catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(10);

      // Failing immediately beats sleeping 60 seconds past a deadline that has already decided
      // the outcome, and beats reporting the rate-limit error the caller could not have avoided.
      await expect(settled).resolves.toBeInstanceOf(RequestDeadlineExceededError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fails promptly when the deadline is shorter than one attempt timeout', async () => {
      mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = opts.signal as AbortSignal;
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      });

      const client = new Client({
        baseUrl: 'http://localhost:3001',
        timeoutMs: 30_000,
        maxRetries: 3,
        totalTimeoutMs: 50,
      });

      const settled = client.get('/test').catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(60);

      const error = await settled;
      expect(error).toBeInstanceOf(RequestDeadlineExceededError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('names the deadline rather than the last transport error', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      const client = new Client({
        baseUrl: 'http://localhost:3001',
        maxRetries: 4,
        totalTimeoutMs: 200,
      });

      const settled = client.get('/test').catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(1_000);
      const error = await settled;

      expect(error).toBeInstanceOf(RequestDeadlineExceededError);
      expect((error as Error).message).toMatch(/deadline/i);
      expect((error as Error).message).not.toMatch(/fetch failed/);
    });

    it('leaves the per-attempt behaviour alone when no deadline is configured', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ success: false, message: 'Down' }),
      });

      const client = new Client({ baseUrl: 'http://localhost:3001', maxRetries: 2 });

      const settled = client.get('/test').catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(10_000);

      // The last transport error, as before: nothing bounded the request.
      await expect(settled).resolves.toBeInstanceOf(ApiError);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('exposes a documented default cap on a single backoff wait', () => {
      expect(DEFAULT_MAX_RETRY_DELAY_MS).toBe(30_000);
    });
  });
});
