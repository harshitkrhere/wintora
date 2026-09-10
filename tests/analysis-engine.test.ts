/**
 * The deterministic rule engine.
 *
 * This is the part of the product that decides what is true, so it is tested
 * directly, rule by rule, including the cases where it must stay quiet.
 */

import { describe, expect, it } from 'vitest';
import {
  analyzeBill,
  analyzeBillAgainstEob,
  headline,
  suggestedActions,
} from '@/domain/analysis/engine';
import {
  ENGINE_VERSION,
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
} from '@/domain/analysis/rules';
import type { BillDocument, EobDocument, LineItem } from '@/domain/analysis/types';

function line(overrides: Partial<LineItem> & { index: number }): LineItem {
  return {
    description: 'Service',
    amountCents: 10_000,
    confidence: 'HIGH',
    ...overrides,
  };
}

function bill(overrides: Partial<BillDocument> = {}): BillDocument {
  return {
    documentId: 'doc_1',
    currency: 'USD',
    lineItems: [
      line({ index: 0, description: 'Emergency department visit', amountCents: 120_000 }),
      line({ index: 1, description: 'Radiology, chest', amountCents: 45_000 }),
      line({ index: 2, description: 'Laboratory panel', amountCents: 18_000 }),
    ],
    subtotalCents: 183_000,
    amountDueCents: 183_000,
    statementDate: '2026-08-01',
    accountReference: 'ACC-1',
    overallConfidence: 'HIGH',
    ...overrides,
  };
}

function eob(overrides: Partial<EobDocument> = {}): EobDocument {
  return {
    documentId: 'doc_eob',
    currency: 'USD',
    lines: [],
    overallConfidence: 'HIGH',
    ...overrides,
  };
}

describe('line item sum', () => {
  it('stays silent when the lines add up', () => {
    expect(checkLineItemSum(bill())).toBeNull();
  });

  it('reports a mismatch with the exact difference', () => {
    const finding = checkLineItemSum(bill({ subtotalCents: 203_000 }));

    expect(finding).not.toBeNull();
    expect(finding!.code).toBe('LINE_ITEM_SUM_MISMATCH');
    expect(finding!.severity).toBe('ATTENTION');
    expect(finding!.explanation).toContain('$1,830.00');
    expect(finding!.explanation).toContain('$2,030.00');
    expect(finding!.explanation).toContain('$200.00');
  });

  it('never accuses anyone of anything', () => {
    const finding = checkLineItemSum(bill({ subtotalCents: 203_000 }))!;
    expect(finding.explanation).not.toMatch(/fraud|steal|overcharg|illegal|deliberate/i);
    // Offers the ordinary explanation rather than implying wrongdoing.
    expect(finding.explanation).toMatch(/ordinary explanation/i);
  });

  it('carries evidence a user can check against the page', () => {
    const finding = checkLineItemSum(bill({ subtotalCents: 203_000 }))!;
    expect(finding.evidence[0]!.observed.statedSubtotal).toBe('$2,030.00');
    expect(finding.evidence[0]!.observed.sumOfLineItems).toBe('$1,830.00');
  });

  it('degrades confidence when an input line was hard to read', () => {
    const withLowConfidence = bill({
      lineItems: [
        line({ index: 0, amountCents: 100_000, confidence: 'LOW' }),
        line({ index: 1, amountCents: 50_000 }),
      ],
      subtotalCents: 160_000,
    });
    expect(checkLineItemSum(withLowConfidence)!.confidence).toBe('LOW');
  });

  it('honours an explicit rounding tolerance', () => {
    const rounded = bill({ subtotalCents: 183_001 });
    expect(checkLineItemSum(rounded)).not.toBeNull();
    expect(checkLineItemSum(rounded, { toleranceCents: 5 })).toBeNull();
  });

  it('uses no floating point arithmetic on money', () => {
    // 0.1 + 0.2 in cents must be exactly 30, not 30.000000000000004.
    const pennies = bill({
      lineItems: [line({ index: 0, amountCents: 10 }), line({ index: 1, amountCents: 20 })],
      subtotalCents: 30,
    });
    expect(checkLineItemSum(pennies)).toBeNull();
  });
});

describe('total reconciliation', () => {
  it('reconciles subtotal, adjustments and payments against the amount due', () => {
    const consistent = bill({
      subtotalCents: 183_000,
      adjustmentsCents: 20_000,
      insurancePaidCents: 100_000,
      amountDueCents: 63_000,
    });
    expect(checkTotalReconciliation(consistent)).toBeNull();
  });

  it('reports the working when it does not reconcile', () => {
    const finding = checkTotalReconciliation(
      bill({
        subtotalCents: 183_000,
        adjustmentsCents: 20_000,
        insurancePaidCents: 100_000,
        amountDueCents: 90_000,
      }),
    );

    expect(finding).not.toBeNull();
    expect(finding!.code).toBe('TOTAL_RECONCILIATION_MISMATCH');
    expect(finding!.evidence[0]!.observed.statedAmountDue).toBe('$900.00');
    expect(finding!.evidence[0]!.expected).toEqual({ amountDue: '$630.00' });
  });

  it('includes a previous balance when the statement carries one', () => {
    const finding = checkTotalReconciliation(
      bill({
        subtotalCents: 100_000,
        previousBalanceCents: 50_000,
        amountDueCents: 100_000,
      }),
    );
    expect(finding!.explanation).toContain('previous balance');
  });

  it('stays silent when it cannot compute anything', () => {
    expect(checkTotalReconciliation(bill({ amountDueCents: undefined }))).toBeNull();
  });
});

describe('duplicates', () => {
  it('finds rows identical in description, code, date and amount', () => {
    const findings = checkDuplicateLineItems(
      bill({
        lineItems: [
          line({ index: 0, description: 'CT scan', code: '70450', serviceDate: '2026-07-01' }),
          line({ index: 1, description: 'CT scan', code: '70450', serviceDate: '2026-07-01' }),
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe('DUPLICATE_LINE_ITEM');
    expect(findings[0]!.evidence).toHaveLength(2);
  });

  it('presents a repeat as something to confirm, not as double billing', () => {
    const finding = checkDuplicateLineItems(
      bill({
        lineItems: [
          line({ index: 0, description: 'CT scan' }),
          line({ index: 1, description: 'CT scan' }),
        ],
      }),
    )[0]!;

    expect(finding.severity).toBe('REVIEW');
    expect(finding.explanation).toMatch(/sometimes correct/i);
    expect(finding.explanation).not.toMatch(/double bill|fraud|overcharg/i);
  });

  it('does not flag different dates as duplicates', () => {
    const findings = checkDuplicateLineItems(
      bill({
        lineItems: [
          line({ index: 0, description: 'CT scan', serviceDate: '2026-07-01' }),
          line({ index: 1, description: 'CT scan', serviceDate: '2026-07-08' }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('ignores case and whitespace when matching descriptions', () => {
    const findings = checkDuplicateLineItems(
      bill({
        lineItems: [
          line({ index: 0, description: 'CT  Scan' }),
          line({ index: 1, description: 'ct scan' }),
        ],
      }),
    );
    expect(findings).toHaveLength(1);
  });
});

describe('repeated descriptions at different amounts', () => {
  it('reports as information only', () => {
    const findings = checkRepeatedDescriptions(
      bill({
        lineItems: [
          line({ index: 0, description: 'Physical therapy', amountCents: 15_000 }),
          line({ index: 1, description: 'Physical therapy', amountCents: 22_500 }),
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('INFO');
    expect(findings[0]!.explanation).toMatch(/can be normal/i);
  });

  it('leaves identical amounts to the duplicate check', () => {
    const findings = checkRepeatedDescriptions(
      bill({
        lineItems: [
          line({ index: 0, description: 'Physical therapy' }),
          line({ index: 1, description: 'Physical therapy' }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });
});

describe('quantity and unit price', () => {
  it('stays silent when the multiplication is right', () => {
    const findings = checkQuantityPricing(
      bill({
        lineItems: [line({ index: 0, quantity: 3, unitAmountCents: 5_000, amountCents: 15_000 })],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('reports when it is not', () => {
    const findings = checkQuantityPricing(
      bill({
        lineItems: [
          line({
            index: 0,
            description: 'Wound dressing',
            quantity: 3,
            unitAmountCents: 5_000,
            amountCents: 45_000,
          }),
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.explanation).toContain('$150.00');
    expect(findings[0]!.explanation).toContain('$450.00');
  });

  it('skips lines with no quantity or unit price', () => {
    expect(checkQuantityPricing(bill())).toHaveLength(0);
  });
});

describe('missing itemisation', () => {
  it('flags a large total with almost no detail', () => {
    const finding = checkMissingItemization(
      bill({
        lineItems: [line({ index: 0, description: 'Hospital services', amountCents: 800_000 })],
        subtotalCents: 800_000,
        totalCents: 800_000,
      }),
    );

    expect(finding).not.toBeNull();
    expect(finding!.recommendedAction).toContain('itemised statement');
  });

  it('does not flag a properly itemised statement', () => {
    const detailed = bill({
      lineItems: Array.from({ length: 8 }, (_unused, i) =>
        line({ index: i, amountCents: 100_000 }),
      ),
      totalCents: 800_000,
    });
    expect(checkMissingItemization(detailed)).toBeNull();
  });

  it('does not flag a small total', () => {
    expect(
      checkMissingItemization(
        bill({ lineItems: [line({ index: 0, amountCents: 4_000 })], totalCents: 4_000 }),
      ),
    ).toBeNull();
  });
});

describe('required fields', () => {
  it('says which checks were skipped and why', () => {
    const finding = checkRequiredFields(
      bill({ accountReference: undefined, statementDate: undefined }),
    );

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('INFO');
    expect(finding!.explanation).toContain('account or statement number');
    expect(finding!.explanation).toContain('statement date');
  });

  it('stays silent on a complete document', () => {
    expect(checkRequiredFields(bill())).toBeNull();
  });
});

describe('date consistency', () => {
  it('flags a service dated after the statement', () => {
    const findings = checkDateConsistency(
      bill({
        statementDate: '2026-08-01',
        lineItems: [line({ index: 0, serviceDate: '2026-09-15' })],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.explanation).toMatch(/typing error/i);
  });

  it('accepts services dated before the statement', () => {
    expect(
      checkDateConsistency(
        bill({ statementDate: '2026-08-01', lineItems: [line({ index: 0, serviceDate: '2026-07-15' })] }),
      ),
    ).toHaveLength(0);
  });
});

describe('bill against EOB', () => {
  it('reports when the bill asks for more than the EOB says you owe', () => {
    const finding = checkPatientResponsibility(
      bill({ amountDueCents: 50_000 }),
      eob({ totalPatientResponsibilityCents: 20_000 }),
    );

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('ATTENTION');
    expect(finding!.explanation).toContain('$300.00');
    // Timing is offered as the likely cause, rather than blame.
    expect(finding!.explanation).toMatch(/timing/i);
  });

  it('stays silent when the bill asks for less', () => {
    expect(
      checkPatientResponsibility(
        bill({ amountDueCents: 10_000 }),
        eob({ totalPatientResponsibilityCents: 20_000 }),
      ),
    ).toBeNull();
  });

  it('reports an insurance payment missing from the statement', () => {
    const finding = checkPlanPaymentReflected(
      bill({ insurancePaidCents: 0 }),
      eob({ totalPlanPaidCents: 120_000 }),
    );

    expect(finding).not.toBeNull();
    expect(finding!.recommendedAction).toContain('updated statement');
  });

  it('stays silent when the payment is already reflected', () => {
    expect(
      checkPlanPaymentReflected(
        bill({ insurancePaidCents: 120_000 }),
        eob({ totalPlanPaidCents: 120_000 }),
      ),
    ).toBeNull();
  });

  it('lists charges that could not be matched, without overclaiming', () => {
    const findings = checkLineCoverage(
      bill({ lineItems: [line({ index: 0, description: 'Anaesthesia', code: '00840' })] }),
      eob({ lines: [{ index: 0, description: 'Surgery', code: '47562' }] }),
    );

    const notOnEob = findings.find((f) => f.code === 'CHARGE_NOT_ON_EOB');
    expect(notOnEob).toBeDefined();
    expect(notOnEob!.confidence).toBe('MEDIUM');
    expect(notOnEob!.explanation).toMatch(/starting point for a question/i);
  });

  it('compares the same code across both documents', () => {
    const findings = checkBilledAmountAgreement(
      bill({ lineItems: [line({ index: 0, code: '70450', amountCents: 45_000 })] }),
      eob({ lines: [{ index: 0, description: 'CT', code: '70450', billedCents: 38_000 }] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.explanation).toContain('$70.00');
  });
});

describe('full analysis', () => {
  it('says so plainly when nothing is wrong', () => {
    const result = analyzeBill(bill());

    expect(result.findings.some((f) => f.code === 'NO_ISSUES_FOUND')).toBe(true);
    expect(headline(result)).toBe('The figures on this statement are consistent.');
    // And it is honest about what that does and does not mean.
    const clear = result.findings.find((f) => f.code === 'NO_ISSUES_FOUND')!;
    expect(clear.explanation).toMatch(/does not tell you whether the charges/i);
  });

  it('sorts the most important finding first', () => {
    const result = analyzeBill(
      bill({
        subtotalCents: 203_000,
        lineItems: [
          line({ index: 0, description: 'CT scan', amountCents: 45_000 }),
          line({ index: 1, description: 'CT scan', amountCents: 45_000 }),
          line({ index: 2, description: 'Visit', amountCents: 93_000 }),
        ],
      }),
    );

    expect(result.findings[0]!.severity).toBe('ATTENTION');
  });

  it('is deterministic: the same document always gives the same answer', () => {
    const input = bill({ subtotalCents: 203_000 });
    const a = analyzeBill(input);
    const b = analyzeBill(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('never marks a finding as model-authored', () => {
    const result = analyzeBillAgainstEob(
      bill({ amountDueCents: 50_000 }),
      eob({ totalPatientResponsibilityCents: 20_000 }),
    );
    for (const finding of result.findings) {
      expect(finding.isAiGenerated).toBe(false);
    }
  });

  it('records the engine version and every check that ran', () => {
    const result = analyzeBill(bill());
    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.checksRun).toContain('LINE_ITEM_SUM_MISMATCH');
  });

  it('drops the all-clear when a comparison finds something', () => {
    const result = analyzeBillAgainstEob(
      bill({ amountDueCents: 50_000 }),
      eob({ totalPatientResponsibilityCents: 20_000 }),
    );
    expect(result.findings.some((f) => f.code === 'NO_ISSUES_FOUND')).toBe(false);
  });

  it('derives next steps from the findings themselves', () => {
    const withMissingItems = analyzeBill(
      bill({
        lineItems: [line({ index: 0, description: 'Hospital services', amountCents: 800_000 })],
        subtotalCents: 800_000,
        totalCents: 800_000,
        amountDueCents: 800_000,
      }),
    );

    expect(suggestedActions(withMissingItems)).toContain('Request an itemised statement');
  });

  it('suggests uploading an EOB after a single-document analysis', () => {
    const result = analyzeBill(bill({ subtotalCents: 203_000 }));
    expect(suggestedActions(result)).toContain(
      'Upload your EOB to compare the two documents',
    );
  });

  it('summarises counts by severity', () => {
    const result = analyzeBill(bill({ subtotalCents: 203_000 }));
    expect(result.summary.attention).toBeGreaterThan(0);
    expect(result.summary.lineItemCount).toBe(3);
    expect(result.summary.currency).toBe('USD');
  });

  it('handles an empty document without crashing', () => {
    const result = analyzeBill({
      documentId: 'empty',
      currency: 'USD',
      lineItems: [],
    });
    expect(result.findings.some((f) => f.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
  });

  it('formats Canadian currency correctly', () => {
    const finding = checkLineItemSum(
      bill({
        currency: 'CAD',
        lineItems: [line({ index: 0, amountCents: 10_000 })],
        subtotalCents: 12_000,
      }),
    )!;
    expect(finding.explanation).toContain('$100.00');
  });
});
