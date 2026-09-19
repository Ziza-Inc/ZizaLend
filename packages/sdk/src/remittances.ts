/**
 * Remittances module.
 *
 * Cross-border payment operations via Stellar blockchain.
 */

import type { components } from "@zizalend/types";

import { Client } from "./client.js";
import {
  collectPages,
  iteratePages,
  type PaginatorOptions,
} from "./pagination.js";

// Spec-derived, as in `loans.ts`.
export type Remittance = components["schemas"]["Remittance"];

export type RemittanceResponse = components["schemas"]["RemittanceResponse"];

export type CreateRemittanceInput =
  components["schemas"]["CreateRemittanceInput"];

export type PaginatedRemittancesResponse =
  components["schemas"]["PaginatedRemittancesResponse"];

export type SubmittedTransactionResponse =
  components["schemas"]["SubmittedTransactionResponse"];

export class Remittances {
  constructor(private client: Client) {}

  /**
   * Get remittances for the authenticated user.
   */
  async list(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<PaginatedRemittancesResponse> {
    return this.client.get<PaginatedRemittancesResponse>(
      "/remittances",
      params,
    );
  }

  /**
   * Iterate every remittance, page by page.
   *
   *     for await (const remittance of client.remittances.iterate()) { ... }
   *
   * Stops when the cursor is exhausted, when the server repeats a cursor, or after `maxPages`
   * pages — the last of which is the only defence against a server that returns a fresh cursor
   * per request without advancing. `list` is unchanged and remains the way to fetch one page.
   */
  async *iterate(
    params?: { limit?: number } & PaginatorOptions,
  ): AsyncGenerator<Remittance, void, undefined> {
    const { maxPages, startCursor, limit } = params ?? {};
    const pageOptions: PaginatorOptions = { maxPages, startCursor };

    yield* iteratePages<Remittance>(async (cursor) => {
      const page = await this.list({ limit, cursor });
      return {
        items: page.data ?? [],
        nextCursor: page.page_info?.next_cursor ?? undefined,
      };
    }, pageOptions);
  }

  /**
   * Fetch every page and return the remittances as one array.
   *
   * `maxPages` still applies, because a collector cannot stop early.
   */
  async collect(
    params?: { limit?: number } & PaginatorOptions,
  ): Promise<Remittance[]> {
    const { maxPages, startCursor, limit } = params ?? {};

    return collectPages<Remittance>(
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

  /**
   * Create a new remittance (builds an unsigned transaction).
   */
  async create(input: CreateRemittanceInput): Promise<RemittanceResponse> {
    return this.client.post<RemittanceResponse>("/remittances", input);
  }

  /**
   * Get a specific remittance by ID.
   */
  async get(id: number): Promise<RemittanceResponse> {
    return this.client.get<RemittanceResponse>(`/remittances/${id}`);
  }

  /**
   * Submit a signed remittance transaction.
   */
  async submitTransaction(
    id: number,
    signedTxXdr: string,
  ): Promise<SubmittedTransactionResponse> {
    return this.client.post<SubmittedTransactionResponse>(
      `/remittances/${id}/submit`,
      {
        signedTxXdr,
      },
    );
  }
}
