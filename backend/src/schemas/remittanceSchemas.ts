import { z } from 'zod';
import {
  REMITTANCE_AMOUNT_DECIMALS,
  REMITTANCE_MAX_AMOUNT,
  REMITTANCE_MEMO_MAX_LENGTH,
  STELLAR_ADDRESS_PATTERN,
  hasSupportedAmountPrecision,
} from '../services/remittanceRules.js';

/**
 * Request-boundary enforcement of the remittance acceptance rules.
 *
 * This is the first of the two places the rules live — see `remittanceRules.ts` for the shared
 * definitions and `docs/remittances.md` for the documented set. The bound on `amount` and the
 * bounds on the addresses come from the same constants the service uses, so the two cannot
 * disagree about what "too large" or "not an address" means.
 *
 * Self-transfer and the duplicate window are deliberately absent: neither is expressible here.
 * The sender is authenticated, not submitted, so the body never contains both addresses, and
 * the duplicate check needs the database.
 */
export const createRemittanceSchema = z.object({
  body: z.object({
    recipientAddress: z
      .string()
      .regex(STELLAR_ADDRESS_PATTERN, 'Invalid Stellar address format')
      .describe("Recipient's Stellar public key"),
    amount: z
      .number()
      .finite('Amount must be a finite number')
      .positive('Amount must be greater than 0')
      .max(REMITTANCE_MAX_AMOUNT, `Amount exceeds the maximum of ${REMITTANCE_MAX_AMOUNT}`)
      .refine(
        hasSupportedAmountPrecision,
        `Amount supports at most ${REMITTANCE_AMOUNT_DECIMALS} decimal places`,
      )
      .describe('Amount to send'),
    fromCurrency: z.enum(['USDC', 'EURC', 'PHP']).describe('Source currency'),
    toCurrency: z.enum(['USDC', 'EURC', 'PHP']).describe('Destination currency'),
    memo: z
      .string()
      .max(
        REMITTANCE_MEMO_MAX_LENGTH,
        `Memo must be ${REMITTANCE_MEMO_MAX_LENGTH} characters or less`,
      )
      .optional()
      .describe('Optional transaction memo'),
  }),
});

// ISO date string validation
const isoDateString = z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
  message: 'Must be a valid ISO-8601 date string',
});

// Schema for GET /remittances (list)
export const getRemittancesSchema = z.object({
  query: z.object({
    limit: z
      .string()
      .transform((v) => Math.min(parseInt(v, 10), 100))
      .pipe(z.number())
      .default(20)
      .optional(),
    cursor: z.string().optional(),
    status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
    from: isoDateString.optional(),
    to: isoDateString.optional(),
    q: z.string().max(255).optional(),
  }),
});

// Schema for GET /remittances/:id
export const getRemittanceSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Remittance ID is required').describe('Remittance ID (UUID format)'),
  }),
});

// Export types for TypeScript
export type CreateRemittanceInput = z.infer<typeof createRemittanceSchema>;
export type GetRemittancesInput = z.infer<typeof getRemittancesSchema>;
export type GetRemittanceInput = z.infer<typeof getRemittanceSchema>;
