import type { NextFunction, Request, Response } from 'express';
import client from 'prom-client';
import { query } from '../db/connection.js';
import logger from '../utils/logger.js';
import {
  UNMATCHED_ROUTE,
  normaliseMethod,
  normaliseRouteLabel,
  normaliseStatusCode,
  statusClassFor,
} from './metricsLabels.js';

export const metricsRegistry = new client.Registry();

client.collectDefaultMetrics({ register: metricsRegistry });

export const indexerLastLedgerGauge = new client.Gauge({
  name: 'indexer_last_ledger',
  help: 'Last ledger successfully processed by the event indexer.',
  registers: [metricsRegistry],
});

export const indexerChainTipGauge = new client.Gauge({
  name: 'indexer_chain_tip',
  help: 'Latest ledger observed from the chain RPC.',
  registers: [metricsRegistry],
});

export const indexerLagLedgersGauge = new client.Gauge({
  name: 'indexer_lag_ledgers',
  help: 'Difference between the latest chain ledger and the last indexed ledger.',
  registers: [metricsRegistry],
});

export const webhookRetryQueueDepthGauge = new client.Gauge({
  name: 'webhook_retry_queue_depth',
  help: 'Number of webhook deliveries currently waiting for retry.',
  registers: [metricsRegistry],
});

export const scoreReconciliationLastRunTimestampGauge = new client.Gauge({
  name: 'score_reconciliation_last_run_timestamp',
  help: 'Unix timestamp in seconds for the last score reconciliation run.',
  registers: [metricsRegistry],
});

export const httpRequestDurationHistogram = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status_class'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

/**
 * Total requests handled, labelled by route template and exact status code.
 * The duration histogram only carries a status *class* (2xx/4xx/...), which is
 * too coarse to alert on (e.g. a spike in 401s or 429s is invisible).
 */
export const httpRequestsTotalCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests handled, labelled by method, route and status code.',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

/** Requests currently being processed; a proxy for saturation and stuck handlers. */
export const httpRequestsInFlightGauge = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Number of HTTP requests currently being processed.',
  registers: [metricsRegistry],
});

/**
 * The `route` label for a request: the matched template, with its mount prefix restored.
 *
 * `/api/v1/loans/1012` becomes `/api/v1/loans/:loanId`, so one series covers every loan while the
 * API version and the router stay distinguishable — reading `req.baseUrl` at this point would not,
 * because a router restores it as it unwinds and an async handler unwinds before it responds, which
 * collapses every router's `:loanId` route into a single `/:loanId` series.
 *
 * `req.route.path` is relative to the router that matched, and `req.path` is the full request path
 * — rewritten back to its original form on the same unwind that clears `baseUrl`. The two are
 * aligned from the right, which is where the matched template sits: the segments the template spells
 * out take its values, and whatever precedes them is the mount path, which comes from configuration
 * rather than from the request.
 *
 * A request that matched nothing has no template, and its real path is attacker-controlled — a
 * scanner walking `/wp-admin/<random>` would create a time series per request — so it is reported as
 * `unmatched`. `normaliseRouteLabel` is then the last line of defence: it collapses anything
 * resource-shaped that survives, as happens when a router is mounted under a parameterised path.
 */
function routeLabel(req: Request): string {
  const routePath = req.route?.path;

  if (Array.isArray(routePath)) {
    return normaliseRouteLabel(`${req.baseUrl}${routePath.join('|')}`);
  }

  if (typeof routePath !== 'string') return UNMATCHED_ROUTE;

  const templateSegments = routePath.split('/').filter((segment) => segment !== '');
  const actualSegments = req.path.split('/').filter((segment) => segment !== '');

  // A wildcard or an inline pattern cannot be aligned segment for segment, and a template longer
  // than the path it matched is not one of ours; both fall back to the router-relative template,
  // which is still bounded.
  const alignable =
    templateSegments.length > 0 &&
    templateSegments.length <= actualSegments.length &&
    !templateSegments.some((segment) => segment.includes('*') || segment.includes('('));

  if (!alignable) return normaliseRouteLabel(routePath);

  const prefix = actualSegments.slice(0, actualSegments.length - templateSegments.length);

  return normaliseRouteLabel(`/${[...prefix, ...templateSegments].join('/')}`);
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const endTimer = httpRequestDurationHistogram.startTimer();
  httpRequestsInFlightGauge.inc();

  let finalized = false;
  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    httpRequestsInFlightGauge.dec();
  };

  res.on('finish', () => {
    // Each of these is normalised against a declared domain in `metricsLabels.ts`; see that module
    // for why an unbounded label is the failure mode being avoided.
    const route = routeLabel(req);
    const method = normaliseMethod(req.method);
    const statusCode = res.statusCode;

    endTimer({
      method,
      route,
      status_class: statusClassFor(statusCode),
    });
    httpRequestsTotalCounter.inc({ method, route, status_code: normaliseStatusCode(statusCode) });

    finalize();
  });

  // Aborted requests never emit 'finish'; release the in-flight slot so the
  // gauge does not drift upwards on client disconnects.
  res.on('close', finalize);

  next();
}

export function recordIndexerLedgers(lastLedger: number, chainTip: number): void {
  indexerLastLedgerGauge.set(lastLedger);
  indexerChainTipGauge.set(chainTip);
  indexerLagLedgersGauge.set(Math.max(chainTip - lastLedger, 0));
}

export function recordScoreReconciliationRun(date = new Date()): void {
  scoreReconciliationLastRunTimestampGauge.set(Math.floor(date.getTime() / 1000));
}

export async function refreshWebhookRetryQueueDepth(): Promise<void> {
  try {
    const result = await query(
      `SELECT COUNT(*)::int AS count
       FROM webhook_deliveries
       WHERE delivered_at IS NULL
         AND next_retry_at IS NOT NULL`,
      [],
    );
    webhookRetryQueueDepthGauge.set(Number(result.rows[0]?.count ?? 0));
  } catch (error) {
    logger.warn('Failed to refresh webhook retry queue depth metric', {
      error,
    });
  }
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
}
