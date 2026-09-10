/**
 * checkEntitlement(): the ONE way to ask whether a user may do something.
 *
 * There is no `if (user.plan === 'pro')` anywhere else in the codebase, and
 * `scripts/verify-sql-invariants.mjs` fails the build if that pattern reappears
 * outside this directory.
 *
 * Persistence is a port. Production wires the Supabase adapter; tests wire an
 * in-memory fake. See docs/ENTITLEMENTS.md.
 */

import { FEATURES, type FeatureKey } from '@/config/features';
import { PLANS, type PlanSlug } from '@/config/plans';
import { POLICY } from '@/config/policy';
import {
  computeEntitlements,
  effectivePlan,
  quotaWindow,
  freeSnapshot,
} from './compute';
import type {
  EntitlementDecision,
  EntitlementQuery,
  EntitlementReason,
  GateState,
  PlanFeatureMatrix,
  QuotaWindow,
  ResourceRef,
  SubscriptionSnapshot,
} from './types';

/** Persistence port. The domain never imports a database client. */
export interface EntitlementStore {
  getSubscription(userId: string): Promise<SubscriptionSnapshot | null>;
  getPlanMatrix(): Promise<PlanFeatureMatrix>;
  getUsage(
    userId: string,
    featureKey: FeatureKey,
    window: QuotaWindow,
  ): Promise<number>;
  getEntitlementVersion(userId: string): Promise<number>;
  countActiveCases(userId: string): Promise<number>;
  ownsResource(userId: string, resource: ResourceRef): Promise<boolean>;
  isFeatureEnabled(flagKey: string): Promise<boolean>;
  isJurisdictionEnabled(code: string): Promise<boolean>;
  recordSecurityEvent(event: {
    type: 'CROSS_USER_ACCESS_ATTEMPT' | 'QUOTA_BYPASS_ATTEMPT';
    userId: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
}

export interface CheckContext {
  readonly store: EntitlementStore;
  readonly now?: Date;
  /** Global incident switch. See docs/SECURITY.md section 12. */
  readonly safeMode?: boolean;
  /** When the session last completed a full authentication. */
  readonly lastAuthenticatedAt?: Date | null;
  /** Fallback account age for users with no subscription row. */
  readonly accountCreatedAt?: Date;
}

/**
 * Features that touch document processing or AI, and are therefore disabled by
 * safe mode. Authentication, billing, export and deletion deliberately are not.
 */
const SAFE_MODE_BLOCKED: readonly FeatureKey[] = [
  'DOCUMENT_UPLOAD',
  'BASIC_BILL_ANALYSIS',
  'ADVANCED_DOCUMENT_ANALYSIS',
  'EOB_COMPARISON',
  'LETTER_GENERATION',
  'ADVANCED_LETTERS',
];

const GATE_FOR_REASON: Readonly<Record<EntitlementReason, GateState>> = {
  ALLOWED: 'AVAILABLE',
  PLAN_REQUIRED: 'PLAN_REQUIRED',
  LIMIT_REACHED: 'LIMIT_REACHED',
  SUBSCRIPTION_INACTIVE: 'PLAN_REQUIRED',
  JURISDICTION_UNAVAILABLE: 'JURISDICTION_UNAVAILABLE',
  FEATURE_DISABLED: 'TEMPORARILY_UNAVAILABLE',
  REQUIRES_VERIFICATION: 'REQUIRES_VERIFICATION',
  NOT_OWNER: 'TEMPORARILY_UNAVAILABLE',
  RESOURCE_INVALID: 'TEMPORARILY_UNAVAILABLE',
};

export async function checkEntitlement(
  ctx: CheckContext,
  query: EntitlementQuery,
): Promise<EntitlementDecision> {
  const now = ctx.now ?? new Date();
  const amount = query.amount ?? 1;
  const feature = FEATURES[query.feature];

  const subscription =
    (await ctx.store.getSubscription(query.userId)) ??
    freeSnapshot(ctx.accountCreatedAt ?? now);

  const matrix = await ctx.store.getPlanMatrix();
  const plan = effectivePlan(subscription, now);
  const entitlements = computeEntitlements(subscription, { matrix, now });
  const entitlement = entitlements[query.feature];
  const version = await ctx.store.getEntitlementVersion(query.userId);
  const window = quotaWindow(subscription, now);

  const base = {
    feature: query.feature,
    plan,
    limit: entitlement.limitValue,
    resetAt: entitlement.periodEnd,
    expiresAt: entitlement.expiresAt,
    version,
  };

  // 1. Ownership. Entitlement and ownership are separate questions, and a
  //    failure here is a security signal, not a product message.
  if (query.resource !== undefined) {
    const owns = await ctx.store.ownsResource(query.userId, query.resource);
    if (!owns) {
      await ctx.store.recordSecurityEvent({
        type: 'CROSS_USER_ACCESS_ATTEMPT',
        userId: query.userId,
        detail: {
          feature: query.feature,
          resourceType: query.resource.type,
          resourceId: query.resource.id,
        },
      });
      // Deliberately generic: never confirm that the resource exists.
      return deny('NOT_OWNER', base, 'We could not find that item.', null, null);
    }
  }

  // 2. Safe mode and feature flags.
  if (ctx.safeMode === true && SAFE_MODE_BLOCKED.includes(query.feature)) {
    return deny(
      'FEATURE_DISABLED',
      base,
      'Document processing is paused while we investigate an issue. Your account and documents are unaffected.',
      null,
      null,
    );
  }

  // 3. Step-up authentication for sensitive operations.
  if (requiresStepUp(query.feature)) {
    const fresh = isRecentAuth(ctx.lastAuthenticatedAt ?? null, now);
    if (!fresh) {
      return deny(
        'REQUIRES_VERIFICATION',
        base,
        'Please confirm your password to continue. This protects your documents.',
        null,
        null,
      );
    }
  }

  // 4. Jurisdiction availability.
  if (query.jurisdictionCode !== undefined) {
    const ok = await ctx.store.isJurisdictionEnabled(query.jurisdictionCode);
    if (!ok) {
      return deny(
        'JURISDICTION_UNAVAILABLE',
        base,
        'We do not yet have reviewed guidance for your state or province for this step.',
        null,
        null,
      );
    }
  }

  // 5. Is the feature part of this plan at all?
  if (!entitlement.enabled) {
    const requiredPlan = cheapestPlanWith(query.feature, matrix);
    const inactive =
      requiredPlan !== null &&
      PLANS[requiredPlan].tier <= PLANS[subscription.planSlug].tier &&
      plan === 'free';

    return deny(
      inactive ? 'SUBSCRIPTION_INACTIVE' : 'PLAN_REQUIRED',
      base,
      planRequiredMessage(query.feature, requiredPlan),
      null,
      null,
    );
  }

  // 6. Limits and quotas.
  if (entitlement.limitValue !== null) {
    const used = await currentUsage(ctx, query, window);
    const remaining = Math.max(entitlement.limitValue - used, 0);

    if (used + amount > entitlement.limitValue) {
      return {
        ...base,
        allowed: false,
        reason: 'LIMIT_REACHED',
        gateState: GATE_FOR_REASON.LIMIT_REACHED,
        remaining,
        used,
        message: limitReachedMessage(query.feature, entitlement.limitValue, plan, entitlement.periodEnd),
      };
    }

    return {
      ...base,
      allowed: true,
      reason: 'ALLOWED',
      gateState: 'AVAILABLE',
      remaining: remaining - amount,
      used,
      message: 'Available.',
    };
  }

  // 7. Enabled, unmetered.
  return {
    ...base,
    allowed: true,
    reason: 'ALLOWED',
    gateState: 'AVAILABLE',
    remaining: null,
    used: null,
    message: 'Available.',
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function deny(
  reason: EntitlementReason,
  base: {
    feature: FeatureKey;
    plan: PlanSlug;
    limit: number | null;
    resetAt: string | null;
    expiresAt: string | null;
    version: number;
  },
  message: string,
  remaining: number | null,
  used: number | null,
): EntitlementDecision {
  return {
    ...base,
    allowed: false,
    reason,
    gateState: GATE_FOR_REASON[reason],
    remaining,
    used,
    message,
  };
}

async function currentUsage(
  ctx: CheckContext,
  query: EntitlementQuery,
  window: QuotaWindow,
): Promise<number> {
  const def = FEATURES[query.feature];

  if (def.type === 'QUOTA') {
    return ctx.store.getUsage(query.userId, query.feature, window);
  }

  // The single definition of "active case", shared with count_active_cases() in
  // SQL so the UI and the enforcement cannot disagree.
  if (query.feature === 'MAX_ACTIVE_CASES') {
    return ctx.store.countActiveCases(query.userId);
  }

  return query.currentUsage ?? 0;
}

function requiresStepUp(feature: FeatureKey): boolean {
  return (POLICY.stepUpAuth.requiredFor as readonly string[]).includes(feature);
}

function isRecentAuth(lastAuthenticatedAt: Date | null, now: Date): boolean {
  if (lastAuthenticatedAt === null) return false;
  const ageMinutes = (now.getTime() - lastAuthenticatedAt.getTime()) / 60000;
  return ageMinutes >= 0 && ageMinutes <= POLICY.stepUpAuth.maxAgeMinutes;
}

/** The cheapest plan that includes a feature, for an honest upgrade prompt. */
export function cheapestPlanWith(
  feature: FeatureKey,
  matrix: PlanFeatureMatrix,
): PlanSlug | null {
  const ordered = (Object.keys(PLANS) as PlanSlug[]).sort(
    (a, b) => PLANS[a].tier - PLANS[b].tier,
  );
  for (const slug of ordered) {
    if (matrix[slug]?.[feature]?.enabled === true) return slug;
  }
  return null;
}

/**
 * Paywall copy. States what the feature does and which plan includes it.
 * No urgency, no invented savings, no implied risk.
 * See docs/AI_SAFETY.md section 8.
 */
function planRequiredMessage(feature: FeatureKey, requiredPlan: PlanSlug | null): string {
  const name = FEATURES[feature].name;
  if (requiredPlan === null) {
    return `${name} is not available on any current plan.`;
  }
  return `${name} is included in ${PLANS[requiredPlan].displayName}.`;
}

function limitReachedMessage(
  feature: FeatureKey,
  limit: number,
  plan: PlanSlug,
  resetAt: string | null,
): string {
  const def = FEATURES[feature];

  if (feature === 'MAX_ACTIVE_CASES') {
    return (
      `Your ${PLANS[plan].displayName} plan includes ${limit} active ` +
      `${limit === 1 ? 'case' : 'cases'}. Existing cases stay open and fully ` +
      `readable. To start another, close or archive one, or move to a larger plan.`
    );
  }

  const resets =
    resetAt !== null
      ? ` This resets on ${formatDate(resetAt)}.`
      : '';

  return (
    `You have used all ${limit} of your ${def.name.toLowerCase()} for this ` +
    `billing period.${resets}`
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
