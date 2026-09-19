import { Client } from "../client.js";
import { Indexer } from "../indexer.js";
import { Loans } from "../loans.js";
import {
  collectPages,
  DEFAULT_MAX_PAGES,
  iteratePages,
  type IteratorPage,
} from "../pagination.js";
import { Remittances } from "../remittances.js";
import { Transactions } from "../transactions.js";

/**
 * A `fetchPage` that plays back a fixed sequence of pages and records every cursor it was
 * asked for, so the tests can assert on the requests as well as the items.
 */
function scriptedPages<T>(pages: Array<IteratorPage<T>>): {
  fetchPage: (cursor: string | undefined) => Promise<IteratorPage<T>>;
  cursors: Array<string | undefined>;
} {
  const cursors: Array<string | undefined> = [];
  let index = 0;

  return {
    cursors,
    fetchPage: async (cursor) => {
      cursors.push(cursor);
      const page = pages[index];
      index += 1;
      if (page === undefined) {
        throw new Error(`unexpected request for page ${index}`);
      }
      return page;
    },
  };
}

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe("iteratePages", () => {
  it("yields every item across pages until the cursor runs out", async () => {
    const { fetchPage, cursors } = scriptedPages<number>([
      { items: [1, 2], nextCursor: "c1" },
      { items: [3, 4], nextCursor: "c2" },
      { items: [5] },
    ]);

    await expect(drain(iteratePages(fetchPage))).resolves.toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(cursors).toEqual([undefined, "c1", "c2"]);
  });

  it("treats an empty-string cursor as the end of the collection", async () => {
    const { fetchPage, cursors } = scriptedPages<number>([
      { items: [1], nextCursor: "" },
    ]);

    await expect(drain(iteratePages(fetchPage))).resolves.toEqual([1]);
    expect(cursors).toEqual([undefined]);
  });

  it("stops when the server echoes a cursor it has already been given", async () => {
    // The failure this guards: a loop that only stops on an absent cursor never returns when
    // the server repeats the cursor it was handed.
    const { fetchPage, cursors } = scriptedPages<number>([
      { items: [1], nextCursor: "c1" },
      { items: [2], nextCursor: "c1" },
      { items: [3], nextCursor: "c2" },
    ]);

    await expect(drain(iteratePages(fetchPage))).resolves.toEqual([1, 2]);
    expect(cursors).toEqual([undefined, "c1"]);
  });

  it("stops when the server returns a cursor from an earlier page", async () => {
    const { fetchPage } = scriptedPages<number>([
      { items: [1], nextCursor: "c1" },
      { items: [2], nextCursor: "c2" },
      { items: [3], nextCursor: "c1" },
      { items: [4], nextCursor: "c3" },
    ]);

    await expect(drain(iteratePages(fetchPage))).resolves.toEqual([1, 2, 3]);
  });

  it("begins from startCursor when one is given", async () => {
    const { fetchPage, cursors } = scriptedPages<number>([
      { items: [1], nextCursor: "c2" },
      { items: [2] },
    ]);

    await expect(
      drain(iteratePages(fetchPage, { startCursor: "c1" })),
    ).resolves.toEqual([1, 2]);
    expect(cursors).toEqual(["c1", "c2"]);
  });

  it("stops after maxPages even when every page reports a fresh cursor", async () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({
      items: [i],
      nextCursor: `c${i}`,
    }));
    const { fetchPage, cursors } = scriptedPages<number>(pages);

    await expect(
      drain(iteratePages(fetchPage, { maxPages: 3 })),
    ).resolves.toEqual([0, 1, 2]);
    expect(cursors).toHaveLength(3);
  });

  it("defaults to a bounded page count rather than looping forever", async () => {
    let requested = 0;
    const fetchPage = async (
      cursor: string | undefined,
    ): Promise<IteratorPage<number>> => {
      requested += 1;
      return {
        items: [requested],
        nextCursor: `cursor-${String(cursor)}-${requested}`,
      };
    };

    const items = await drain(iteratePages(fetchPage));
    expect(items).toHaveLength(DEFAULT_MAX_PAGES);
    expect(requested).toBe(DEFAULT_MAX_PAGES);
  });

  it("rejects a maxPages that cannot bound the loop", async () => {
    const { fetchPage } = scriptedPages<number>([{ items: [] }]);

    await expect(
      drain(iteratePages(fetchPage, { maxPages: 0 })),
    ).rejects.toThrow(RangeError);
    await expect(
      drain(iteratePages(fetchPage, { maxPages: -1 })),
    ).rejects.toThrow(RangeError);
    await expect(
      drain(iteratePages(fetchPage, { maxPages: NaN })),
    ).rejects.toThrow(RangeError);
    await expect(
      drain(iteratePages(fetchPage, { maxPages: Infinity })),
    ).rejects.toThrow(RangeError);
  });

  it("does not fetch a page whose items were never requested", async () => {
    const { fetchPage, cursors } = scriptedPages<number>([
      { items: [1, 2], nextCursor: "c1" },
      { items: [3] },
    ]);

    for await (const item of iteratePages(fetchPage)) {
      expect(item).toBe(1);
      break;
    }

    expect(cursors).toEqual([undefined]);
  });

  it("handles a page with no items but a cursor", async () => {
    const { fetchPage } = scriptedPages<number>([
      { items: [], nextCursor: "c1" },
      { items: [1] },
    ]);

    await expect(drain(iteratePages(fetchPage))).resolves.toEqual([1]);
  });
});

describe("collectPages", () => {
  it("collects every page into one array", async () => {
    const { fetchPage } = scriptedPages<number>([
      { items: [1, 2], nextCursor: "c1" },
      { items: [3] },
    ]);

    await expect(collectPages(fetchPage)).resolves.toEqual([1, 2, 3]);
  });

  it("honours maxPages", async () => {
    const { fetchPage } = scriptedPages<number>([
      { items: [1], nextCursor: "c1" },
      { items: [2], nextCursor: "c2" },
    ]);

    await expect(collectPages(fetchPage, { maxPages: 1 })).resolves.toEqual([
      1,
    ]);
  });
});

// ─── Module integrations ──────────────────────────────────────────────────────

function mockFetchPages(pages: unknown[]): jest.Mock {
  const mockFetch = jest.fn();
  let index = 0;
  mockFetch.mockImplementation(async () => {
    const page = pages[index];
    index += 1;
    return { ok: true, status: 200, json: async () => page };
  });
  global.fetch = mockFetch;
  return mockFetch;
}

function createClient(): Client {
  return new Client({
    baseUrl: "http://localhost:3001/api/v1",
    token: "test-token",
  });
}

function requestedCursors(mockFetch: jest.Mock): Array<string | null> {
  return mockFetch.mock.calls.map((call) =>
    new URL(String(call[0])).searchParams.get("cursor"),
  );
}

describe("Loans.iterate", () => {
  afterEach(() => jest.restoreAllMocks());

  it("walks the loans envelope and reads the cursor from page_info", async () => {
    const mockFetch = mockFetchPages([
      {
        success: true,
        data: { loans: [{ loanId: 1 }, { loanId: 2 }] },
        page_info: { limit: 2, next_cursor: "c1", has_next: true },
      },
      {
        success: true,
        data: { loans: [{ loanId: 3 }] },
        page_info: { limit: 2, next_cursor: null, has_next: false },
      },
    ]);
    const loans = new Loans(createClient());

    const ids: number[] = [];
    for await (const loan of loans.iterate({ status: "active", limit: 2 })) {
      ids.push(loan.loanId);
    }

    expect(ids).toEqual([1, 2, 3]);
    expect(requestedCursors(mockFetch)).toEqual([null, "c1"]);
    expect(
      new URL(String(mockFetch.mock.calls[0]?.[0])).searchParams.get("status"),
    ).toBe("active");
  });

  it("terminates when the server repeats the cursor", async () => {
    mockFetchPages([
      {
        success: true,
        data: { loans: [{ loanId: 1 }] },
        page_info: { limit: 1, next_cursor: "c1" },
      },
      {
        success: true,
        data: { loans: [{ loanId: 2 }] },
        page_info: { limit: 1, next_cursor: "c1" },
      },
    ]);
    const loans = new Loans(createClient());

    const ids: number[] = [];
    for await (const loan of loans.iterate()) {
      ids.push(loan.loanId);
    }

    expect(ids).toEqual([1, 2]);
  });
});

describe("Remittances.iterate", () => {
  afterEach(() => jest.restoreAllMocks());

  it("walks every page", async () => {
    const mockFetch = mockFetchPages([
      {
        success: true,
        data: [{ id: 1 }],
        page_info: { limit: 1, next_cursor: "c1", has_previous: false },
      },
      {
        success: true,
        data: [{ id: 2 }],
        page_info: { limit: 1, next_cursor: null, has_previous: true },
      },
    ]);
    const remittances = new Remittances(createClient());

    const ids: number[] = [];
    for await (const remittance of remittances.iterate()) {
      ids.push(remittance.id);
    }

    expect(ids).toEqual([1, 2]);
    expect(requestedCursors(mockFetch)).toEqual([null, "c1"]);
  });
});

describe("Transactions.iterate", () => {
  afterEach(() => jest.restoreAllMocks());

  it("walks every page from /transactions/me", async () => {
    const mockFetch = mockFetchPages([
      {
        success: true,
        data: [{ id: 1 }],
        page_info: { limit: 1, next_cursor: "c1" },
      },
      { success: true, data: [{ id: 2 }] },
    ]);
    const transactions = new Transactions(createClient());

    const ids: number[] = [];
    for await (const tx of transactions.iterate()) {
      ids.push(tx.id);
    }

    expect(ids).toEqual([1, 2]);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain("/transactions/me");
  });
});

describe("module collect() helpers", () => {
  afterEach(() => jest.restoreAllMocks());

  it("Loans.collect returns every loan across pages", async () => {
    mockFetchPages([
      {
        success: true,
        data: { loans: [{ loanId: 1 }] },
        page_info: { limit: 1, next_cursor: "c1" },
      },
      {
        success: true,
        data: { loans: [{ loanId: 2 }] },
        page_info: { limit: 1, next_cursor: null },
      },
    ]);

    await expect(new Loans(createClient()).collect()).resolves.toEqual([
      { loanId: 1 },
      { loanId: 2 },
    ]);
  });

  it("Remittances.collect returns every remittance across pages", async () => {
    mockFetchPages([
      {
        success: true,
        data: [{ id: 1 }],
        page_info: { limit: 1, next_cursor: "c1", has_previous: false },
      },
      {
        success: true,
        data: [{ id: 2 }],
        page_info: { limit: 1, next_cursor: null, has_previous: true },
      },
    ]);

    await expect(new Remittances(createClient()).collect()).resolves.toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it("Transactions.collect returns the whole history", async () => {
    mockFetchPages([
      {
        success: true,
        data: [{ id: 1 }],
        page_info: { limit: 1, next_cursor: "c1" },
      },
      { success: true, data: [{ id: 2 }] },
    ]);

    await expect(new Transactions(createClient()).collect()).resolves.toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it("Indexer.collectBorrowerEvents returns every event", async () => {
    mockFetchPages([
      {
        success: true,
        data: { events: [{ id: "e1" }], pagination: { next_cursor: "c1" } },
      },
      {
        success: true,
        data: { events: [{ id: "e2" }], pagination: { next_cursor: null } },
      },
    ]);

    const events = await new Indexer(createClient()).collectBorrowerEvents(
      "GBORROWER",
    );
    expect(
      events.map((event) => (event as unknown as { id: string }).id),
    ).toEqual(["e1", "e2"]);
  });

  it("collect() is still bounded by maxPages", async () => {
    mockFetchPages([
      {
        success: true,
        data: [{ id: 1 }],
        page_info: { limit: 1, next_cursor: "c1" },
      },
      {
        success: true,
        data: [{ id: 2 }],
        page_info: { limit: 1, next_cursor: "c2" },
      },
      {
        success: true,
        data: [{ id: 3 }],
        page_info: { limit: 1, next_cursor: null },
      },
    ]);

    await expect(
      new Transactions(createClient()).collect({ maxPages: 2 }),
    ).resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });
});

describe("Indexer.iterateBorrowerEvents", () => {
  afterEach(() => jest.restoreAllMocks());

  it("walks the nested events envelope", async () => {
    const mockFetch = mockFetchPages([
      {
        success: true,
        data: {
          events: [{ id: "e1" }, { id: "e2" }],
          pagination: { limit: 2, next_cursor: "c1" },
        },
      },
      {
        success: true,
        data: {
          events: [{ id: "e3" }],
          pagination: { limit: 2, next_cursor: null },
        },
      },
    ]);
    const indexer = new Indexer(createClient());

    const ids: string[] = [];
    for await (const event of indexer.iterateBorrowerEvents("GBORROWER")) {
      ids.push((event as unknown as { id: string }).id);
    }

    expect(ids).toEqual(["e1", "e2", "e3"]);
    expect(requestedCursors(mockFetch)).toEqual([null, "c1"]);
  });

  it("stops when the nested cursor repeats", async () => {
    mockFetchPages([
      {
        success: true,
        data: { events: [{ id: "e1" }], pagination: { next_cursor: "c1" } },
      },
      {
        success: true,
        data: { events: [{ id: "e2" }], pagination: { next_cursor: "c1" } },
      },
    ]);
    const indexer = new Indexer(createClient());

    const ids: string[] = [];
    for await (const event of indexer.iterateBorrowerEvents("GBORROWER")) {
      ids.push((event as unknown as { id: string }).id);
    }

    expect(ids).toEqual(["e1", "e2"]);
  });
});
