/**
 * Quota windows.
 *
 * Windows align to the BILLING period, not the calendar month. A subscription
 * running the 14th to the 14th resets on the 14th. Free users have no provider
 * period, so they get a rolling window anchored to account creation.
 *
 * All arithmetic is UTC. Pure module: no I/O.
 */

import { POLICY } from '@/config/policy';
import type { QuotaWindow, SubscriptionSnapshot } from '@/domain/entitlements/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A rolling window of `days` anchored to `anchor` and containing `now`.
 *
 * Fixed-length arithmetic on epoch milliseconds rather than calendar month
 * addition, so 31 January does not silently become 3 March, and a DST
 * transition does not move a boundary.
 */
export function rollingWindow(anchor: Date, now: Date, days: number): QuotaWindow {
  if (days <= 0) {
    throw new RangeError(`rollingWindow: days must be positive, got ${days}`);
  }
  const lengthMs = days * DAY_MS;
  const elapsed = now.getTime() - anchor.getTime();
  const periods = elapsed >= 0 ? Math.floor(elapsed / lengthMs) : 0;
  const start = new Date(anchor.getTime() + periods * lengthMs);
  return { start, end: new Date(start.getTime() + lengthMs) };
}

/**
 * The quota window in force right now.
 *
 * Three cases:
 *   1. `now` sits inside the provider period: use it verbatim.
 *   2. The period has rolled but the webhook has not landed: project forward by
 *      whole period lengths. A delayed webhook must never cost a customer an
 *      allowance, and must never silently extend one either.
 *   3. No provider period at all (free, or pre-checkout): rolling window.
 */
export function quotaWindow(
  subscription: SubscriptionSnapshot,
  now: Date = new Date(),
): QuotaWindow {
  const { currentPeriodStart: start, currentPeriodEnd: end } = subscription;

  if (start !== null && end !== null && end.getTime() > start.getTime()) {
    if (now.getTime() >= start.getTime() && now.getTime() < end.getTime()) {
      return { start, end };
    }

    if (now.getTime() >= end.getTime()) {
      const lengthMs = end.getTime() - start.getTime();
      const periods = Math.floor((now.getTime() - start.getTime()) / lengthMs);
      const projected = new Date(start.getTime() + periods * lengthMs);
      return { start: projected, end: new Date(projected.getTime() + lengthMs) };
    }
    // now < start: the period has not begun. Fall through to the rolling window
    // rather than granting an allowance early.
  }

  return rollingWindow(
    subscription.accountCreatedAt,
    now,
    POLICY.usage.freeWindowDays,
  );
}

/** Stable key for a window, used in idempotency keys and counter lookups. */
export function windowKey(window: QuotaWindow): string {
  return `${window.start.toISOString()}_${window.end.toISOString()}`;
}

export function isSameWindow(a: QuotaWindow, b: QuotaWindow): boolean {
  return (
    a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime()
  );
}

export function windowContains(window: QuotaWindow, at: Date): boolean {
  return at.getTime() >= window.start.getTime() && at.getTime() < window.end.getTime();
}

/** Whole days remaining in the window, for "resets in N days" copy. */
export function daysRemaining(window: QuotaWindow, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((window.end.getTime() - now.getTime()) / DAY_MS));
}
