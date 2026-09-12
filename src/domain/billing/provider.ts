/**
 * The payment provider port.
 *
 * Everything the application needs from a billing provider, expressed without
 * naming one. Razorpay is an adapter. The state machine, entitlement engine,
 * metering and policy never see it.
 *
 * This exists because the provider is the one component of Wintora most likely
 * to be forced to change for reasons that have nothing to do with the product:
 * availability in a founder's country, underwriting decisions, or a provider
 * shutting down. It has already changed twice (Stripe, then Paddle, now
 * Razorpay). Each change should cost one adapter, not a rewrite.
 *
 * Pure module: types and contracts only, no I/O.
 */

import type { BillingInterval, CountryCode, CurrencyCode, PlanSlug } from '@/config/plans';
import type { SubscriptionStatus } from './states';

/**
 * The providers the application knows how to talk to. The database enum
 * `billing_provider` also carries historical values ('stripe', 'paddle',
 * 'apple', 'google') because Postgres cannot drop an enum value in place; no
 * code path writes them and no adapter exists for them.
 */
export const PAYMENT_PROVIDERS = ['razorpay'] as const;
export type ProviderName = (typeof PAYMENT_PROVIDERS)[number];

/**
 * A Merchant of Record is the LEGAL SELLER of the subscription; a gateway
 * merely moves money on your behalf. The distinction is not cosmetic:
 *
 *   - An MoR remits sales tax, VAT and GST itself, which removes most of the
 *     tax obligation but also means the customer's contract is with them.
 *   - Under a gateway, WE are the seller. The customer contracts with the
 *     operator, the operator's name should appear on the statement, refunds
 *     are the operator's decision, and any consumption tax where the customer
 *     lives is the operator's obligation once a threshold is crossed.
 *
 * Recorded on the provider so the billing page can tell a customer who
 * actually charged them, which some jurisdictions require.
 */
export type ProviderModel = 'GATEWAY' | 'MERCHANT_OF_RECORD';

export interface ProviderCapabilities {
  readonly model: ProviderModel;
  /** Signed webhooks. Required: see `webhookSupport` below. */
  readonly webhooks: boolean;
  /** Proration on mid-period plan changes, handled by the provider. */
  readonly proration: boolean;
  /** Schedule a plan change for period end rather than applying it now. */
  readonly scheduledPlanChange: boolean;
  /** Pause and resume a live subscription. */
  readonly pause: boolean;
  /** Undo a cancellation that is scheduled for period end. */
  readonly undoScheduledCancel: boolean;
  /** Provider remits sales tax / VAT / GST itself. True for every MoR. */
  readonly remitsTax: boolean;
  readonly currencies: readonly CurrencyCode[];
}

/**
 * A provider without signed webhooks cannot back this product.
 *
 * Some providers market "no webhooks" and offer a synchronous `hasAccess()`
 * call instead. That is a poor fit here for three concrete reasons:
 *
 *   1. Quota reservation runs inside a database transaction that holds a row
 *      lock (`consume_usage`). A network call to a third party cannot
 *      participate in that transaction, so the atomic guarantee is lost.
 *   2. Authorization would become coupled to the provider's uptime. Today a
 *      provider outage does not stop a single signed-in user, because
 *      `checkEntitlement()` reads our own database.
 *   3. The database is the authorization authority by design. Delegating that
 *      to a remote call is exactly what the architecture rules out.
 *
 * A provider offering only polling can still be adapted: poll on a schedule and
 * synthesise events. That is strictly worse than signed webhooks and must be a
 * deliberate, recorded choice rather than a silent downgrade.
 */
export type WebhookSupport = 'SIGNED_WEBHOOKS' | 'POLLING_ONLY';

// ---------------------------------------------------------------------------
// Normalised event
// ---------------------------------------------------------------------------

/**
 * A provider event, reduced to what the state machine needs.
 *
 * Adapters translate their provider's payload into this shape. Handlers then
 * contain no provider-specific knowledge at all, which is what makes the same
 * idempotency, ordering and reconciliation logic work for every provider.
 */
export interface NormalizedEvent {
  /** Provider's own event id. The idempotency key. */
  readonly eventId: string;
  /** Provider's own type string, kept for the audit trail. */
  readonly rawType: string;
  /** What this event means to us. Null: recognised but not a lifecycle change. */
  readonly kind: ProviderEventKind | null;
  readonly occurredAt: Date;
  readonly subscription?: ProviderSubscription;
  readonly payment?: ProviderPayment;
  readonly invoice?: ProviderInvoice;
  readonly refund?: ProviderRefund;
  readonly customerRef?: string;
  /**
   * The provider's payment id this event is about, when it carries no
   * subscription or customer. Refunds and disputes reference a payment, and
   * the `payments` table maps a payment back to its user.
   */
  readonly paymentRef?: string;
  /** Our user id, when the provider carries it in metadata. */
  readonly userId?: string;
}

export type ProviderEventKind =
  | 'SUBSCRIPTION_ACTIVATED'
  | 'SUBSCRIPTION_UPDATED'
  | 'SUBSCRIPTION_CANCELED'
  | 'SUBSCRIPTION_PAUSED'
  | 'SUBSCRIPTION_RESUMED'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_ACTION_REQUIRED'
  | 'INVOICE_ISSUED'
  | 'REFUND_ISSUED'
  | 'DISPUTE_OPENED'
  | 'TRIAL_ENDING';

export interface ProviderSubscription {
  readonly providerSubscriptionId: string;
  readonly providerCustomerId: string;
  readonly providerPriceId: string | null;
  /** Already mapped to our vocabulary by the adapter. */
  readonly status: SubscriptionStatus;
  readonly currency: CurrencyCode;
  readonly amountCents: number;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  /**
   * Whether a cancellation is scheduled for period end. Null when the provider
   * does not expose it on the object; our own record is then authoritative.
   */
  readonly cancelAtPeriodEnd: boolean | null;
  readonly canceledAt: Date | null;
  readonly trialStart: Date | null;
  readonly trialEnd: Date | null;
  /**
   * Provider's own last-modified time, for out-of-order protection. Providers
   * that do not stamp one on the object use the event time instead.
   */
  readonly updatedAt: Date;
}

/**
 * One charge. Never a card number: brand and last four only, exactly as the
 * provider returns them. `payments_no_pan` in the database enforces the same.
 */
export interface ProviderPayment {
  readonly providerPaymentId: string;
  readonly providerInvoiceId: string | null;
  readonly amountCents: number;
  readonly currency: CurrencyCode;
  /** Provider's own status string, kept verbatim. */
  readonly status: string;
  readonly method: string | null;
  readonly cardBrand: string | null;
  readonly cardLast4: string | null;
  readonly failureCode: string | null;
  readonly createdAt: Date;
}

export interface ProviderInvoice {
  readonly providerInvoiceId: string;
  readonly number: string | null;
  readonly amountDueCents: number;
  readonly amountPaidCents: number;
  readonly taxCents: number;
  readonly currency: CurrencyCode;
  readonly status: string;
  readonly hostedUrl: string | null;
  readonly pdfUrl: string | null;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly issuedAt: Date | null;
  readonly paidAt: Date | null;
}

export interface ProviderRefund {
  readonly providerRefundId: string;
  readonly providerPaymentRef: string | null;
  readonly amountCents: number;
  readonly currency: CurrencyCode;
  readonly reason: string | null;
  readonly isFullRefund: boolean;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface CheckoutRequest {
  readonly userId: string;
  readonly email: string | null;
  readonly planSlug: PlanSlug;
  readonly interval: BillingInterval;
  readonly country: CountryCode;
  /** Resolved server-side from `plan_prices`. Never supplied by a client. */
  readonly providerPriceId: string;
  readonly providerCustomerId: string | null;
  /** Stable across retries of the same attempt. Not a timestamp. */
  readonly attemptKey: string;
  /** What the price row says will be charged, for the checkout display. */
  readonly amountCents: number;
  readonly currency: CurrencyCode;
  /** How long the customer has to complete payment before the session lapses. */
  readonly expiresAt: Date;
}

/**
 * A checkout the provider has prepared and we host. The browser opens it with
 * the provider's public key and this reference; it cannot change the plan, the
 * amount or the currency, all of which were fixed server-side.
 */
export interface CheckoutResult {
  readonly providerSubscriptionId: string;
  readonly amountCents: number;
  readonly currency: CurrencyCode;
  readonly expiresAt: Date | null;
}

/** What the browser hands back after the provider's checkout completes. */
export interface CheckoutCallback {
  readonly providerPaymentId: string;
  readonly providerSubscriptionId: string;
  readonly signature: string;
}

export interface PlanChangeRequest {
  readonly providerSubscriptionId: string;
  readonly newProviderPriceId: string;
  /** The interval of the new price, for providers that count billing cycles. */
  readonly newInterval: BillingInterval;
  /** Upgrades apply now with proration; downgrades at period end. */
  readonly isUpgrade: boolean;
}

export interface PlanChangeResult {
  /** When the change takes effect. Null means immediately. */
  readonly effectiveAt: Date | null;
  readonly subscription: ProviderSubscription | null;
}

export class ProviderUnsupportedError extends Error {
  readonly provider: ProviderName;
  readonly operation: string;

  constructor(provider: ProviderName, operation: string, detail?: string) {
    super(`${provider} does not support ${operation}${detail ? `: ${detail}` : ''}`);
    this.name = 'ProviderUnsupportedError';
    this.provider = provider;
    this.operation = operation;
  }
}

/**
 * The contract. An adapter that cannot honour an operation throws
 * `ProviderUnsupportedError` rather than silently doing nothing, so a missing
 * capability surfaces as a loud failure in development instead of a customer
 * quietly not getting what they paid for.
 */
export interface PaymentProvider {
  readonly name: ProviderName;
  readonly capabilities: ProviderCapabilities;
  readonly webhookSupport: WebhookSupport;

  /** Find or create the provider-side customer, returning its reference. */
  ensureCustomer(user: { id: string; email: string | null }): Promise<string>;

  /** Prepare a subscription for the customer to authorise in the browser. */
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;

  /**
   * Verify what the browser reports after checkout. Must throw on a bad or
   * absent signature. A verified callback proves the payment happened; it does
   * not by itself grant anything, because the subscription state is then read
   * back from the provider.
   */
  verifyCheckoutCallback(callback: CheckoutCallback): void;

  changePlan(request: PlanChangeRequest): Promise<PlanChangeResult>;

  cancelAtPeriodEnd(providerSubscriptionId: string): Promise<ProviderSubscription>;

  cancelImmediately(providerSubscriptionId: string): Promise<ProviderSubscription>;

  /** Undo a cancellation scheduled for period end, where the provider allows it. */
  reactivate(providerSubscriptionId: string): Promise<ProviderSubscription>;

  pause(providerSubscriptionId: string): Promise<ProviderSubscription>;

  resume(providerSubscriptionId: string): Promise<ProviderSubscription>;

  /** Read current provider state. Used by reconciliation and after checkout. */
  getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null>;

  /** The provider's invoices for a subscription, newest first. */
  listInvoices(providerSubscriptionId: string): Promise<readonly ProviderInvoice[]>;

  /**
   * Verify a webhook against the raw request bytes and translate it.
   *
   * Must throw on an invalid or absent signature. Must NOT parse before
   * verifying: parsing and re-serialising breaks signature verification for
   * every provider that signs the raw body.
   */
  verifyAndParseWebhook(
    rawBody: string,
    headers: Headers,
    secret: string | undefined,
  ): NormalizedEvent;
}

/**
 * What a provider must offer before it can back this product. Checked at
 * startup so an unsuitable provider fails on deploy rather than at the moment a
 * customer's quota needs to be enforced.
 */
export function assertProviderSuitable(provider: PaymentProvider): void {
  const problems: string[] = [];

  if (provider.webhookSupport !== 'SIGNED_WEBHOOKS') {
    problems.push(
      'no signed webhooks: entitlements would depend on a synchronous call to the provider, ' +
        'which breaks transactional quota reservation and couples authorization to their uptime',
    );
  }
  if (!provider.capabilities.currencies.includes('USD')) problems.push('cannot charge USD');
  if (!provider.capabilities.currencies.includes('CAD')) problems.push('cannot charge CAD');

  if (problems.length > 0) {
    throw new Error(
      `Payment provider "${provider.name}" is not suitable:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

/**
 * Compensating behaviour for a provider that cannot schedule a plan change.
 *
 * Downgrading immediately would revoke access the customer has already paid
 * for, which the policy forbids. So when the provider cannot defer the change,
 * we hold it ourselves in `pending_plan_id` and apply it at period end. The
 * customer experience is identical; only the bookkeeping differs.
 */
export function downgradeStrategy(
  provider: PaymentProvider,
): 'PROVIDER_SCHEDULED' | 'APPLICATION_SCHEDULED' {
  return provider.capabilities.scheduledPlanChange
    ? 'PROVIDER_SCHEDULED'
    : 'APPLICATION_SCHEDULED';
}
