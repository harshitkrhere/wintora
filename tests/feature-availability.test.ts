/**
 * "Do not sell features you don't actually provide."
 *
 * Every customer-facing benefit list renders from the feature registry. That
 * keeps words and enforcement in one place, and it means an unbuilt feature
 * appears as "now active" the moment someone pays for it unless the registry
 * says otherwise. These tests make that declaration mandatory and keep it
 * honest as features ship.
 */

import { describe, expect, it } from 'vitest';
import { ALL_FEATURES, FEATURES } from '@/config/features';
import {
  CONFIG_PLAN_MATRIX,
  benefitList,
  computeEntitlements,
} from '@/domain/entitlements/compute';

describe('feature availability', () => {
  it('every feature declares whether a customer can use it today', () => {
    for (const feature of ALL_FEATURES) {
      expect(typeof feature.available, `${feature.key} must declare available`).toBe('boolean');
    }
  });

  // The two user-rights features must never be marked unavailable: a customer
  // can always export and delete, on every plan, including expired ones.
  it('data export and account deletion are always available', () => {
    expect(FEATURES.DATA_EXPORT.available).toBe(true);
    expect(FEATURES.ACCOUNT_DELETION.available).toBe(true);
  });

  // Update this list as features ship. It is deliberately explicit: a feature
  // becoming available should be a conscious change here, not an accident of
  // editing the registry.
  it('reflects what is actually built', () => {
    const available = ALL_FEATURES.filter((f) => f.available).map((f) => f.key).sort();
    expect(available).toEqual(
      [
        'ACCOUNT_DELETION',
        'BASIC_BILL_ANALYSIS',
        'CASE_TIMELINE',
        'CASE_TRACKING',
        'DATA_EXPORT',
        'DOCUMENT_UPLOAD',
        'EOB_COMPARISON',
        'MAX_ACTIVE_CASES',
        'MAX_FILE_SIZE_MB',
        'MONTHLY_ANALYSES',
        'MONTHLY_DOCUMENTS',
        'MULTIPLE_CASES',
        'RETENTION_DAYS',
        'STORAGE_LIMIT_MB',
      ].sort(),
    );
  });

  it('letters, reminders and household are not claimed while unbuilt', () => {
    expect(FEATURES.LETTER_GENERATION.available).toBe(false);
    expect(FEATURES.REMINDERS.available).toBe(false);
    expect(FEATURES.DEADLINE_TRACKING.available).toBe(false);
    expect(FEATURES.HOUSEHOLD_CASES.available).toBe(false);
    expect(FEATURES.ADVANCED_EXPORT.available).toBe(false);
  });

  it('benefit lines carry availability so pages cannot lose it', () => {
    const now = new Date('2026-09-11T00:00:00Z');
    const set = computeEntitlements(
      {
        status: 'ACTIVE',
        planSlug: 'plus',
        currentPeriodStart: now,
        currentPeriodEnd: new Date('2026-10-11T00:00:00Z'),
        gracePeriodEnd: null,
        pendingPlanSlug: null,
        pendingPlanEffectiveAt: null,
        pauseEnd: null,
        accountCreatedAt: now,
      },
      { matrix: CONFIG_PLAN_MATRIX, now },
    );
    const lines = benefitList(set);

    const letters = lines.find((l) => l.key === 'LETTER_GENERATION');
    const upload = lines.find((l) => l.key === 'DOCUMENT_UPLOAD');

    expect(letters?.available).toBe(false);
    expect(upload?.available).toBe(true);
    // A paid plan today has more promised than delivered. That is a fact the
    // pages must be able to state, so both kinds must be present in the list.
    expect(lines.some((l) => l.available)).toBe(true);
    expect(lines.some((l) => !l.available)).toBe(true);
  });
});
