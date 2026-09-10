/**
 * The subscription state machine.
 *
 * Every transition in docs/BILLING.md section 3 is exercised here, plus the
 * property that matters most: an unknown transition is REJECTED rather than
 * silently accepted.
 */

import { describe, expect, it } from 'vitest';
import {
  BILLING_EVENTS,
  BillingTransitionError,
  ENTITLED_STATUSES,
  SUBSCRIPTION_STATUSES,
  STATUS_DESCRIPTIONS,
  applyTransition,
  canTransition,
  grantsPlanEntitlements,
  isLive,
  isTerminal,
  tryTransition,
  type BillingEvent,
  type SubscriptionStatus,
} from '@/domain/billing/states';
import { comparePlans } from '@/config/plans';

describe('documented transitions', () => {
  const cases: [SubscriptionStatus, BillingEvent, SubscriptionStatus][] = [
    ['FREE', 'CHECKOUT_STARTED', 'CHECKOUT_PENDING'],
    ['CHECKOUT_PENDING', 'PAYMENT_REQUIRES_ACTION', 'INCOMPLETE'],
    ['CHECKOUT_PENDING', 'PAYMENT_SUCCEEDED', 'ACTIVE'],
    ['CHECKOUT_PENDING', 'CHECKOUT_ABANDONED', 'FREE'],
    ['INCOMPLETE', 'PAYMENT_SUCCEEDED', 'ACTIVE'],
    ['INCOMPLETE', 'SUBSCRIPTION_DELETED', 'EXPIRED'],
    ['ACTIVE', 'TRIAL_STARTED', 'TRIALING'],
    ['TRIALING', 'PAYMENT_SUCCEEDED', 'ACTIVE'],
    ['TRIALING', 'TRIAL_ENDED_UNPAID', 'EXPIRED'],
    ['ACTIVE', 'PAYMENT_FAILED', 'PAST_DUE'],
    ['PAST_DUE', 'GRACE_STARTED', 'GRACE'],
    ['PAST_DUE', 'PAYMENT_SUCCEEDED', 'ACTIVE'],
    ['GRACE', 'PAYMENT_SUCCEEDED', 'ACTIVE'],
    ['GRACE', 'GRACE_EXPIRED', 'EXPIRED'],
    ['ACTIVE', 'PAUSE_REQUESTED', 'PAUSED'],
    ['PAUSED', 'RESUMED', 'ACTIVE'],
    ['ACTIVE', 'CANCEL_AT_PERIOD_END', 'CANCELED_PENDING_EXPIRY'],
    ['CANCELED_PENDING_EXPIRY', 'REACTIVATED', 'ACTIVE'],
    ['CANCELED_PENDING_EXPIRY', 'PERIOD_ENDED', 'EXPIRED'],
    ['ACTIVE', 'CANCEL_IMMEDIATELY', 'EXPIRED'],
    ['ACTIVE', 'REFUND_ISSUED', 'REFUNDED'],
    ['REFUNDED', 'ENTITLEMENTS_RECOMPUTED', 'FREE'],
    ['EXPIRED', 'ENTITLEMENTS_RECOMPUTED', 'FREE'],
    ['ACTIVE', 'REVOKED_FOR_ABUSE', 'REVOKED'],
    ['REVOKED', 'ENTITLEMENTS_RECOMPUTED', 'FREE'],
  ];

  it.each(cases)('%s + %s -> %s', (from, event, expected) => {
    expect(applyTransition(from, event).to).toBe(expected);
  });
});

describe('illegal transitions', () => {
  it('rejects rather than silently accepting', () => {
    expect(() => applyTransition('FREE', 'PAYMENT_SUCCEEDED')).toThrow(
      BillingTransitionError,
    );
    expect(() => applyTransition('EXPIRED', 'PAYMENT_FAILED')).toThrow(
      BillingTransitionError,
    );
    expect(() => applyTransition('REVOKED', 'REACTIVATED')).toThrow(
      BillingTransitionError,
    );
  });

  it('exposes the rejection without throwing, so it can be recorded', () => {
    const result = tryTransition('FREE', 'GRACE_EXPIRED');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.from).toBe('FREE');
      expect(result.error.event).toBe('GRACE_EXPIRED');
    }
  });

  it('cannot be tricked into granting access from a terminal state', () => {
    // A forged event that somehow got past signature verification still cannot
    // move REVOKED straight to ACTIVE.
    for (const event of BILLING_EVENTS) {
      if (!canTransition('REVOKED', event)) continue;
      expect(applyTransition('REVOKED', event).to).toBe('FREE');
    }
  });
});

describe('idempotency', () => {
  it('marks a self-transition as a no-op', () => {
    // A duplicate PAYMENT_SUCCEEDED on an ACTIVE subscription changes nothing.
    const result = applyTransition('ACTIVE', 'PAYMENT_SUCCEEDED');
    expect(result.to).toBe('ACTIVE');
    expect(result.noop).toBe(true);
  });

  it('treats a repeated failure as still past due', () => {
    const result = applyTransition('PAST_DUE', 'PAYMENT_FAILED');
    expect(result.to).toBe('PAST_DUE');
    expect(result.noop).toBe(true);
  });
});

describe('entitlement-bearing statuses', () => {
  it('includes the states where the customer has already paid', () => {
    expect(ENTITLED_STATUSES).toContain('ACTIVE');
    expect(ENTITLED_STATUSES).toContain('TRIALING');
    // A failed renewal does not immediately revoke.
    expect(ENTITLED_STATUSES).toContain('PAST_DUE');
    expect(ENTITLED_STATUSES).toContain('GRACE');
    // A canceled subscription runs to the end of the paid period.
    expect(ENTITLED_STATUSES).toContain('CANCELED_PENDING_EXPIRY');
  });

  it('excludes every state where nothing is being paid for', () => {
    for (const status of ['FREE', 'EXPIRED', 'REFUNDED', 'REVOKED', 'PAUSED'] as const) {
      expect(grantsPlanEntitlements(status)).toBe(false);
    }
  });

  it('classifies terminal and live statuses consistently', () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      // Nothing can be both terminal and occupying the live slot.
      expect(isTerminal(status) && isLive(status)).toBe(false);
    }
  });
});

describe('customer-facing copy', () => {
  it('describes every status without alarming language', () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      const text = STATUS_DESCRIPTIONS[status];
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/immediately|urgent|lose everything|act now|!!/i);
      expect(text).toBe(text.trim());
    }
  });
});

describe('plan comparison', () => {
  it('identifies upgrades and downgrades', () => {
    expect(comparePlans('free', 'plus')).toBe(1);
    expect(comparePlans('plus', 'essential')).toBe(-1);
    expect(comparePlans('pro', 'pro')).toBe(0);
    expect(comparePlans('essential', 'pro')).toBe(1);
  });
});
