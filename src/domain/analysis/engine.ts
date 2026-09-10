/**
 * The analysis engine: runs the deterministic rules and assembles a result.
 *
 * Pure module. Given the same documents it returns the same findings, every
 * time, with no model involved. The AI layer sits strictly downstream and may
 * only rephrase what this produced.
 */

import type {
  AnalysisResult,
  BillDocument,
  EobDocument,
  Finding,
  RuleOptions,
  Severity,
} from './types';
import {
  BILL_CHECKS,
  ENGINE_VERSION,
  EOB_CHECKS,
  checkBilledAmountAgreement,
  checkDateConsistency,
  checkDuplicateLineItems,
  checkLineCoverage,
  checkLineItemSum,
  checkMissingItemization,
  checkPatientResponsibility,
  checkPlanPaymentReflected,
  checkQuantityPricing,
  checkRepeatedDescriptions,
  checkRequiredFields,
  checkTotalReconciliation,
} from './rules';

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = {
  ATTENTION: 0,
  REVIEW: 1,
  INFO: 2,
};

const CONFIDENCE_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

function compact(findings: readonly (Finding | null)[]): Finding[] {
  return findings.filter((f): f is Finding => f !== null);
}

/** Most important first: severity, then confidence. */
function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
  });
}

/**
 * "Nothing found" is a real, useful answer and the product says so plainly.
 * It sells nothing, which is precisely why it has to be said clearly.
 */
function noIssuesFinding(documentId: string): Finding {
  return {
    code: 'NO_ISSUES_FOUND',
    severity: 'INFO',
    title: 'The figures on this statement are consistent',
    explanation:
      'The line items add up to the stated totals, and we did not find ' +
      'duplicated entries or date problems. That does not tell you whether the ' +
      'charges themselves are correct or whether the prices are reasonable, ' +
      'only that the arithmetic on the page holds together.',
    confidence: 'HIGH',
    evidence: [{ documentId, fieldPath: 'document', observed: { checksPassed: true } }],
    isAiGenerated: false,
  };
}

function summarize(
  bill: BillDocument,
  findings: readonly Finding[],
): AnalysisResult['summary'] {
  return {
    lineItemCount: bill.lineItems.length,
    totalChargesCents:
      bill.totalCents ?? bill.subtotalCents ?? bill.amountDueCents ?? null,
    currency: bill.currency,
    attention: findings.filter((f) => f.severity === 'ATTENTION').length,
    review: findings.filter((f) => f.severity === 'REVIEW').length,
    info: findings.filter((f) => f.severity === 'INFO' && f.code !== 'NO_ISSUES_FOUND')
      .length,
  };
}

/** Single-document consistency analysis. Available on every plan, including free. */
export function analyzeBill(
  bill: BillDocument,
  options: RuleOptions = {},
): AnalysisResult {
  const findings = sortFindings([
    ...compact([
      checkRequiredFields(bill),
      checkLineItemSum(bill, options),
      checkTotalReconciliation(bill, options),
      checkMissingItemization(bill, options),
    ]),
    ...checkDuplicateLineItems(bill),
    ...checkRepeatedDescriptions(bill),
    ...checkQuantityPricing(bill, options),
    ...checkDateConsistency(bill),
  ]);

  const substantive = findings.filter((f) => f.code !== 'MISSING_REQUIRED_FIELD');
  const finalFindings =
    substantive.length === 0 ? [...findings, noIssuesFinding(bill.documentId)] : findings;

  return {
    engineVersion: ENGINE_VERSION,
    analysisType: 'BILL_CONSISTENCY',
    findings: finalFindings,
    checksRun: BILL_CHECKS,
    summary: summarize(bill, finalFindings),
  };
}

/**
 * Bill against EOB. Runs the single-document checks on the bill as well, since
 * an internal inconsistency matters regardless of what the insurer said.
 */
export function analyzeBillAgainstEob(
  bill: BillDocument,
  eob: EobDocument,
  options: RuleOptions = {},
): AnalysisResult {
  const billResult = analyzeBill(bill, options);

  const comparison = sortFindings([
    ...compact([
      checkPatientResponsibility(bill, eob, options),
      checkPlanPaymentReflected(bill, eob),
    ]),
    ...checkLineCoverage(bill, eob),
    ...checkBilledAmountAgreement(bill, eob, options),
  ]);

  // Drop the single-document "all clear" if the comparison found something.
  const billFindings =
    comparison.length > 0
      ? billResult.findings.filter((f) => f.code !== 'NO_ISSUES_FOUND')
      : billResult.findings;

  const findings = sortFindings([...billFindings, ...comparison]);

  return {
    engineVersion: ENGINE_VERSION,
    analysisType: 'BILL_VS_EOB',
    findings,
    checksRun: [...BILL_CHECKS, ...EOB_CHECKS],
    summary: summarize(bill, findings),
  };
}

/**
 * The first screen answers four questions in order:
 *   what did you find, why might it matter, what should I do next, and what can
 *   the app help with. See docs/AI_SAFETY.md section 8.
 */
export function headline(result: AnalysisResult): string {
  const { attention, review } = result.summary;

  if (attention === 0 && review === 0) {
    return 'The figures on this statement are consistent.';
  }
  if (attention > 0) {
    return `${attention} ${attention === 1 ? 'entry needs' : 'entries need'} a closer look.`;
  }
  return `${review} ${review === 1 ? 'entry is' : 'entries are'} worth confirming.`;
}

/** Next steps offered to the user, derived from the findings themselves. */
export function suggestedActions(result: AnalysisResult): readonly string[] {
  const codes = new Set(result.findings.map((f) => f.code));
  const actions: string[] = [];

  if (codes.has('MISSING_ITEMIZATION')) {
    actions.push('Request an itemised statement');
  }
  if (codes.has('LINE_ITEM_SUM_MISMATCH') || codes.has('TOTAL_RECONCILIATION_MISMATCH')) {
    actions.push('Ask the billing office to reconcile the totals');
  }
  if (codes.has('DUPLICATE_LINE_ITEM') || codes.has('QUANTITY_PRICE_MISMATCH')) {
    actions.push('Ask for confirmation of specific charges');
  }
  if (
    codes.has('BILL_EXCEEDS_EOB_PATIENT_RESPONSIBILITY') ||
    codes.has('EOB_PLAN_PAYMENT_NOT_REFLECTED')
  ) {
    actions.push('Ask for an updated statement that reflects your EOB');
  }
  if (result.analysisType === 'BILL_CONSISTENCY' && !codes.has('NO_ISSUES_FOUND')) {
    actions.push('Upload your EOB to compare the two documents');
  }
  if (actions.length === 0) {
    actions.push('Save this to a case so you have a record');
  }

  return actions;
}
