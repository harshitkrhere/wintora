/**
 * Structured representation of a bill and an EOB, plus the finding shape.
 *
 * Money is integer minor units throughout. No float ever touches money: a
 * floating-point cent error in a product whose entire job is checking
 * arithmetic would be self-defeating.
 *
 * Pure module: no I/O.
 */

export type Cents = number;

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type Severity = 'INFO' | 'REVIEW' | 'ATTENTION';

export interface LineItem {
  /** Position on the document, used in evidence so the user can find it. */
  readonly index: number;
  readonly page?: number;
  readonly description: string;
  /** Procedure or billing code exactly as printed. Never interpreted. */
  readonly code?: string;
  readonly serviceDate?: string;
  readonly quantity?: number;
  readonly unitAmountCents?: Cents;
  readonly amountCents: Cents;
  /** Extraction confidence for this row. */
  readonly confidence?: Confidence;
}

export interface BillDocument {
  readonly documentId: string;
  readonly currency: string;
  readonly lineItems: readonly LineItem[];
  /** Sum of charges as PRINTED on the document, if it states one. */
  readonly subtotalCents?: Cents;
  readonly adjustmentsCents?: Cents;
  readonly insurancePaidCents?: Cents;
  readonly paymentsCents?: Cents;
  readonly totalCents?: Cents;
  readonly amountDueCents?: Cents;
  readonly previousBalanceCents?: Cents;
  readonly statementDate?: string;
  readonly accountReference?: string;
  readonly providerName?: string;
  readonly overallConfidence?: Confidence;
}

export interface EobLine {
  readonly index: number;
  readonly description: string;
  readonly code?: string;
  readonly serviceDate?: string;
  readonly billedCents?: Cents;
  readonly allowedCents?: Cents;
  readonly planPaidCents?: Cents;
  readonly patientResponsibilityCents?: Cents;
  readonly confidence?: Confidence;
}

export interface EobDocument {
  readonly documentId: string;
  readonly currency: string;
  readonly lines: readonly EobLine[];
  readonly totalBilledCents?: Cents;
  readonly totalAllowedCents?: Cents;
  readonly totalPlanPaidCents?: Cents;
  readonly totalPatientResponsibilityCents?: Cents;
  readonly claimReference?: string;
  readonly processedDate?: string;
  readonly overallConfidence?: Confidence;
}

/** Where a finding came from. Shown next to the finding so a user can check it. */
export interface Evidence {
  readonly documentId: string;
  readonly page?: number;
  readonly fieldPath: string;
  readonly observed: Record<string, unknown>;
  readonly expected?: Record<string, unknown>;
}

export const FINDING_CODES = [
  'LINE_ITEM_SUM_MISMATCH',
  'TOTAL_RECONCILIATION_MISMATCH',
  'DUPLICATE_LINE_ITEM',
  'REPEATED_SERVICE_DESCRIPTION',
  'QUANTITY_PRICE_MISMATCH',
  'MISSING_ITEMIZATION',
  'MISSING_REQUIRED_FIELD',
  'SERVICE_DATE_AFTER_STATEMENT_DATE',
  'INCONSISTENT_SERVICE_DATES',
  'UNEXPLAINED_BALANCE_CHANGE',
  'BILL_EXCEEDS_EOB_PATIENT_RESPONSIBILITY',
  'EOB_PLAN_PAYMENT_NOT_REFLECTED',
  'CHARGE_NOT_ON_EOB',
  'EOB_LINE_NOT_ON_BILL',
  'BILLED_AMOUNT_DIFFERS_FROM_EOB',
  'NO_ISSUES_FOUND',
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

export interface Finding {
  readonly code: FindingCode;
  readonly severity: Severity;
  readonly title: string;
  /**
   * Plain language, factual, and never accusatory. An arithmetic difference is
   * a question to ask, not evidence that anyone did anything wrong.
   * See docs/AI_SAFETY.md section 8.
   */
  readonly explanation: string;
  readonly recommendedAction?: string;
  readonly confidence: Confidence;
  readonly evidence: readonly Evidence[];
  /** Always false. The rule engine authors findings; a model never does. */
  readonly isAiGenerated: false;
}

export interface AnalysisResult {
  readonly engineVersion: string;
  readonly analysisType: 'BILL_CONSISTENCY' | 'BILL_VS_EOB';
  readonly findings: readonly Finding[];
  readonly checksRun: readonly FindingCode[];
  readonly summary: {
    readonly lineItemCount: number;
    readonly totalChargesCents: Cents | null;
    readonly currency: string;
    readonly attention: number;
    readonly review: number;
    readonly info: number;
  };
}

export interface RuleOptions {
  /**
   * Cents of tolerance when comparing sums. Real statements sometimes round.
   * Default 0: report the difference and let the user decide whether it matters.
   */
  readonly toleranceCents?: number;
  /** A total above this with very few line items suggests missing itemisation. */
  readonly missingItemizationThresholdCents?: number;
}
