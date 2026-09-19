/**
 * Core HTTP client for the Zizalend API.
 *
 * Handles authentication, request/response serialization, error handling,
 * retry logic for transient failures, and provides a typed fetch interface.
 */

import { isKnownApiErrorCode, toApiErrorCode, type ApiErrorCode } from './errorCodes.generated.js';

export interface ClientConfig {
  /** Base URL for the API (e.g. http://localhost:3001/api/v1) */
  baseUrl: string;
  /** JWT token (set after login or from persisted session) */
  token?: string;
  /** API key for server-to-server admin endpoints */
  apiKey?: string;
  /** Request timeout in milliseconds, applied to each attempt (default: 60000) */
  timeoutMs?: number;
  /** Maximum retries for transient errors (default: 3) */
  maxRetries?: number;
  /**
   * Wall-clock budget in milliseconds for one logical request, covering every attempt and
   * every backoff wait between them.
   *
   * Without it the real worst case is `timeoutMs * (maxRetries + 1)` plus the backoff — 120
   * seconds or more with the documented defaults — and a caller has no way to say "give up
   * after five seconds", which is the constraint a UI actually has. Left unset, so existing
   * callers keep the per-attempt behaviour they have today.
   */
  totalTimeoutMs?: number;
  /**
   * Upper bound in milliseconds on any single backoff wait (default: 30000).
   *
   * Caps both the exponential fallback and an honoured `Retry-After`, so a server asking for
   * an hour cannot pin a client for an hour.
   */
  maxRetryDelayMs?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    field?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Thrown when a request exhausts the `totalTimeoutMs` budget.
 *
 * Deliberately not an `ApiError`, and deliberately not the last transport error: nothing was
 * refused by the server and nothing necessarily failed on the network. The client decided to
 * stop, and reporting the underlying `ECONNRESET` would attribute a policy decision to the
 * network.
 */
export class RequestDeadlineExceededError extends Error {
  public readonly totalTimeoutMs: number;
  public readonly elapsedMs: number;

  constructor(totalTimeoutMs: number, elapsedMs: number) {
    super(
      `Request deadline of ${totalTimeoutMs}ms exceeded after ${elapsedMs}ms ` +
        '(including every attempt and the backoff between them)',
    );
    this.name = 'RequestDeadlineExceededError';
    this.totalTimeoutMs = totalTimeoutMs;
    this.elapsedMs = elapsedMs;
  }
}

export class ApiError extends Error {
  public readonly statusCode: number;

  /**
   * The code the API reported, or `UNKNOWN_API_ERROR` when the failure did not come from
   * the backend's error handler.
   *
   * Always populated and always one of a closed set, so `switch (err.errorCode)` is
   * exhaustive and a comparison against a code that no longer exists fails to compile
   * instead of quietly never matching. The set is derived from the backend registry by
   * `scripts/generate-sdk-error-codes.mjs`.
   */
  public readonly errorCode: ApiErrorCode;

  public readonly field?: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    errorCode?: ApiErrorCode | string,
    field?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    // Normalised here rather than at each call site, so no consumer ever receives an
    // arbitrary string from the wire under this property.
    this.errorCode = toApiErrorCode(errorCode);
    this.field = field;
    this.details = details;
  }

  /**
   * Whether the server named the failure, rather than the client falling back to the
   * unknown member. Useful for logging and for deciding whether retrying could help.
   */
  get hasKnownErrorCode(): boolean {
    return isKnownApiErrorCode(this.errorCode);
  }

  get isAuthError(): boolean {
    return this.statusCode === 401;
  }

  get isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  get isNotFound(): boolean {
    return this.statusCode === 404;
  }

  get isValidationError(): boolean {
    return this.statusCode === 400 && this.errorCode === 'VALIDATION_ERROR';
  }
}

const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504]);

/** Statuses whose `Retry-After` the client honours. */
const RETRY_AFTER_STATUS_CODES = new Set([429, 503]);

/** Default ceiling on a single backoff wait, in milliseconds. */
export const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;

/**
 * Additive jitter applied on top of an honoured `Retry-After`, in milliseconds.
 *
 * `Retry-After` is a floor, so the jitter can only be added: subtracting from it would send
 * every client back to the limiter before the window it was told to wait for had reopened.
 */
export const RETRY_AFTER_JITTER_MS = 250;

/** Minimal shape of the response headers this client needs, so a stub can satisfy it. */
export interface ResponseHeadersLike {
  get(name: string): string | null;
}

/**
 * Parse a `Retry-After` header into a delay in milliseconds.
 *
 * RFC 9110 allows two forms, and both appear in the wild:
 *   - `Retry-After: 60`                      — delta-seconds
 *   - `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT` — an HTTP-date
 *
 * Returns `null` when the header is absent, empty or unparseable, which is what makes the
 * caller fall back to exponential backoff. A date already in the past returns `0`.
 */
export function parseRetryAfterMs(
  headers?: ResponseHeadersLike | null,
  now: number = Date.now(),
): number | null {
  const raw = headers?.get?.('retry-after');
  if (typeof raw !== 'string') return null;

  const value = raw.trim();
  if (value === '') return null;

  // Delta-seconds is digits only. `Number` would also accept '1.5' and '-5' here, and neither
  // is a form the header defines.
  if (/^\d+$/.test(value)) {
    return Number(value) * 1000;
  }

  // Anything else has to at least look like a date before `Date.parse` is asked. V8's parser is
  // permissive enough to read '-5' as a year, which would turn a malformed header into a wait
  // of “that date, a long time ago” — i.e. zero — instead of the exponential fallback. All
  // three date forms RFC 9110 requires a recipient to accept contain letters.
  if (!/[A-Za-z]/.test(value)) return null;

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, parsed - now);
}

export class Client {
  private readonly config: {
    baseUrl: string;
    token: string | undefined;
    apiKey: string | undefined;
    timeoutMs: number;
    maxRetries: number;
    totalTimeoutMs: number | undefined;
    maxRetryDelayMs: number;
  };

  constructor(config: ClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ''),
      token: config.token,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs ?? 60000,
      maxRetries: config.maxRetries ?? 3,
      totalTimeoutMs: config.totalTimeoutMs,
      maxRetryDelayMs: config.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
    };
  }

  /** Update the auth token (e.g. after login or token refresh) */
  setToken(token: string | undefined): void {
    this.config.token = token;
  }

  /** Update the API key */
  setApiKey(apiKey: string | undefined): void {
    this.config.apiKey = apiKey;
  }

  /** Check if a JWT token is currently set */
  hasToken(): boolean {
    return !!this.config.token;
  }

  /** The current JWT token, or `undefined` when none is set. */
  getToken(): string | undefined {
    return this.config.token;
  }

  /** Check if an API key is currently set */
  hasApiKey(): boolean {
    return !!this.config.apiKey;
  }

  /** Get current base URL */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Make a typed HTTP GET request.
   */
  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    init?: RequestInit,
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    const response = await this.request(url, { ...init, method: 'GET' });
    return response as T;
  }

  /**
   * Make a typed HTTP POST request.
   */
  async post<T>(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const url = this.buildUrl(path);
    const response = await this.request(url, {
      ...init,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return response as T;
  }

  /**
   * Make a typed HTTP PUT request.
   */
  async put<T>(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const url = this.buildUrl(path);
    const response = await this.request(url, {
      ...init,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return response as T;
  }

  /**
   * Make a typed HTTP PATCH request.
   */
  async patch<T>(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const url = this.buildUrl(path);
    const response = await this.request(url, {
      ...init,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return response as T;
  }

  /**
   * Make a typed HTTP DELETE request.
   */
  async delete<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const url = this.buildUrl(path);
    const response = await this.request(url, { ...init, method: 'DELETE' });
    return response as T;
  }

  /**
   * Make a raw request that returns the full Response object.
   * Useful for SSE streams or when you need to check response headers.
   */
  async raw(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const url = this.buildUrl(path);
    return this.executeFetch(url, init ?? {});
  }

  // ─── Private helpers ─────────────────────────────────────────

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(`${this.config.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    const totalTimeoutMs = this.config.totalTimeoutMs;
    const startedAt = Date.now();
    const deadlineAt = totalTimeoutMs === undefined ? null : startedAt + totalTimeoutMs;

    const deadlineError = (): RequestDeadlineExceededError =>
      new RequestDeadlineExceededError(totalTimeoutMs ?? 0, Date.now() - startedAt);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (deadlineAt !== null && Date.now() >= deadlineAt) {
        throw deadlineError();
      }

      // Never let a single attempt run past the shared budget. The per-attempt abort timer is
      // set to whichever is smaller, so `timeoutMs: 30000` with a five-second budget aborts at
      // five seconds rather than at thirty.
      const remainingMs =
        deadlineAt === null ? Number.POSITIVE_INFINITY : deadlineAt - Date.now();
      const attemptTimeoutMs = Math.min(this.config.timeoutMs, remainingMs);

      try {
        const response = await this.executeFetch(url, init, attemptTimeoutMs);
        const body = await response.json() as ApiResponse<unknown>;

        if (!response.ok) {
          const apiError = new ApiError(
            body.error?.message ?? body.message ?? `HTTP ${response.status}`,
            response.status,
            body.error?.code,
            body.error?.field,
            body.error?.details,
          );

          // Don't retry client errors (4xx) except 429
          if (!TRANSIENT_STATUS_CODES.has(response.status)) {
            throw apiError;
          }

          // On last attempt, throw
          if (attempt >= this.config.maxRetries) {
            throw apiError;
          }

          lastError = apiError;
          const waitMs = this.computeRetryDelay(attempt, response.status, response.headers);

          // A backoff that already consumes the whole remaining budget cannot be followed by an
          // attempt, so waiting it out would only delay the same answer. Fail now, and fail as
          // the deadline rather than as a rate-limit error the caller could not have avoided.
          if (deadlineAt !== null && waitMs >= deadlineAt - Date.now()) {
            throw deadlineError();
          }

          await this.sleep(waitMs);
          continue;
        }

        return body;
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        if (error instanceof RequestDeadlineExceededError) {
          throw error;
        }

        // An attempt aborted because the shared budget ran out failed on the budget, not on the
        // network. Saying so is the point of the option: the caller asked for a bound and the
        // bound is what stopped the request.
        if (deadlineAt !== null && Date.now() >= deadlineAt) {
          throw deadlineError();
        }

        // Network / timeout errors are transient
        if (attempt >= this.config.maxRetries) {
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));
        const waitMs = this.computeRetryDelay(attempt, undefined, undefined);

        if (deadlineAt !== null && waitMs >= deadlineAt - Date.now()) {
          throw deadlineError();
        }

        await this.sleep(waitMs);
      }
    }

    throw lastError ?? new Error('Request failed');
  }

  /**
   * How long to wait before the next attempt.
   *
   * `Retry-After` wins on a 429 or a 503: the server knows when its window reopens and the
   * client does not. Everything else falls back to exponential backoff from 200ms. Either wait
   * is capped by `maxRetryDelayMs` and jittered so independent clients do not retry together.
   */
  private computeRetryDelay(
    attempt: number,
    status: number | undefined,
    headers: ResponseHeadersLike | null | undefined,
  ): number {
    const headerMs =
      status !== undefined && RETRY_AFTER_STATUS_CODES.has(status)
        ? parseRetryAfterMs(headers)
        : null;

    if (headerMs !== null) {
      const capped = Math.min(headerMs, this.config.maxRetryDelayMs);
      // Additive only: `Retry-After` is a floor, so subtracting from it would send every
      // client back before the window it was told to wait for had reopened.
      return capped + Math.random() * RETRY_AFTER_JITTER_MS;
    }

    const backoff = Math.min(Math.pow(2, attempt) * 200, this.config.maxRetryDelayMs);
    // Equal jitter: half the window fixed, half random. A fleet that hit the same limiter at
    // the same moment does not come back in lockstep, while the wait still grows with the
    // attempt index.
    return backoff / 2 + Math.random() * (backoff / 2);
  }

  private async executeFetch(
    url: string,
    init: RequestInit,
    attemptTimeoutMs: number = this.config.timeoutMs,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Copy any caller-supplied headers
    if (init.headers) {
      const incoming = init.headers as Record<string, string>;
      for (const key of Object.keys(incoming)) {
        const val = incoming[key];
        if (val !== undefined) {
          headers[key] = val;
        }
      }
    }

    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }

    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
