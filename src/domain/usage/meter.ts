/**
 * Usage metering: reserve, then commit or roll back.
 *
 * A failed operation must not burn a credit, and a browser retry must not burn
 * two. Both properties come from the database: `SELECT ... FOR UPDATE`
 * serialises concurrent callers, and a unique idempotency key makes a retry
 * return the original answer.
 *
 * Pure module apart from the injected store port. See docs/ENTITLEMENTS.md
 * section 5 and supabase/migrations/0011_functions_usage_atomic.sql.
 */

import type { FeatureKey } from '@/config/features';
import { shouldRefundUsage, type UsageFailureReason } from '@/config/policy';
import type { QuotaWindow } from '@/domain/entitlements/types';
import { windowKey } from './period';

export type ConsumeStatus = 'ALLOWED' | 'LIMIT_REACHED' | 'REPLAYED';

export interface ConsumeInput {
  readonly userId: string;
  readonly featureKey: FeatureKey;
  readonly amount: number;
  readonly idempotencyKey: string;
  readonly window: QuotaWindow;
  /** null means unlimited. */
  readonly limit: number | null;
}

export interface ConsumeResult {
  readonly status: ConsumeStatus;
  readonly remaining: number | null;
  readonly used: number;
  readonly limit: number | null;
  readonly reservationId: string | null;
}

/** Persistence port, mirroring the three SQL functions exactly. */
export interface UsageStore {
  consume(input: ConsumeInput): Promise<ConsumeResult>;
  commit(reservationId: string): Promise<boolean>;
  rollback(reservationId: string): Promise<boolean>;
}

export class QuotaExceededError extends Error {
  readonly featureKey: FeatureKey;
  readonly limit: number | null;
  readonly used: number;

  constructor(featureKey: FeatureKey, limit: number | null, used: number) {
    super(`Quota exceeded for ${featureKey}`);
    this.name = 'QuotaExceededError';
    this.featureKey = featureKey;
    this.limit = limit;
    this.used = used;
  }
}

/**
 * Build a stable idempotency key.
 *
 * The `operationKey` is what distinguishes a genuine second operation from a
 * retry of the first. Callers derive it from something the client controls and
 * repeats across retries: a client-supplied request id, or a content hash of
 * the input. It must NOT be a timestamp or a random value, because that would
 * turn every retry into a second charge.
 */
export function buildIdempotencyKey(parts: {
  userId: string;
  featureKey: FeatureKey;
  window: QuotaWindow;
  operationKey: string;
}): string {
  return [
    parts.userId,
    parts.featureKey,
    windowKey(parts.window),
    parts.operationKey,
  ].join('|');
}

export interface MeteredRunResult<T> {
  readonly value: T;
  readonly reservationId: string | null;
  readonly remaining: number | null;
  readonly replayed: boolean;
}

/**
 * Run an operation under a quota reservation.
 *
 * Reserve, run, then commit on success or roll back on a failure the policy
 * says is not the customer's fault. An unexpected throw is treated as an
 * infrastructure failure and the credit is returned, because the alternative —
 * charging a customer for work that did not happen — is the worse error.
 */
export async function withQuota<T>(
  store: UsageStore,
  input: ConsumeInput,
  operation: () => Promise<T>,
  options: {
    /** Classify a thrown error. Defaults to INFRASTRUCTURE_FAILURE. */
    classifyFailure?: (error: unknown) => UsageFailureReason;
  } = {},
): Promise<MeteredRunResult<T>> {
  const reservation = await store.consume(input);

  if (reservation.status === 'LIMIT_REACHED') {
    throw new QuotaExceededError(input.featureKey, reservation.limit, reservation.used);
  }

  // A replay returns the original decision. The caller re-runs the operation
  // (results are derived and idempotent), but no further quota is consumed.
  const replayed = reservation.status === 'REPLAYED';

  try {
    const value = await operation();
    if (reservation.reservationId !== null && !replayed) {
      await store.commit(reservation.reservationId);
    }
    return {
      value,
      reservationId: reservation.reservationId,
      remaining: reservation.remaining,
      replayed,
    };
  } catch (error) {
    const reason: UsageFailureReason =
      options.classifyFailure?.(error) ?? 'INFRASTRUCTURE_FAILURE';

    if (reservation.reservationId !== null && !replayed && shouldRefundUsage(reason)) {
      await store.rollback(reservation.reservationId);
    } else if (reservation.reservationId !== null && !replayed) {
      await store.commit(reservation.reservationId);
    }
    throw error;
  }
}

/**
 * An in-memory UsageStore with the same semantics as the SQL functions.
 *
 * Used by `tests/usage-metering.test.ts`, including the concurrency case:
 * because JavaScript runs the critical section without interleaving, ten
 * simultaneous callers against a limit of two resolve to exactly two, which is
 * the behaviour `SELECT ... FOR UPDATE` produces in Postgres.
 */
export function createInMemoryUsageStore(): UsageStore & {
  readonly counters: Map<string, { used: number; limit: number | null }>;
} {
  const counters = new Map<string, { used: number; limit: number | null }>();
  const reservations = new Map<
    string,
    {
      id: string;
      counterKey: string;
      amount: number;
      status: 'RESERVED' | 'COMMITTED' | 'ROLLED_BACK';
      remaining: number | null;
    }
  >();
  const byIdempotencyKey = new Map<string, string>();
  let seq = 0;

  const counterKeyFor = (i: ConsumeInput): string =>
    `${i.userId}|${i.featureKey}|${i.window.start.toISOString()}`;

  return {
    counters,

    async consume(input: ConsumeInput): Promise<ConsumeResult> {
      if (input.amount <= 0) {
        throw new RangeError(`consume: amount must be positive, got ${input.amount}`);
      }

      const existingId = byIdempotencyKey.get(input.idempotencyKey);
      if (existingId !== undefined) {
        const res = reservations.get(existingId)!;
        const counter = counters.get(res.counterKey)!;
        return {
          status: 'REPLAYED',
          remaining: res.remaining,
          used: counter.used,
          limit: counter.limit,
          reservationId: res.id,
        };
      }

      const key = counterKeyFor(input);
      let counter = counters.get(key);
      if (counter === undefined) {
        counter = { used: 0, limit: input.limit };
        counters.set(key, counter);
      }

      // A larger new limit is adopted (upgrades apply at once); a smaller one is
      // ignored for the current window, so a mid-period change cannot
      // retroactively push a user over a limit they were legitimately under.
      if (input.limit !== null && (counter.limit === null || input.limit > counter.limit)) {
        counter.limit = input.limit;
      }

      if (counter.limit !== null && counter.used + input.amount > counter.limit) {
        return {
          status: 'LIMIT_REACHED',
          remaining: Math.max(counter.limit - counter.used, 0),
          used: counter.used,
          limit: counter.limit,
          reservationId: null,
        };
      }

      counter.used += input.amount;
      const id = `res_${++seq}`;
      const remaining = counter.limit === null ? null : counter.limit - counter.used;
      reservations.set(id, {
        id,
        counterKey: key,
        amount: input.amount,
        status: 'RESERVED',
        remaining,
      });
      byIdempotencyKey.set(input.idempotencyKey, id);

      return {
        status: 'ALLOWED',
        remaining,
        used: counter.used,
        limit: counter.limit,
        reservationId: id,
      };
    },

    async commit(reservationId: string): Promise<boolean> {
      const res = reservations.get(reservationId);
      if (res === undefined) return false;
      if (res.status === 'COMMITTED') return true;
      if (res.status !== 'RESERVED') return false;
      res.status = 'COMMITTED';
      return true;
    },

    async rollback(reservationId: string): Promise<boolean> {
      const res = reservations.get(reservationId);
      if (res === undefined) return false;
      // Never double-refund.
      if (res.status !== 'RESERVED') return res.status === 'ROLLED_BACK';
      const counter = counters.get(res.counterKey);
      if (counter !== undefined) {
        counter.used = Math.max(counter.used - res.amount, 0);
      }
      res.status = 'ROLLED_BACK';
      return true;
    },
  };
}
