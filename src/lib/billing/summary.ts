/**
 * The subscription summary rendered on /settings/subscription and returned by
 * /api/entitlements.
 *
 * Built entirely from live data: the plan catalog, the computed entitlements
 * and the usage counters. Nothing here is hand-typed, so what a customer reads
 * cannot drift away from what the backend enforces.
 *
 * See docs/ENTITLEMENTS.md section 9.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { FEATURES, FEATURE_KEYS, METERED_FEATURES, type FeatureKey } from '@/config/features';
import {
  PLANS,
  formatPrice,
  isPaidPlan,
  type CurrencyCode,
  type PlanSlug,
} from '@/config/plans';
import { POLICY } from '@/config/policy';
import { STATUS_DESCRIPTIONS, type SubscriptionStatus } from '@/domain/billing/states';
import { benefitList, computeEntitlements, effectivePlan, freeSnapshot } from '@/domain/entitlements/compute';
import { quotaWindow } from '@/domain/usage/period';
import { createEntitlementStore, loadPlanMatrix } from '@/lib/supabase/stores';

export interface UsageLine {
  readonly featureKey: FeatureKey;
  readonly label: string;
  readonly used: number;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly unit: string | null;
}

export interface BenefitLine {
  readonly key: FeatureKey;
  readonly text: string;
  readonly limit: number | null;
  readonly unit: string | null;
}

export interface SubscriptionSummary {
  readonly plan: PlanSlug;
  readonly planDisplayName: string;
  /** True once a paid plan is in force. Saves callers comparing plan strings. */
  readonly hasPaidPlan: boolean;
  readonly status: SubscriptionStatus;
  readonly statusDescription: string;
  readonly priceFormatted: string | null;
  readonly currency: CurrencyCode | null;
  readonly billingInterval: 'month' | 'year';
  readonly currentPeriodStart: string | null;
  readonly currentPeriodEnd: string | null;
  readonly nextBillingDate: string | null;
  readonly autoRenews: boolean;
  readonly cancelAtPeriodEnd: boolean;
  readonly gracePeriodEnd: string | null;
  readonly pendingPlan: PlanSlug | null;
  readonly pendingPlanEffectiveAt: string | null;
  readonly entitlementVersion: number;
  readonly benefits: readonly BenefitLine[];
  readonly usage: readonly UsageLine[];
  readonly quotaResetsAt: string;
  /** Enabled boolean features, for client-side gate rendering. DISPLAY ONLY. */
  readonly features: Readonly<Record<string, boolean>>;
  /** How long the client may cache this before refetching. */
  readonly cacheSeconds: number;
}

export async function buildSubscriptionSummary(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<SubscriptionSummary> {
  const store = createEntitlementStore(client);
  const [subscription, matrix, version] = await Promise.all([
    store.getSubscription(userId),
    loadPlanMatrix(client),
    store.getEntitlementVersion(userId),
  ]);

  const snapshot = subscription ?? freeSnapshot(now);
  const entitlements = computeEntitlements(snapshot, { matrix, now });
  const plan = effectivePlan(snapshot, now);
  const window = quotaWindow(snapshot, now);

  const { data: row } = await client
    .from('subscriptions')
    .select('status, currency, amount_cents, billing_interval, cancel_at_period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const live = row as unknown as
    | {
        status: SubscriptionStatus;
        currency: string;
        amount_cents: number;
        billing_interval: 'month' | 'year';
        cancel_at_period_end: boolean;
      }
    | null;

  const currency = (live?.currency as CurrencyCode | undefined) ?? null;

  // Live usage for every metered feature. This is what makes "42 of 50
  // remaining" true rather than decorative.
  const usage: UsageLine[] = [];
  for (const key of METERED_FEATURES) {
    const entitlement = entitlements[key];
    if (!entitlement.enabled) continue;
    const used = await store.getUsage(userId, key, window);
    usage.push({
      featureKey: key,
      label: FEATURES[key].name,
      used,
      limit: entitlement.limitValue,
      remaining:
        entitlement.limitValue === null
          ? null
          : Math.max(entitlement.limitValue - used, 0),
      unit: entitlement.limitUnit,
    });
  }

  // Active cases are a concurrent limit rather than a per-period quota, so they
  // are counted rather than metered.
  const activeCases = await store.countActiveCases(userId);
  const caseLimit = entitlements.MAX_ACTIVE_CASES.limitValue;
  usage.push({
    featureKey: 'MAX_ACTIVE_CASES',
    label: 'Active cases',
    used: activeCases,
    limit: caseLimit,
    remaining: caseLimit === null ? null : Math.max(caseLimit - activeCases, 0),
    unit: 'cases',
  });

  const features: Record<string, boolean> = {};
  for (const key of FEATURE_KEYS) {
    if (FEATURES[key].type === 'BOOLEAN' || FEATURES[key].type === 'SUPPORT_LEVEL') {
      features[key] = entitlements[key].enabled;
    }
  }

  const cancelAtPeriodEnd = live?.cancel_at_period_end ?? false;

  return {
    plan,
    planDisplayName: PLANS[plan].displayName,
    hasPaidPlan: isPaidPlan(plan),
    status: snapshot.status,
    statusDescription: STATUS_DESCRIPTIONS[snapshot.status],
    priceFormatted:
      live !== null && currency !== null ? formatPrice(live.amount_cents, currency) : null,
    currency,
    billingInterval: live?.billing_interval ?? 'month',
    currentPeriodStart: snapshot.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: snapshot.currentPeriodEnd?.toISOString() ?? null,
    nextBillingDate: cancelAtPeriodEnd
      ? null
      : (snapshot.currentPeriodEnd?.toISOString() ?? null),
    autoRenews: !cancelAtPeriodEnd && isPaidPlan(plan),
    cancelAtPeriodEnd,
    gracePeriodEnd: snapshot.gracePeriodEnd?.toISOString() ?? null,
    pendingPlan: snapshot.pendingPlanSlug,
    pendingPlanEffectiveAt: snapshot.pendingPlanEffectiveAt?.toISOString() ?? null,
    entitlementVersion: version,
    benefits: benefitList(entitlements),
    usage,
    quotaResetsAt: window.end.toISOString(),
    features,
    cacheSeconds: POLICY.entitlementClientCacheSeconds,
  };
}
