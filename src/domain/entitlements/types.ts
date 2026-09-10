/**
 * Entitlement types. Pure: no I/O, no framework imports.
 */

import type { FeatureKey } from '@/config/features';
import type { PlanSlug } from '@/config/plans';
import type { SubscriptionStatus } from '@/domain/billing/states';

/** Why an entitlement decision came out the way it did. */
export const ENTITLEMENT_REASONS = [
  'ALLOWED',
  'PLAN_REQUIRED',
  'LIMIT_REACHED',
  'SUBSCRIPTION_INACTIVE',
  'JURISDICTION_UNAVAILABLE',
  'FEATURE_DISABLED',
  'REQUIRES_VERIFICATION',
  'NOT_OWNER',
  'RESOURCE_INVALID',
] as const;

export type EntitlementReason = (typeof ENTITLEMENT_REASONS)[number];

/** What the UI renders for a gated feature. */
export const GATE_STATES = [
  'AVAILABLE',
  'LIMIT_REACHED',
  'PLAN_REQUIRED',
  'TEMPORARILY_UNAVAILABLE',
  'JURISDICTION_UNAVAILABLE',
  'REQUIRES_VERIFICATION',
] as const;

export type GateState = (typeof GATE_STATES)[number];

export interface Entitlement {
  readonly featureKey: FeatureKey;
  readonly enabled: boolean;
  /** null means unlimited. */
  readonly limitValue: number | null;
  readonly limitUnit: string | null;
  readonly sourcePlan: PlanSlug;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly expiresAt: string | null;
}

export type EntitlementSet = Readonly<Record<FeatureKey, Entitlement>>;

/** A snapshot of the subscription, as read from the database. */
export interface SubscriptionSnapshot {
  readonly status: SubscriptionStatus;
  readonly planSlug: PlanSlug;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly gracePeriodEnd: Date | null;
  /** Set when a downgrade has been scheduled for the end of the period. */
  readonly pendingPlanSlug: PlanSlug | null;
  readonly pendingPlanEffectiveAt: Date | null;
  readonly pauseEnd: Date | null;
  /** Anchors the rolling quota window for users with no billing period. */
  readonly accountCreatedAt: Date;
}

/** The plan matrix, as read from `plan_features` (or from src/config/plans.ts). */
export interface PlanFeatureRow {
  readonly enabled: boolean;
  readonly limitValue: number | null;
  readonly limitUnit: string | null;
}

export type PlanFeatureMatrix = Readonly<
  Record<PlanSlug, Readonly<Partial<Record<FeatureKey, PlanFeatureRow>>>>
>;

export interface QuotaWindow {
  readonly start: Date;
  readonly end: Date;
}

export interface UsageSnapshot {
  readonly featureKey: FeatureKey;
  readonly used: number;
  readonly limitValue: number | null;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

/** What `checkEntitlement()` returns. Never a bare boolean. */
export interface EntitlementDecision {
  readonly allowed: boolean;
  readonly feature: FeatureKey;
  readonly reason: EntitlementReason;
  readonly gateState: GateState;
  readonly plan: PlanSlug;
  /** null when the feature is not metered. */
  readonly remaining: number | null;
  readonly limit: number | null;
  readonly used: number | null;
  /** ISO 8601, aligned to the billing period. */
  readonly resetAt: string | null;
  readonly expiresAt: string | null;
  readonly version: number;
  /** Plain, non-manipulative sentence safe to show a user directly. */
  readonly message: string;
}

export interface ResourceRef {
  readonly type: 'case' | 'document' | 'analysis' | 'generated_document' | 'export';
  readonly id: string;
}

export interface EntitlementQuery {
  readonly userId: string;
  readonly feature: FeatureKey;
  /**
   * Entitlement and ownership are separate questions. Being on Pro entitles you
   * to run an analysis; it does not entitle you to run one on someone else's
   * case. When a resource is supplied, ownership is verified too.
   */
  readonly resource?: ResourceRef;
  readonly action?: 'read' | 'create' | 'execute' | 'export' | 'delete';
  /** How much quota this operation would consume. Defaults to 1. */
  readonly amount?: number;
  /**
   * For LIMIT features whose current value only the caller knows, such as the
   * size of the file being uploaded or bytes already stored. QUOTA features and
   * MAX_ACTIVE_CASES are read from the store instead and ignore this.
   */
  readonly currentUsage?: number;
  /** Some features are gated per state or province. */
  readonly jurisdictionCode?: string;
}
