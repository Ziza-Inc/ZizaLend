/**
 * hooks/useApi.idempotencyKey.test.ts
 *
 * The API refuses a POST or PATCH that arrives without an `Idempotency-Key`
 * (backend/src/middleware/idempotencyPolicy.ts), so the frontend has to send one.
 * These tests pin the two properties that make the header useful rather than
 * merely present: an overlapping repeat of one click carries the *same* key, and
 * a request the API refuses as already-in-flight is waited out and replayed
 * instead of surfacing an error for a click the user made once.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCreateRemittance, useLoans, resetIdempotencyKeysForTests } from "./useApi";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const PAYLOAD = {
  amount: 100,
  fromCurrency: "USD",
  toCurrency: "EUR",
  recipientAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
};

/** A `Response`-shaped object good enough for `apiFetch`. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
    clone: () => jsonResponse(body, status),
  } as unknown as Response;
}

/** The `Idempotency-Key` each fetch call carried. */
function keysSent(fetchMock: jest.Mock): (string | null)[] {
  return fetchMock.mock.calls.map(([, init]) => (init.headers as Headers).get("Idempotency-Key"));
}

describe("apiFetch idempotency keys", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetIdempotencyKeysForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("sends an Idempotency-Key on a state-changing request", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { id: "remittance-1" } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useCreateRemittance(), { wrapper: createWrapper() });
    result.current.mutate(PAYLOAD);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [key] = keysSent(fetchMock);
    expect(key).toEqual(expect.any(String));
    // Long enough for the server's 8-character minimum, and an opaque token.
    expect(key!.length).toBeGreaterThanOrEqual(8);
  });

  it("does not send one on a read", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ success: true, data: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useLoans(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(keysSent(fetchMock)).toEqual([null]);
  });

  it("gives an overlapping repeat of the same request the same key", async () => {
    // Both requests hang until released, so they are genuinely in flight together —
    // which is the double-click this is about.
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = jest
      .fn()
      .mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = renderHook(() => useCreateRemittance(), { wrapper: createWrapper() });
    const second = renderHook(() => useCreateRemittance(), { wrapper: createWrapper() });

    first.result.current.mutate(PAYLOAD);
    second.result.current.mutate(PAYLOAD);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const keys = keysSent(fetchMock);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);

    // The second request is served from the first's response by the server, so both resolve.
    pending.forEach((resolve) => resolve(jsonResponse({ success: true, data: { id: "one" } })));
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
  });

  it("gives a repeat of the same request after the first finished a new key", async () => {
    // Two identical remittances sent deliberately are two operations, and must not be
    // collapsed into one by a client-side window.
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { id: "remittance-1" } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = renderHook(() => useCreateRemittance(), { wrapper: createWrapper() });
    first.result.current.mutate(PAYLOAD);
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    const second = renderHook(() => useCreateRemittance(), { wrapper: createWrapper() });
    second.result.current.mutate(PAYLOAD);
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    const keys = keysSent(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("waits out a 409 duplicate-request refusal and replays it", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: { code: "DUPLICATE_REQUEST", message: "already in flight" },
          },
          409,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { id: "the-first-outcome" } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useCreateRemittance(), { wrapper: createWrapper() });
    result.current.mutate(PAYLOAD);

    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 });

    // The replay carries the same key, which is what makes it a replay.
    const keys = keysSent(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    // The replayed response is the first request's outcome, not a second execution.
    expect(result.current.data).toEqual({
      success: true,
      data: { id: "the-first-outcome" },
    });
  });

  it("surfaces a duplicate-request refusal once the replay budget is spent", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { success: false, error: { code: "DUPLICATE_REQUEST", message: "busy" } },
          409,
        ),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useCreateRemittance(), { wrapper: createWrapper() });
    result.current.mutate(PAYLOAD);

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });

    // Bounded: it gives up rather than waiting forever on a stuck first request.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("does not treat an unrelated conflict as a replay", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, error: { code: "CONFLICT" } }, 409));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useCreateRemittance(), { wrapper: createWrapper() });
    result.current.mutate(PAYLOAD);

    await waitFor(() => expect(result.current.isError).toBe(true));

    // One attempt, because a 409 that is not DUPLICATE_REQUEST is a real answer.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
