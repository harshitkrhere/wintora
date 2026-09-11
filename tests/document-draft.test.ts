/**
 * Turning what a reader saw into a draft the customer reviews.
 *
 * Money parsing is the part that must not be clever. A wrong amount confirmed
 * by a tired customer becomes a wrong finding; a blank they have to fill in
 * does not. So ambiguity returns null, every time.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  confidenceFromScore,
  lowestConfidence,
  parseDateToIso,
  parseMoneyToCents,
} from '@/domain/documents/draft';
import { type AzureAnalyzeResult, mapAzureInvoice } from '@/lib/documents/extract/azure';
import { structureText } from '@/lib/documents/extract/structure';

describe('parseMoneyToCents', () => {
  it('parses the ways bills print money', () => {
    expect(parseMoneyToCents('$1,234.56')).toBe(123456);
    expect(parseMoneyToCents('1234.56')).toBe(123456);
    expect(parseMoneyToCents('1,234')).toBe(123400);
    expect(parseMoneyToCents('US$ 12.00')).toBe(1200);
    expect(parseMoneyToCents('12.00 USD')).toBe(1200);
    expect(parseMoneyToCents('C$45.10')).toBe(4510);
    expect(parseMoneyToCents('1 234,56')).toBe(123456);
    expect(parseMoneyToCents('1.234,56')).toBe(123456);
  });

  it('treats parentheses and a minus as a credit', () => {
    expect(parseMoneyToCents('(12.00)')).toBe(-1200);
    expect(parseMoneyToCents('-12.00')).toBe(-1200);
  });

  it('returns null for anything ambiguous rather than guessing', () => {
    for (const bad of ['', '  ', 'twelve', '12.345', '1,23', '12..00', '$', 'N/A', '12-00']) {
      expect(parseMoneyToCents(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents(undefined)).toBeNull();
  });
});

describe('parseDateToIso', () => {
  it('handles ISO, North American, and written forms', () => {
    expect(parseDateToIso('2026-03-05')).toBe('2026-03-05');
    expect(parseDateToIso('03/05/2026')).toBe('2026-03-05');
    expect(parseDateToIso('3/5/2026')).toBe('2026-03-05');
    expect(parseDateToIso('Mar 5, 2026')).toBe('2026-03-05');
    expect(parseDateToIso('March 5 2026')).toBe('2026-03-05');
    expect(parseDateToIso('5 Mar 2026')).toBe('2026-03-05');
  });

  it('returns null for an impossible or unrecognised date', () => {
    expect(parseDateToIso('13/40/2026')).toBeNull();
    expect(parseDateToIso('sometime')).toBeNull();
    expect(parseDateToIso('')).toBeNull();
  });
});

describe('confidence', () => {
  it('maps provider scores onto three levels, with the bottom open', () => {
    expect(confidenceFromScore(0.95)).toBe('HIGH');
    expect(confidenceFromScore(0.75)).toBe('MEDIUM');
    expect(confidenceFromScore(0.2)).toBe('LOW');
    expect(confidenceFromScore(undefined)).toBe('LOW');
  });

  it('takes the lowest across fields', () => {
    expect(lowestConfidence(['HIGH', 'MEDIUM', 'HIGH'])).toBe('MEDIUM');
    expect(lowestConfidence(['HIGH', null, undefined])).toBe('HIGH');
    expect(lowestConfidence([])).toBe('HIGH');
  });
});

describe('mapAzureInvoice', () => {
  const recorded: AzureAnalyzeResult = {
    status: 'succeeded',
    analyzeResult: {
      pages: [{}, {}],
      documents: [
        {
          fields: {
            VendorName: { valueString: 'Mercy General Hospital', confidence: 0.97 },
            InvoiceId: { valueString: 'ACCT-4471', confidence: 0.91 },
            InvoiceDate: { valueDate: '2026-03-05', confidence: 0.93 },
            SubTotal: { valueCurrency: { amount: 1240, currencyCode: 'USD' }, confidence: 0.88 },
            InvoiceTotal: { valueCurrency: { amount: 1420, currencyCode: 'USD' }, confidence: 0.95 },
            AmountDue: { valueCurrency: { amount: 1420, currencyCode: 'USD' }, confidence: 0.94 },
            Items: {
              valueArray: [
                {
                  valueObject: {
                    Description: { valueString: 'ER visit level 3', confidence: 0.92 },
                    ProductCode: { valueString: '99283', confidence: 0.9 },
                    Amount: { valueCurrency: { amount: 840, currencyCode: 'USD' }, confidence: 0.96 },
                  },
                },
                {
                  valueObject: {
                    Description: { valueString: 'CT head w/o contrast', confidence: 0.6 },
                    Amount: { valueCurrency: { amount: 400, currencyCode: 'USD' }, confidence: 0.55 },
                  },
                },
                { valueObject: { Description: { valueString: 'Misc supplies', confidence: 0.8 } } },
              ],
            },
          },
        },
      ],
    },
  };

  it('maps fields, cents, codes, and per-field confidence', () => {
    const d = mapAzureInvoice(recorded, 2);
    expect(d.engine).toBe('azure-invoice');
    expect(d.currency).toBe('USD');
    expect(d.pageCount).toBe(2);
    expect(d.providerName?.value).toBe('Mercy General Hospital');
    expect(d.accountReference?.value).toBe('ACCT-4471');
    expect(d.statementDate?.value).toBe('2026-03-05');
    expect(d.subtotal?.amountCents).toBe(124000);
    expect(d.total?.amountCents).toBe(142000);
    expect(d.lineItems).toHaveLength(3);
    expect(d.lineItems[0]).toMatchObject({ description: 'ER visit level 3', code: '99283', amountCents: 84000, confidence: 'HIGH' });
    expect(d.lineItems[1]?.confidence).toBe('LOW');
    expect(d.lineItems[2]?.amountCents).toBeNull();
  });

  it('reports the lowest confidence overall and notes the blank amount', () => {
    const d = mapAzureInvoice(recorded, 2);
    expect(d.overallConfidence).toBe('LOW');
    expect(d.notes.join(' ')).toMatch(/1 line item had no readable amount/);
  });

  it('survives an empty result', () => {
    const d = mapAzureInvoice({ status: 'succeeded', analyzeResult: {} }, null);
    expect(d.lineItems).toEqual([]);
    expect(d.total).toBeNull();
    expect(d.notes.join(' ')).toMatch(/No total was found/);
  });

  it('leaves the currency null when it is not USD or CAD', () => {
    const d = mapAzureInvoice(
      { analyzeResult: { documents: [{ fields: { InvoiceTotal: { valueCurrency: { amount: 1, currencyCode: 'EUR' } } } }] } },
      1,
    );
    expect(d.currency).toBeNull();
  });
});

describe('structureText', () => {
  const BILL_TEXT = [
    'MERCY GENERAL HOSPITAL   Statement date: 03/05/2026',
    'Patient: Jane Doe   Account: 4471-22   DOB 01/02/1980   SSN 123-45-6789',
    'ER visit level 3   99283   $840.00',
    'CT head w/o contrast   70450   $400.00',
    'Subtotal $1,240.00   Insurance paid $0.00   Amount due $1,420.00',
  ].join('\n');

  it('never sends identifiers to the model, and keeps the amounts', async () => {
    let sent = '';
    const provider = {
      name: 'fake',
      complete: async ({ user }: { user: string }) => {
        sent = user;
        return JSON.stringify({ currency: 'USD', lineItems: [] });
      },
    };
    await structureText(BILL_TEXT, { engine: 'pdf-text', pageCount: 1, provider });

    expect(sent).not.toContain('123-45-6789');
    expect(sent).not.toContain('Jane Doe');
    expect(sent).toContain('$840.00');
    expect(sent).toContain('$1,420.00');
    expect(sent).toContain('<document>');
  });

  // The model returns strings; WE parse money. This is the rule that stops a
  // model that "helpfully" converts $1,234.56 to 123456 and drops a digit.
  it('parses money itself from the strings the model returns', async () => {
    const provider = {
      name: 'fake',
      complete: async () =>
        '```json\n' +
        JSON.stringify({
          currency: 'USD',
          statementDate: '03/05/2026',
          subtotal: '$1,240.00',
          amountDue: '$1,420.00',
          lineItems: [
            { description: 'ER visit level 3', code: '99283', amount: '$840.00' },
            { description: 'CT head', amount: 'see attached' },
          ],
        }) +
        '\n```',
    };
    const d = await structureText(BILL_TEXT, { engine: 'pdf-text', pageCount: 1, provider });

    expect(d.subtotal?.amountCents).toBe(124000);
    expect(d.amountDue?.amountCents).toBe(142000);
    expect(d.statementDate?.value).toBe('2026-03-05');
    expect(d.lineItems[0]).toMatchObject({ code: '99283', amountCents: 84000 });
    expect(d.lineItems[1]?.amountCents).toBeNull();
    expect(d.overallConfidence).toBe('LOW');
    expect(d.notes.join(' ')).toMatch(/Check each one/);
  });

  it('returns an empty draft with a plain note when the model misbehaves', async () => {
    const provider = { name: 'fake', complete: async () => 'Sure! Here is the bill: total is 1420' };
    const d = await structureText(BILL_TEXT, { engine: 'pdf-text', pageCount: 1, provider });
    expect(d.lineItems).toEqual([]);
    expect(d.notes[0]).toMatch(/could not be laid out reliably/);
  });

  it('returns an empty draft when the model errors, never throws', async () => {
    const provider = { name: 'fake', complete: vi.fn().mockRejectedValue(new Error('429')) };
    const d = await structureText(BILL_TEXT, { engine: 'pdf-text', pageCount: 1, provider });
    expect(d.lineItems).toEqual([]);
    expect(d.notes[0]).toMatch(/unavailable/);
  });

  it('returns an empty draft when no provider is configured', async () => {
    const d = await structureText(BILL_TEXT, { engine: 'pdf-text', pageCount: 1, provider: null });
    expect(d.notes[0]).toMatch(/No reader is configured/);
  });
});
