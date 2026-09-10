/**
 * Shared request schemas.
 *
 * Every route parses its input with one of these before anything reaches the
 * domain layer. Money arrives as integer minor units; there is no float path
 * into the analysis engine.
 */

import { z } from 'zod';

const MAX_MONEY_CENTS = 100_000_000_00; // 100 million, in cents
const MAX_LINE_ITEMS = 500;

export const confidenceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const lineItemSchema = z.object({
  index: z.number().int().min(0).max(MAX_LINE_ITEMS),
  page: z.number().int().min(1).max(500).optional(),
  description: z.string().trim().min(1).max(500),
  code: z.string().trim().max(40).optional(),
  serviceDate: z.string().date().optional(),
  quantity: z.number().min(0).max(100_000).optional(),
  unitAmountCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  amountCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS),
  confidence: confidenceSchema.optional(),
});

export const billDocumentSchema = z.object({
  documentId: z.string().min(1).max(100),
  currency: z.enum(['USD', 'CAD']),
  lineItems: z.array(lineItemSchema).max(MAX_LINE_ITEMS),
  subtotalCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  adjustmentsCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  insurancePaidCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  paymentsCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  totalCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  amountDueCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  previousBalanceCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  statementDate: z.string().date().optional(),
  accountReference: z.string().trim().max(120).optional(),
  providerName: z.string().trim().max(200).optional(),
  overallConfidence: confidenceSchema.optional(),
});

export const eobLineSchema = z.object({
  index: z.number().int().min(0).max(MAX_LINE_ITEMS),
  description: z.string().trim().min(1).max(500),
  code: z.string().trim().max(40).optional(),
  serviceDate: z.string().date().optional(),
  billedCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  allowedCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  planPaidCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  patientResponsibilityCents: z
    .number()
    .int()
    .min(-MAX_MONEY_CENTS)
    .max(MAX_MONEY_CENTS)
    .optional(),
  confidence: confidenceSchema.optional(),
});

export const eobDocumentSchema = z.object({
  documentId: z.string().min(1).max(100),
  currency: z.enum(['USD', 'CAD']),
  lines: z.array(eobLineSchema).max(MAX_LINE_ITEMS),
  totalBilledCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  totalAllowedCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  totalPlanPaidCents: z.number().int().min(-MAX_MONEY_CENTS).max(MAX_MONEY_CENTS).optional(),
  totalPatientResponsibilityCents: z
    .number()
    .int()
    .min(-MAX_MONEY_CENTS)
    .max(MAX_MONEY_CENTS)
    .optional(),
  claimReference: z.string().trim().max(120).optional(),
  processedDate: z.string().date().optional(),
  overallConfidence: confidenceSchema.optional(),
});

/**
 * Idempotency key supplied by the client.
 *
 * It MUST be stable across retries of the same operation, and different for a
 * genuinely new one. A timestamp or a random value here would turn every retry
 * into a second charge against the user's quota.
 */
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, hyphen and underscore only.');
