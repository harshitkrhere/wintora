/**
 * Document retention.
 *
 * The property under test throughout: retention is governed by the retention
 * system, not by billing. A downgrade must never delete anything on the spot,
 * and a lapsed subscription must never delete anything at all.
 */

import { describe, expect, it } from 'vitest';
import { POLICY } from '@/config/policy';
import {
  applyRetentionIncrease,
  daysUntilExpiry,
  isExpired,
  needsExpiryNotice,
  planRetentionChange,
  retentionChangeMessage,
  retentionUntil,
  selectForDeletion,
  type DocumentRetentionState,
} from '@/domain/retention/policy';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-08T00:00:00Z');

function doc(id: string, uploadedDaysAgo: number, retentionDays: number): DocumentRetentionState {
  const uploadedAt = new Date(NOW.getTime() - uploadedDaysAgo * DAY);
  return {
    documentId: id,
    uploadedAt,
    retentionUntil: new Date(uploadedAt.getTime() + retentionDays * DAY),
  };
}

describe('retention dates', () => {
  it('computes the expiry from the upload date and the plan window', () => {
    const until = retentionUntil({ uploadedAt: NOW, retentionDays: 90 });
    expect(until.toISOString()).toBe('2026-12-07T00:00:00.000Z');
  });

  it('refuses a non-positive window rather than deleting immediately', () => {
    expect(() => retentionUntil({ uploadedAt: NOW, retentionDays: 0 })).toThrow(RangeError);
    expect(() => retentionUntil({ uploadedAt: NOW, retentionDays: -5 })).toThrow(RangeError);
  });

  it('reports days remaining and expiry', () => {
    const until = new Date(NOW.getTime() + 5 * DAY);
    expect(daysUntilExpiry(until, NOW)).toBe(5);
    expect(isExpired(until, NOW)).toBe(false);
    expect(isExpired(new Date(NOW.getTime() - DAY), NOW)).toBe(true);
  });
});

describe('expiry notices', () => {
  it('warns inside the notice window', () => {
    const document = {
      retentionUntil: new Date(NOW.getTime() + 5 * DAY),
      retentionNoticeSentAt: null,
    };
    expect(needsExpiryNotice(document, NOW)).toBe(true);
  });

  it('does not warn too early', () => {
    const document = {
      retentionUntil: new Date(NOW.getTime() + 40 * DAY),
      retentionNoticeSentAt: null,
    };
    expect(needsExpiryNotice(document, NOW)).toBe(false);
  });

  it('does not warn twice', () => {
    const document = {
      retentionUntil: new Date(NOW.getTime() + 5 * DAY),
      retentionNoticeSentAt: new Date(NOW.getTime() - DAY),
    };
    expect(needsExpiryNotice(document, NOW)).toBe(false);
  });

  it('warns before expiry, never after', () => {
    const document = {
      retentionUntil: new Date(NOW.getTime() - DAY),
      retentionNoticeSentAt: null,
    };
    expect(needsExpiryNotice(document, NOW)).toBe(false);
  });
});

describe('downgrade', () => {
  const documents = [
    doc('old', 150, 180),
    doc('middling', 100, 180),
    doc('recent', 10, 180),
  ];

  const plan = planRetentionChange(documents, 180, 90, NOW);

  it('identifies which documents are affected', () => {
    expect(plan.isReduction).toBe(true);
    expect(plan.affected.map((a) => a.documentId)).toEqual(['old', 'middling']);
    // A document already inside the new window is untouched.
    expect(plan.affected.map((a) => a.documentId)).not.toContain('recent');
  });

  it('never deletes anything before the transition window closes', () => {
    // The case that would otherwise lose someone their records with no warning:
    // a document already past the new, shorter window.
    const old = plan.affected.find((a) => a.documentId === 'old')!;
    expect(old.newRetentionUntil.getTime()).toBeLessThan(NOW.getTime());
    expect(old.effectiveDeletionDate.getTime()).toBe(
      NOW.getTime() + POLICY.retention.transitionDays * DAY,
    );
  });

  it('gives every affected document at least the full transition window', () => {
    for (const affected of plan.affected) {
      expect(affected.effectiveDeletionDate.getTime()).toBeGreaterThanOrEqual(
        NOW.getTime() + POLICY.retention.transitionDays * DAY,
      );
    }
  });

  it('reports the transition end date', () => {
    expect(plan.transitionEndsAt?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });

  it('reports nothing affected when nothing shortens', () => {
    const noChange = planRetentionChange(documents, 180, 180, NOW);
    expect(noChange.affected).toHaveLength(0);
    expect(noChange.transitionEndsAt).toBeNull();
  });
});

describe('upgrade', () => {
  it('extends retention immediately, because a benefit needs no delay', () => {
    const document = doc('a', 10, 90);
    const extended = applyRetentionIncrease(document, 365);
    expect(extended.getTime()).toBe(document.uploadedAt.getTime() + 365 * DAY);
  });

  it('never shortens an existing window through the increase path', () => {
    const document = doc('a', 10, 365);
    const result = applyRetentionIncrease(document, 30);
    expect(result.getTime()).toBe(document.retentionUntil.getTime());
  });
});

describe('customer message', () => {
  const plan = planRetentionChange([doc('old', 150, 180)], 180, 90, NOW);
  const message = retentionChangeMessage(plan, 'Essential')!;

  it('states the facts and the date', () => {
    expect(message).toContain('90 days');
    expect(message).toContain('October 8, 2026');
    expect(message).toContain('1 document is');
  });

  it('says explicitly what is NOT affected', () => {
    // The part people actually worry about.
    expect(message).toContain('Your cases, findings and letters stay in your account');
  });

  it('does not manufacture urgency', () => {
    expect(message).not.toMatch(/act now|immediately|urgent|last chance|hurry/i);
  });

  it('returns nothing when there is nothing to say', () => {
    const noChange = planRetentionChange([doc('a', 10, 90)], 90, 180, NOW);
    expect(retentionChangeMessage(noChange, 'Plus')).toBeNull();
  });
});

describe('the sweeper', () => {
  it('selects only documents whose retention has genuinely passed', () => {
    const documents = [
      { ...doc('expired', 200, 180), deletedAt: null },
      { ...doc('live', 10, 180), deletedAt: null },
    ];

    expect(selectForDeletion(documents, NOW)).toEqual(['expired']);
  });

  it('skips documents already deleted', () => {
    const documents = [{ ...doc('expired', 200, 180), deletedAt: new Date() }];
    expect(selectForDeletion(documents, NOW)).toEqual([]);
  });

  it('deletes nothing when nothing has expired', () => {
    const documents = [{ ...doc('a', 1, 30), deletedAt: null }];
    expect(selectForDeletion(documents, NOW)).toEqual([]);
  });
});

describe('separation from billing', () => {
  it('states that retention is not governed by billing', () => {
    // A subscription lapsing must delete nothing, and a document expiring must
    // affect no subscription. The policy records that as an explicit decision.
    expect(POLICY.retention.governedByBilling).toBe(false);
    expect(POLICY.retention.plansGovernDocumentsOnly).toBe(true);
  });

  it('gives a transition window long enough to be useful', () => {
    expect(POLICY.retention.transitionDays).toBeGreaterThanOrEqual(14);
    expect(POLICY.retention.expiryNoticeDays).toBeGreaterThanOrEqual(7);
  });
});
