/**
 * Pool module.
 *
 * Lending pool operations: stats, deposits, withdrawals, yield history.
 */

import type { components } from '@zizalend/types';

import { Client } from './client.js';

// Spec-derived, as in `loans.ts`: these names are schema names in `packages/openapi.json`.
export type PoolStats = components['schemas']['PoolStats'];

export type PoolStatsResponse = components['schemas']['PoolStatsResponse'];

export type DepositorPortfolio = components['schemas']['DepositorPortfolio'];

export type DepositorPortfolioResponse =
  components['schemas']['DepositorPortfolioResponse'];

export type SharePriceResponse = components['schemas']['SharePriceResponse'];

export interface BuildPoolTxParams {
  depositorPublicKey: string;
  token: string;
  amount: string;
}

export type UnsignedTransactionResponse =
  components['schemas']['UnsignedTransactionResponse'];

export type SubmittedTransactionResponse =
  components['schemas']['SubmittedTransactionResponse'];

export class Pool {
  constructor(private client: Client) {}

  /**
   * Get lending pool statistics.
   */
  async getStats(): Promise<PoolStats> {
    const response = await this.client.get<PoolStatsResponse>('/pool/stats');
    return response.data;
  }

  /**
   * Get the authenticated user's depositor portfolio.
   */
  async getPortfolio(): Promise<DepositorPortfolio> {
    const response = await this.client.get<DepositorPortfolioResponse>('/pool/portfolio');
    return response.data;
  }

  /**
   * Get the current share price for a token.
   */
  async getSharePrice(token: string): Promise<SharePriceResponse['data']> {
    const response = await this.client.get<SharePriceResponse>('/pool/share-price', { token });
    return response.data;
  }

  /**
   * Get yield history for the authenticated depositor.
   */
  async getYieldHistory(params?: { token?: string; days?: number }): Promise<unknown> {
    return this.client.get('/pool/yield-history', params);
  }

  /**
   * Build an unsigned deposit transaction.
   */
  async buildDepositTx(params: BuildPoolTxParams): Promise<UnsignedTransactionResponse> {
    return this.client.post<UnsignedTransactionResponse>('/pool/deposit', params);
  }

  /**
   * Build an unsigned withdraw transaction.
   */
  async buildWithdrawTx(params: BuildPoolTxParams): Promise<UnsignedTransactionResponse> {
    return this.client.post<UnsignedTransactionResponse>('/pool/withdraw', params);
  }

  /**
   * Build an unsigned emergency withdraw transaction.
   */
  async buildEmergencyWithdrawTx(): Promise<UnsignedTransactionResponse> {
    return this.client.post<UnsignedTransactionResponse>('/pool/emergency-withdraw');
  }

  /**
   * Submit a signed pool transaction.
   */
  async submitTransaction(signedTxXdr: string): Promise<SubmittedTransactionResponse> {
    return this.client.post<SubmittedTransactionResponse>('/pool/submit', {
      signedTxXdr,
    });
  }
}
