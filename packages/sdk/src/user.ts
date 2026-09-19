/**
 * User module.
 *
 * User profile management.
 */

import type { components } from '@zizalend/types';

import { Client } from './client.js';

// Spec-derived, as in `loans.ts`.
export type UserProfile = components['schemas']['UserProfile'];

export type UpdateUserProfileInput =
  components['schemas']['UpdateUserProfileInput'];

export class User {
  constructor(private client: Client) {}

  /**
   * Get the authenticated user's profile.
   */
  async getProfile(): Promise<UserProfile> {
    const response = await this.client.get<{ success: boolean; data: UserProfile }>('/user/profile');
    return response.data;
  }

  /**
   * Update the authenticated user's profile.
   */
  async updateProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
    const response = await this.client.patch<{ success: boolean; data: UserProfile }>(
      '/user/profile',
      input,
    );
    return response.data;
  }
}
