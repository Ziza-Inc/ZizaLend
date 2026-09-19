/**
 * Cursor pagination for the SDK.
 *
 * Four endpoints return a page plus a `next_cursor` — loans, remittances, transactions, and
 * borrower events — and none of them offered a way to consume more than the first page. Every
 * consumer that needed the whole set therefore wrote the same loop, and each wrote it slightly
 * differently: some stopped on a missing cursor, some on a short page, some on a cursor that
 * repeated.
 *
 * The repeated cursor is the case worth centralising. A server that echoes the cursor it was
 * given — because the parameter was ignored, or because the last page has one more row — makes
 * a loop that only stops when the cursor is absent spin forever, and the caller's version is
 * not reviewed. The three termination conditions here are the ones that make the loop total:
 * the cursor is absent, the cursor is one we have already requested, or the page ceiling is
 * reached.
 */

/** Default ceiling on pages fetched by one iteration. */
export const DEFAULT_MAX_PAGES = 100;

/**
 * One page of results, in the shape the iterator needs.
 *
 * Deliberately not one of the module response types: the SDK's responses differ in where they
 * put the items (`data` versus `data.events`) and what they call the cursor (`next_cursor`
 * under `page_info`, `pagination`, or nothing at all). Each module adapts its own response to
 * this shape, so the loop itself has one input rather than four.
 */
export interface IteratorPage<T> {
  items: T[];
  nextCursor?: string | undefined;
}

export interface PaginatorOptions {
  /**
   * Ceiling on the number of pages fetched.
   *
   * A collector that needs every row still needs a bound: a page whose cursor is always new
   * but never progresses — a server generating a fresh cursor per request without advancing —
   * is not detectable from the cursor alone, and an unbounded `for await` against it never
   * returns.
   */
  maxPages?: number | undefined;
  /** Cursor to begin from. Defaults to the first page. */
  startCursor?: string | undefined;
}

/**
 * Yield every item across every page of a paginated collection.
 *
 * Iteration stops when the page reports no next cursor, when the next cursor has already been
 * requested, or when `maxPages` pages have been fetched. Each condition is a `return` rather
 * than a throw: a truncated iteration is a normal outcome for a bounded loop, and the caller
 * can see where it stopped by counting what it received.
 *
 * The generator is lazy — a page is fetched only when its items are requested — so breaking out
 * of a `for await` loop does not fetch a page nobody asked for.
 */
export async function* iteratePages<T>(
  fetchPage: (cursor: string | undefined) => Promise<IteratorPage<T>>,
  options: PaginatorOptions = {},
): AsyncGenerator<T, void, undefined> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  if (!Number.isFinite(maxPages) || maxPages < 1) {
    throw new RangeError(
      `maxPages must be a positive number, received ${String(maxPages)}`,
    );
  }

  let cursor = options.startCursor;

  // Every cursor this loop has already sent as a request. Membership is the "already seen"
  // test, which catches the echo whether the echo is of the current cursor or of one from
  // several pages back.
  const requested = new Set<string | undefined>([cursor]);

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);

    for (const item of result.items) {
      yield item;
    }

    const next = result.nextCursor ?? undefined;

    // No cursor: the server says there is nothing more to fetch.
    if (next === undefined || next === null || next === "") {
      return;
    }

    // A cursor we have already sent. A server echoing the last cursor would otherwise make
    // this loop non-terminating, which is the failure the caller's own version had.
    if (requested.has(next)) {
      return;
    }

    requested.add(next);
    cursor = next;
  }
}

/**
 * Collect every item across every page into a single array.
 *
 * A convenience over {@link iteratePages} for callers that want the whole set rather than a
 * stream. `maxPages` still applies, because the bound is what makes the call safe — a
 * collector is exactly the caller that cannot stop early and so needs the ceiling most.
 */
export async function collectPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<IteratorPage<T>>,
  options: PaginatorOptions = {},
): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iteratePages(fetchPage, options)) {
    items.push(item);
  }

  return items;
}
