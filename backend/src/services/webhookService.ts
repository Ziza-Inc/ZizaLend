import crypto from 'node:crypto';
import { query } from '../db/connection.js';
import logger from '../utils/logger.js';
import { UnsafeWebhookUrlError, assertSafeWebhookUrl } from '../utils/webhookUrlGuard.js';

export const SUPPORTED_WEBHOOK_EVENT_TYPES = [
  'LoanRequested',
  'LoanApproved',
  'LoanRepaid',
  'LoanDefaulted',
  'CollateralLiquidated',
  'CollateralReturned',
  'CollateralDeposited',
  'CollateralReleased',
  'ColDep',
  'ColRel',
  'LateFeeCharged',
  'LoanExtended',
  'LoanCancelled',
  'LoanRejected',
  'LoanRefinanced',
  'InterestRateUpdated',
  'DefaultTermUpdated',
  'TermLimitsUpdated',
  'LateFeeRateUpdated',
  'GracePeriodUpdated',
  'DefaultWindowUpdated',
  'MaxLoanAmountUpdated',
  'MinRepaymentUpdated',
  'MaxLoansPerBorrower',
  'MinRateBpsUpdated',
  'MaxRateBpsUpdated',
  'RateOracleUpdated',
  'Deposit',
  'Withdraw',
  'YieldDistributed',
  'EmergencyWithdraw',
  'DepositCapUpdated',
  'WithdrawalCooldownUpdated',
  'NFTMinted',
  'ScoreUpdated',
  'NFTSeized',
  'NFTBurned',
  'ProposalCreated',
  'ProposalApproved',
  'ProposalFinalized',
  'ProposalCancelled',
  'LoanApprv',
  'LoanLiquidated',
  // Legacy aliases kept to preserve compatibility for existing subscribers.
  'Mint',
  'ScoreUpd',
  'ScoreDecr',
  'Seized',
  'NftBurned',
  'AdmRemint',
  'HashUpd',
  'GovProp',
  'GovAppr',
  'GovFin',
  'Transfer',
  'MntAuth',
  'MntRev',
  'Paused',
  'Unpaused',
  'MinScoreUpdated',
  'PoolPaused',
  'PoolUnpaused',
  'GovCncl',
  'GovEmerg',
  'GovExp',
] as const;

export type WebhookEventType = (typeof SUPPORTED_WEBHOOK_EVENT_TYPES)[number];

export interface IndexedLoanEvent {
  eventId: string;
  eventType: WebhookEventType;
  loanId?: number;
  address?: string;
  amount?: string;
  interestRateBps?: number;
  termLedgers?: number;
  ledger: number;
  ledgerClosedAt: Date;
  txHash: string;
  contractId: string;
  topics: string[];
  value: string;
}

export interface WebhookSubscription {
  id: number;
  callbackUrl: string;
  eventTypes: WebhookEventType[];
  secret?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery {
  id: number;
  subscriptionId: number;
  eventId: string;
  eventType: WebhookEventType;
  attemptCount: number;
  lastStatusCode?: number;
  lastError?: string;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface RegisterWebhookInput {
  callbackUrl: string;
  eventTypes: WebhookEventType[];
  secret?: string;
}

interface PreparedWebhookPayload {
  body: string;
  payload: Record<string, unknown>;
}

/** Row shape returned by webhook_deliveries JOIN webhook_subscriptions queries. */
interface PendingRetryRow {
  id: number;
  subscription_id: number;
  callback_url: string;
  secret: string | null;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
}

/** Row shape returned by webhook_subscriptions queries. */
interface WebhookSubscriptionRow {
  id: number;
  callback_url: string;
  event_types: string | string[];
  secret: string | null;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

/** Row shape returned by webhook_deliveries queries. */
interface WebhookDeliveryRow {
  id: number;
  subscription_id: number;
  event_id: string;
  event_type: string;
  attempt_count: number;
  last_status_code?: number | null;
  last_error?: string | null;
  delivered_at?: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  payload?: string;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getWebhookRequestTimeoutMs(): number {
  return parsePositiveInt(process.env.WEBHOOK_REQUEST_TIMEOUT_MS, 30 * 1000);
}

function getWebhookMaxPayloadBytes(): number {
  return parsePositiveInt(process.env.WEBHOOK_MAX_PAYLOAD_BYTES, 64 * 1024);
}

/**
 * Redirect statuses a delivery follows itself.
 *
 * `redirect: 'follow'` hands the chain to the runtime, which walks it without asking: a public
 * endpoint that redirects to `http://169.254.169.254/latest/meta-data/` would be fetched before
 * any check could refuse it. So the chain is followed by hand, one vetted hop at a time.
 */
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/** How many redirect hops a delivery follows before it is treated as a failure. */
export const MAX_WEBHOOK_REDIRECTS = 5;

/**
 * How much of a response body is read before the rest is abandoned.
 *
 * Not a value the caller ever looks at: the status code is the whole result of a delivery. The
 * cap exists so a hostile or merely talkative endpoint cannot make the worker buffer an
 * unbounded body, which is the one part of the exchange the subscriber still controls.
 */
const WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Read at most the cap, then abandon the rest.
 *
 * A webhook response is never used, so this is about releasing the connection rather than
 * getting any bytes: leaving a body unread keeps the socket open until the response is
 * collected, and a redirect has to free its connection before the next hop.
 */
async function discardResponseBody(response: Response): Promise<void> {
  const bodyStream = response.body;
  if (!bodyStream) return;

  const reader = bodyStream.getReader();
  let read = 0;

  try {
    while (read < WEBHOOK_MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done) return;
      read += value?.byteLength ?? 0;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function summarizeOversizedPayload(
  payload: Record<string, unknown>,
  originalPayloadBytes: number,
  maxPayloadBytes: number,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    truncated: true,
    reason: 'payload_too_large',
    originalPayloadBytes,
    maxPayloadBytes,
  };

  const passthroughKeys = ['eventId', 'eventType', 'loanId', 'address', 'ledger'] as const;

  for (const key of passthroughKeys) {
    const value = payload[key];
    if (value !== undefined) {
      summary[key] = value;
    }
  }

  if (Array.isArray(payload.topics)) {
    summary.topicsCount = payload.topics.length;
  }

  return summary;
}

function summarizeOversizedPayloadMinimal(
  payload: Record<string, unknown>,
  originalPayloadBytes: number,
  maxPayloadBytes: number,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    truncated: true,
    reason: 'payload_too_large',
    originalPayloadBytes,
    maxPayloadBytes,
  };

  if (typeof payload.eventId === 'string') {
    summary.eventId = payload.eventId;
  }
  if (typeof payload.eventType === 'string') {
    summary.eventType = payload.eventType;
  }

  return summary;
}

function prepareWebhookPayload(payload: Record<string, unknown>): PreparedWebhookPayload {
  const body = JSON.stringify(payload);
  const payloadBytes = Buffer.byteLength(body);
  const maxPayloadBytes = getWebhookMaxPayloadBytes();
  const eventId = typeof payload.eventId === 'string' ? payload.eventId : undefined;
  const eventType = typeof payload.eventType === 'string' ? payload.eventType : undefined;

  if (payloadBytes > maxPayloadBytes) {
    let summarizedPayload = summarizeOversizedPayload(payload, payloadBytes, maxPayloadBytes);
    let summarizedBody = JSON.stringify(summarizedPayload);

    if (Buffer.byteLength(summarizedBody) > maxPayloadBytes) {
      summarizedPayload = summarizeOversizedPayloadMinimal(payload, payloadBytes, maxPayloadBytes);
      summarizedBody = JSON.stringify(summarizedPayload);
    }

    if (Buffer.byteLength(summarizedBody) > maxPayloadBytes) {
      throw new Error(
        `Webhook summary payload exceeds configured limit of ${maxPayloadBytes} bytes`,
      );
    }

    logger.withContext().warn('Webhook payload exceeds size limit, sending summary payload', {
      eventId,
      eventType,
      payloadBytes,
      maxPayloadBytes,
    });

    return {
      body: summarizedBody,
      payload: summarizedPayload,
    };
  }

  if (payloadBytes >= Math.floor(maxPayloadBytes * 0.9)) {
    logger.withContext().warn('Webhook payload is near size limit', {
      eventId,
      eventType,
      payloadBytes,
      maxPayloadBytes,
    });
  }

  return {
    body,
    payload,
  };
}

async function postWebhook(
  callbackUrl: string,
  body: string,
  signature: string | undefined,
): Promise<Response> {
  const timeoutMs = getWebhookRequestTimeoutMs();
  const controller = new AbortController();
  // One budget for the whole exchange, redirects included, so a chain of slow hops cannot
  // outlive the timeout each hop would otherwise get of its own.
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  timeoutHandle.unref?.();

  try {
    // Vetted here and not only at subscription time: a hostname that resolved publicly when it
    // was registered can resolve privately now, and a stored URL is not evidence about the
    // network it currently points at.
    //
    // The vetted URL is deliberately not the one that gets fetched. `new URL(...).toString()`
    // appends a trailing slash, and a subscriber that routes on an empty path would start
    // receiving deliveries at a different path than the one it registered.
    await assertSafeWebhookUrl(callbackUrl);
    let currentUrl = callbackUrl;

    for (let hop = 0; ; hop += 1) {
      const response = await fetch(currentUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // X-ZizaLend-Signature uses the GitHub/Stripe-style "sha256=<hex>"
          // format so subscribers can verify payload integrity (see
          // docs/wiki/webhook-signatures.md for the verification recipe).
          ...(signature && { 'x-ZizaLend-signature': `sha256=${signature}` }),
        },
        body,
        signal: controller.signal,
        redirect: 'manual',
      });

      const isRedirect = REDIRECT_STATUS_CODES.has(response.status);
      const location = isRedirect ? (response.headers?.get?.('location') ?? null) : null;

      await discardResponseBody(response);

      if (!isRedirect || !location) return response;

      if (hop >= MAX_WEBHOOK_REDIRECTS) {
        throw new Error(
          `Webhook redirect chain exceeded ${MAX_WEBHOOK_REDIRECTS} hops (last: ${currentUrl})`,
        );
      }

      // Each hop is vetted on its own, so a redirect to a private address is refused exactly
      // where a direct request to one would be.
      const next = new URL(location, currentUrl);
      currentUrl = (await assertSafeWebhookUrl(next.toString())).toString();
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Webhook request timed out after ${timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// Retry configuration for webhook delivery.
// This yields retry attempts at ~5m, ~15m, and ~45m after a failed delivery,
// for a total retry window a little over one hour after the initial attempt.
const RETRY_DELAYS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 45 * 60 * 1000] as const;

const MAX_RETRY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export const getRetryDelayMs = (attemptNumber: number): number => {
  const delayIndex = Math.min(attemptNumber - 1, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[delayIndex] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
};

export class WebhookService {
  /**
   * Retry processor that polls for pending retries.
   *
   * Webhooks are not covered by user notification preferences and do not need to be: a
   * subscription carries its own `is_active` switch and its own `event_types`, and it
   * belongs to the deployment rather than to a user (there is no owner column). That
   * switch is therefore the one this processor has to honour, and the join below filters
   * on it — without that filter a deactivated subscription kept receiving every delivery
   * that was already queued, so muting a webhook only stopped *new* events and left the
   * backlog flowing.
   */
  static async processRetries(): Promise<void> {
    logger.withContext().info('Starting webhook retry processor');

    try {
      const now = new Date();
      const result = await query(
        `SELECT id, subscription_id, callback_url, secret, event_id, event_type, 
                payload, attempt_count
         FROM webhook_deliveries wd
         JOIN webhook_subscriptions ws ON wd.subscription_id = ws.id
         WHERE wd.delivered_at IS NULL 
           AND wd.next_retry_at IS NOT NULL
           AND wd.next_retry_at <= $1
           AND wd.attempt_count < $2
           -- A deactivated subscription stops its queued retries as well as its new
           -- events. Deliveries for a deleted subscription cannot appear here at all:
           -- the foreign key cascades.
           AND ws.is_active = true
         ORDER BY wd.next_retry_at ASC
         LIMIT 100`,
        [now, MAX_RETRY_ATTEMPTS],
      );

      if (result.rows.length === 0) {
        logger.debug('No pending webhook retries');
        return;
      }

      logger.withContext().info(`Processing ${result.rows.length} pending webhook retries`);

      for (const delivery of result.rows as PendingRetryRow[]) {
        // Defensive circuit breaker: the SQL filter above already excludes
        // deliveries at the retry ceiling, but guard here too so a delivery
        // at MAX_RETRY_ATTEMPTS is never re-sent even if it slips through.
        if (delivery.attempt_count >= MAX_RETRY_ATTEMPTS) {
          continue;
        }
        await WebhookService.retryWebhookDelivery(
          delivery.id,
          delivery.subscription_id,
          delivery.callback_url,
          delivery.secret || undefined,
          delivery.event_id,
          delivery.event_type as WebhookEventType,
          delivery.payload,
          delivery.attempt_count,
        );
      }
    } catch (error) {
      logger.withContext().error('Error in webhook retry processor', { error });
    }
  }

  public static async retryWebhookDelivery(
    deliveryId: number,
    subscriptionId: number,
    callbackUrl: string,
    secret: string | undefined,
    eventId: string,
    _eventType: WebhookEventType,
    payload: Record<string, unknown>,
    attemptCount: number,
  ): Promise<void> {
    const preparedPayload = prepareWebhookPayload(payload);
    const body = preparedPayload.body;

    const signature = secret
      ? crypto.createHmac('sha256', secret).update(body).digest('hex')
      : undefined;

    let response: Response | null;

    try {
      response = await postWebhook(callbackUrl, body, signature);

      const successful = response.ok;
      const newAttemptCount = attemptCount + 1;

      if (successful) {
        // Mark as delivered
        await query(
          `UPDATE webhook_deliveries 
           SET attempt_count = $1, 
               last_status_code = $2, 
               delivered_at = $3,
               last_error = NULL,
               next_retry_at = NULL,
               updated_at = $4
           WHERE id = $5`,
          [newAttemptCount, response.status, new Date(), new Date(), deliveryId],
        );

        logger.withContext().info('Webhook delivery succeeded after retry', {
          deliveryId,
          subscriptionId,
          eventId,
          attemptCount: newAttemptCount,
        });
      } else {
        // Schedule next retry or mark as permanently failed
        const nextRetryTime =
          newAttemptCount < MAX_RETRY_ATTEMPTS
            ? new Date(Date.now() + getRetryDelayMs(newAttemptCount))
            : null;

        const errorMsg = `Webhook returned status ${response.status}`;
        await query(
          `UPDATE webhook_deliveries 
           SET attempt_count = $1, 
               last_status_code = $2, 
               last_error = $3,
               next_retry_at = $4,
               updated_at = $5
           WHERE id = $6`,
          [newAttemptCount, response.status, errorMsg, nextRetryTime, new Date(), deliveryId],
        );

        if (nextRetryTime) {
          logger.withContext().warn('Webhook delivery failed, scheduled retry', {
            deliveryId,
            subscriptionId,
            eventId,
            attemptCount: newAttemptCount,
            statusCode: response.status,
            nextRetryAt: nextRetryTime,
          });
        } else {
          logger.withContext().error('Webhook delivery permanently failed after max retries', {
            deliveryId,
            subscriptionId,
            eventId,
            attemptCount: newAttemptCount,
            statusCode: response.status,
            payload: body,
          });
        }
      }
    } catch (error) {
      // A refused destination is terminal, and it did not consume an attempt: nothing was sent,
      // and re-resolving a name that points somewhere private only repeats the refusal.
      const refused = error instanceof UnsafeWebhookUrlError;
      const newAttemptCount = refused ? attemptCount : attemptCount + 1;
      const nextRetryTime = refused
        ? null
        : newAttemptCount < MAX_RETRY_ATTEMPTS
          ? new Date(Date.now() + getRetryDelayMs(newAttemptCount))
          : null;

      const errorMsg = error instanceof Error ? error.message : 'Unknown webhook error';

      await query(
        `UPDATE webhook_deliveries 
         SET attempt_count = $1, 
             last_error = $2,
             next_retry_at = $3,
             updated_at = $4
         WHERE id = $5`,
        [newAttemptCount, errorMsg, nextRetryTime, new Date(), deliveryId],
      );

      if (refused) {
        logger.withContext().error('Refused to deliver a webhook to an unsafe URL', {
          deliveryId,
          subscriptionId,
          eventId,
          reason: (error as UnsafeWebhookUrlError).reason,
          error,
        });
      } else if (nextRetryTime) {
        logger.withContext().warn('Webhook delivery error, scheduled retry', {
          deliveryId,
          subscriptionId,
          eventId,
          attemptCount: newAttemptCount,
          error,
          nextRetryAt: nextRetryTime,
        });
      } else {
        logger.withContext().error('Webhook delivery permanently failed after max retries', {
          deliveryId,
          subscriptionId,
          eventId,
          attemptCount: newAttemptCount,
          error,
        });
      }
    }
  }
  static isSupported(type: string): type is WebhookEventType {
    return SUPPORTED_WEBHOOK_EVENT_TYPES.includes(type as WebhookEventType);
  }

  async registerSubscription(input: RegisterWebhookInput): Promise<WebhookSubscription> {
    const result = await query(
      `INSERT INTO webhook_subscriptions (callback_url, event_types, secret, is_active)
       VALUES ($1, $2::jsonb, $3, true)
       RETURNING id, callback_url, event_types, secret, is_active, created_at, updated_at`,
      [input.callbackUrl, JSON.stringify(input.eventTypes), input.secret ?? null],
    );

    return this.mapSubscriptionRow(result.rows[0] as WebhookSubscriptionRow);
  }

  async listSubscriptions(): Promise<WebhookSubscription[]> {
    const result = await query(
      `SELECT id, callback_url, event_types, secret, is_active, created_at, updated_at
       FROM webhook_subscriptions
       ORDER BY created_at DESC`,
      [],
    );

    return result.rows.map((row) => this.mapSubscriptionRow(row as WebhookSubscriptionRow));
  }

  async deleteSubscription(id: number): Promise<boolean> {
    const result = await query(
      `DELETE FROM webhook_subscriptions
       WHERE id = $1`,
      [id],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async getSubscriptionDeliveries(
    subscriptionId: number,
    limit: number = 50,
  ): Promise<WebhookDelivery[]> {
    const result = await query(
      `SELECT id, subscription_id, event_id, event_type, attempt_count, last_status_code,
              last_error, delivered_at, created_at, updated_at
       FROM webhook_deliveries
       WHERE subscription_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [subscriptionId, limit],
    );

    return result.rows.map((row) => this.mapDeliveryRow(row as WebhookDeliveryRow));
  }

  async dispatch(event: IndexedLoanEvent): Promise<void> {
    logger.withContext().info('Dispatching webhook event', {
      eventId: event.eventId,
      eventType: event.eventType,
      loanId: event.loanId,
      address: event.address,
    });

    try {
      const preparedPayload = prepareWebhookPayload(event as unknown as Record<string, unknown>);

      const webhooksResult = await query(
        `SELECT id, callback_url, secret
         FROM webhook_subscriptions
         WHERE is_active = true
           AND event_types @> $1::jsonb`,
        [JSON.stringify([event.eventType])],
      );

      await Promise.all(
        webhooksResult.rows.map((hook) => {
          const h = hook as { id: number; callback_url: string; secret: string | null };
          return this.sendToWebhook(
            Number(h.id),
            String(h.callback_url),
            h.secret ?? undefined,
            preparedPayload,
          );
        }),
      );
    } catch (error) {
      logger.withContext().error('Error during webhook dispatch', {
        eventId: event.eventId,
        eventType: event.eventType,
        error,
      });
    }
  }

  private async sendToWebhook(
    subscriptionId: number,
    callbackUrl: string,
    secret: string | undefined,
    payload: PreparedWebhookPayload,
  ): Promise<void> {
    const body = payload.body;

    const signature = secret
      ? crypto.createHmac('sha256', secret).update(body).digest('hex')
      : undefined;

    try {
      const response = await postWebhook(callbackUrl, body, signature);

      const successful = response.ok;

      if (successful) {
        // Delivery succeeded, mark as delivered
        await query(
          `INSERT INTO webhook_deliveries (
            subscription_id,
            event_id,
            event_type,
            attempt_count,
            last_status_code,
            delivered_at,
            payload,
            next_retry_at
          )
          VALUES ($1, $2, $3, 1, $4, $5, $6::jsonb, NULL)`,
          [
            subscriptionId,
            payload.payload.eventId,
            payload.payload.eventType,
            response.status,
            new Date(),
            body,
          ],
        );
      } else {
        // Delivery failed, schedule first retry
        const nextRetryAt = new Date(Date.now() + getRetryDelayMs(1));
        await query(
          `INSERT INTO webhook_deliveries (
            subscription_id,
            event_id,
            event_type,
            attempt_count,
            last_status_code,
            last_error,
            payload,
            next_retry_at
          )
          VALUES ($1, $2, $3, 1, $4, $5, $6::jsonb, $7)`,
          [
            subscriptionId,
            payload.payload.eventId,
            payload.payload.eventType,
            response.status,
            `Webhook returned status ${response.status}`,
            body,
            nextRetryAt,
          ],
        );

        logger.withContext().warn('Webhook delivery failed, scheduled retry', {
          subscriptionId,
          callbackUrl,
          eventId: payload.payload.eventId,
          statusCode: response.status,
          nextRetryAt,
        });
      }
    } catch (error) {
      if (error instanceof UnsafeWebhookUrlError) {
        // Recorded with `attempt_count = 0` and no retry: no request was made, and no later one
        // would be either. The row is kept so the destination is visible as refused rather than
        // as a delivery that silently never happened.
        await query(
          `INSERT INTO webhook_deliveries (
            subscription_id,
            event_id,
            event_type,
            attempt_count,
            last_error,
            payload,
            next_retry_at
          )
          VALUES ($1, $2, $3, 0, $4, $5::jsonb, NULL)`,
          [subscriptionId, payload.payload.eventId, payload.payload.eventType, error.message, body],
        );

        logger.withContext().error('Refused to deliver a webhook to an unsafe URL', {
          subscriptionId,
          callbackUrl,
          eventId: payload.payload.eventId,
          reason: error.reason,
          error,
        });

        return;
      }

      // Network error or timeout, schedule first retry
      const nextRetryAt = new Date(Date.now() + getRetryDelayMs(1));
      await query(
        `INSERT INTO webhook_deliveries (
          subscription_id,
          event_id,
          event_type,
          attempt_count,
          last_error,
          payload,
          next_retry_at
        )
        VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6)`,
        [
          subscriptionId,
          payload.payload.eventId,
          payload.payload.eventType,
          error instanceof Error ? error.message : 'Unknown webhook error',
          body,
          nextRetryAt,
        ],
      );

      logger.withContext().error('Failed to send webhook, scheduled retry', {
        subscriptionId,
        callbackUrl,
        eventId: payload.payload.eventId,
        error,
        nextRetryAt,
      });
    }
  }

  private mapSubscriptionRow(row: WebhookSubscriptionRow): WebhookSubscription {
    const secret = typeof row.secret === 'string' && row.secret.length > 0 ? row.secret : undefined;

    return {
      id: Number(row.id),
      callbackUrl: String(row.callback_url),
      eventTypes: (row.event_types as WebhookEventType[]) ?? [],
      ...(secret ? { secret } : {}),
      isActive: Boolean(row.is_active),
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    };
  }

  private mapDeliveryRow(row: WebhookDeliveryRow): WebhookDelivery {
    const lastStatusCode =
      typeof row.last_status_code === 'number'
        ? row.last_status_code
        : row.last_status_code !== null && row.last_status_code !== undefined
          ? Number(row.last_status_code)
          : undefined;

    const lastError =
      typeof row.last_error === 'string' && row.last_error.length > 0 ? row.last_error : undefined;

    const deliveredAt = row.delivered_at ? new Date(String(row.delivered_at)) : undefined;

    return {
      id: Number(row.id),
      subscriptionId: Number(row.subscription_id),
      eventId: String(row.event_id),
      eventType: String(row.event_type) as WebhookEventType,
      attemptCount: Number(row.attempt_count ?? 1),
      ...(lastStatusCode !== undefined ? { lastStatusCode } : {}),
      ...(lastError ? { lastError } : {}),
      ...(deliveredAt ? { deliveredAt } : {}),
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    };
  }
}

export const webhookService = new WebhookService();
