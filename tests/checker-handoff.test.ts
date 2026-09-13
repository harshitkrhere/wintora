/**
 * Carrying typed figures across sign-up: serialise, version, tolerate junk.
 */

import { describe, expect, it } from 'vitest';
import {
  HANDOFF_KEY,
  clearHandoff,
  handoffToDraft,
  readHandoff,
  saveHandoff,
  type HandoffFigures,
  type StorageLike,
} from '@/domain/checker/handoff';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const FIGURES: HandoffFigures = {
  currency: 'USD',
  lines: [
    { description: 'Emergency department visit', code: '99284', amount: '1,250.00' },
    { description: 'CT scan', code: '', amount: '840.00' },
  ],
  subtotal: '2090.00',
  total: '2090.00',
  adjustments: '',
  insurancePaid: '',
  tax: '',
  payments: '',
  amountDue: '2090.00',
  statementDate: '2026-08-30',
  accountReference: 'ACC-1',
};

describe('save and read', () => {
  it('round-trips the figures under the versioned key with a timestamp', () => {
    const s = memoryStorage();
    expect(saveHandoff(s, FIGURES, new Date('2026-09-13T10:00:00Z'))).toBe(true);
    expect(s.data.has(HANDOFF_KEY)).toBe(true);
    const back = readHandoff(s);
    expect(back).toMatchObject({ ...FIGURES, v: 1, savedAt: '2026-09-13T10:00:00.000Z' });
  });

  it('clears', () => {
    const s = memoryStorage();
    saveHandoff(s, FIGURES);
    clearHandoff(s);
    expect(readHandoff(s)).toBeNull();
  });

  it('returns null for missing, corrupt, wrong-version or wrong-shape data without throwing', () => {
    expect(readHandoff(memoryStorage())).toBeNull();
    expect(readHandoff(memoryStorage({ [HANDOFF_KEY]: 'not json' }))).toBeNull();
    expect(readHandoff(memoryStorage({ [HANDOFF_KEY]: '42' }))).toBeNull();
    expect(readHandoff(memoryStorage({ [HANDOFF_KEY]: JSON.stringify({ v: 2, lines: [] }) }))).toBeNull();
    expect(readHandoff(memoryStorage({ [HANDOFF_KEY]: JSON.stringify({ v: 1, lines: 'nope' }) }))).toBeNull();
  });

  it('coerces odd values inside an otherwise valid record and drops junk lines', () => {
    const raw = JSON.stringify({
      v: 1,
      currency: 'EUR',
      lines: [{ description: 'ok', amount: 12 }, 'junk', null, { description: 7 }],
      subtotal: 100,
      accountReference: 'x'.repeat(500),
    });
    const back = readHandoff(memoryStorage({ [HANDOFF_KEY]: raw }))!;
    expect(back.currency).toBe('USD');
    expect(back.lines).toEqual([
      { description: 'ok', code: '', amount: '' },
      { description: '', code: '', amount: '' },
    ]);
    expect(back.subtotal).toBe('');
    expect(back.accountReference).toHaveLength(120);
  });

  it('survives a storage that throws', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('disabled');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('disabled');
      },
    };
    expect(saveHandoff(broken, FIGURES)).toBe(false);
    expect(readHandoff(broken)).toBeNull();
    expect(() => clearHandoff(broken)).not.toThrow();
  });
});

describe('handoffToDraft', () => {
  it('turns typed strings into a draft the confirm form can pre-fill from', () => {
    const s = memoryStorage();
    saveHandoff(s, FIGURES);
    const draft = handoffToDraft(readHandoff(s)!);
    expect(draft.currency).toBe('USD');
    expect(draft.lineItems).toEqual([
      { description: 'Emergency department visit', amountCents: 125000, code: '99284', confidence: 'HIGH' },
      { description: 'CT scan', amountCents: 84000, confidence: 'HIGH' },
    ]);
    expect(draft.subtotal).toEqual({ amountCents: 209000, confidence: 'HIGH' });
    expect(draft.adjustments).toBeNull();
    expect(draft.statementDate).toEqual({ value: '2026-08-30', confidence: 'HIGH' });
    expect(draft.accountReference).toEqual({ value: 'ACC-1', confidence: 'HIGH' });
    expect(draft.providerName).toBeNull();
  });
});
