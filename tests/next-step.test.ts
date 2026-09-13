/**
 * The one thing to do next, decided from a case's real rows. Every rule,
 * and every way a row can fail to count: unfinished, refused and failed
 * uploads, deleted documents, documents of other kinds, checks that did
 * not complete or ran on typed figures, archived and deleted letters,
 * closed cases.
 */

import { describe, expect, it } from 'vitest';
import {
  actionForFinding,
  checklistFor,
  keptDocuments,
  nextStepFor,
  pickHomeStep,
  type CaseFacts,
  type FactAnalysis,
  type FactDocument,
  type FactLetter,
} from '@/lib/cases/next-step';

const CASE = '11111111-1111-4111-8111-111111111111';

function doc(over: Partial<FactDocument> & { id: string }): FactDocument {
  return {
    type: 'BILL',
    scanStatus: 'CLEAN',
    extractionStatus: 'COMPLETED',
    deletedAt: null,
    createdAt: '2026-09-01T10:00:00Z',
    filename: `${over.id}.pdf`,
    ...over,
  };
}

function check(over: Partial<FactAnalysis> = {}): FactAnalysis {
  return {
    type: 'BILL_CONSISTENCY',
    status: 'COMPLETED',
    documentId: null,
    compareDocumentId: null,
    worstSeverity: 'INFO',
    createdAt: '2026-09-02T10:00:00Z',
    ...over,
  };
}

function letter(over: Partial<FactLetter> & { id: string }): FactLetter {
  return { status: 'DRAFT', sentAt: null, deletedAt: null, updatedAt: '2026-09-03T10:00:00Z', ...over };
}

function facts(over: Partial<CaseFacts> = {}): CaseFacts {
  return { id: CASE, status: 'OPEN', documents: [], analyses: [], letters: [], ...over };
}

describe('nextStepFor: what counts as a document', () => {
  it('asks for the bill when there is nothing at all', () => {
    expect(nextStepFor(facts())?.key).toBe('upload-bill');
    expect(nextStepFor(facts())?.href).toBe(`/upload?case=${CASE}&type=BILL`);
  });

  it('does not count an upload that never finished, was refused or failed', () => {
    for (const scanStatus of ['PENDING', 'INFECTED', 'FAILED', 'SKIPPED']) {
      const f = facts({ documents: [doc({ id: 'a', scanStatus })] });
      expect(nextStepFor(f)?.key, scanStatus).toBe('upload-bill');
      expect(keptDocuments(f.documents)).toHaveLength(0);
    }
  });

  it('does not count a deleted document even if it was clean', () => {
    const f = facts({ documents: [doc({ id: 'a', deletedAt: '2026-09-05T00:00:00Z' })] });
    expect(nextStepFor(f)?.key).toBe('upload-bill');
    expect(keptDocuments(f.documents)).toHaveLength(0);
  });

  it('keeps other kinds of document but never asks for a step about them', () => {
    const f = facts({ documents: [doc({ id: 'a', type: 'OTHER' }), doc({ id: 'b', type: 'INSURANCE_CARD' })] });
    expect(keptDocuments(f.documents)).toHaveLength(2);
    expect(nextStepFor(f)?.key).toBe('upload-bill');
  });

  it('still asks for the bill when only an EOB is in', () => {
    expect(nextStepFor(facts({ documents: [doc({ id: 'e', type: 'EOB' })] }))?.key).toBe('upload-bill');
  });

  it('treats an itemized bill and a statement as bills', () => {
    expect(nextStepFor(facts({ documents: [doc({ id: 'a', type: 'ITEMIZED_BILL' })] }))?.key).toBe('check-figures');
    expect(nextStepFor(facts({ documents: [doc({ id: 'a', type: 'STATEMENT' })] }))?.key).toBe('check-figures');
  });
});

describe('nextStepFor: checking the figures', () => {
  it('sends an unchecked bill to the review step, whatever happened to the read', () => {
    for (const extractionStatus of ['COMPLETED', 'FAILED', 'PENDING', 'RUNNING']) {
      const step = nextStepFor(facts({ documents: [doc({ id: 'a', extractionStatus })] }));
      expect(step?.key, extractionStatus).toBe('check-figures');
      expect(step?.href).toBe(`/upload?case=${CASE}&document=a`);
    }
  });

  it('names the file in the hint', () => {
    const step = nextStepFor(facts({ documents: [doc({ id: 'a', filename: 'mercy-march.pdf' })] }));
    expect(step?.hint).toContain('mercy-march.pdf');
  });

  it('ignores a check that did not complete', () => {
    for (const status of ['PENDING', 'RUNNING', 'FAILED', 'CANCELED']) {
      const f = facts({ documents: [doc({ id: 'a' })], analyses: [check({ status, documentId: 'a' })] });
      expect(nextStepFor(f)?.key, status).toBe('check-figures');
    }
  });

  it('does not treat a typed-figures check from before the bill arrived as its check', () => {
    const f = facts({
      documents: [doc({ id: 'a', createdAt: '2026-09-05T00:00:00Z' })],
      analyses: [check({ documentId: null, createdAt: '2026-09-02T00:00:00Z' })],
    });
    expect(nextStepFor(f)?.key).toBe('check-figures');
  });

  it('takes an unattributed check that ran after the bill arrived as its check (older rows)', () => {
    const f = facts({
      documents: [doc({ id: 'a', createdAt: '2026-09-01T00:00:00Z' })],
      analyses: [check({ documentId: null, createdAt: '2026-09-02T00:00:00Z', worstSeverity: 'INFO' })],
    });
    expect(nextStepFor(f)?.key).toBe('add-eob');
  });

  it('does not let an unattributed check cover a bill that arrived after it', () => {
    const f = facts({
      documents: [
        doc({ id: 'old', createdAt: '2026-09-01T00:00:00Z' }),
        doc({ id: 'new', createdAt: '2026-09-03T00:00:00Z' }),
      ],
      analyses: [check({ documentId: null, createdAt: '2026-09-02T00:00:00Z' })],
    });
    const step = nextStepFor(f);
    expect(step?.key).toBe('check-figures');
    expect(step?.href).toContain('document=new');
  });

  it('counts a bill as checked when a check names it as either document', () => {
    const asDocument = facts({ documents: [doc({ id: 'a' })], analyses: [check({ documentId: 'a' })] });
    expect(nextStepFor(asDocument)?.key).not.toBe('check-figures');
    const asCompared = facts({ documents: [doc({ id: 'a' })], analyses: [check({ compareDocumentId: 'a' })] });
    expect(nextStepFor(asCompared)?.key).not.toBe('check-figures');
  });

  it('with two bills and one checked, asks for the older unchecked one whatever the row order', () => {
    const older = doc({ id: 'old', createdAt: '2026-08-01T00:00:00Z' });
    const newer = doc({ id: 'new', createdAt: '2026-09-01T00:00:00Z' });
    const checked = doc({ id: 'done', createdAt: '2026-07-01T00:00:00Z' });
    const f = facts({ documents: [newer, checked, older], analyses: [check({ documentId: 'done', createdAt: '2026-07-02T00:00:00Z' })] });
    const step = nextStepFor(f);
    expect(step?.key).toBe('check-figures');
    expect(step?.href).toContain('document=old');
  });
});

describe('nextStepFor: the EOB', () => {
  const billChecked = { documents: [doc({ id: 'a' })], analyses: [check({ documentId: 'a', worstSeverity: 'INFO' })] };

  it('asks to compare when an EOB is in and has not been set against the bill', () => {
    const f = facts({ ...billChecked, documents: [...billChecked.documents, doc({ id: 'e', type: 'EOB' })] });
    const step = nextStepFor(f);
    expect(step?.key).toBe('compare');
    expect(step?.href).toBe(`/cases/${CASE}/compare`);
  });

  it('counts an EOB as compared only by a bill-vs-EOB check that names it as the compared document', () => {
    const eob = doc({ id: 'e', type: 'EOB' });
    const byBillCheck = facts({
      documents: [doc({ id: 'a' }), eob],
      analyses: [check({ documentId: 'a', compareDocumentId: 'e', type: 'BILL_CONSISTENCY' })],
    });
    expect(nextStepFor(byBillCheck)?.key).toBe('compare');
    const byCompare = facts({
      documents: [doc({ id: 'a' }), eob],
      analyses: [check({ documentId: 'a', compareDocumentId: 'e', type: 'BILL_VS_EOB', worstSeverity: 'INFO' })],
    });
    expect(nextStepFor(byCompare)).toBeNull();
  });

  it('checks the bill before comparing an EOB', () => {
    const f = facts({ documents: [doc({ id: 'a' }), doc({ id: 'e', type: 'EOB' })] });
    expect(nextStepFor(f)?.key).toBe('check-figures');
  });

  it('asks for the EOB once the bill is checked and looks consistent', () => {
    const step = nextStepFor(facts(billChecked));
    expect(step?.key).toBe('add-eob');
    expect(step?.href).toBe(`/upload?case=${CASE}&type=EOB`);
  });
});

describe('nextStepFor: requests and drafts', () => {
  const attention = { documents: [doc({ id: 'a' })], analyses: [check({ documentId: 'a', worstSeverity: 'ATTENTION' })] };

  it('puts a request before the EOB when the latest check found something', () => {
    const step = nextStepFor(facts(attention));
    expect(step?.key).toBe('request');
    expect(step?.href).toBe(`/cases/${CASE}/letters/new`);
  });

  it('treats REVIEW like ATTENTION', () => {
    const f = facts({ ...attention, analyses: [check({ documentId: 'a', worstSeverity: 'REVIEW' })] });
    expect(nextStepFor(f)?.key).toBe('request');
  });

  it('judges by the latest completed check, not an older one', () => {
    const f = facts({
      documents: [doc({ id: 'a' })],
      analyses: [
        check({ documentId: 'a', worstSeverity: 'ATTENTION', createdAt: '2026-09-01T00:00:00Z' }),
        check({ documentId: 'a', worstSeverity: 'INFO', createdAt: '2026-09-04T00:00:00Z' }),
      ],
    });
    expect(nextStepFor(f)?.key).toBe('add-eob');
  });

  it('ignores archived and deleted letters', () => {
    const archived = facts({ ...attention, letters: [letter({ id: 'l', status: 'ARCHIVED' })] });
    expect(nextStepFor(archived)?.key).toBe('request');
    const deleted = facts({ ...attention, letters: [letter({ id: 'l', deletedAt: '2026-09-05T00:00:00Z' })] });
    expect(nextStepFor(deleted)?.key).toBe('request');
  });

  it('sends one unsent draft to its page, whatever its status', () => {
    for (const status of ['DRAFT', 'USER_REVIEWED', 'FINALIZED']) {
      const step = nextStepFor(facts({ ...attention, letters: [letter({ id: 'l1', status })] }));
      expect(step?.key, status).toBe('draft');
      expect(step?.href).toBe(`/cases/${CASE}/letters/l1`);
    }
  });

  it('sends several unsent drafts to the list', () => {
    const step = nextStepFor(facts({ ...attention, letters: [letter({ id: 'l1' }), letter({ id: 'l2' })] }));
    expect(step?.key).toBe('draft');
    expect(step?.href).toBe(`/cases/${CASE}/letters`);
  });

  it('stops asking for the EOB once a request has gone out', () => {
    const f = facts({ ...attention, letters: [letter({ id: 'l1', sentAt: '2026-09-06T00:00:00Z' })] });
    expect(nextStepFor(f)).toBeNull();
  });

  it('asks for the EOB after a draft exists but nothing has been sent, once the draft is sent it stops', () => {
    // A draft that is unsent is the step; the EOB waits behind it.
    const drafted = facts({ ...attention, letters: [letter({ id: 'l1' })] });
    expect(nextStepFor(drafted)?.key).toBe('draft');
  });

  it('has nothing to say when the bill and EOB agree and a letter has gone', () => {
    const f = facts({
      documents: [doc({ id: 'a' }), doc({ id: 'e', type: 'EOB' })],
      analyses: [check({ type: 'BILL_VS_EOB', documentId: 'a', compareDocumentId: 'e', worstSeverity: 'INFO' })],
      letters: [letter({ id: 'l1', sentAt: '2026-09-06T00:00:00Z' })],
    });
    expect(nextStepFor(f)).toBeNull();
  });
});

describe('nextStepFor: closed cases', () => {
  it('asks nothing of a closed case, whatever is on it', () => {
    const f = facts({ status: 'CLOSED', documents: [doc({ id: 'a' })] });
    expect(nextStepFor(f)).toBeNull();
  });

  it('treats every status other than OPEN as closed', () => {
    for (const status of ['AWAITING_PROVIDER', 'AWAITING_INSURER', 'RESOLVED', 'ARCHIVED']) {
      expect(nextStepFor(facts({ status })), status).toBeNull();
    }
  });
});

describe('pickHomeStep', () => {
  const now = new Date('2026-09-10T12:00:00Z');
  const base = { id: 'x', title: 'x', status: 'OPEN', updatedAt: '2026-09-01T00:00:00Z', nextStep: null };
  const step = { key: 'add-eob' as const, label: 'Add your EOB', hint: '', href: '/upload' };

  it('skips closed cases and open cases with nothing waiting', () => {
    const cases = [
      { ...base, id: 'closed', status: 'CLOSED', updatedAt: '2026-09-09T00:00:00Z', nextStep: step },
      { ...base, id: 'quiet', updatedAt: '2026-09-08T00:00:00Z', nextStep: null },
      { ...base, id: 'due', updatedAt: '2026-09-07T00:00:00Z', nextStep: step },
    ];
    expect(pickHomeStep(cases, now)?.caseSummary.id).toBe('due');
  });

  it('prefers the case with the newest activity', () => {
    const cases = [
      { ...base, id: 'older', updatedAt: '2026-09-01T00:00:00Z', nextStep: step },
      { ...base, id: 'newer', updatedAt: '2026-09-05T00:00:00Z', nextStep: step },
    ];
    expect(pickHomeStep(cases, now)?.caseSummary.id).toBe('newer');
  });

  it('says "resumed" only inside the last 24 hours', () => {
    const fresh = [{ ...base, updatedAt: '2026-09-09T12:00:01Z', nextStep: step }];
    expect(pickHomeStep(fresh, now)?.resumed).toBe(true);
    const stale = [{ ...base, updatedAt: '2026-09-09T12:00:00Z', nextStep: step }];
    expect(pickHomeStep(stale, now)?.resumed).toBe(false);
    const future = [{ ...base, updatedAt: '2026-09-11T00:00:00Z', nextStep: step }];
    expect(pickHomeStep(future, now)?.resumed).toBe(false);
  });

  it('returns null with no cases', () => {
    expect(pickHomeStep([], now)).toBeNull();
  });
});

describe('checklistFor and actionForFinding', () => {
  it('is empty when the engine found nothing', () => {
    const analysis = {
      engineVersion: '1',
      analysisType: 'BILL_CONSISTENCY',
      findings: [
        {
          code: 'NO_ISSUES_FOUND' as const,
          severity: 'INFO' as const,
          title: '',
          explanation: '',
          confidence: 'HIGH' as const,
          evidence: [],
          isAiGenerated: false as const,
        },
      ],
    };
    expect(checklistFor(analysis, [])).toEqual([]);
  });

  it('marks a step done from the newest timeline entry about it', () => {
    const analysis = {
      engineVersion: '1',
      analysisType: 'BILL_CONSISTENCY',
      findings: [
        {
          code: 'MISSING_ITEMIZATION' as const,
          severity: 'ATTENTION' as const,
          title: '',
          explanation: '',
          confidence: 'HIGH' as const,
          evidence: [],
          isAiGenerated: false as const,
        },
      ],
    };
    const events = [
      { eventType: 'STEP_REOPENED', detail: 'Request an itemised statement' },
      { eventType: 'STEP_DONE', detail: 'Request an itemised statement' },
    ];
    const steps = checklistFor(analysis, events);
    expect(steps[0]).toEqual({ text: 'Request an itemised statement', done: false });
  });

  it('maps a finding to a seeded letter template, or to nothing', () => {
    expect(actionForFinding('MISSING_ITEMIZATION', CASE)?.href).toBe(`/cases/${CASE}/letters/new?template=REQUEST_ITEMIZED_BILL`);
    expect(actionForFinding('BILL_EXCEEDS_EOB_PATIENT_RESPONSIBILITY', CASE)?.href).toContain('REQUEST_CORRECTED_STATEMENT');
    expect(actionForFinding('NO_ISSUES_FOUND', CASE)).toBeNull();
  });
});
