import type { Request } from 'express';

/** Largest page size any endpoint may return. */
export const MAX_LIMIT = 100;

/** Page size assumed when the caller does not supply `?limit=`. */
export const DEFAULT_LIMIT = 20;

/**
 * Safely parses and caps a limit query parameter to prevent database
 * performance issues.
 *
 * The effective default is itself capped at MAX_LIMIT: a caller-supplied
 * `defaultLimit` above the ceiling previously leaked through, so
 * `parseCappedLimit(req, 1000)` returned 1000 rows despite the documented cap.
 *
 * @param req - Express request object
 * @param defaultLimit - Default limit to use if not provided (default: 20)
 * @returns Effective limit that's capped at MAX_LIMIT (100)
 */
export function parseCappedLimit(req: Request, defaultLimit: number = DEFAULT_LIMIT): number {
  const raw = req.query.limit;
  const rawLimit = typeof raw === 'string' ? Number(raw) : NaN;

  const effectiveDefault = Math.min(
    Number.isFinite(defaultLimit) && defaultLimit > 0 ? Math.floor(defaultLimit) : DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  if (!Number.isFinite(rawLimit) || rawLimit <= 0 || rawLimit !== Math.floor(rawLimit)) {
    return effectiveDefault;
  }

  return Math.min(rawLimit, MAX_LIMIT);
}
