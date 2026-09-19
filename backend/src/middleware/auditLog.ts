import type { Request, Response, NextFunction } from 'express';
import { query } from '../db/connection.js';
import logger from '../utils/logger.js';
import { redactForLogging } from '../utils/redaction.js';
import {
  auditActionName,
  auditReasonFor,
  isAuditedMethod,
  routeParamsFrom,
} from './auditPolicy.js';

/**
 * Writes a row for every privileged action, whether it succeeded, failed, or never finished.
 *
 * Mounted on the privileged routers (`adminRoutes`, `indexerRoutes`) rather than on individual
 * routes, so a route added later is audited without anyone remembering to add a middleware to it.
 * A file-by-file list of audited routes is a list that is correct until the next commit.
 */

/**
 * Extracts a target identifier from the request based on parameters or body fields.
 *
 * This is what makes a row answer "what did they act on?" rather than only "what did they call?".
 */
type RouteParams = Record<string, string | string[] | undefined>;

function extractTarget(req: Request, params: RouteParams): string | undefined {
  // Check common path parameters
  if (params.id) return `ID:${params.id}`;
  if (params.loanId) return `LoanID:${params.loanId}`;
  if (params.address) return `Address:${params.address}`;
  if (params.userId) return `UserID:${params.userId}`;
  if (params.borrower) return `Borrower:${params.borrower}`;
  if (params.disputeId) return `DisputeID:${params.disputeId}`;

  // Check common body fields
  const body = req.body as Record<string, unknown> | undefined;
  if (body) {
    if (body.loanId) return `LoanID:${body.loanId}`;
    if (Array.isArray(body.loanIds)) return `LoanIDs:[${body.loanIds.join(',')}]`;
    if (body.disputeId) return `DisputeID:${body.disputeId}`;
    if (body.address) return `Address:${body.address}`;
    if (body.userId) return `UserID:${body.userId}`;
    if (body.publicKey) return `PublicKey:${body.publicKey}`;
    if (body.borrowerPublicKey) return `Borrower:${body.borrowerPublicKey}`;
  }

  return undefined;
}

/** The actor, from the authenticated identity or the internal key that was presented. */
function extractActor(req: Request): string {
  return req.user?.publicKey ?? (req.headers['x-api-key'] ? 'INTERNAL_API_KEY' : 'unknown');
}

function extractIpAddress(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];

  return (
    req.ip ||
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress
  );
}

/**
 * Log the request once it has an outcome.
 *
 * The row is written on `finish` **or** `close`, whichever comes first and only ever once. An
 * action that fails partway — a crash after the chain unwound, a client that hung up mid-request —
 * emits `close` without `finish`, and an audit trail that only listened for `finish` recorded
 * nothing for exactly the requests most worth investigating.
 */
export const auditLog = (req: Request, res: Response, next: NextFunction): void => {
  if (!isAuditedMethod(req.method)) {
    next();
    return;
  }

  // Captured now, read later.
  //
  // This middleware is mounted before the auth middleware, because a request that is *refused* is
  // exactly the kind of privileged attempt that must appear in the trail. That puts it in the one
  // place where the request still says which router it is in: Express restores `req.baseUrl`,
  // `req.url` and `req.params` as a router unwinds, so by the time an application-level error
  // handler writes a 401 those are gone — which is how a refused request came out with no route
  // prefix and no target. The actor and the matched route, by contrast, are *not* restored, so
  // they are read at the end, once they have been populated.
  const mountBaseUrl = req.baseUrl;
  const mountPath = req.path;
  const method = req.method;

  let written = false;

  const write = (finished: boolean): void => {
    if (written) return;
    written = true;

    const route = req.route?.path;
    const action = auditActionName(method, mountBaseUrl, route ?? mountPath);
    const params = route ? routeParamsFrom(route, mountPath) : req.params;

    const actor = extractActor(req);
    const target = extractTarget(req, params);
    const payload = redactForLogging(req.body);
    const ipAddress = extractIpAddress(req);
    const reason = auditReasonFor(res, finished);
    const status = finished ? res.statusCode : null;

    void (async () => {
      try {
        await query(
          `INSERT INTO audit_logs (actor, action, target, payload, ip_address, status, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            actor,
            action,
            target ?? null,
            payload ? JSON.stringify(payload) : null,
            ipAddress ?? null,
            status,
            reason,
          ],
        );
      } catch (err) {
        // A failed audit write is loud. Silently swallowing it is how an audit trail develops a
        // hole that nobody notices until the incident review.
        logger.error('Audit logging failure', { err, actor, action, target });
      }
    })();
  };

  // `finish` means a response was written; `close` without a prior `finish` means the requester
  // went away. Which one arrived is what distinguishes a completed action from an abandoned one,
  // so it is passed through rather than inferred from the response object afterwards.
  res.on('finish', () => write(true));
  res.on('close', () => write(false));

  next();
};
