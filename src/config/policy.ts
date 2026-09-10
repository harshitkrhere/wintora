/**
 * Commercial and lifecycle policy.
 *
 * Every number a customer could be affected by lives here rather than being
 * scattered through handlers. Both security and fairness are requirements: the
 * engine must not grant more than was paid for, and must not take away less
 * than was paid for.
 */

export const POLICY = {
  /**
   * Payment failure. Premium access is NOT cut at the first failed charge.
   * Cards expire and banks decline for boring reasons; a paying customer should
   * not lose their case workspace over a retry.
   */
  grace: {
    /** Days of full premium access retained after a failed renewal. */
    days: 7,
    /** Entitlements during PAST_DUE and GRACE are unchanged. */
    retainEntitlements: true,
  },

  downgrade: {
    /**
     * 'period_end' means a customer keeps what they paid for until the period
     * they paid for ends. 'immediate' is only ever appropriate with a proration
     * refund, and is not the default.
     */
    effectiveAt: 'period_end' as 'period_end' | 'immediate',
    /**
     * Data is NEVER deleted because a plan changed. Over-limit resources stay
     * readable; only creation of new ones is blocked.
     */
    deleteOverLimitResources: false,
  },

  upgrade: {
    /** Upgrades apply as soon as billing state is verified, with proration. */
    effectiveAt: 'immediate' as const,
    prorationBehavior: 'create_prorations' as const,
    /**
     * A larger allowance takes effect at once and already-recorded consumption
     * is preserved. Consumption is never retroactively voided.
     */
    preserveConsumedUsage: true,
  },

  refunds: {
    /** Default for a full refund. Support may choose a courtesy window instead. */
    fullRefundEffect: 'REVOKE_IMMEDIATELY' as
      | 'REVOKE_IMMEDIATELY'
      | 'REVOKE_AT'
      | 'NONE',
    /** A goodwill partial refund does not change entitlements. */
    partialRefundEffect: 'NONE' as const,
    /** A chargeback revokes and records a security event. */
    disputeEffect: 'REVOKE_IMMEDIATELY' as const,
  },

  pause: {
    enabled: true,
    maxDays: 90,
    /** A paused subscription is not being paid for, so entitlements drop to free. */
    entitlementsDuringPause: 'free' as const,
  },

  trials: {
    /** Off until trial terms are reviewed. See docs/LIMITATIONS.md. */
    enabled: false,
    days: 0,
  },

  /**
   * Quota windows align to the BILLING period, not the calendar month. A
   * subscription running the 14th to the 14th resets on the 14th.
   */
  usage: {
    /** Free users have no provider billing period, so they get a rolling window. */
    freeWindowDays: 30,
    /**
     * Rollback policy. Infrastructure failures are not the customer's fault, so
     * the credit is returned. Work that was actually performed is retained.
     */
    rollbackOn: [
      'INFRASTRUCTURE_FAILURE',
      'PROVIDER_TIMEOUT',
      'INVALID_INPUT_REJECTED_BEFORE_PROCESSING',
    ] as const,
    retainOn: [
      'COMPLETED_BUT_USER_DISLIKED_RESULT',
      'CLIENT_DISCONNECTED_AFTER_PROCESSING',
    ] as const,
  },

  retention: {
    /**
     * Retention is governed by the retention system, NOT by billing. A lapsed
     * subscription deletes nothing; a document expiring affects no subscription.
     */
    governedByBilling: false,
    /** Grace window before a shortened retention removes anything. */
    transitionDays: 30,
    /** Days of warning before a document is removed. */
    expiryNoticeDays: 7,
    /**
     * Case records, findings and letters are text, are small, and are NOT
     * subject to plan-based document retention. Losing a plan does not erase a
     * person's record of what happened.
     */
    plansGovernDocumentsOnly: true,
  },

  deletion: {
    /** Cancellable window before an account deletion executes. */
    coolingOffDays: 7,
    requiresStepUpAuth: true,
    requiresTypedConfirmation: true,
  },

  export: {
    requiresStepUpAuth: true,
    linkTtlMinutes: 60,
    singleUse: true,
    /** Exports are never emailed as attachments. */
    emailAttachment: false,
  },

  /** Fresh authentication required within this window for sensitive actions. */
  stepUpAuth: {
    maxAgeMinutes: 10,
    requiredFor: [
      'DATA_EXPORT',
      'ACCOUNT_DELETION',
      'CHANGE_EMAIL',
      'CHANGE_PASSWORD',
      'GRANT_SUPPORT_ACCESS',
    ] as const,
  },

  security: {
    signedUrlTtlSeconds: 300,
    supportGrantDefaultHours: 24,
    /** IP hashes are kept only for the abuse window. */
    ipHashRetentionDays: 7,
  },

  /** The client may cache the entitlement snapshot this long, for DISPLAY only. */
  entitlementClientCacheSeconds: 60,
} as const;

export type Policy = typeof POLICY;

/**
 * Reasons an operation may fail after quota was reserved, and whether the
 * credit is returned. Keeping this as a function rather than a scattered
 * conditional is what makes the rollback policy auditable.
 */
export type UsageFailureReason =
  | (typeof POLICY.usage.rollbackOn)[number]
  | (typeof POLICY.usage.retainOn)[number];

export function shouldRefundUsage(reason: UsageFailureReason): boolean {
  return (POLICY.usage.rollbackOn as readonly string[]).includes(reason);
}
