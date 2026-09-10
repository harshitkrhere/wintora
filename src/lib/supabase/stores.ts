/**
 * Supabase adapters for the domain ports.
 *
 * The domain declares narrow interfaces (`EntitlementStore`, `UsageStore`);
 * this module is the only place that knows they are backed by Postgres. Tests
 * substitute in-memory fakes, which is what makes the entitlement and metering
 * matrices testable without a live database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { FEATURE_KEYS, type FeatureKey } from '@/config/features';
import { PLAN_SLUGS, type PlanSlug, isPlanSlug } from '@/config/plans';
import { CONFIG_PLAN_MATRIX, computeEntitlements } from '@/domain/entitlements/compute';
import type { EntitlementStore } from '@/domain/entitlements/check';
import type {
  PlanFeatureMatrix,
  QuotaWindow,
  ResourceRef,
  SubscriptionSnapshot,
} from '@/domain/entitlements/types';
import type {
  ConsumeInput,
  ConsumeResult,
  UsageStore,
} from '@/domain/usage/meter';
import type { SubscriptionStatus } from '@/domain/billing/states';
import { log } from '@/lib/logging';

/** Which table owns each resource type, for the ownership check. */
const RESOURCE_TABLES: Readonly<Record<ResourceRef['type'], string>> = {
  case: 'cases',
  document: 'documents',
  analysis: 'analyses',
  generated_document: 'generated_documents',
  export: 'export_jobs',
};

// ---------------------------------------------------------------------------
// Plan matrix
// ---------------------------------------------------------------------------

let matrixCache: { value: PlanFeatureMatrix; at: number } | null = null;
const MATRIX_TTL_MS = 60_000;

/**
 * Read the plan matrix from the database.
 *
 * Falls back to the config matrix if the read fails, so a transient database
 * problem degrades to the shipped defaults rather than denying every paying
 * customer their features.
 */
export async function loadPlanMatrix(
  client: SupabaseClient,
  options: { force?: boolean } = {},
): Promise<PlanFeatureMatrix> {
  const now = Date.now();
  if (
    options.force !== true &&
    matrixCache !== null &&
    now - matrixCache.at < MATRIX_TTL_MS
  ) {
    return matrixCache.value;
  }

  const { data, error } = await client
    .from('plan_features')
    .select('enabled, limit_value, limit_unit, plans!inner(slug), features!inner(key)');

  if (error !== null || data === null) {
    log.warn('plan matrix read failed, using config fallback', {
      errorClass: error?.code ?? 'unknown',
    });
    return CONFIG_PLAN_MATRIX;
  }

  const out: Record<string, Record<string, unknown>> = {};
  for (const slug of PLAN_SLUGS) out[slug] = {};

  for (const row of data as unknown as {
    enabled: boolean;
    limit_value: number | null;
    limit_unit: string | null;
    plans: { slug: string };
    features: { key: string };
  }[]) {
    const slug = row.plans.slug;
    const key = row.features.key;
    if (!isPlanSlug(slug)) continue;
    if (!(FEATURE_KEYS as readonly string[]).includes(key)) continue;

    out[slug]![key] = {
      enabled: row.enabled,
      limitValue: row.limit_value,
      limitUnit: row.limit_unit,
    };
  }

  const matrix = out as PlanFeatureMatrix;
  matrixCache = { value: matrix, at: now };
  return matrix;
}

export function __clearMatrixCache(): void {
  matrixCache = null;
}

// ---------------------------------------------------------------------------
// EntitlementStore
// ---------------------------------------------------------------------------

/**
 * @param client A service_role client. Every method here is called only after
 *   the route handler has established the authenticated user id, and ownership
 *   is verified explicitly by `ownsResource`.
 */
export function createEntitlementStore(client: SupabaseClient): EntitlementStore {
  return {
    async getSubscription(userId: string): Promise<SubscriptionSnapshot | null> {
      const [{ data: sub }, { data: profile }] = await Promise.all([
        client
          .from('subscriptions')
          .select(
            'status, current_period_start, current_period_end, grace_period_end, ' +
              'pending_plan_effective_at, pause_end, plans!subscriptions_plan_id_fkey(slug), ' +
              'pending:plans!subscriptions_pending_plan_id_fkey(slug)',
          )
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        client
          .from('profiles')
          .select('created_at')
          .eq('id', userId)
          .maybeSingle(),
      ]);

      const accountCreatedAt =
        profile?.created_at !== undefined && profile?.created_at !== null
          ? new Date(profile.created_at as string)
          : new Date();

      if (sub === null || sub === undefined) return null;

      const row = sub as unknown as {
        status: SubscriptionStatus;
        current_period_start: string | null;
        current_period_end: string | null;
        grace_period_end: string | null;
        pending_plan_effective_at: string | null;
        pause_end: string | null;
        plans: { slug: string } | null;
        pending: { slug: string } | null;
      };

      const planSlug = row.plans?.slug;
      const pendingSlug = row.pending?.slug;

      return {
        status: row.status,
        planSlug: planSlug !== undefined && isPlanSlug(planSlug) ? planSlug : 'free',
        currentPeriodStart: toDate(row.current_period_start),
        currentPeriodEnd: toDate(row.current_period_end),
        gracePeriodEnd: toDate(row.grace_period_end),
        pendingPlanSlug:
          pendingSlug !== undefined && isPlanSlug(pendingSlug) ? pendingSlug : null,
        pendingPlanEffectiveAt: toDate(row.pending_plan_effective_at),
        pauseEnd: toDate(row.pause_end),
        accountCreatedAt,
      };
    },

    async getPlanMatrix(): Promise<PlanFeatureMatrix> {
      return loadPlanMatrix(client);
    },

    async getUsage(
      userId: string,
      featureKey: FeatureKey,
      window: QuotaWindow,
    ): Promise<number> {
      const { data } = await client
        .from('usage_counters')
        .select('used')
        .eq('user_id', userId)
        .eq('feature_key', featureKey)
        .eq('period_start', window.start.toISOString())
        .maybeSingle();

      return (data?.used as number | undefined) ?? 0;
    },

    async getEntitlementVersion(userId: string): Promise<number> {
      const { data } = await client
        .from('entitlement_versions')
        .select('version')
        .eq('user_id', userId)
        .maybeSingle();

      return (data?.version as number | undefined) ?? 0;
    },

    async countActiveCases(userId: string): Promise<number> {
      // Calls the SQL function so the UI and the enforcement share one
      // definition of "active case".
      const { data, error } = await client.rpc('count_active_cases', {
        p_user_id: userId,
      });
      if (error !== null) return 0;
      return typeof data === 'number' ? data : 0;
    },

    async ownsResource(userId: string, resource: ResourceRef): Promise<boolean> {
      const table = RESOURCE_TABLES[resource.type];
      const { data, error } = await client
        .from(table)
        .select('user_id')
        .eq('id', resource.id)
        .maybeSingle();

      if (error !== null || data === null) return false;
      return (data as { user_id: string }).user_id === userId;
    },

    async isFeatureEnabled(flagKey: string): Promise<boolean> {
      const { data } = await client
        .from('feature_flags')
        .select('enabled')
        .eq('key', flagKey)
        .maybeSingle();
      return (data?.enabled as boolean | undefined) ?? false;
    },

    async isJurisdictionEnabled(code: string): Promise<boolean> {
      const { data } = await client
        .from('jurisdictions')
        .select('enabled, processing_enabled')
        .eq('slug', code.toLowerCase())
        .maybeSingle();

      if (data === null || data === undefined) return false;
      const row = data as { enabled: boolean; processing_enabled: boolean };
      return row.enabled && row.processing_enabled;
    },

    async recordSecurityEvent(event): Promise<void> {
      await client.from('security_events').insert({
        event_type: event.type,
        user_id: event.userId,
        severity: 'WARN',
        detail: event.detail,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// UsageStore
// ---------------------------------------------------------------------------

/** Wraps the three SQL functions. All atomicity lives in the database. */
export function createUsageStore(client: SupabaseClient): UsageStore {
  return {
    async consume(input: ConsumeInput): Promise<ConsumeResult> {
      const { data, error } = await client.rpc('consume_usage', {
        p_user_id: input.userId,
        p_feature_key: input.featureKey,
        p_amount: input.amount,
        p_idempotency_key: input.idempotencyKey,
        p_period_start: input.window.start.toISOString(),
        p_period_end: input.window.end.toISOString(),
        p_limit: input.limit,
      });

      if (error !== null) {
        throw new Error(`consume_usage failed: ${error.code ?? 'unknown'}`);
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (row === undefined || row === null) {
        throw new Error('consume_usage returned no row');
      }

      const r = row as {
        status: ConsumeResult['status'];
        remaining: number | null;
        used: number;
        limit_value: number | null;
        reservation_id: string | null;
      };

      return {
        status: r.status,
        remaining: r.remaining,
        used: r.used,
        limit: r.limit_value,
        reservationId: r.reservation_id,
      };
    },

    async commit(reservationId: string): Promise<boolean> {
      const { data, error } = await client.rpc('commit_usage', {
        p_reservation_id: reservationId,
      });
      return error === null && data === true;
    },

    async rollback(reservationId: string): Promise<boolean> {
      const { data, error } = await client.rpc('rollback_usage', {
        p_reservation_id: reservationId,
      });
      return error === null && data === true;
    },
  };
}

// ---------------------------------------------------------------------------
// Entitlement recomputation
// ---------------------------------------------------------------------------

/**
 * Rebuild `user_entitlements` from the subscription, the plan matrix and
 * policy, then bump the version.
 *
 * This is the ONLY writer of `user_entitlements`. It is idempotent: running it
 * twice produces the same rows, so a duplicate webhook cannot double-grant.
 * It can be run at any time to repair the cache.
 */
export async function recomputeEntitlements(
  client: SupabaseClient,
  userId: string,
  options: { now?: Date } = {},
): Promise<{ version: number; plan: PlanSlug }> {
  const store = createEntitlementStore(client);
  const now = options.now ?? new Date();

  const subscription = await store.getSubscription(userId);
  const matrix = await loadPlanMatrix(client, { force: true });

  const snapshot: SubscriptionSnapshot = subscription ?? {
    status: 'FREE',
    planSlug: 'free',
    currentPeriodStart: null,
    currentPeriodEnd: null,
    gracePeriodEnd: null,
    pendingPlanSlug: null,
    pendingPlanEffectiveAt: null,
    pauseEnd: null,
    accountCreatedAt: now,
  };

  const entitlements = computeEntitlements(snapshot, { matrix, now });

  const { data: featureRows } = await client.from('features').select('id, key');
  const featureIdByKey = new Map<string, string>(
    ((featureRows ?? []) as { id: string; key: string }[]).map((r) => [r.key, r.id]),
  );

  const { data: planRow } = await client
    .from('plans')
    .select('id')
    .eq('slug', entitlements.DOCUMENT_UPLOAD.sourcePlan)
    .eq('version', 1)
    .maybeSingle();

  const version = await bumpVersion(client, userId);

  const rows = FEATURE_KEYS.flatMap((key) => {
    const featureId = featureIdByKey.get(key);
    if (featureId === undefined) return [];
    const e = entitlements[key];
    return [
      {
        user_id: userId,
        feature_id: featureId,
        feature_key: key,
        source_plan_id: (planRow as { id: string } | null)?.id ?? null,
        enabled: e.enabled,
        limit_value: e.limitValue,
        limit_unit: e.limitUnit,
        period_start: e.periodStart,
        period_end: e.periodEnd,
        expires_at: e.expiresAt,
        version,
        updated_at: now.toISOString(),
      },
    ];
  });

  const { error } = await client
    .from('user_entitlements')
    .upsert(rows, { onConflict: 'user_id,feature_id' });

  if (error !== null) {
    throw new Error(`recomputeEntitlements failed: ${error.code ?? 'unknown'}`);
  }

  log.info('entitlements recomputed', {
    plan: entitlements.DOCUMENT_UPLOAD.sourcePlan,
    version,
    status: snapshot.status as unknown as number,
  });

  return { version, plan: entitlements.DOCUMENT_UPLOAD.sourcePlan };
}

async function bumpVersion(client: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await client.rpc('bump_entitlement_version', {
    p_user_id: userId,
  });
  if (error !== null) throw new Error(`bump_entitlement_version failed: ${error.code}`);
  return typeof data === 'number' ? data : 0;
}

function toDate(value: string | null): Date | null {
  if (value === null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
