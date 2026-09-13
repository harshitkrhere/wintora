/**
 * Evidence appended to an advanced letter draft.
 *
 * Everything in the appendix is copied from the case record. The tests pin
 * the shape a customer sees and the limits that keep a letter a letter.
 */

import { describe, expect, it } from 'vitest';
import { appendEvidence, attachmentsFrom, evidenceAppendix } from '@/domain/letters/evidence';

const DOCS = [
  { id: 'd1', label: 'statement.pdf (uploaded Sep 1, 2026)' },
  { id: 'd2', label: 'eob.pdf (uploaded Sep 2, 2026)' },
];

const FINDINGS = [
  {
    id: 'f1',
    label: 'The line items do not add up to the subtotal',
    explanation: 'The individual charges add up to $1,830.00; the statement shows $2,030.00.',
    evidence: [
      { fieldPath: 'subtotalCents', observed: { subtotal: '$2,030.00', sumOfLines: '$1,830.00' }, expected: { subtotal: '$1,830.00' } },
    ],
  },
  {
    id: 'f2',
    label: 'A charge appears twice',
    explanation: 'Two lines have the same code and amount.',
    evidence: [{ fieldPath: 'lineItems[3]', observed: { code: '99213', amount: '$150.00' } }],
  },
];

describe('evidence appendix', () => {
  it('lists enclosures and points in question, numbered, with the figures', () => {
    const text = evidenceAppendix({ documents: DOCS, findings: FINDINGS });
    expect(text).toContain('Enclosures\n\n1. statement.pdf (uploaded Sep 1, 2026)\n2. eob.pdf');
    expect(text).toContain('Points in question\n\n1. The line items do not add up to the subtotal');
    expect(text).toContain('subtotal: as printed: subtotal $2,030.00, sum of lines $1,830.00; expected: subtotal $1,830.00');
    expect(text).toContain('2. A charge appears twice');
    expect(text).toContain('line 4: as printed: code 99213, amount $150.00');
  });

  it('is empty when there is nothing to attach, so it can be appended unconditionally', () => {
    expect(evidenceAppendix({ documents: [], findings: [] })).toBe('');
    const letter = 'Dear billing office,\n\nPlease.\n\nJane';
    expect(appendEvidence(letter, '')).toBe(letter);
  });

  it('goes after the signature, separated by blank lines', () => {
    const out = appendEvidence('Body\n\nJane\n', evidenceAppendix({ documents: DOCS, findings: [] }));
    expect(out).toBe('Body\n\nJane\n\n\nEnclosures\n\n1. statement.pdf (uploaded Sep 1, 2026)\n2. eob.pdf (uploaded Sep 2, 2026)');
  });

  it('caps the lists so a letter stays a letter', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, label: `file-${i}.pdf` }));
    const text = evidenceAppendix({ documents: many, findings: [] });
    expect(text).toContain('20. file-19.pdf');
    expect(text).not.toContain('21. file-20.pdf');
  });

  it('records what was attached, by id and label, for the case record', () => {
    expect(attachmentsFrom({ documents: DOCS.slice(0, 1), findings: FINDINGS.slice(0, 1) })).toEqual([
      { kind: 'document', id: 'd1', label: 'statement.pdf (uploaded Sep 1, 2026)' },
      { kind: 'finding', id: 'f1', label: 'The line items do not add up to the subtotal' },
    ]);
  });
});
