/**
 * Razorpay adapter.
 *
 * Razorpay is a GATEWAY, not a Merchant of Record. Three consequences run
 * through this file and the copy around it:
 *
 *   1. Wintora's operator is the legal seller. Any consumption tax where the
 *      customer lives is the operator's obligation once a threshold is
 *      crossed; Razorpay calculates and remits nothing on our behalf.
 *   2. Refund decisions are ours. `POLICY.refunds` is policy, not a reaction.
 *   3. Settlement is in INR to an Indian bank account. Plans are still priced
 *      and charged in USD and CAD; Razorpay converts at settlement.
 *
 * Razorpay Subscriptions vocabulary, mapped here and nowhere else:
 *
 *   Plan          = one of our `plan_prices` rows (amount, currency, interval).
 *                   `plan_prices.provider_price_id` holds the Razorpay plan id.
 *   Subscription  = the customer's recurring agreement to a Plan.
 *   Authentication transaction = the first payment, made in checkout.js in the
 *                   browser against a subscription the server created.
 *
 * Every timestamp Razorpay sends is Unix SECONDS. Every amount is an integer in
 * currency subunits. Neither is ever parsed as a float.
 *
 * Implements the PaymentProvider port, so nothing above this file knows any of
 * this except where it deliberately must.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingInterval, CurrencyCode } from '@/config/plans';
import type { SubscriptionStatus } from '@/domain/billing/states';
import {
  ProviderUnsupportedError,
  type CheckoutCallback,
  type CheckoutRequest,
  type CheckoutResult,
  type NormalizedEvent,
  type PaymentProvider,
  type PlanChangeRequest,
  type PlanChangeResult,
  type ProviderEventKind,
  type ProviderInvoice,
  type ProviderPayment,
  type ProviderRefund,
  type ProviderSubscription,
} from '@/domain/billing/provider';
import { AppError } from '@/lib/errors';
import { WebhookVerificationError } from '@/lib/payments/webhook';

export const RAZORPAY_API = 'https://api.razorpay.com/v1';

export interface RazorpayConfig {
  /** `rzp_test_…` or `rzp_live_…`. Public: it is what checkout.js is given. */
  readonly keyId: string;
  /** Server-only. Signs nothing outbound; verifies the checkout callback. */
  readonly keySecret: string;
  readonly webhookSecret: string | undefined;
  /**
   * Razorpay does not sign a timestamp, so freshness comes from the event's own
   * `created_at`. The primary replay defence is the unique (provider, event_id)
   * constraint in `webhook_events`; this is defence in depth and is set wider
   * than Razorpay's retry window so a legitimately late retry is not refused.
   */
  readonly maxEventAgeSeconds: number;
}

/**
 * Razorpay requires a finite number of billing cycles. These are long enough
 * that no customer will reach them; when one does, the subscription completes
 * and the customer is invited to subscribe again. Razorpay caps the total
 * duration at 100 years.
 */
export const TOTAL_CYCLES: Readonly<Record<BillingInterval, number>> = {
  month: 120,
  year: 10,
};

export const RAZORPAY_PERIOD: Readonly<Record<BillingInterval, 'monthly' | 'yearly'>> = {
  month: 'monthly',
  year: 'yearly',
};

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Razorpay subscription statuses, per their state diagram.
 *
 * An unrecognised status maps to EXPIRED rather than ACTIVE, so the failure
 * mode is a customer temporarily losing a premium feature that reconciliation
 * then flags, rather than an unpaid account silently keeping access.
 *
 *   created        subscription exists, customer has not paid yet
 *   authenticated  first payment made; the cycle starts moments later
 *   active         billing cycle running
 *   pending        an auto-charge failed; Razorpay is retrying
 *   halted         retries exhausted; no further automatic charges
 *   paused         paused by us at the customer's request
 *   cancelled      ended, by us
 *   completed      every cycle billed
 *   expired        never authenticated before its expiry
 */
export type RazorpayStatus =
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'paused'
  | 'cancelled'
  | 'completed'
  | 'expired';

export function mapRazorpayStatus(status: string): SubscriptionStatus {
  switch (status as RazorpayStatus) {
    case 'created':
      return 'CHECKOUT_PENDING';
    case 'authenticated':
      // The customer has paid. Razorpay moves to `active` when the cycle
      // starts, which for a subscription without a future start date is
      // immediately. Treating the paid state as active means the customer is
      // never left looking at a spent payment form.
      return 'ACTIVE';
    case 'active':
      return 'ACTIVE';
    case 'pending':
    case 'halted':
      // Both are "the renewal did not go through". Whether the customer is
      // still inside their grace window is decided by the sync, which owns the
      // grace clock; after it, the reconciliation job expires the subscription.
      return 'PAST_DUE';
    case 'paused':
      return 'PAUSED';
    case 'cancelled':
    case 'completed':
    case 'expired':
      return 'EXPIRED';
    default:
      // Fail closed. Reconciliation will surface it as a mismatch.
      return 'EXPIRED';
  }
}

/**
 * Razorpay event name to our vocabulary.
 *
 * Returning null means "recognised, but not a lifecycle transition". Unknown
 * names are handled upstream and stored as IGNORED, so a new Razorpay event
 * type cannot become a retry storm.
 */
export function mapRazorpayEventKind(eventType: string): ProviderEventKind | null {
  switch (eventType) {
    case 'subscription.authenticated':
    case 'subscription.activated':
      return 'SUBSCRIPTION_ACTIVATED';
    case 'subscription.charged':
      return 'PAYMENT_SUCCEEDED';
    case 'subscription.pending':
    case 'subscription.halted':
      return 'PAYMENT_FAILED';
    case 'subscription.updated':
      return 'SUBSCRIPTION_UPDATED';
    case 'subscription.cancelled':
    case 'subscription.completed':
      return 'SUBSCRIPTION_CANCELED';
    case 'subscription.paused':
      return 'SUBSCRIPTION_PAUSED';
    case 'subscription.resumed':
      return 'SUBSCRIPTION_RESUMED';
    case 'invoice.paid':
      return 'INVOICE_ISSUED';
    case 'refund.created':
    case 'refund.processed':
      return 'REFUND_ISSUED';
    case 'payment.dispute.created':
      return 'DISPUTE_OPENED';
    default:
      return null;
  }
}

/** Enable exactly these in the Razorpay dashboard for the webhook. */
export const RAZORPAY_SUBSCRIBED_EVENTS: readonly string[] = [
  'subscription.authenticated',
  'subscription.activated',
  'subscription.charged',
  'subscription.pending',
  'subscription.halted',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.completed',
  'subscription.paused',
  'subscription.resumed',
  'invoice.paid',
  'refund.created',
  'refund.processed',
  'payment.dispute.created',
];

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/**
 * Constant-time comparison. Length is compared first because timingSafeEqual
 * throws on a mismatch; only the length leaks, which is fixed for a hex
 * SHA-256 digest anyway.
 */
function digestsMatch(expectedHex: string, presentedHex: string): boolean {
  const a = Buffer.from(expectedHex, 'utf8');
  const b = Buffer.from(presentedHex, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verify a Razorpay webhook.
 *
 * Header: `X-Razorpay-Signature: <hex>`
 * Signed payload: the raw request body, HMAC-SHA256 with the webhook secret.
 *
 * `rawBody` must be the exact bytes received. Parsing and re-serialising
 * changes the payload and invalidates the signature.
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
): void {
  if (secret === undefined || secret.length === 0) {
    throw new WebhookVerificationError('MISSING_SECRET');
  }
  if (signatureHeader === null || signatureHeader.trim().length === 0) {
    throw new WebhookVerificationError('MISSING_SIGNATURE');
  }
  const presented = signatureHeader.trim();
  if (!/^[0-9a-f]{64}$/i.test(presented)) {
    throw new WebhookVerificationError('INVALID_SIGNATURE', 'malformed X-Razorpay-Signature');
  }
  if (!digestsMatch(hmacHex(secret, rawBody), presented.toLowerCase())) {
    throw new WebhookVerificationError('INVALID_SIGNATURE');
  }
}

/**
 * Verify what checkout.js hands back after the customer pays.
 *
 * Signed payload: `<payment id>|<subscription id>`, HMAC-SHA256 with the KEY
 * SECRET (not the webhook secret). A forged callback is the obvious way to
 * claim a payment that never happened, so the route that receives it verifies
 * this and then re-reads the subscription from Razorpay before writing
 * anything.
 */
export function verifyRazorpayCheckoutSignature(
  callback: CheckoutCallback,
  keySecret: string,
): void {
  const { providerPaymentId, providerSubscriptionId, signature } = callback;
  if (
    !/^pay_[A-Za-z0-9]{14}$/.test(providerPaymentId) ||
    !/^sub_[A-Za-z0-9]{14}$/.test(providerSubscriptionId) ||
    !/^[0-9a-f]{64}$/i.test(signature)
  ) {
    throw new WebhookVerificationError('INVALID_SIGNATURE', 'malformed checkout callback');
  }
  const expected = hmacHex(keySecret, `${providerPaymentId}|${providerSubscriptionId}`);
  if (!digestsMatch(expected, signature.toLowerCase())) {
    throw new WebhookVerificationError('INVALID_SIGNATURE');
  }
}

// ---------------------------------------------------------------------------
// Payload shapes (only the fields we consume)
// ---------------------------------------------------------------------------

export interface RazorpaySubscriptionPayload {
  id?: string;
  plan_id?: string;
  customer_id?: string | null;
  status?: string;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  charge_at?: number | null;
  start_at?: number | null;
  end_at?: number | null;
  paid_count?: number;
  total_count?: number;
  remaining_count?: number;
  has_scheduled_changes?: boolean;
  change_scheduled_at?: string | null;
  short_url?: string | null;
  expire_by?: number | null;
  created_at?: number;
  notes?: Record<string, unknown> | unknown[] | null;
}

export interface RazorpayPaymentPayload {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  method?: string | null;
  invoice_id?: string | null;
  customer_id?: string | null;
  email?: string | null;
  error_code?: string | null;
  amount_refunded?: number;
  card?: { network?: string | null; last4?: string | null } | null;
  created_at?: number;
  notes?: Record<string, unknown> | unknown[] | null;
}

interface RazorpayInvoicePayload {
  id?: string;
  invoice_number?: string | null;
  subscription_id?: string | null;
  customer_id?: string | null;
  amount?: number;
  amount_paid?: number;
  amount_due?: number;
  tax_amount?: number;
  currency?: string;
  status?: string;
  short_url?: string | null;
  billing_start?: number | null;
  billing_end?: number | null;
  issued_at?: number | null;
  paid_at?: number | null;
  date?: number | null;
  notes?: Record<string, unknown> | unknown[] | null;
}

interface RazorpayRefundPayload {
  id?: string;
  payment_id?: string | null;
  amount?: number;
  currency?: string;
  status?: string;
  notes?: Record<string, unknown> | unknown[] | null;
}

interface RazorpayDisputePayload {
  id?: string;
  payment_id?: string | null;
  amount?: number;
  currency?: string;
  reason_code?: string | null;
  status?: string;
}

interface RazorpayEnvelope {
  entity?: string;
  account_id?: string;
  event?: string;
  contains?: string[];
  created_at?: number;
  payload?: {
    subscription?: { entity?: RazorpaySubscriptionPayload };
    payment?: { entity?: RazorpayPaymentPayload };
    invoice?: { entity?: RazorpayInvoicePayload };
    refund?: { entity?: RazorpayRefundPayload };
    dispute?: { entity?: RazorpayDisputePayload };
  };
}

interface RazorpayErrorBody {
  error?: { code?: string; description?: string; field?: string | null };
}

/** Razorpay timestamps are Unix seconds. */
export function fromUnix(value: number | null | undefined): Date | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000);
}

/** Razorpay amounts are integers in subunits. Anything else is treated as 0. */
function toCents(amount: number | undefined): number {
  return typeof amount === 'number' && Number.isInteger(amount) && amount >= 0 ? amount : 0;
}

function toCurrency(code: string | undefined | null): CurrencyCode {
  return (code ?? 'USD').toUpperCase() === 'CAD' ? 'CAD' : 'USD';
}

/** Razorpay sends `notes` as an object when set and as `[]` when empty. */
function noteString(notes: unknown, key: string): string | undefined {
  if (notes === null || typeof notes !== 'object' || Array.isArray(notes)) return undefined;
  const value = (notes as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function normalizeSubscription(
  payload: RazorpaySubscriptionPayload,
  observedAt: Date,
): ProviderSubscription {
  return {
    providerSubscriptionId: payload.id ?? '',
    providerCustomerId: payload.customer_id ?? '',
    providerPriceId: payload.plan_id ?? null,
    status: mapRazorpayStatus(payload.status ?? ''),
    // The subscription object carries no amount; the handler fills it from the
    // price row the plan id resolves to.
    currency: 'USD',
    amountCents: 0,
    currentPeriodStart: fromUnix(payload.current_start) ?? fromUnix(payload.start_at),
    currentPeriodEnd: fromUnix(payload.current_end) ?? fromUnix(payload.charge_at),
    // Not exposed on the object. Our own record of a scheduled cancellation
    // is authoritative until Razorpay reports `cancelled`.
    cancelAtPeriodEnd: null,
    canceledAt: payload.status === 'cancelled' ? fromUnix(payload.ended_at) : null,
    trialStart: null,
    trialEnd: null,
    // Razorpay stamps no last-modified time on the object, so ordering uses
    // the moment we observed it: the webhook's created_at, or now for a read.
    updatedAt: observedAt,
  };
}

export function normalizePayment(payload: RazorpayPaymentPayload): ProviderPayment {
  const last4 = payload.card?.last4 ?? null;
  return {
    providerPaymentId: payload.id ?? '',
    providerInvoiceId: payload.invoice_id ?? null,
    amountCents: toCents(payload.amount),
    currency: toCurrency(payload.currency),
    status: payload.status ?? 'unknown',
    method: payload.method ?? null,
    cardBrand: payload.card?.network ?? null,
    cardLast4: last4 !== null && /^[0-9]{4}$/.test(last4) ? last4 : null,
    failureCode: payload.error_code ?? null,
    createdAt: fromUnix(payload.created_at) ?? new Date(),
  };
}

export function normalizeInvoice(payload: RazorpayInvoicePayload): ProviderInvoice {
  return {
    providerInvoiceId: payload.id ?? '',
    number: payload.invoice_number ?? null,
    amountDueCents: toCents(payload.amount),
    amountPaidCents: toCents(payload.amount_paid),
    // Razorpay's invoice tax field is whatever the operator configured; under
    // a gateway this is the operator's tax, not the provider's.
    taxCents: toCents(payload.tax_amount),
    currency: toCurrency(payload.currency),
    status: payload.status ?? 'unknown',
    hostedUrl: payload.short_url ?? null,
    pdfUrl: null,
    periodStart: fromUnix(payload.billing_start),
    periodEnd: fromUnix(payload.billing_end),
    issuedAt: fromUnix(payload.issued_at) ?? fromUnix(payload.date),
    paidAt: fromUnix(payload.paid_at),
  };
}

export function normalizeRefund(
  payload: RazorpayRefundPayload,
  payment: RazorpayPaymentPayload | undefined,
): ProviderRefund {
  const amount = toCents(payload.amount);
  const paid = toCents(payment?.amount);
  return {
    providerRefundId: payload.id ?? '',
    providerPaymentRef: payload.payment_id ?? payment?.id ?? null,
    amountCents: amount,
    currency: toCurrency(payload.currency ?? payment?.currency),
    reason: noteString(payload.notes, 'reason') ?? null,
    // Full when it returns the whole payment. Without the payment entity we
    // cannot tell, and a partial refund does not touch entitlements, so the
    // safe reading of "unknown" is partial.
    isFullRefund: paid > 0 && amount >= paid,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function createRazorpayProvider(config: RazorpayConfig): PaymentProvider {
  const authorization = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;

  async function api<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${RAZORPAY_API}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new AppError('PROVIDER_ERROR', 'We could not reach the payment provider.', {
        detail: `Razorpay ${init.method ?? 'GET'} ${path}: ${error instanceof Error ? error.name : 'network error'}`,
      });
    }

    const json = (await response.json().catch(() => ({}))) as T & RazorpayErrorBody;

    if (!response.ok) {
      const description = json.error?.description ?? `HTTP ${response.status}`;
      throw new AppError('PROVIDER_ERROR', 'We could not reach the payment provider.', {
        detail: `Razorpay ${init.method ?? 'GET'} ${path}: ${json.error?.code ?? 'error'}: ${description}`,
        meta: {
          status: response.status,
          providerCode: json.error?.code ?? null,
          providerDescription: description,
        },
      });
    }
    return json;
  }

  /** Razorpay answers a lookup of a missing id with HTTP 400, not 404. */
  function isNotFound(error: unknown): boolean {
    if (!(error instanceof AppError)) return false;
    const status = error.meta?.status;
    const description = String(error.meta?.providerDescription ?? '').toLowerCase();
    return (
      status === 404 ||
      (status === 400 && (description.includes('does not exist') || description.includes('not found')))
    );
  }

  return {
    name: 'razorpay',
    webhookSupport: 'SIGNED_WEBHOOKS',
    capabilities: {
      model: 'GATEWAY',
      webhooks: true,
      // Razorpay prorates an immediate plan change itself: it charges the
      // difference or refunds it, and reports the result in subscription.updated.
      proration: true,
      // `schedule_change_at: cycle_end` defers a change to period end, which
      // is exactly what a downgrade needs.
      scheduledPlanChange: true,
      pause: true,
      // Razorpay has no API to withdraw a cancellation scheduled for cycle
      // end. A customer who changes their mind subscribes again afterwards.
      undoScheduledCancel: false,
      remitsTax: false,
      currencies: ['USD', 'CAD'],
    },

    async ensureCustomer(user): Promise<string> {
      // fail_existing=0 returns the existing customer for a known email
      // rather than rejecting the duplicate.
      const created = await api<{ id: string }>('/customers', {
        method: 'POST',
        body: {
          email: user.email ?? undefined,
          fail_existing: '0',
          // The link back to our user. Webhooks resolve through metadata
          // first, then through this customer id, never through an email
          // address that a customer can change.
          notes: { wintora_user_id: user.id },
        },
      });
      return created.id;
    },

    async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
      const subscription = await api<RazorpaySubscriptionPayload>('/subscriptions', {
        method: 'POST',
        body: {
          plan_id: request.providerPriceId,
          total_count: TOTAL_CYCLES[request.interval],
          quantity: 1,
          // Razorpay emails the customer about charges, failures and pre-debit
          // notices. Until we have our own email provider, that is the only
          // channel those messages have.
          customer_notify: 1,
          expire_by: Math.floor(request.expiresAt.getTime() / 1000),
          notes: {
            wintora_user_id: request.userId,
            wintora_plan_slug: request.planSlug,
            wintora_interval: request.interval,
            wintora_country: request.country,
            wintora_attempt: request.attemptKey,
          },
        },
      });

      if (subscription.id === undefined) {
        throw new AppError('BILLING_ERROR', 'We could not start checkout. Please try again.', {
          detail: 'Razorpay returned a subscription with no id.',
        });
      }

      return {
        providerSubscriptionId: subscription.id,
        amountCents: request.amountCents,
        currency: request.currency,
        expiresAt: fromUnix(subscription.expire_by) ?? request.expiresAt,
      };
    },

    verifyCheckoutCallback(callback: CheckoutCallback): void {
      verifyRazorpayCheckoutSignature(callback, config.keySecret);
    },

    async changePlan(request: PlanChangeRequest): Promise<PlanChangeResult> {
      // Razorpay only updates subscriptions in `authenticated` or `active`.
      // The caller checks our own state first; this read makes the refusal
      // precise when the two disagree.
      const current = await api<RazorpaySubscriptionPayload>(
        `/subscriptions/${encodeURIComponent(request.providerSubscriptionId)}`,
      );
      if (current.status !== 'active' && current.status !== 'authenticated') {
        throw new AppError(
          'BILLING_ERROR',
          'Your plan cannot be changed while a payment is outstanding. Update your payment method first.',
          { detail: `Razorpay subscription is ${current.status ?? 'unknown'}` },
        );
      }

      // Upgrades apply now: Razorpay charges the prorated difference
      // immediately. Downgrades wait for the cycle end and are not billed now,
      // so paid access is never revoked early. See docs/BILLING.md section 4.
      const updated = await api<RazorpaySubscriptionPayload>(
        `/subscriptions/${encodeURIComponent(request.providerSubscriptionId)}`,
        {
          method: 'PATCH',
          body: {
            plan_id: request.newProviderPriceId,
            quantity: 1,
            schedule_change_at: request.isUpgrade ? 'now' : 'cycle_end',
            customer_notify: 1,
            // A plan at a different interval needs a cycle count that fits it:
            // 118 remaining monthly cycles would be 118 years on a yearly plan.
            remaining_count: TOTAL_CYCLES[request.newInterval],
          },
        },
      );

      const subscription = normalizeSubscription(updated, new Date());
      return {
        effectiveAt: request.isUpgrade ? null : subscription.currentPeriodEnd,
        subscription,
      };
    },

    async cancelAtPeriodEnd(providerSubscriptionId): Promise<ProviderSubscription> {
      const updated = await api<RazorpaySubscriptionPayload>(
        `/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`,
        { method: 'POST', body: { cancel_at_cycle_end: 1 } },
      );
      // Razorpay keeps the status `active` until the cycle ends; the caller
      // records the scheduled cancellation on our side.
      return { ...normalizeSubscription(updated, new Date()), cancelAtPeriodEnd: true };
    },

    async cancelImmediately(providerSubscriptionId): Promise<ProviderSubscription> {
      const updated = await api<RazorpaySubscriptionPayload>(
        `/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`,
        { method: 'POST', body: { cancel_at_cycle_end: 0 } },
      );
      return normalizeSubscription(updated, new Date());
    },

    async reactivate(): Promise<ProviderSubscription> {
      throw new ProviderUnsupportedError(
        'razorpay',
        'reactivate',
        'a cancellation scheduled for cycle end cannot be withdrawn',
      );
    },

    async pause(providerSubscriptionId): Promise<ProviderSubscription> {
      const updated = await api<RazorpaySubscriptionPayload>(
        `/subscriptions/${encodeURIComponent(providerSubscriptionId)}/pause`,
        { method: 'POST', body: { pause_at: 'now' } },
      );
      return normalizeSubscription(updated, new Date());
    },

    async resume(providerSubscriptionId): Promise<ProviderSubscription> {
      const updated = await api<RazorpaySubscriptionPayload>(
        `/subscriptions/${encodeURIComponent(providerSubscriptionId)}/resume`,
        { method: 'POST', body: { resume_at: 'now' } },
      );
      return normalizeSubscription(updated, new Date());
    },

    async getSubscription(providerSubscriptionId): Promise<ProviderSubscription | null> {
      try {
        const found = await api<RazorpaySubscriptionPayload>(
          `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
        );
        return normalizeSubscription(found, new Date());
      } catch (error) {
        // "Does not exist" is an answer. Anything else (network, 5xx, auth) is
        // not, and pretending it is would make a provider outage look like a
        // thousand missing subscriptions to the reconciliation job.
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async listInvoices(providerSubscriptionId): Promise<readonly ProviderInvoice[]> {
      const result = await api<{ items?: RazorpayInvoicePayload[] }>(
        `/invoices?subscription_id=${encodeURIComponent(providerSubscriptionId)}&count=100`,
      );
      return (result.items ?? [])
        .map(normalizeInvoice)
        .sort((a, b) => (b.issuedAt?.getTime() ?? 0) - (a.issuedAt?.getTime() ?? 0));
    },

    verifyAndParseWebhook(rawBody, headers, secret): NormalizedEvent {
      verifyRazorpayWebhookSignature(rawBody, headers.get('x-razorpay-signature'), secret);

      const envelope = JSON.parse(rawBody) as RazorpayEnvelope;
      const eventType = envelope.event ?? 'unknown';
      const occurredAt = fromUnix(envelope.created_at) ?? new Date();

      const ageSeconds = (Date.now() - occurredAt.getTime()) / 1000;
      if (ageSeconds > config.maxEventAgeSeconds) {
        throw new WebhookVerificationError('INVALID_SIGNATURE', 'event older than the accepted window');
      }

      // Razorpay sends a unique id per event in a header, and redelivers with
      // the same id. Without the header, a digest of the body still dedupes an
      // exact redelivery.
      const eventId =
        headers.get('x-razorpay-event-id') ??
        `rzp_${createHash('sha256').update(rawBody).digest('hex').slice(0, 40)}`;

      const subscriptionPayload = envelope.payload?.subscription?.entity;
      const paymentPayload = envelope.payload?.payment?.entity;
      const invoicePayload = envelope.payload?.invoice?.entity;
      const refundPayload = envelope.payload?.refund?.entity;
      const disputePayload = envelope.payload?.dispute?.entity;

      const userId =
        noteString(subscriptionPayload?.notes, 'wintora_user_id') ??
        noteString(paymentPayload?.notes, 'wintora_user_id') ??
        noteString(invoicePayload?.notes, 'wintora_user_id');

      const customerRef =
        subscriptionPayload?.customer_id ??
        paymentPayload?.customer_id ??
        invoicePayload?.customer_id ??
        undefined;

      const paymentRef =
        paymentPayload?.id ?? refundPayload?.payment_id ?? disputePayload?.payment_id ?? undefined;

      return {
        eventId,
        rawType: eventType,
        kind: mapRazorpayEventKind(eventType),
        occurredAt,
        subscription:
          subscriptionPayload !== undefined
            ? normalizeSubscription(subscriptionPayload, occurredAt)
            : undefined,
        payment: paymentPayload !== undefined ? normalizePayment(paymentPayload) : undefined,
        invoice: invoicePayload !== undefined ? normalizeInvoice(invoicePayload) : undefined,
        refund:
          refundPayload !== undefined ? normalizeRefund(refundPayload, paymentPayload) : undefined,
        customerRef: customerRef ?? undefined,
        paymentRef,
        userId,
      };
    },
  };
}
