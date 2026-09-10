/**
 * The subscription state machine.
 *
 * Every transition is explicit, logged, idempotent and testable. A transition
 * that is not in the table is REJECTED rather than silently accepted, and the
 * attempt is recorded as a security event. See docs/BILLING.md section 3.
 *
 * Pure module: no I/O, no imports from src/lib.
 */

export const SUBSCRIPTION_STATUSES = [
  'FREE',
  'CHECKOUT_PENDING',
  'INCOMPLETE',
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'GRACE',
  'PAUSED',
  'CANCELED_PENDING_EXPIRY',
  'EXPIRED',
  'REFUNDED',
  'REVOKED',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_EVENTS = [
  'CHECKOUT_STARTED',
  'CHECKOUT_ABANDONED',
  'PAYMENT_REQUIRES_ACTION',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'TRIAL_STARTED',
  'TRIAL_ENDED_UNPAID',
  'GRACE_STARTED',
  'GRACE_EXPIRED',
  'PAUSE_REQUESTED',
  'RESUMED',
  'CANCEL_AT_PERIOD_END',
  'CANCEL_IMMEDIATELY',
  'REACTIVATED',
  'PERIOD_ENDED',
  'SUBSCRIPTION_DELETED',
  'REFUND_ISSUED',
  'REVOKED_FOR_ABUSE',
  'ENTITLEMENTS_RECOMPUTED',
] as const;

export type BillingEvent = (typeof BILLING_EVENTS)[number];

/**
 * The transition table. Anything absent is illegal by construction, which is
 * the property that makes an out-of-order or forged event harmless.
 */
export const TRANSITIONS: Readonly<
  Record<SubscriptionStatus, Readonly<Partial<Record<BillingEvent, SubscriptionStatus>>>>
> = {
  FREE: {
    CHECKOUT_STARTED: 'CHECKOUT_PENDING',
  },
  CHECKOUT_PENDING: {
    PAYMENT_REQUIRES_ACTION: 'INCOMPLETE',
    PAYMENT_SUCCEEDED: 'ACTIVE',
    TRIAL_STARTED: 'TRIALING',
    CHECKOUT_ABANDONED: 'FREE',
    SUBSCRIPTION_DELETED: 'EXPIRED',
  },
  INCOMPLETE: {
    PAYMENT_SUCCEEDED: 'ACTIVE',
    PAYMENT_FAILED: 'INCOMPLETE',
    SUBSCRIPTION_DELETED: 'EXPIRED',
    CANCEL_IMMEDIATELY: 'EXPIRED',
  },
  TRIALING: {
    PAYMENT_SUCCEEDED: 'ACTIVE',
    TRIAL_ENDED_UNPAID: 'EXPIRED',
    PAYMENT_FAILED: 'PAST_DUE',
    CANCEL_AT_PERIOD_END: 'CANCELED_PENDING_EXPIRY',
    CANCEL_IMMEDIATELY: 'EXPIRED',
    SUBSCRIPTION_DELETED: 'EXPIRED',
    REVOKED_FOR_ABUSE: 'REVOKED',
  },
  ACTIVE: {
    TRIAL_STARTED: 'TRIALING',
    PAYMENT_SUCCEEDED: 'ACTIVE',
    PAYMENT_FAILED: 'PAST_DUE',
    PAUSE_REQUESTED: 'PAUSED',
    CANCEL_AT_PERIOD_END: 'CANCELED_PENDING_EXPIRY',
    CANCEL_IMMEDIATELY: 'EXPIRED',
    REFUND_ISSUED: 'REFUNDED',
    SUBSCRIPTION_DELETED: 'EXPIRED',
    REVOKED_FOR_ABUSE: 'REVOKED',
    PERIOD_ENDED: 'ACTIVE',
  },
  PAST_DUE: {
    GRACE_STARTED: 'GRACE',
    PAYMENT_SUCCEEDED: 'ACTIVE',
    PAYMENT_FAILED: 'PAST_DUE',
    CANCEL_IMMEDIATELY: 'EXPIRED',
    SUBSCRIPTION_DELETED: 'EXPIRED',
    REVOKED_FOR_ABUSE: 'REVOKED',
  },
  GRACE: {
    PAYMENT_SUCCEEDED: 'ACTIVE',
    GRACE_EXPIRED: 'EXPIRED',
    CANCEL_IMMEDIATELY: 'EXPIRED',
    SUBSCRIPTION_DELETED: 'EXPIRED',
    REVOKED_FOR_ABUSE: 'REVOKED',
  },
  PAUSED: {
    RESUMED: 'ACTIVE',
    CANCEL_IMMEDIATELY: 'EXPIRED',
    SUBSCRIPTION_DELETED: 'EXPIRED',
    REVOKED_FOR_ABUSE: 'REVOKED',
  },
  CANCELED_PENDING_EXPIRY: {
    REACTIVATED: 'ACTIVE',
    PERIOD_ENDED: 'EXPIRED',
    SUBSCRIPTION_DELETED: 'EXPIRED',
    CANCEL_IMMEDIATELY: 'EXPIRED',
    PAYMENT_SUCCEEDED: 'CANCELED_PENDING_EXPIRY',
    REVOKED_FOR_ABUSE: 'REVOKED',
  },
  EXPIRED: {
    ENTITLEMENTS_RECOMPUTED: 'FREE',
    CHECKOUT_STARTED: 'CHECKOUT_PENDING',
  },
  REFUNDED: {
    ENTITLEMENTS_RECOMPUTED: 'FREE',
    CHECKOUT_STARTED: 'CHECKOUT_PENDING',
  },
  REVOKED: {
    ENTITLEMENTS_RECOMPUTED: 'FREE',
  },
};

/**
 * Statuses in which the customer holds the entitlements of their paid plan.
 *
 * PAST_DUE and GRACE are deliberately included: premium access is not cut at
 * the first failed charge. CANCELED_PENDING_EXPIRY is included because a
 * customer keeps what they paid for until the period they paid for ends.
 */
export const ENTITLED_STATUSES: readonly SubscriptionStatus[] = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'GRACE',
  'CANCELED_PENDING_EXPIRY',
];

/** Statuses from which no further lifecycle event is expected. */
export const TERMINAL_STATUSES: readonly SubscriptionStatus[] = [
  'EXPIRED',
  'REFUNDED',
  'REVOKED',
];

/** Statuses that occupy the single live-subscription slot for a user. */
export const LIVE_STATUSES: readonly SubscriptionStatus[] = [
  'CHECKOUT_PENDING',
  'INCOMPLETE',
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'GRACE',
  'PAUSED',
  'CANCELED_PENDING_EXPIRY',
];

export function grantsPlanEntitlements(status: SubscriptionStatus): boolean {
  return ENTITLED_STATUSES.includes(status);
}

export function isTerminal(status: SubscriptionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isLive(status: SubscriptionStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

export class BillingTransitionError extends Error {
  readonly from: SubscriptionStatus;
  readonly event: BillingEvent;

  constructor(from: SubscriptionStatus, event: BillingEvent) {
    super(`Illegal billing transition: ${from} + ${event}`);
    this.name = 'BillingTransitionError';
    this.from = from;
    this.event = event;
  }
}

export interface TransitionResult {
  readonly from: SubscriptionStatus;
  readonly to: SubscriptionStatus;
  readonly event: BillingEvent;
  /** True when the state did not change, e.g. a duplicate PAYMENT_SUCCEEDED. */
  readonly noop: boolean;
}

export function canTransition(
  from: SubscriptionStatus,
  event: BillingEvent,
): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

export function nextStatus(
  from: SubscriptionStatus,
  event: BillingEvent,
): SubscriptionStatus | undefined {
  return TRANSITIONS[from][event];
}

/**
 * Apply a transition, or throw. Idempotent by construction: replaying an event
 * that maps a status to itself yields `noop: true`, so a duplicate webhook
 * changes nothing.
 */
export function applyTransition(
  from: SubscriptionStatus,
  event: BillingEvent,
): TransitionResult {
  const to = TRANSITIONS[from][event];
  if (to === undefined) {
    throw new BillingTransitionError(from, event);
  }
  return { from, to, event, noop: to === from };
}

/** Non-throwing variant for callers that need to record the rejection. */
export function tryTransition(
  from: SubscriptionStatus,
  event: BillingEvent,
): { ok: true; result: TransitionResult } | { ok: false; error: BillingTransitionError } {
  const to = TRANSITIONS[from][event];
  if (to === undefined) {
    return { ok: false, error: new BillingTransitionError(from, event) };
  }
  return { ok: true, result: { from, to, event, noop: to === from } };
}

/**
 * Customer-facing description of a status. Factual, never alarming.
 * See docs/AI_SAFETY.md section 8 on language.
 */
export const STATUS_DESCRIPTIONS: Readonly<Record<SubscriptionStatus, string>> = {
  FREE: 'You are on the Free plan.',
  CHECKOUT_PENDING: 'We are finalising your subscription.',
  INCOMPLETE: 'Your bank needs to confirm this payment before we can continue.',
  TRIALING: 'You are in a trial period.',
  ACTIVE: 'Your subscription is active.',
  PAST_DUE: 'We could not process your renewal payment. Your features are still active.',
  GRACE: 'Your payment has not gone through yet. Your features stay active for now.',
  PAUSED: 'Your subscription is paused.',
  CANCELED_PENDING_EXPIRY:
    'Your subscription is canceled. Your features stay active until the end of the current period.',
  EXPIRED: 'Your subscription has ended. Your account is on the Free plan.',
  REFUNDED: 'This subscription was refunded.',
  REVOKED: 'This subscription was ended by us. Please contact support.',
};
