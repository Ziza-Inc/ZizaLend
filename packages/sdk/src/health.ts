/**
 * Health check module.
 */

import type { components } from '@zizalend/types';

import { Client } from './client.js';

// Spec-derived, as in `loans.ts`. The nested check statuses used to be hand-written literal
// unions here; they now come from the spec's enums, which is where the backend's actual values
// are recorded.
export type HealthCheckResponse = components['schemas']['HealthCheckResponse'];

export type DeepHealthCheckResponse =
  components['schemas']['DeepHealthCheckResponse'];

export type VersionResponse = components['schemas']['VersionResponse'];

export class Health {
  constructor(private client: Client) {}

  /**
   * Basic health check.
   */
  async check(): Promise<HealthCheckResponse> {
    return this.client.get<{ status: string; checks: HealthCheckResponse['checks']; uptime: number; timestamp: number }>('/health') as unknown as Promise<HealthCheckResponse>;
  }

  /**
   * Deep health check with dependency-by-dependency status.
   */
  async deepCheck(): Promise<DeepHealthCheckResponse> {
    return this.client.get<DeepHealthCheckResponse>('/health/deep') as unknown as Promise<DeepHealthCheckResponse>;
  }

  /**
   * Get version and build metadata.
   */
  async getVersion(): Promise<VersionResponse> {
    return this.client.get<VersionResponse>('/version') as unknown as Promise<VersionResponse>;
  }
}
