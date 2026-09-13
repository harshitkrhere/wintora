/**
 * The one unprompted message about a case: who is eligible, and when.
 */

import { describe, expect, it } from 'vitest';
import { NUDGE_AFTER_DAYS, nudgeEligible, nudgeKey, type NudgeCandidate } from '@/domain/email/nudge';

const now = new Date('2026-09-13T12:00:00Z');
const daysAgo = (n: number): string => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const base: NudgeCandidate = {
  status: 'OPEN',
  documentCount: 1,
  sentLetterCount: 0,
  lastEventAt: daysAgo(4),
  updatedAt: daysAgo(4),
};

describe('nudgeEligible', () => {
  it('a document, no letter sent, quiet for three days: eligible', () => {
    expect(nudgeEligible(base, now)).toBe(true);
    expect(nudgeEligible({ ...base, lastEventAt: daysAgo(NUDGE_AFTER_DAYS), updatedAt: daysAgo(NUDGE_AFTER_DAYS) }, now)).toBe(true);
  });

  it('no document: not eligible', () => {
    expect(nudgeEligible({ ...base, documentCount: 0 }, now)).toBe(false);
  });

  it('a letter already sent: not eligible', () => {
    expect(nudgeEligible({ ...base, sentLetterCount: 1 }, now)).toBe(false);
  });

  it('activity within three days, on the timeline or on the case, resets the clock', () => {
    expect(nudgeEligible({ ...base, lastEventAt: daysAgo(1) }, now)).toBe(false);
    expect(nudgeEligible({ ...base, updatedAt: daysAgo(2) }, now)).toBe(false);
    expect(nudgeEligible({ ...base, lastEventAt: daysAgo(2.9) }, now)).toBe(false);
  });

  it('a closed case is never nudged', () => {
    expect(nudgeEligible({ ...base, status: 'CLOSED' }, now)).toBe(false);
  });

  it('once per case, ever: the log key is the case, not the day', () => {
    expect(nudgeKey('abc')).toBe('email_nudge_unsent_abc');
    expect(nudgeKey('abc')).toBe(nudgeKey('abc'));
  });
});
