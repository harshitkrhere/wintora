/**
 * In-memory implementations of the domain ports.
 *
 * These exist because the domain declares narrow interfaces rather than
 * importing a database client. That is what makes the full entitlement and
 * lifecycle matrix testable without a live Postgres.
 *
 * The Row Level Security matrix is a different question and genuinely needs a
 * database; it lives in supabase/tests/rls_isolation.sql.
 */

import type { FeatureKey } from '@/config/features';
import type { PlanSlug } from '@/config/plans';
import { CONFIG_PLAN_MATRIX } from '@/domain/entitlements/compute';
import type { EntitlementStore } from '@/domain/entitlements/check';
import type {
  PlanFeatureMatrix,
  QuotaWindow,
  ResourceRef,
  SubscriptionSnapshot,
} from '@/domain/entitlements/types';
import type { SubscriptionStatus } from '@/domain/billing/states';

export interface FakeStoreOptions {
  readonly subscription?: SubscriptionSnapshot | null;
  readonly matrix?: PlanFeatureMatrix;
  readonly usage?: Partial<Record<FeatureKey, number>>;
  readonly activeCases?: number;
  readonly ownedResourceIds?: readonly string[];
  readonly enabledJurisdictions?: readonly string[];
  readonly flags?: Readonly<Record<string, boolean>>;
  readonly version?: number;
}

export interface FakeStore extends EntitlementStore {
  readonly securityEvents: {
    type: string;
    userId: string;
    detail: Record<string, unknown>;
  }[];
  setUsage(feature: FeatureKey, value: number): void;
  setSubscription(subscription: SubscriptionSnapshot | null): void;
}

export function createFakeStore(options: FakeStoreOptions = {}): FakeStore {
  let subscription = options.subscription ?? null;
  const usage: Partial<Record<FeatureKey, number>> = { ...(options.usage ?? {}) };
  const securityEvents: FakeStore['securityEvents'] = [];

  return {
    securityEvents,

    setUsage(feature, value) {
      usage[feature] = value;
    },

    setSubscription(next) {
      subscription = next;
    },

    async getSubscription(): Promise<SubscriptionSnapshot | null> {
      return subscription;
    },

    async getPlanMatrix(): Promise<PlanFeatureMatrix> {
      return options.matrix ?? CONFIG_PLAN_MATRIX;
    },

    async getUsage(_userId: string, featureKey: FeatureKey, _window: QuotaWindow) {
      return usage[featureKey] ?? 0;
    },

    async getEntitlementVersion(): Promise<number> {
      return options.version ?? 1;
    },

    async countActiveCases(): Promise<number> {
      return options.activeCases ?? 0;
    },

    async ownsResource(_userId: string, resource: ResourceRef): Promise<boolean> {
      // Defaults to "owns nothing was not specified", so a test that passes a
      // resource must opt in explicitly. Fail-closed in tests too.
      if (options.ownedResourceIds === undefined) return true;
      return options.ownedResourceIds.includes(resource.id);
    },

    async isFeatureEnabled(flagKey: string): Promise<boolean> {
      return options.flags?.[flagKey] ?? false;
    },

    async isJurisdictionEnabled(code: string): Promise<boolean> {
      return (options.enabledJurisdictions ?? []).includes(code);
    },

    async recordSecurityEvent(event): Promise<void> {
      securityEvents.push(event);
    },
  };
}

const DAY = 24 * 60 * 60 * 1000;

/** A subscription snapshot with sensible defaults, overridable per test. */
export function snapshot(
  overrides: Partial<SubscriptionSnapshot> & {
    status?: SubscriptionStatus;
    planSlug?: PlanSlug;
  } = {},
): SubscriptionSnapshot {
  const now = Date.now();
  return {
    status: 'ACTIVE',
    planSlug: 'plus',
    currentPeriodStart: new Date(now - 10 * DAY),
    currentPeriodEnd: new Date(now + 20 * DAY),
    gracePeriodEnd: null,
    pendingPlanSlug: null,
    pendingPlanEffectiveAt: null,
    pauseEnd: null,
    accountCreatedAt: new Date(now - 100 * DAY),
    ...overrides,
  };
}

export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';
export const CASE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CASE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
