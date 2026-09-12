/**
 * Finding printed totals by their labels.
 *
 * Structured readers return line items well and totals badly on hospital
 * statements. This is the deterministic backstop, and these are the layouts
 * it has to survive.
 */

import { describe, expect, it } from 'vitest';
import { type FoundTotals, backfillTotals, findTotalsInText } from '@/domain/documents/totals';
import { mapAzureInvoice } from '@/lib/documents/extract/azure';

const UB04_STYLE = `
MERCY GENERAL HOSPITAL          STATEMENT OF ACCOUNT
Patient: J DOE      Account: 4471-22      Statement date 03/05/2026

0110  ROOM & BOARD - SEMI-PRIVATE T*        72,624.00
0250  PHARMACY - GENERAL CLASSIFICA*        11,152.32
0270  MEDICAL/SURGICAL SUPPLIES AND*        11,115.53
0370  ANESTHESIA - GENERAL CLASSIFI*        31,049.61

                    TOTAL CHARGES ............ $292,643.73
                    INSURANCE PAYMENTS ........ (210,000.00)
                    CONTRACTUAL ADJUSTMENTS ....  (62,643.73)
                    PATIENT BALANCE ............   $20,000.00

Previous balance: $0.00
`;

describe('findTotalsInText', () => {
  it('reads a UB-04 style hospital statement', () => {
    const t = findTotalsInText(UB04_STYLE);
    expect(t.total?.amountCents).toBe(29264373);
    expect(t.amountDue?.amountCents).toBe(2000000);
    expect(t.insurancePaid?.amountCents).toBe(-21000000);
    expect(t.adjustments?.amountCents).toBe(-6264373);
    expect(t.previousBalance?.amountCents).toBe(0);
    expect(t.total?.confidence).toBe('MEDIUM');
  });

  it('takes the LAST total, because bills put the grand total at the bottom', () => {
    const t = findTotalsInText(`
      Room charges total 500.00
      Pharmacy total 200.00
      TOTAL 700.00
    `);
    expect(t.total?.amountCents).toBe(70000);
  });

  // "Total amount due $500" is an amount due, and must not ALSO be read as a
  // total of $500 by the more generic rule that runs afterwards.
  it('does not let a generic label re-read a specific one', () => {
    const t = findTotalsInText('Total amount due $500.00');
    expect(t.amountDue?.amountCents).toBe(50000);
    expect(t.total).toBeNull();
  });

  it('ignores a label whose number is not money', () => {
    const t = findTotalsInText('Total number of visits: 3\nTotal days: 12');
    expect(t.total).toBeNull();
  });

  it('does not match across lines', () => {
    const t = findTotalsInText('Total\n\nRoom & board 500.00');
    expect(t.total).toBeNull();
  });

  it('handles the wording insurers and clinics use', () => {
    expect(findTotalsInText('Amount you owe: $125.40').amountDue?.amountCents).toBe(12540);
    expect(findTotalsInText('Please pay $99.00').amountDue?.amountCents).toBe(9900);
    expect(findTotalsInText('Balance Due ... 1,204.10').amountDue?.amountCents).toBe(120410);
    expect(findTotalsInText('Plan paid $840.00').insurancePaid?.amountCents).toBe(84000);
    expect(findTotalsInText('Sub-total $12.00').subtotal?.amountCents).toBe(1200);
  });

  it('returns nothing for empty or label-free text', () => {
    const t = findTotalsInText('');
    expect(Object.values(t).every((v) => v === null)).toBe(true);
    const u = findTotalsInText('Just some words and a number 42.00');
    expect(Object.values(u).every((v) => v === null)).toBe(true);
  });
});

describe('backfillTotals', () => {
  it('fills only what the reader left empty; reader fields win', () => {
    const draft: FoundTotals = {
      subtotal: null,
      total: { amountCents: 1, confidence: 'HIGH' },
      amountDue: null,
      insurancePaid: null,
      adjustments: null,
      previousBalance: null,
    };
    const out = backfillTotals(draft, 'TOTAL CHARGES $999.00\nAMOUNT DUE $50.00');
    expect(out.total?.amountCents).toBe(1); // reader's, untouched
    expect(out.amountDue?.amountCents).toBe(5000); // scanned
  });
});

describe('Azure backfill from OCR content', () => {
  // What actually happened on the first production upload: 14 line items, no
  // InvoiceTotal, no AmountDue, while the OCR text plainly said both.
  it('recovers totals the invoice model missed', () => {
    const d = mapAzureInvoice(
      {
        status: 'succeeded',
        analyzeResult: {
          content: UB04_STYLE,
          pages: [{}],
          documents: [
            {
              fields: {
                Items: {
                  valueArray: [
                    {
                      valueObject: {
                        Description: { valueString: 'ROOM & BOARD - SEMI-PRIVATE T*', confidence: 0.9 },
                        Amount: { valueCurrency: { amount: 72624, currencyCode: 'USD' }, confidence: 0.9 },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
      1,
    );
    expect(d.total?.amountCents).toBe(29264373);
    expect(d.amountDue?.amountCents).toBe(2000000);
    expect(d.insurancePaid?.amountCents).toBe(-21000000);
    expect(d.notes.join(' ')).not.toMatch(/No total was found/);
  });
});

/**
 * The exact OCR text Azure produced from the first real production upload:
 * a photographed hospital statement, label and amount on separate lines,
 * footnote asterisks, sign after the dollar, and the left edge clipped so
 * "Insurance" became "surance". This is what the scan has to survive.
 */
const REAL_OCR_LAYOUT = `
Summary of Charges
ROOM & BOARD - SEMI-PRIVATE T*
$72,624.00
PHARMACY - GENERAL CLASSIFICA*
$11,152.32
OTHER DIAGNOSTIC SERVICES - G*
$14,822.78
Pre-discount Charges*
$292,643.73
Hospital Discount to Patient*
$-171,196.61
surance Payments Received
$0.00
atient Payments Received
$0.00
ctual Discounted Charges Pending with Insurance*
$121,447.12
The Medical Center provides discounts for services covered by most insurance plans, and
`;

describe('the real photographed-statement layout', () => {
  it('reads every total with label and amount on separate lines', () => {
    const t = findTotalsInText(REAL_OCR_LAYOUT);
    expect(t.total?.amountCents).toBe(29264373);
    expect(t.adjustments?.amountCents).toBe(-17119661);
    expect(t.insurancePaid?.amountCents).toBe(0);
    expect(t.amountDue?.amountCents).toBe(12144712);
  });

  it('does not read a line-item code as money', () => {
    // "0110" must never become $11.00 for a heading above it.
    const t = findTotalsInText('Summary of Charges\n0110 ROOM & BOARD 500.00\nTotal\n0250 PHARMACY 12.00');
    expect(t.total).toBeNull();
  });

  it('does not let a blank line carry a heading onto a list amount', () => {
    const t = findTotalsInText('Total\n\n$500.00');
    expect(t.total).toBeNull();
  });

  it('keeps patient payments out of insurance paid', () => {
    const t = findTotalsInText('Insurance Payments Received\n$840.00\nPatient Payments Received\n$25.00');
    expect(t.insurancePaid?.amountCents).toBe(84000);
  });

  it('matches a label whose leading word was clipped off the photo', () => {
    const t = findTotalsInText('surance Payments Received\n$840.00');
    expect(t.insurancePaid?.amountCents).toBe(84000);
  });
});

describe('parseMoneyToCents with sign after the currency mark', () => {
  it('reads $-171,196.61 and -$12.00 alike', async () => {
    const { parseMoneyToCents } = await import('@/domain/documents/draft');
    expect(parseMoneyToCents('$-171,196.61')).toBe(-17119661);
    expect(parseMoneyToCents('-$12.00')).toBe(-1200);
    expect(parseMoneyToCents('$ -5.00')).toBe(-500);
  });
});
