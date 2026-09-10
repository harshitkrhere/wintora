/**
 * The entitlement matrix.
 *
 * Covers every plan, every lifecycle state, and the two properties that matter
 * in both directions: a user must never receive more than they paid for, and
 * must never lose what they legitimately did pay for.
 */

import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS, INALIENABLE_FEATURES } from '@/config/features';
import { PLAN_SLUGS, PLANS, type PlanSlug } from '@/config/plans';
import { POLICY } from '@/config/policy';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '@/domain/billing/states';
import {
  benefitList,
  computeEntitlements,
  effectivePlan,
  freeSnapshot,
} from '@/domain/entitlements/compute';
import { checkEntitlement } from '@/domain/entitlements/check';
import { createFakeStore, snapshot, USER_A } from './helpers/store';

const DAY = 24 * 60 * 60 * 1000;

describe('plan matrix', () => {
  it('grants each plan exactly what the catalog says', () => {
    for (const slug of PLAN_SLUGS) {
      const entitlements = computeEntitlements(
        snapshot({ status: 'ACTIVE', planSlug: slug }),
      );

      for (const key of FEATURE_KEYS) {
        const grant = PLANS[slug].features[key];
        const expected = INALIENABLE_FEATURES.includes(key)
          ? true
          : (grant?.enabled ?? false);

        expect(
          entitlements[key].enabled,
          `${slug} / ${key} enabled`,
        ).toBe(expected);

        if (!INALIENABLE_FEATURES.includes(key) && grant?.enabled === true) {
          expect(entitlements[key].limitValue, `${slug} / ${key} limit`).toBe(
            grant.limitValue ?? null,
          );
        }
      }
    }
  });

  it('escalates limits monotonically as the tier rises', () => {
    const metered = [
      'MAX_ACTIVE_CASES',
      'MONTHLY_ANALYSES',
      'MONTHLY_LETTERS',
      'MONTHLY_DOCUMENTS',
      'STORAGE_LIMIT_MB',
      'RETENTION_DAYS',
    ] as const;

    const ordered = [...PLAN_SLUGS].sort((a, b) => PLANS[a].tier - PLANS[b].tier);

    for (const key of metered) {
      for (let i = 1; i < ordered.length; i += 1) {
        const lower = PLANS[ordered[i - 1]!].features[key]?.limitValue ?? 0;
        const higher = PLANS[ordered[i]!].features[key]?.limitValue ?? 0;
        expect(higher, `${key}: ${ordered[i]} >= ${ordered[i - 1]}`).toBeGreaterThanOrEqual(
          lower ?? 0,
        );
      }
    }
  });

  it('gives the free tier the same analysis engine as every paid tier', () => {
    // The free plan is deliberately useful. What a free user gets less of is
    // volume and workflow, never truth.
    for (const slug of PLAN_SLUGS) {
      expect(PLANS[slug].features.BASIC_BILL_ANALYSIS?.enabled).toBe(true);
    }
  });
});

describe('lifecycle states', () => {
  const paidStatuses: SubscriptionStatus[] = [
    'TRIALING',
    'ACTIVE',
    'PAST_DUE',
    'GRACE',
    'CANCELED_PENDING_EXPIRY',
  ];

  it.each(paidStatuses)('keeps plan entitlements while %s', (status) => {
    const entitlements = computeEntitlements(snapshot({ status, planSlug: 'plus' }));
    expect(entitlements.DEADLINE_TRACKING.enabled).toBe(true);
    expect(entitlements.MONTHLY_ANALYSES.limitValue).toBe(50);
  });

  const revokedStatuses: SubscriptionStatus[] = [
    'FREE',
    'EXPIRED',
    'REFUNDED',
    'REVOKED',
    'PAUSED',
    'CHECKOUT_PENDING',
    'INCOMPLETE',
  ];

  it.each(revokedStatuses)('drops to free entitlements while %s', (status) => {
    const entitlements = computeEntitlements(snapshot({ status, planSlug: 'plus' }));
    expect(entitlements.DEADLINE_TRACKING.enabled).toBe(false);
    expect(entitlements.MONTHLY_ANALYSES.limitValue).toBe(2);
    expect(entitlements.MAX_ACTIVE_CASES.limitValue).toBe(1);
  });

  it('does not cut premium access on the first failed payment', () => {
    // Cards expire and banks decline for boring reasons. A paying customer
    // should not lose their case workspace over a retry.
    const pastDue = computeEntitlements(snapshot({ status: 'PAST_DUE', planSlug: 'pro' }));
    expect(pastDue.HOUSEHOLD_CASES.enabled).toBe(true);
    expect(POLICY.grace.retainEntitlements).toBe(true);
  });

  it('keeps a canceled subscription entitled until the period it paid for ends', () => {
    const periodEnd = new Date(Date.now() + 12 * DAY);
    const entitlements = computeEntitlements(
      snapshot({
        status: 'CANCELED_PENDING_EXPIRY',
        planSlug: 'plus',
        currentPeriodEnd: periodEnd,
      }),
    );

    expect(entitlements.ADVANCED_EXPORT.enabled).toBe(true);
    expect(entitlements.ADVANCED_EXPORT.expiresAt).toBe(periodEnd.toISOString());
  });

  it('covers every declared subscription status', () => {
    // A status added to the enum without a decision here would silently inherit
    // whatever the fallback does, which is exactly the bug this catches.
    for (const status of SUBSCRIPTION_STATUSES) {
      const plan = effectivePlan(snapshot({ status, planSlug: 'pro' }));
      const expected = paidStatuses.includes(status) ? 'pro' : 'free';
      expect(plan, `status ${status}`).toBe(expected);
    }
  });
});

describe('scheduled downgrade', () => {
  it('keeps the higher plan until the effective moment', () => {
    const effectiveAt = new Date(Date.now() + 5 * DAY);
    const sub = snapshot({
      planSlug: 'plus',
      pendingPlanSlug: 'essential',
      pendingPlanEffectiveAt: effectiveAt,
    });

    const before = computeEntitlements(sub, { now: new Date(Date.now() + 1 * DAY) });
    expect(before.DEADLINE_TRACKING.enabled).toBe(true);
    expect(before.MAX_ACTIVE_CASES.limitValue).toBe(15);

    const after = computeEntitlements(sub, { now: new Date(Date.now() + 6 * DAY) });
    expect(after.DEADLINE_TRACKING.enabled).toBe(false);
    expect(after.MAX_ACTIVE_CASES.limitValue).toBe(5);
  });

  it('never deletes data as part of a downgrade', () => {
    // Enforced structurally: the entitlement engine returns access rules only.
    // It has no delete path, and policy states the intent explicitly.
    expect(POLICY.downgrade.deleteOverLimitResources).toBe(false);
    expect(POLICY.downgrade.effectiveAt).toBe('period_end');
  });
});

describe('inalienable rights', () => {
  it.each(SUBSCRIPTION_STATUSES)(
    'keeps export and deletion available while %s',
    (status) => {
      // Data portability and deletion are user rights, not paid features. The
      // entitlement engine is not permitted to gate them, in ANY state.
      const entitlements = computeEntitlements(snapshot({ status, planSlug: 'free' }));
      expect(entitlements.DATA_EXPORT.enabled).toBe(true);
      expect(entitlements.ACCOUNT_DELETION.enabled).toBe(true);
      expect(entitlements.DATA_EXPORT.expiresAt).toBeNull();
    },
  );

  it('keeps them available even if a plan tried to disable them', () => {
    const hostileMatrix = {
      free: {
        DATA_EXPORT: { enabled: false, limitValue: null, limitUnit: null },
        ACCOUNT_DELETION: { enabled: false, limitValue: null, limitUnit: null },
      },
    } as never;

    const entitlements = computeEntitlements(
      snapshot({ status: 'FREE', planSlug: 'free' }),
      { matrix: hostileMatrix },
    );

    expect(entitlements.DATA_EXPORT.enabled).toBe(true);
    expect(entitlements.ACCOUNT_DELETION.enabled).toBe(true);
  });
});

describe('checkEntitlement', () => {
  it('allows a feature the plan includes', async () => {
    const store = createFakeStore({ subscription: snapshot({ planSlug: 'plus' }) });
    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'EOB_COMPARISON',
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('ALLOWED');
    expect(decision.plan).toBe('plus');
  });

  it('denies with PLAN_REQUIRED and names the cheapest plan that has it', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'free', status: 'FREE' }),
    });
    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'HOUSEHOLD_CASES',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.gateState).toBe('PLAN_REQUIRED');
    expect(decision.message).toContain('Pro');
    // No urgency, no invented savings, no implied risk.
    expect(decision.message).not.toMatch(/now|hurry|lose|risk/i);
  });

  it('denies with LIMIT_REACHED once the quota is spent, and says when it resets', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'free', status: 'FREE' }),
      usage: { MONTHLY_ANALYSES: 2 },
    });

    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'MONTHLY_ANALYSES',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('LIMIT_REACHED');
    expect(decision.remaining).toBe(0);
    expect(decision.used).toBe(2);
    expect(decision.resetAt).not.toBeNull();
  });

  it('reports remaining balance accurately below the limit', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'plus' }),
      usage: { MONTHLY_ANALYSES: 8 },
    });

    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'MONTHLY_ANALYSES',
    });

    expect(decision.allowed).toBe(true);
    expect(decision.used).toBe(8);
    expect(decision.remaining).toBe(41); // 50 - 8 used - 1 for this operation
  });

  it('counts active cases rather than a quota window for MAX_ACTIVE_CASES', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'free', status: 'FREE' }),
      activeCases: 1,
    });

    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'MAX_ACTIVE_CASES',
      action: 'create',
    });

    expect(decision.allowed).toBe(false);
    // The message explains the position honestly: nothing is deleted.
    expect(decision.message).toContain('stay open');
  });

  it('blocks processing features in safe mode but not export or deletion', async () => {
    const store = createFakeStore({ subscription: snapshot({ planSlug: 'pro' }) });

    const upload = await checkEntitlement({ store, safeMode: true }, {
      userId: USER_A,
      feature: 'DOCUMENT_UPLOAD',
    });
    expect(upload.allowed).toBe(false);
    expect(upload.gateState).toBe('TEMPORARILY_UNAVAILABLE');

    const exportDecision = await checkEntitlement(
      { store, safeMode: true, lastAuthenticatedAt: new Date() },
      { userId: USER_A, feature: 'DATA_EXPORT' },
    );
    expect(exportDecision.allowed).toBe(true);
  });

  it('requires step-up authentication for export and deletion', async () => {
    const store = createFakeStore({ subscription: snapshot({ planSlug: 'plus' }) });

    const stale = await checkEntitlement(
      {
        store,
        lastAuthenticatedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
      { userId: USER_A, feature: 'ACCOUNT_DELETION' },
    );
    expect(stale.allowed).toBe(false);
    expect(stale.reason).toBe('REQUIRES_VERIFICATION');

    const fresh = await checkEntitlement(
      { store, lastAuthenticatedAt: new Date() },
      { userId: USER_A, feature: 'ACCOUNT_DELETION' },
    );
    expect(fresh.allowed).toBe(true);
  });

  it('denies a feature in a jurisdiction that has not been reviewed', async () => {
    const store = createFakeStore({
      subscription: snapshot({ planSlug: 'pro' }),
      enabledJurisdictions: ['us-ca'],
    });

    const decision = await checkEntitlement({ store }, {
      userId: USER_A,
      feature: 'DEADLINE_TRACKING',
      jurisdictionCode: 'us-tx',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.gateState).toBe('JURISDICTION_UNAVAILABLE');
  });

  it('falls back to free entitlements when there is no subscription row', async () => {
    const store = createFakeStore({ subscription: null });
    const decision = await checkEntitlement(
      { store, accountCreatedAt: new Date() },
      { userId: USER_A, feature: 'ADVANCED_DOCUMENT_ANALYSIS' },
    );

    expect(decision.allowed).toBe(false);
    expect(decision.plan).toBe('free');
  });
});

describe('benefits panel', () => {
  it('lists only enabled features, sorted, with their limits', () => {
    const entitlements = computeEntitlements(snapshot({ planSlug: 'essential' }));
    const benefits = benefitList(entitlements);

    expect(benefits.some((b) => b.key === 'EOB_COMPARISON')).toBe(true);
    expect(benefits.some((b) => b.key === 'HOUSEHOLD_CASES')).toBe(false);

    const cases = benefits.find((b) => b.key === 'MAX_ACTIVE_CASES');
    expect(cases?.limit).toBe(5);
    expect(cases?.unit).toBe('cases');
  });

  it('never advertises a benefit with no registry text', () => {
    const benefits = benefitList(computeEntitlements(snapshot({ planSlug: 'pro' })));
    for (const benefit of benefits) {
      expect(benefit.text.length).toBeGreaterThan(0);
    }
  });
});

describe('free snapshot', () => {
  it('anchors the quota window to account creation', () => {
    const created = new Date('2026-03-15T00:00:00Z');
    const entitlements = computeEntitlements(freeSnapshot(created), {
      now: new Date('2026-03-20T00:00:00Z'),
    });

    expect(entitlements.MONTHLY_ANALYSES.periodStart).toBe(created.toISOString());
  });
});
