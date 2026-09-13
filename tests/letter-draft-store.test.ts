/**
 * A letter form kept in the browser: restored when it should be, discarded
 * when it is stale, for a template no longer offered, or junk.
 */

import { describe, expect, it } from 'vitest';
import type { StorageLike } from '@/domain/checker/handoff';
import {
  LETTER_DRAFT_TTL_MS,
  clearLetterDraft,
  letterDraftKey,
  readLetterDraft,
  writeLetterDraft,
} from '@/domain/letters/draft-store';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const CASE = 'c1';
const TEMPLATE = 'REQUEST_ITEMIZED_BILL';
const OFFERED = [TEMPLATE, 'REQUEST_BILLING_CLARIFICATION'];
const NOW = new Date('2026-09-13T12:00:00Z');
const draft = { values: { account: '123', name: 'A' }, docIds: ['d1'], findingIds: [] };

describe('letter draft store', () => {
  it('round-trips what was typed', () => {
    const s = memoryStorage();
    writeLetterDraft(s, CASE, TEMPLATE, draft, NOW);
    expect(readLetterDraft(s, CASE, TEMPLATE, OFFERED, NOW)).toEqual(draft);
  });

  it('keeps drafts apart by case and template', () => {
    const s = memoryStorage();
    writeLetterDraft(s, CASE, TEMPLATE, draft, NOW);
    expect(readLetterDraft(s, 'c2', TEMPLATE, OFFERED, NOW)).toBeNull();
    expect(readLetterDraft(s, CASE, 'REQUEST_BILLING_CLARIFICATION', OFFERED, NOW)).toBeNull();
  });

  it('discards a draft older than thirty days', () => {
    const s = memoryStorage();
    writeLetterDraft(s, CASE, TEMPLATE, draft, NOW);
    const later = new Date(NOW.getTime() + LETTER_DRAFT_TTL_MS + 1);
    expect(readLetterDraft(s, CASE, TEMPLATE, OFFERED, later)).toBeNull();
    expect(s.data.has(letterDraftKey(CASE, TEMPLATE))).toBe(false);
  });

  it('keeps a draft exactly thirty days old', () => {
    const s = memoryStorage();
    writeLetterDraft(s, CASE, TEMPLATE, draft, NOW);
    const later = new Date(NOW.getTime() + LETTER_DRAFT_TTL_MS);
    expect(readLetterDraft(s, CASE, TEMPLATE, OFFERED, later)).toEqual(draft);
  });

  it('discards a draft for a template the page no longer offers', () => {
    const s = memoryStorage();
    writeLetterDraft(s, CASE, TEMPLATE, draft, NOW);
    expect(readLetterDraft(s, CASE, TEMPLATE, ['SOMETHING_ELSE'], NOW)).toBeNull();
    expect(s.data.size).toBe(0);
  });

  it('discards a draft saved in the future, junk, and the wrong version', () => {
    const key = letterDraftKey(CASE, TEMPLATE);
    for (const raw of [
      'not json',
      '[]',
      'null',
      JSON.stringify({ version: 2, savedAt: NOW.toISOString(), values: {} }),
      JSON.stringify({ version: 1, savedAt: 'yesterday', values: {} }),
      JSON.stringify({ version: 1, savedAt: '2026-09-14T00:00:00Z', values: {} }),
      JSON.stringify({ version: 1, savedAt: NOW.toISOString(), values: 'x' }),
    ]) {
      const s = memoryStorage({ [key]: raw });
      expect(readLetterDraft(s, CASE, TEMPLATE, OFFERED, NOW), raw).toBeNull();
      expect(s.data.has(key), raw).toBe(false);
    }
  });

  it('keeps only string values and string ids', () => {
    const key = letterDraftKey(CASE, TEMPLATE);
    const s = memoryStorage({
      [key]: JSON.stringify({
        version: 1,
        savedAt: NOW.toISOString(),
        values: { a: 'x', b: 2, c: null },
        docIds: ['d', 3],
        findingIds: 'no',
      }),
    });
    expect(readLetterDraft(s, CASE, TEMPLATE, OFFERED, NOW)).toEqual({ values: { a: 'x' }, docIds: [], findingIds: [] });
  });

  it('removes the draft rather than keeping an empty one', () => {
    const s = memoryStorage();
    writeLetterDraft(s, CASE, TEMPLATE, draft, NOW);
    writeLetterDraft(s, CASE, TEMPLATE, { values: { account: '  ' }, docIds: [], findingIds: [] }, NOW);
    expect(s.data.size).toBe(0);
  });

  it('clears on demand and tolerates a storage that throws', () => {
    const s = memoryStorage();
    writeLetterDraft(s, CASE, TEMPLATE, draft, NOW);
    clearLetterDraft(s, CASE, TEMPLATE);
    expect(s.data.size).toBe(0);

    const broken: StorageLike = {
      getItem: () => {
        throw new Error('no');
      },
      setItem: () => {
        throw new Error('no');
      },
      removeItem: () => {
        throw new Error('no');
      },
    };
    expect(() => writeLetterDraft(broken, CASE, TEMPLATE, draft, NOW)).not.toThrow();
    expect(readLetterDraft(broken, CASE, TEMPLATE, OFFERED, NOW)).toBeNull();
    expect(() => clearLetterDraft(broken, CASE, TEMPLATE)).not.toThrow();
    expect(readLetterDraft(null, CASE, TEMPLATE, OFFERED, NOW)).toBeNull();
  });
});
