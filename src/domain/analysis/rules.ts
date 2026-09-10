/**
 * The deterministic rule engine.
 *
 * Every user-visible finding originates here. A language model may later
 * rephrase a finding, but it can never create, suppress or alter one. That is
 * the structural property that makes prompt injection in an uploaded document
 * harmless. See docs/AI_SAFETY.md.
 *
 * Pure module: no I/O, no randomness, no clock except what is passed in.
 */

import type {
  BillDocument,
  Cents,
  Confidence,
  EobDocument,
  Evidence,
  Finding,
  FindingCode,
  LineItem,
  RuleOptions,
} from './types';

export const ENGINE_VERSION = '1.0.0';

const DEFAULT_TOLERANCE_CENTS = 0;
/**
 * A total above this supported by three or fewer lines suggests the statement
 * is a summary rather than an itemised one. Set at 2,000 rather than lower
 * because three lines on a smaller bill is genuinely itemised, and a rule that
 * fires on ordinary statements teaches people to ignore it.
 */
const DEFAULT_MISSING_ITEMIZATION_THRESHOLD = 200_000; // 2,000.00

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function formatMoney(cents: Cents, currency: string): string {
  const locale = currency === 'CAD' ? 'en-CA' : 'en-US';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    cents / 100,
  );
}

function sumLineItems(items: readonly LineItem[]): Cents {
  return items.reduce((acc, item) => acc + item.amountCents, 0);
}

/**
 * A finding is only as confident as the fields it rests on. If any input row
 * was extracted with low confidence, the finding is presented as a question
 * rather than a statement.
 */
function combineConfidence(inputs: readonly (Confidence | undefined)[]): Confidence {
  let worst: Confidence = 'HIGH';
  for (const c of inputs) {
    const value = c ?? 'MEDIUM';
    if (value === 'LOW') return 'LOW';
    if (value === 'MEDIUM') worst = 'MEDIUM';
  }
  return worst;
}

function normalizeDescription(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Bill consistency rules
// ---------------------------------------------------------------------------

/**
 * Do the printed line items add up to the printed subtotal?
 *
 * This is the single most useful check in the product, and it is pure
 * arithmetic over what the document itself states.
 */
export function checkLineItemSum(
  bill: BillDocument,
  options: RuleOptions = {},
): Finding | null {
  const tolerance = options.toleranceCents ?? DEFAULT_TOLERANCE_CENTS;
  if (bill.subtotalCents === undefined || bill.lineItems.length === 0) return null;

  const computed = sumLineItems(bill.lineItems);
  const difference = computed - bill.subtotalCents;
  if (Math.abs(difference) <= tolerance) return null;

  const evidence: Evidence[] = [
    {
      documentId: bill.documentId,
      fieldPath: 'subtotalCents',
      observed: {
        statedSubtotal: formatMoney(bill.subtotalCents, bill.currency),
        sumOfLineItems: formatMoney(computed, bill.currency),
        difference: formatMoney(Math.abs(difference), bill.currency),
        lineItemCount: bill.lineItems.length,
      },
      expected: { subtotalEquals: formatMoney(computed, bill.currency) },
    },
  ];

  return {
    code: 'LINE_ITEM_SUM_MISMATCH',
    severity: 'ATTENTION',
    title: 'Line items and subtotal do not match',
    explanation:
      `The ${bill.lineItems.length} line items on this statement add up to ` +
      `${formatMoney(computed, bill.currency)}, but the stated subtotal is ` +
      `${formatMoney(bill.subtotalCents, bill.currency)}. That is a difference of ` +
      `${formatMoney(Math.abs(difference), bill.currency)}. There is often an ` +
      `ordinary explanation, such as a charge listed on another page.`,
    recommendedAction:
      'Ask the billing office to reconcile the subtotal with the itemised lines.',
    confidence: combineConfidence([
      bill.overallConfidence,
      ...bill.lineItems.map((i) => i.confidence),
    ]),
    evidence,
    isAiGenerated: false,
  };
}

/**
 * Does subtotal, minus adjustments, minus what insurance and the patient have
 * already paid, equal the amount now due?
 */
export function checkTotalReconciliation(
  bill: BillDocument,
  options: RuleOptions = {},
): Finding | null {
  const tolerance = options.toleranceCents ?? DEFAULT_TOLERANCE_CENTS;
  const base = bill.subtotalCents ?? bill.totalCents;
  const due = bill.amountDueCents;
  if (base === undefined || due === undefined) return null;

  const adjustments = bill.adjustmentsCents ?? 0;
  const insurancePaid = bill.insurancePaidCents ?? 0;
  const payments = bill.paymentsCents ?? 0;
  const previousBalance = bill.previousBalanceCents ?? 0;

  const computed = base + previousBalance - adjustments - insurancePaid - payments;
  const difference = computed - due;
  if (Math.abs(difference) <= tolerance) return null;

  return {
    code: 'TOTAL_RECONCILIATION_MISMATCH',
    severity: 'ATTENTION',
    title: 'The balance does not reconcile',
    explanation:
      `Starting from ${formatMoney(base, bill.currency)}` +
      (previousBalance !== 0
        ? ` plus a previous balance of ${formatMoney(previousBalance, bill.currency)}`
        : '') +
      `, subtracting adjustments of ${formatMoney(adjustments, bill.currency)}, ` +
      `insurance payments of ${formatMoney(insurancePaid, bill.currency)} and ` +
      `payments of ${formatMoney(payments, bill.currency)} gives ` +
      `${formatMoney(computed, bill.currency)}. The statement shows ` +
      `${formatMoney(due, bill.currency)} due, a difference of ` +
      `${formatMoney(Math.abs(difference), bill.currency)}.`,
    recommendedAction:
      'Ask the billing office to explain how the amount due was calculated.',
    confidence: combineConfidence([bill.overallConfidence]),
    evidence: [
      {
        documentId: bill.documentId,
        fieldPath: 'amountDueCents',
        observed: {
          base: formatMoney(base, bill.currency),
          previousBalance: formatMoney(previousBalance, bill.currency),
          adjustments: formatMoney(adjustments, bill.currency),
          insurancePaid: formatMoney(insurancePaid, bill.currency),
          payments: formatMoney(payments, bill.currency),
          statedAmountDue: formatMoney(due, bill.currency),
        },
        expected: { amountDue: formatMoney(computed, bill.currency) },
      },
    ],
    isAiGenerated: false,
  };
}

/**
 * Identical rows: same description, code, date and amount.
 *
 * Deliberately strict. A genuine repeat of the same service on the same day is
 * common and legitimate, so this is reported as something to confirm, never as
 * an accusation of double billing.
 */
export function checkDuplicateLineItems(bill: BillDocument): Finding[] {
  const groups = new Map<string, LineItem[]>();

  for (const item of bill.lineItems) {
    const key = [
      normalizeDescription(item.description),
      item.code ?? '',
      item.serviceDate ?? '',
      String(item.amountCents),
    ].join('|');
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [item]);
    else bucket.push(item);
  }

  const findings: Finding[] = [];

  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const first = items[0]!;

    findings.push({
      code: 'DUPLICATE_LINE_ITEM',
      severity: 'REVIEW',
      title: 'The same charge appears more than once',
      explanation:
        `"${first.description}" appears ${items.length} times` +
        (first.serviceDate !== undefined ? ` for ${first.serviceDate}` : '') +
        `, each at ${formatMoney(first.amountCents, bill.currency)}. Repeated ` +
        `charges are sometimes correct, for example when a service really was ` +
        `provided more than once. It is worth confirming.`,
      recommendedAction:
        'Ask the billing office to confirm each of these charges was a separate service.',
      confidence: combineConfidence(items.map((i) => i.confidence)),
      evidence: items.map((item) => ({
        documentId: bill.documentId,
        page: item.page,
        fieldPath: `lineItems[${item.index}]`,
        observed: {
          description: item.description,
          code: item.code,
          serviceDate: item.serviceDate,
          amount: formatMoney(item.amountCents, bill.currency),
        },
      })),
      isAiGenerated: false,
    });
  }

  return findings;
}

/** The same service description at different amounts. Informational only. */
export function checkRepeatedDescriptions(bill: BillDocument): Finding[] {
  const groups = new Map<string, LineItem[]>();

  for (const item of bill.lineItems) {
    const key = normalizeDescription(item.description);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [item]);
    else bucket.push(item);
  }

  const findings: Finding[] = [];

  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const amounts = new Set(items.map((i) => i.amountCents));
    // Identical amounts are already covered by the duplicate check.
    if (amounts.size < 2) continue;

    const first = items[0]!;
    findings.push({
      code: 'REPEATED_SERVICE_DESCRIPTION',
      severity: 'INFO',
      title: 'The same service is listed at different amounts',
      explanation:
        `"${first.description}" appears ${items.length} times at different ` +
        `amounts: ${[...amounts]
          .sort((a, b) => a - b)
          .map((a) => formatMoney(a, bill.currency))
          .join(', ')}. This can be normal, for example when the time or ` +
        `quantity differed.`,
      recommendedAction:
        'If the amounts look unexpected, ask what differed between these entries.',
      confidence: combineConfidence(items.map((i) => i.confidence)),
      evidence: items.map((item) => ({
        documentId: bill.documentId,
        page: item.page,
        fieldPath: `lineItems[${item.index}]`,
        observed: {
          description: item.description,
          amount: formatMoney(item.amountCents, bill.currency),
        },
      })),
      isAiGenerated: false,
    });
  }

  return findings;
}

/** Quantity times unit price should equal the line amount. */
export function checkQuantityPricing(
  bill: BillDocument,
  options: RuleOptions = {},
): Finding[] {
  const tolerance = options.toleranceCents ?? DEFAULT_TOLERANCE_CENTS;
  const findings: Finding[] = [];

  for (const item of bill.lineItems) {
    if (item.quantity === undefined || item.unitAmountCents === undefined) continue;
    if (item.quantity <= 0) continue;

    const computed = Math.round(item.quantity * item.unitAmountCents);
    const difference = computed - item.amountCents;
    if (Math.abs(difference) <= tolerance) continue;

    findings.push({
      code: 'QUANTITY_PRICE_MISMATCH',
      severity: 'REVIEW',
      title: 'Quantity and unit price do not match the line total',
      explanation:
        `"${item.description}" shows a quantity of ${item.quantity} at ` +
        `${formatMoney(item.unitAmountCents, bill.currency)} each, which comes to ` +
        `${formatMoney(computed, bill.currency)}. The line total shown is ` +
        `${formatMoney(item.amountCents, bill.currency)}.`,
      recommendedAction:
        'Ask the billing office to confirm the quantity and the unit price for this line.',
      confidence: combineConfidence([item.confidence]),
      evidence: [
        {
          documentId: bill.documentId,
          page: item.page,
          fieldPath: `lineItems[${item.index}]`,
          observed: {
            description: item.description,
            quantity: item.quantity,
            unitAmount: formatMoney(item.unitAmountCents, bill.currency),
            lineTotal: formatMoney(item.amountCents, bill.currency),
          },
          expected: { lineTotal: formatMoney(computed, bill.currency) },
        },
      ],
      isAiGenerated: false,
    });
  }

  return findings;
}

/** A large total with almost no detail. The prompt for requesting itemisation. */
export function checkMissingItemization(
  bill: BillDocument,
  options: RuleOptions = {},
): Finding | null {
  const threshold =
    options.missingItemizationThresholdCents ?? DEFAULT_MISSING_ITEMIZATION_THRESHOLD;
  const total = bill.totalCents ?? bill.subtotalCents ?? bill.amountDueCents;
  if (total === undefined || total < threshold) return null;
  if (bill.lineItems.length > 3) return null;

  return {
    code: 'MISSING_ITEMIZATION',
    severity: 'REVIEW',
    title: 'This statement has little detail for the amount charged',
    explanation:
      `The statement shows ${formatMoney(total, bill.currency)} across ` +
      `${bill.lineItems.length} ` +
      `${bill.lineItems.length === 1 ? 'line' : 'lines'}. An itemised statement ` +
      `lists each service separately, which makes it much easier to check.`,
    recommendedAction: 'Request an itemised statement in writing, and keep a copy.',
    confidence: 'HIGH',
    evidence: [
      {
        documentId: bill.documentId,
        fieldPath: 'lineItems',
        observed: {
          lineItemCount: bill.lineItems.length,
          total: formatMoney(total, bill.currency),
        },
      },
    ],
    isAiGenerated: false,
  };
}

/** Fields a statement needs before it can be checked properly. */
export function checkRequiredFields(bill: BillDocument): Finding | null {
  const missing: string[] = [];
  if (bill.accountReference === undefined) missing.push('an account or statement number');
  if (bill.statementDate === undefined) missing.push('a statement date');
  if (bill.subtotalCents === undefined && bill.totalCents === undefined) {
    missing.push('a stated total');
  }
  if (bill.lineItems.length === 0) missing.push('any itemised charges');
  if (missing.length === 0) return null;

  return {
    code: 'MISSING_REQUIRED_FIELD',
    severity: 'INFO',
    title: 'Some details could not be read from this document',
    explanation:
      `We could not find ${missing.join(', ')}. That may be because the ` +
      `document does not include it, or because the scan was hard to read. ` +
      `Some checks were skipped as a result.`,
    recommendedAction:
      'You can add these details by hand, or upload a clearer copy.',
    confidence: 'HIGH',
    evidence: [
      {
        documentId: bill.documentId,
        fieldPath: 'document',
        observed: { missingFields: missing },
      },
    ],
    isAiGenerated: false,
  };
}

/** Dates that cannot be right: a service dated after the statement was issued. */
export function checkDateConsistency(bill: BillDocument): Finding[] {
  const findings: Finding[] = [];
  const statementDate = parseDate(bill.statementDate);
  if (statementDate === null) return findings;

  const future = bill.lineItems.filter((item) => {
    const d = parseDate(item.serviceDate);
    return d !== null && d.getTime() > statementDate.getTime();
  });

  if (future.length > 0) {
    findings.push({
      code: 'SERVICE_DATE_AFTER_STATEMENT_DATE',
      severity: 'REVIEW',
      title: 'A service date is later than the statement date',
      explanation:
        `${future.length} ${future.length === 1 ? 'charge is' : 'charges are'} ` +
        `dated after the statement date of ${bill.statementDate}. This is often ` +
        `a typing error on the statement.`,
      recommendedAction: 'Ask the billing office to confirm the dates of service.',
      confidence: combineConfidence(future.map((i) => i.confidence)),
      evidence: future.map((item) => ({
        documentId: bill.documentId,
        page: item.page,
        fieldPath: `lineItems[${item.index}].serviceDate`,
        observed: {
          description: item.description,
          serviceDate: item.serviceDate,
          statementDate: bill.statementDate,
        },
      })),
      isAiGenerated: false,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Bill vs EOB rules
// ---------------------------------------------------------------------------

/**
 * The comparison people most want: does the provider bill match what the
 * insurer said the patient owes?
 */
export function checkPatientResponsibility(
  bill: BillDocument,
  eob: EobDocument,
  options: RuleOptions = {},
): Finding | null {
  const tolerance = options.toleranceCents ?? DEFAULT_TOLERANCE_CENTS;
  const billed = bill.amountDueCents;
  const responsibility = eob.totalPatientResponsibilityCents;
  if (billed === undefined || responsibility === undefined) return null;

  const difference = billed - responsibility;
  if (difference <= tolerance) return null;

  return {
    code: 'BILL_EXCEEDS_EOB_PATIENT_RESPONSIBILITY',
    severity: 'ATTENTION',
    title: 'The bill asks for more than the EOB shows as your responsibility',
    explanation:
      `The statement asks for ${formatMoney(billed, bill.currency)}. The ` +
      `explanation of benefits shows your responsibility as ` +
      `${formatMoney(responsibility, eob.currency)}, a difference of ` +
      `${formatMoney(difference, bill.currency)}. Timing is a common cause: the ` +
      `statement may have been produced before the claim finished processing.`,
    recommendedAction:
      'Ask the billing office to review the statement against the EOB, and quote both reference numbers.',
    confidence: combineConfidence([bill.overallConfidence, eob.overallConfidence]),
    evidence: [
      {
        documentId: bill.documentId,
        fieldPath: 'amountDueCents',
        observed: { amountDue: formatMoney(billed, bill.currency) },
      },
      {
        documentId: eob.documentId,
        fieldPath: 'totalPatientResponsibilityCents',
        observed: {
          patientResponsibility: formatMoney(responsibility, eob.currency),
          claimReference: eob.claimReference,
        },
      },
    ],
    isAiGenerated: false,
  };
}

/** The insurer says it paid, but the statement shows no insurance payment. */
export function checkPlanPaymentReflected(
  bill: BillDocument,
  eob: EobDocument,
): Finding | null {
  const planPaid = eob.totalPlanPaidCents;
  if (planPaid === undefined || planPaid <= 0) return null;

  const reflected = bill.insurancePaidCents ?? 0;
  if (reflected > 0) return null;

  return {
    code: 'EOB_PLAN_PAYMENT_NOT_REFLECTED',
    severity: 'ATTENTION',
    title: 'An insurance payment on the EOB is not shown on the bill',
    explanation:
      `The explanation of benefits shows the plan paid ` +
      `${formatMoney(planPaid, eob.currency)}, but the statement does not show ` +
      `an insurance payment. This often means the statement was printed before ` +
      `the payment was applied.`,
    recommendedAction:
      'Ask for an updated statement that reflects the insurance payment.',
    confidence: combineConfidence([bill.overallConfidence, eob.overallConfidence]),
    evidence: [
      {
        documentId: eob.documentId,
        fieldPath: 'totalPlanPaidCents',
        observed: { planPaid: formatMoney(planPaid, eob.currency) },
      },
      {
        documentId: bill.documentId,
        fieldPath: 'insurancePaidCents',
        observed: { insurancePaidOnStatement: formatMoney(reflected, bill.currency) },
      },
    ],
    isAiGenerated: false,
  };
}

/** Charges present on one document and not the other. Matched by code or text. */
export function checkLineCoverage(
  bill: BillDocument,
  eob: EobDocument,
): Finding[] {
  const findings: Finding[] = [];

  const eobKeys = new Set(
    eob.lines.map((l) => l.code ?? normalizeDescription(l.description)),
  );
  const billKeys = new Set(
    bill.lineItems.map((l) => l.code ?? normalizeDescription(l.description)),
  );

  const notOnEob = bill.lineItems.filter(
    (l) => !eobKeys.has(l.code ?? normalizeDescription(l.description)),
  );
  const notOnBill = eob.lines.filter(
    (l) => !billKeys.has(l.code ?? normalizeDescription(l.description)),
  );

  if (notOnEob.length > 0) {
    findings.push({
      code: 'CHARGE_NOT_ON_EOB',
      severity: 'REVIEW',
      title: 'Some charges do not appear on the EOB',
      explanation:
        `${notOnEob.length} ${notOnEob.length === 1 ? 'charge' : 'charges'} on ` +
        `the statement could not be matched to a line on the explanation of ` +
        `benefits. Wording differs between documents quite often, so this is a ` +
        `starting point for a question rather than a conclusion.`,
      recommendedAction:
        'Ask whether these charges were submitted to your insurer, and if so, under which claim.',
      confidence: 'MEDIUM',
      evidence: notOnEob.slice(0, 20).map((item) => ({
        documentId: bill.documentId,
        page: item.page,
        fieldPath: `lineItems[${item.index}]`,
        observed: {
          description: item.description,
          code: item.code,
          amount: formatMoney(item.amountCents, bill.currency),
        },
      })),
      isAiGenerated: false,
    });
  }

  if (notOnBill.length > 0) {
    findings.push({
      code: 'EOB_LINE_NOT_ON_BILL',
      severity: 'INFO',
      title: 'The EOB lists services that are not on this statement',
      explanation:
        `${notOnBill.length} ${notOnBill.length === 1 ? 'line' : 'lines'} on the ` +
        `explanation of benefits could not be matched to this statement. That is ` +
        `normal when a claim covers more than one statement.`,
      confidence: 'MEDIUM',
      evidence: notOnBill.slice(0, 20).map((line) => ({
        documentId: eob.documentId,
        fieldPath: `lines[${line.index}]`,
        observed: { description: line.description, code: line.code },
      })),
      isAiGenerated: false,
    });
  }

  return findings;
}

/** The same coded service billed at different amounts on the two documents. */
export function checkBilledAmountAgreement(
  bill: BillDocument,
  eob: EobDocument,
  options: RuleOptions = {},
): Finding[] {
  const tolerance = options.toleranceCents ?? DEFAULT_TOLERANCE_CENTS;
  const findings: Finding[] = [];

  const eobByCode = new Map<string, (typeof eob.lines)[number]>();
  for (const line of eob.lines) {
    if (line.code !== undefined) eobByCode.set(line.code, line);
  }

  for (const item of bill.lineItems) {
    if (item.code === undefined) continue;
    const match = eobByCode.get(item.code);
    if (match?.billedCents === undefined) continue;

    const difference = item.amountCents - match.billedCents;
    if (Math.abs(difference) <= tolerance) continue;

    findings.push({
      code: 'BILLED_AMOUNT_DIFFERS_FROM_EOB',
      severity: 'REVIEW',
      title: 'A charge is a different amount on the EOB',
      explanation:
        `Code ${item.code} ("${item.description}") is ` +
        `${formatMoney(item.amountCents, bill.currency)} on the statement and ` +
        `${formatMoney(match.billedCents, eob.currency)} on the explanation of ` +
        `benefits, a difference of ` +
        `${formatMoney(Math.abs(difference), bill.currency)}.`,
      recommendedAction:
        'Ask the billing office which amount was submitted to your insurer.',
      confidence: combineConfidence([item.confidence, match.confidence]),
      evidence: [
        {
          documentId: bill.documentId,
          page: item.page,
          fieldPath: `lineItems[${item.index}]`,
          observed: {
            code: item.code,
            amount: formatMoney(item.amountCents, bill.currency),
          },
        },
        {
          documentId: eob.documentId,
          fieldPath: `lines[${match.index}]`,
          observed: {
            code: match.code,
            billed: formatMoney(match.billedCents, eob.currency),
          },
        },
      ],
      isAiGenerated: false,
    });
  }

  return findings;
}

/** Codes for every check this engine version runs, for the audit trail. */
export const BILL_CHECKS: readonly FindingCode[] = [
  'MISSING_REQUIRED_FIELD',
  'LINE_ITEM_SUM_MISMATCH',
  'TOTAL_RECONCILIATION_MISMATCH',
  'DUPLICATE_LINE_ITEM',
  'REPEATED_SERVICE_DESCRIPTION',
  'QUANTITY_PRICE_MISMATCH',
  'MISSING_ITEMIZATION',
  'SERVICE_DATE_AFTER_STATEMENT_DATE',
];

export const EOB_CHECKS: readonly FindingCode[] = [
  'BILL_EXCEEDS_EOB_PATIENT_RESPONSIBILITY',
  'EOB_PLAN_PAYMENT_NOT_REFLECTED',
  'CHARGE_NOT_ON_EOB',
  'EOB_LINE_NOT_ON_BILL',
  'BILLED_AMOUNT_DIFFERS_FROM_EOB',
];
