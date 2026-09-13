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
import { SUPPORT, prioritySupportAvailable, responseTargetPhrase, responseTargetSentence } from '@/config/support';
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
        'ADVANCED_DOCUMENT_ANALYSIS',
        'ADVANCED_EXPORT',
        'ADVANCED_LETTERS',
        'BASIC_BILL_ANALYSIS',
        'CASE_TIMELINE',
        'CASE_TRACKING',
        'DATA_EXPORT',
        'DEADLINE_TRACKING',
        'DOCUMENT_UPLOAD',
        'EOB_COMPARISON',
        'EXTENDED_HISTORY',
        'HOUSEHOLD_CASES',
        'HOUSEHOLD_MEMBERS',
        'LETTER_GENERATION',
        'MAX_ACTIVE_CASES',
        'MAX_FILE_SIZE_MB',
        'MONTHLY_ANALYSES',
        'MONTHLY_DOCUMENTS',
        'MONTHLY_EXPORTS',
        'MONTHLY_LETTERS',
        'MULTIPLE_CASES',
        'PREMIUM_TEMPLATES',
        'REMINDERS',
        'RETENTION_DAYS',
        'STORAGE_LIMIT_MB',
        ...(prioritySupportAvailable() ? ['PRIORITY_SUPPORT'] : []),
      ].sort(),
    );
  });

  // Priority support is a promise about time. It is sold only once a number
  // exists in src/config/support.ts, and the flag follows that file rather
  // than being set by hand somewhere else.
  it('priority support is claimed only once a response target is written down', () => {
    expect(FEATURES.PRIORITY_SUPPORT.available).toBe(prioritySupportAvailable());
    if (SUPPORT.priorityHours === null) {
      expect(FEATURES.PRIORITY_SUPPORT.available).toBe(false);
    } else {
      expect(SUPPORT.priorityHours).toBeGreaterThan(0);
      expect(FEATURES.PRIORITY_SUPPORT.available).toBe(true);
    }
  });

  // The contact page says the same thing the flag means: a number, in the
  // customer's units, with the working week alongside so "day" is honest.
  it('states the support targets in plain words from the same numbers', () => {
    expect(responseTargetPhrase(8)).toBe('one working day');
    expect(responseTargetPhrase(16)).toBe('two working days');
    expect(responseTargetPhrase(4)).toBe('4 working hours');
    expect(responseTargetSentence(false)).toBe('We aim to reply within two working days, Monday to Friday.');
    expect(responseTargetSentence(true)).toBe('We aim to reply within one working day, Monday to Friday.');
    // Priority must actually be faster than standard, or it is not priority.
    expect(SUPPORT.priorityHours).toBeLessThan(SUPPORT.standardHours ?? Infinity);
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

    expect(letters?.available).toBe(true);
    expect(upload?.available).toBe(true);
    // Every line carries the flag, so a page can always split the list into
    // "available now" and "included, not yet available" without guessing.
    for (const line of lines) expect(typeof line.available).toBe('boolean');
  });
});
