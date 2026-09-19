/**
 * Admin module.
 *
 * Administrative operations: audit logs, disputes, governance.
 */

import type { components } from '@zizalend/types';

import { Client } from './client.js';

// Spec-derived, as in `loans.ts`.
export type AuditLogEntry = components['schemas']['AuditLogEntry'];

export type LoanDispute = components['schemas']['LoanDispute'];

export class Admin {
  constructor(private client: Client) {}

  /**
   * List audit logs (admin).
   */
  async listAuditLogs(params?: {
    limit?: number;
    cursor?: string;
    actor?: string;
    action?: string;
  }): Promise<AuditLogEntry[]> {
    const response = await this.client.get<{ success: boolean; data: AuditLogEntry[]; page_info?: unknown }>(
      '/admin/audit-logs',
      params,
    );
    return response.data;
  }

  /**
   * List loan disputes (admin).
   */
  async listLoanDisputes(): Promise<LoanDispute[]> {
    const response = await this.client.get<{ success: boolean; data: LoanDispute[] }>(
      '/admin/loan-disputes',
    );
    return response.data;
  }

  /**
   * Get a specific loan dispute.
   */
  async getLoanDispute(disputeId: number): Promise<LoanDispute> {
    const response = await this.client.get<{ success: boolean; data: LoanDispute }>(
      `/admin/loan-disputes/${disputeId}`,
    );
    return response.data;
  }

  /**
   * Get pending governance proposals.
   */
  async getPendingGovernance(): Promise<unknown> {
    return this.client.get('/admin/governance/pending');
  }
}
