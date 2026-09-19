/**
 * Scores module.
 *
 * Credit score queries, breakdowns, history, and updates.
 */

import type { components } from '@zizalend/types';

import { Client } from './client.js';

// Spec-derived, as in `loans.ts`. `UserScore.band` in particular used to be a hand-written
// literal union that the spec happened to agree with; the alias is what keeps it that way.
export type UserScore = components['schemas']['UserScore'];

export type ScoreBreakdownMetrics =
  components['schemas']['ScoreBreakdownMetrics'];

export type ScoreHistoryEntry = components['schemas']['ScoreHistoryEntry'];

export type ScoreBreakdownResponse =
  components['schemas']['ScoreBreakdownResponse'];

export type ScoreUpdateResponse = components['schemas']['ScoreUpdateResponse'];

export class Scores {
  constructor(private client: Client) {}

  /**
   * Get the credit score for a user.
   */
  async get(userId: string): Promise<UserScore> {
    return this.client.get<UserScore>(`/score/${userId}`);
  }

  /**
   * Get detailed score breakdown with metrics and history.
   */
  async getBreakdown(userId: string): Promise<ScoreBreakdownResponse> {
    return this.client.get<ScoreBreakdownResponse>(`/score/${userId}/breakdown`);
  }

  /**
   * Get score history timeline.
   */
  async getHistory(userId: string): Promise<ScoreHistoryEntry[]> {
    const response = await this.client.get<{ success: boolean; data: ScoreHistoryEntry[] }>(
      `/score/${userId}/history`,
    );
    return response.data;
  }

  /**
   * Update a user's score (internal - requires API key).
   */
  async update(
    userId: string,
    params: { repaymentAmount: number; onTime: boolean },
  ): Promise<ScoreUpdateResponse> {
    return this.client.post<ScoreUpdateResponse>('/score/update', {
      userId,
      ...params,
    });
  }
}
