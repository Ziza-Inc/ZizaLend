/**
 * Notifications module.
 *
 * In-app notification management and SSE streaming.
 */

import type { components } from '@zizalend/types';

import { Client } from './client.js';

// Spec-derived, as in `loans.ts`.
export type Notification = components['schemas']['Notification'];

export type NotificationsData = components['schemas']['NotificationsData'];

export type NotificationsResponse =
  components['schemas']['NotificationsResponse'];

export type NotificationPreferences =
  components['schemas']['NotificationPreferences'];

export class Notifications {
  constructor(private client: Client) {}

  /**
   * Get notifications for the authenticated user.
   */
  async list(params?: {
    type?: string;
    status?: 'unread' | 'read' | 'archived';
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<NotificationsData> {
    const response = await this.client.get<NotificationsResponse>('/notifications', params);
    return response.data;
  }

  /**
   * Get the SSE URL for real-time notification streaming.
   */
  getStreamUrl(): string {
    const baseUrl = this.client.getBaseUrl();
    const token = (this.client as unknown as { config: { token?: string } }).config.token;
    const url = new URL(`${baseUrl}/notifications/stream`);
    // SSE endpoints typically use cookie auth, but we include token as fallback
    return url.toString();
  }

  /**
   * Mark specific notifications as read.
   */
  async markRead(ids: number[]): Promise<void> {
    await this.client.post('/notifications/mark-read', { ids });
  }

  /**
   * Mark all notifications as read.
   */
  async markAllRead(): Promise<void> {
    await this.client.post('/notifications/mark-all-read');
  }

  /**
   * Get notification preferences.
   */
  async getPreferences(): Promise<NotificationPreferences> {
    const response = await this.client.get<{ success: boolean; data: NotificationPreferences }>(
      '/notifications/preferences',
    );
    return response.data;
  }

  /**
   * Update notification preferences.
   */
  async updatePreferences(
    preferences: { emailEnabled: boolean; smsEnabled: boolean; phone?: string | null },
  ): Promise<NotificationPreferences> {
    const response = await this.client.put<{ success: boolean; data: NotificationPreferences }>(
      '/notifications/preferences',
      preferences,
    );
    return response.data;
  }
}
