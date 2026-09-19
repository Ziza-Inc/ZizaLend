/**
 * Transactions module.
 *
 * Transaction history for the authenticated user.
 */

import { Client } from "./client.js";
import {
  collectPages,
  iteratePages,
  type PaginatorOptions,
} from "./pagination.js";

export interface Transaction {
  id: number;
  type: string;
  amount: string;
  status: string;
  txHash?: string | null;
  createdAt: string;
}

export interface TransactionsResponse {
  success: boolean;
  data: Transaction[];
  page_info?: {
    limit: number;
    next_cursor?: string | null;
    has_previous?: boolean;
  };
}

export class Transactions {
  constructor(private client: Client) {}

  /**
   * Get the authenticated user's transaction history.
   */
  async list(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<TransactionsResponse> {
    return this.client.get<TransactionsResponse>("/transactions/me", params);
  }

  /**
   * Iterate the whole transaction history, page by page.
   *
   *     for await (const tx of client.transactions.iterate()) { ... }
   *
   * Transaction history is the list most likely to be long enough to matter and the one a
   * caller is most likely to want in full, which is why the loop belongs here rather than in
   * each consumer. `list` is unchanged.
   */
  async *iterate(
    params?: { limit?: number } & PaginatorOptions,
  ): AsyncGenerator<Transaction, void, undefined> {
    const { maxPages, startCursor, limit } = params ?? {};
    const pageOptions: PaginatorOptions = { maxPages, startCursor };

    yield* iteratePages<Transaction>(async (cursor) => {
      const page = await this.list({ limit, cursor });
      return {
        items: page.data ?? [],
        nextCursor: page.page_info?.next_cursor ?? undefined,
      };
    }, pageOptions);
  }

  /**
   * Fetch the whole transaction history as one array.
   *
   * `maxPages` still applies, because a collector cannot stop early.
   */
  async collect(
    params?: { limit?: number } & PaginatorOptions,
  ): Promise<Transaction[]> {
    const { maxPages, startCursor, limit } = params ?? {};

    return collectPages<Transaction>(
      async (cursor) => {
        const page = await this.list({ limit, cursor });
        return {
          items: page.data ?? [],
          nextCursor: page.page_info?.next_cursor ?? undefined,
        };
      },
      { maxPages, startCursor },
    );
  }
}
