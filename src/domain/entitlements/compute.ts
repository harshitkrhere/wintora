/**
 * computeEntitlements(): the pure function at the centre of authorization.
 *
 * Given a subscription snapshot, a plan-feature matrix and policy, it returns
 * the entitlement set. No I/O, so the whole plan and lifecycle matrix is
 * directly unit-testable. `user_entitlements` is a materialised cache of this
 * function and can be dropped and rebuilt at any time.
 *
 * See docs/ENTITLEMENTS.md section 1.
 */

import {
  FEATURE_KEYS,
  FEATURES,
  INALIENABLE_FEATURES,
  type FeatureKey,
} from '@/config/features';
import { PLANS, type PlanSlug } from '@/config/plans';
import { POLICY } from '@/config/policy';
import { grantsPlanEntitlements } from '@/domain/billing/states';
import { quotaWindow, rollingWindow } from '@/domain/usage/period';
import type {
  Entitlement,
  EntitlementSet,
  PlanFeatureMatrix,
  SubscriptionSnapshot,
} from './types';

export { quotaWindow, rollingWindow };

/** The matrix built from src/config/plans.ts, used to seed and as a fallback. */
export const CONFIG_PLAN_MATRIX: PlanFeatureMatrix = buildConfigMatrix();

function buildConfigMatrix(): PlanFeatureMatrix {
  const out: Record<string, Record<string, unknown>> = {};
  for (const slug of Object.keys(PLANS) as PlanSlug[]) {
    const rows: Record<string, unknown> = {};
    const grants = PLANS[slug].features;
    for (const key of FEATURE_KEYS) {
      const grant = grants[key];
      if (grant === undefined) continue;
      rows[key] = {
        enabled: grant.enabled,
        limitValue: grant.limitValue ?? null,
        limitUnit: grant.limitUnit ?? null,
      };
    }
    out[slug] = rows;
  }
  return out as PlanFeatureMatrix;
}

/**
 * Which plan's benefits the user actually holds right now.
 *
 * Three rules, in order:
 *   1. A scheduled downgrade that has reached its effective time applies.
 *   2. A paused subscription is not being paid for, so it drops to free.
 *   3. Otherwise the plan applies only in a status that grants entitlements —
 *      which deliberately includes PAST_DUE, GRACE and CANCELED_PENDING_EXPIRY.
 */
export function effectivePlan(
  subscription: SubscriptionSnapshot,
  now: Date = new Date(),
): PlanSlug {
  if (
    subscription.pendingPlanSlug !== null &&
    subscription.pendingPlanEffectiveAt !== null &&
    subscription.pendingPlanEffectiveAt.getTime() <= now.getTime()
  ) {
    return subscription.pendingPlanSlug;
  }

  if (subscription.status === 'PAUSED') {
    return POLICY.pause.entitlementsDuringPause === 'free'
      ? 'free'
      : subscription.planSlug;
  }

  return grantsPlanEntitlements(subscription.status) ? subscription.planSlug : 'free';
}

/**
 * When the currently held premium entitlements lapse, if a lapse is scheduled.
 * Null means no scheduled end.
 */
export function entitlementExpiry(
  subscription: SubscriptionSnapshot,
  plan: PlanSlug,
): Date | null {
  if (plan === 'free') return null;

  switch (subscription.status) {
    case 'CANCELED_PENDING_EXPIRY':
      return subscription.currentPeriodEnd;
    case 'PAST_DUE':
    case 'GRACE':
      return subscription.gracePeriodEnd ?? subscription.currentPeriodEnd;
    default:
      // A scheduled downgrade is a partial lapse of the current plan.
      return subscription.pendingPlanSlug !== null
        ? subscription.pendingPlanEffectiveAt
        : null;
  }
}

export interface ComputeOptions {
  readonly matrix?: PlanFeatureMatrix;
  readonly now?: Date;
}

/**
 * The entitlement set for a subscription snapshot.
 *
 * Inalienable features (data export, account deletion) are forced on
 * regardless of what the matrix says, in every lifecycle state including
 * EXPIRED and REVOKED. Data portability and deletion are user rights, not
 * paid features, and this function is not permitted to gate them.
 */
export function computeEntitlements(
  subscription: SubscriptionSnapshot,
  options: ComputeOptions = {},
): EntitlementSet {
  const matrix = options.matrix ?? CONFIG_PLAN_MATRIX;
  const now = options.now ?? new Date();

  const plan = effectivePlan(subscription, now);
  const window = quotaWindow(subscription, now);
  const expiresAt = entitlementExpiry(subscription, plan);
  const planRows = matrix[plan] ?? {};

  const out: Record<string, Entitlement> = {};

  for (const key of FEATURE_KEYS) {
    const row = planRows[key];
    const inalienable = INALIENABLE_FEATURES.includes(key);

    const enabled = inalienable ? true : (row?.enabled ?? false);
    const limitValue = inalienable ? null : (row?.limitValue ?? null);

    out[key] = {
      featureKey: key,
      enabled,
      limitValue,
      limitUnit: row?.limitUnit ?? null,
      sourcePlan: plan,
      periodStart: window.start.toISOString(),
      periodEnd: window.end.toISOString(),
      expiresAt: inalienable ? null : (expiresAt?.toISOString() ?? null),
    };
  }

  return out as EntitlementSet;
}

/** Convenience for the common boolean question. */
export function hasFeature(set: EntitlementSet, key: FeatureKey): boolean {
  return set[key].enabled;
}

export function limitFor(set: EntitlementSet, key: FeatureKey): number | null {
  return set[key].limitValue;
}

/**
 * The benefits list shown on the subscription page, built from the registry so
 * the words a customer reads and the rules the backend enforces are the same
 * source. See docs/ENTITLEMENTS.md section 9.
 */
export function benefitList(
  set: EntitlementSet,
): readonly { key: FeatureKey; text: string; limit: number | null; unit: string | null }[] {
  return FEATURE_KEYS.filter((k) => set[k].enabled)
    .map((k) => ({
      key: k,
      text: FEATURES[k].benefitText,
      limit: set[k].limitValue,
      unit: set[k].limitUnit,
      sortOrder: FEATURES[k].sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ key, text, limit, unit }) => ({ key, text, limit, unit }));
}

/**
 * A free-plan snapshot, used for anonymous visitors and as the fallback when a
 * user has no subscription row at all.
 */
export function freeSnapshot(accountCreatedAt: Date): SubscriptionSnapshot {
  return {
    status: 'FREE',
    planSlug: 'free',
    currentPeriodStart: null,
    currentPeriodEnd: null,
    gracePeriodEnd: null,
    pendingPlanSlug: null,
    pendingPlanEffectiveAt: null,
    pauseEnd: null,
    accountCreatedAt,
  };
}
