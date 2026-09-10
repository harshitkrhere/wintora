/**
 * Paddle adapter.
 *
 * Paddle is a MERCHANT OF RECORD, not a gateway. Paddle.com Market Ltd is the
 * legal seller to the customer; we license our software to Paddle and they
 * remit our share. Three consequences run through this file:
 *
 *   1. Paddle calculates and remits sales tax, VAT and GST. We never do.
 *   2. Refund and chargeback decisions are Paddle's. Our refund policy becomes
 *      a reaction to their decision, not our own.
 *   3. The customer's contract is with Paddle, so the checkout and the billing
 *      page must say so. See docs/BILLING.md, "Seller of record disclosure".
 *
 * Implements the PaymentProvider port, so nothing above this file knows any of
 * that except where it deliberately must.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CurrencyCode } from '@/config/plans';
import type { SubscriptionStatus } from '@/domain/billing/states';
import {
  ProviderUnsupportedError,
  type CheckoutRequest,
  type CheckoutResult,
  type NormalizedEvent,
  type PaymentProvider,
  type PlanChangeRequest,
  type PlanChangeResult,
  type ProviderEventKind,
  type ProviderInvoice,
  type ProviderRefund,
  type ProviderSubscription,
} from '@/domain/billing/provider';
import { AppError } from '@/lib/errors';
import { WebhookVerificationError } from '@/lib/payments/webhook';

const PADDLE_API = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
} as const;

export interface PaddleConfig {
  readonly apiKey: string;
  readonly webhookSecret: string | undefined;
  readonly environment: 'sandbox' | 'production';
  /**
   * Tolerance between the signed timestamp and now.
   *
   * Paddle's own SDKs default to five seconds. That is very tight for a
   * webhook that must cross the public internet, and a dropped event here
   * means a paying customer does not get the plan they just bought.
   *
   * The primary replay defence is not this window: it is the unique
   * (provider, event_id) constraint in `webhook_events`, which makes a replay
   * a no-op however old it is. This tolerance is defence in depth, so it is
   * set wide enough not to reject legitimate traffic.
   */
  readonly toleranceSeconds: number;
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Paddle Billing subscription statuses.
 *
 * VERIFY AGAINST PADDLE DOCS BEFORE GOING LIVE. An unrecognised status maps to
 * EXPIRED rather than ACTIVE, so the failure mode is a customer temporarily
 * losing a premium feature that reconciliation then flags, rather than an
 * unpaid account silently keeping access.
 */
type PaddleStatus = 'active' | 'canceled' | 'past_due' | 'paused' | 'trialing';

export function mapPaddleStatus(
  status: string,
  options: { scheduledCancel: boolean; gracePeriodEnd: Date | null; now?: Date },
): SubscriptionStatus {
  const now = options.now ?? new Date();
  const inGrace =
    options.gracePeriodEnd !== null && options.gracePeriodEnd.getTime() > now.getTime();

  switch (status as PaddleStatus) {
    case 'trialing':
      return options.scheduledCancel ? 'CANCELED_PENDING_EXPIRY' : 'TRIALING';
    case 'active':
      // A scheduled cancellation keeps full entitlements until it takes
      // effect; only the UI copy differs.
      return options.scheduledCancel ? 'CANCELED_PENDING_EXPIRY' : 'ACTIVE';
    case 'past_due':
      return inGrace ? 'GRACE' : 'PAST_DUE';
    case 'paused':
      return 'PAUSED';
    case 'canceled':
      return 'EXPIRED';
    default:
      // Fail closed. Reconciliation will surface it as a mismatch.
      return 'EXPIRED';
  }
}

/**
 * Paddle event name to our vocabulary.
 *
 * Returning null means "recognised, but not a lifecycle transition" — an
 * invoice being drafted, for instance. Unknown names are handled upstream and
 * stored as IGNORED, so a new Paddle event type cannot become a retry storm.
 */
export function mapPaddleEventKind(eventType: string): ProviderEventKind | null {
  switch (eventType) {
    case 'subscription.activated':
    case 'subscription.created':
      return 'SUBSCRIPTION_ACTIVATED';
    case 'subscription.updated':
      return 'SUBSCRIPTION_UPDATED';
    case 'subscription.canceled':
      return 'SUBSCRIPTION_CANCELED';
    case 'subscription.paused':
      return 'SUBSCRIPTION_PAUSED';
    case 'subscription.resumed':
      return 'SUBSCRIPTION_RESUMED';
    case 'subscription.past_due':
      return 'PAYMENT_FAILED';
    case 'subscription.trialing':
      return 'TRIAL_ENDING';
    case 'transaction.completed':
    case 'transaction.paid':
      return 'PAYMENT_SUCCEEDED';
    case 'transaction.payment_failed':
      return 'PAYMENT_FAILED';
    case 'transaction.billed':
      return 'INVOICE_ISSUED';
    case 'adjustment.created':
      // Paddle models refunds and credits as adjustments.
      return 'REFUND_ISSUED';
    default:
      return null;
  }
}

export const PADDLE_SUBSCRIBED_EVENTS: readonly string[] = [
  'subscription.created',
  'subscription.activated',
  'subscription.updated',
  'subscription.canceled',
  'subscription.paused',
  'subscription.resumed',
  'subscription.past_due',
  'subscription.trialing',
  'transaction.completed',
  'transaction.paid',
  'transaction.billed',
  'transaction.payment_failed',
  'adjustment.created',
];

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify a Paddle webhook.
 *
 * Header: `Paddle-Signature: ts=<unix>;h1=<hex>`
 * Signed payload: `<ts>:<raw body>`, HMAC-SHA256, compared in constant time.
 *
 * `rawBody` must be the exact bytes received. Parsing and re-serialising
 * changes the payload and invalidates the signature.
 */
export function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
  toleranceSeconds: number,
  now: Date = new Date(),
): { timestamp: Date } {
  if (secret === undefined || secret.length === 0) {
    throw new WebhookVerificationError('MISSING_SECRET');
  }
  if (signatureHeader === null || signatureHeader.length === 0) {
    throw new WebhookVerificationError('MISSING_SIGNATURE');
  }

  const parts = new Map<string, string>();
  for (const segment of signatureHeader.split(';')) {
    const index = segment.indexOf('=');
    if (index === -1) continue;
    parts.set(segment.slice(0, index).trim(), segment.slice(index + 1).trim());
  }

  const ts = parts.get('ts');
  const h1 = parts.get('h1');

  if (ts === undefined || h1 === undefined || !/^\d+$/.test(ts)) {
    throw new WebhookVerificationError('INVALID_SIGNATURE', 'malformed Paddle-Signature');
  }

  const expected = createHmac('sha256', secret)
    .update(`${ts}:${rawBody}`, 'utf8')
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(h1, 'utf8');

  // Length is compared first because timingSafeEqual throws on a mismatch.
  // Only the length leaks, which is fixed for a hex SHA-256 digest anyway.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new WebhookVerificationError('INVALID_SIGNATURE');
  }

  const timestamp = new Date(Number(ts) * 1000);
  const ageSeconds = Math.abs(now.getTime() - timestamp.getTime()) / 1000;
  if (ageSeconds > toleranceSeconds) {
    throw new WebhookVerificationError('INVALID_SIGNATURE', 'timestamp outside tolerance');
  }

  return { timestamp };
}

// ---------------------------------------------------------------------------
// Payload shapes (only the fields we consume)
// ---------------------------------------------------------------------------

interface PaddleEnvelope {
  event_id?: string;
  event_type?: string;
  occurred_at?: string;
  data?: Record<string, unknown>;
}

interface PaddleSubscriptionPayload {
  id?: string;
  status?: string;
  customer_id?: string;
  currency_code?: string;
  started_at?: string | null;
  canceled_at?: string | null;
  paused_at?: string | null;
  updated_at?: string | null;
  current_billing_period?: { starts_at?: string; ends_at?: string } | null;
  scheduled_change?: { action?: string; effective_at?: string } | null;
  trial_dates?: { starts_at?: string; ends_at?: string } | null;
  items?: {
    price?: { id?: string; unit_price?: { amount?: string; currency_code?: string } };
  }[];
  custom_data?: Record<string, unknown> | null;
}

function toDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Paddle sends money as a string in minor units. Never parse it as a float. */
function toCents(amount: string | undefined): number {
  if (amount === undefined) return 0;
  const parsed = Number.parseInt(amount, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toCurrency(code: string | undefined): CurrencyCode {
  return (code ?? 'USD').toUpperCase() === 'CAD' ? 'CAD' : 'USD';
}

export function normalizeSubscription(
  payload: PaddleSubscriptionPayload,
  gracePeriodEnd: Date | null = null,
): ProviderSubscription {
  const item = payload.items?.[0];
  const scheduled = payload.scheduled_change ?? null;
  // Paddle expresses "cancel at period end" as a scheduled change, not a flag.
  const scheduledCancel = scheduled?.action === 'cancel';

  return {
    providerSubscriptionId: payload.id ?? '',
    providerCustomerId: payload.customer_id ?? '',
    providerPriceId: item?.price?.id ?? null,
    status: mapPaddleStatus(payload.status ?? '', {
      scheduledCancel,
      gracePeriodEnd,
    }),
    currency: toCurrency(payload.currency_code ?? item?.price?.unit_price?.currency_code),
    amountCents: toCents(item?.price?.unit_price?.amount),
    currentPeriodStart: toDate(payload.current_billing_period?.starts_at),
    currentPeriodEnd: toDate(payload.current_billing_period?.ends_at),
    cancelAtPeriodEnd: scheduledCancel,
    canceledAt: toDate(payload.canceled_at),
    trialStart: toDate(payload.trial_dates?.starts_at),
    trialEnd: toDate(payload.trial_dates?.ends_at),
    updatedAt: toDate(payload.updated_at) ?? new Date(),
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function createPaddleProvider(config: PaddleConfig): PaymentProvider {
  const base = PADDLE_API[config.environment];

  async function api<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        'paddle-version': '1',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });

    const json = (await response.json()) as { data?: T; error?: { detail?: string } };

    if (!response.ok) {
      throw new AppError('PROVIDER_ERROR', 'We could not reach the payment provider.', {
        detail: `Paddle ${init.method ?? 'GET'} ${path}: ${json.error?.detail ?? response.status}`,
      });
    }
    return json.data as T;
  }

  return {
    name: 'paddle',
    webhookSupport: 'SIGNED_WEBHOOKS',
    capabilities: {
      model: 'MERCHANT_OF_RECORD',
      webhooks: true,
      hostedPortal: true,
      proration: true,
      scheduledPlanChange: true,
      // The reason we are on Paddle at all: they remit sales tax, VAT and GST
      // as the legal seller, which an India-based individual seller cannot
      // practically do across US states and Canadian provinces.
      remitsTax: true,
      currencies: ['USD', 'CAD'],
    },

    async ensureCustomer(user): Promise<string> {
      // Paddle rejects duplicate emails, so an existing customer is adopted
      // rather than treated as an error.
      if (user.email !== null) {
        const found = await api<{ id: string }[]>(
          `/customers?email=${encodeURIComponent(user.email)}`,
        );
        if (Array.isArray(found) && found[0]?.id !== undefined) return found[0].id;
      }

      const created = await api<{ id: string }>('/customers', {
        method: 'POST',
        body: {
          email: user.email,
          // The link back to our user. Every webhook resolves through this
          // rather than an email address, which a customer can change.
          custom_data: { wintora_user_id: user.id },
        },
      });
      return created.id;
    },

    async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
      const transaction = await api<{ id: string; checkout?: { url?: string } }>(
        '/transactions',
        {
          method: 'POST',
          body: {
            items: [{ price_id: request.providerPriceId, quantity: 1 }],
            customer_id: request.providerCustomerId ?? undefined,
            currency_code: undefined,
            collection_mode: 'automatic',
            custom_data: {
              wintora_user_id: request.userId,
              plan_slug: request.planSlug,
              attempt: request.attemptKey,
            },
            // Paddle appends ?_ptxn=<transaction id> to this and treats it as
            // the page hosting the overlay. Sending it explicitly rather than
            // relying on the dashboard's single default payment link is what
            // lets preview, production and local each resolve to themselves.
            // The domain must be approved in Paddle's checkout settings, or the
            // API rejects the transaction with
            // `transaction_checkout_url_domain_is_not_approved`.
            checkout: { url: request.checkoutUrl },
          },
        },
      );

      const url = transaction.checkout?.url;
      if (url === undefined || url === null) {
        throw new AppError('BILLING_ERROR', 'We could not start checkout. Please try again.', {
          detail:
            'Paddle returned a transaction with no checkout URL. A default payment link must be ' +
            'configured under Checkout settings in the Paddle dashboard.',
        });
      }

      return { url, sessionId: transaction.id };
    },

    async createPortalSession(providerCustomerId, returnUrl): Promise<{ url: string }> {
      void returnUrl;
      const session = await api<{ urls?: { general?: { overview?: string } } }>(
        `/customers/${providerCustomerId}/portal-sessions`,
        { method: 'POST', body: {} },
      );

      const url = session.urls?.general?.overview;
      if (url === undefined) {
        throw new AppError('BILLING_ERROR', 'We could not open your billing portal.', {
          detail: 'Paddle portal session returned no overview URL.',
        });
      }
      return { url };
    },

    async changePlan(request: PlanChangeRequest): Promise<PlanChangeResult> {
      const current = await api<PaddleSubscriptionPayload>(
        `/subscriptions/${request.providerSubscriptionId}`,
      );
      const itemId = current.items?.[0]?.price?.id;
      if (itemId === undefined) {
        throw new AppError('BILLING_ERROR', 'We could not change your plan.', {
          detail: `Paddle subscription ${request.providerSubscriptionId} has no items.`,
        });
      }

      // Upgrades bill the prorated difference now, because the customer is
      // paying more for something they want immediately. Downgrades take
      // effect at the next billing period and are NOT billed now, so paid
      // access is never revoked early. See docs/BILLING.md section 4.
      const updated = await api<PaddleSubscriptionPayload>(
        `/subscriptions/${request.providerSubscriptionId}`,
        {
          method: 'PATCH',
          body: {
            items: [{ price_id: request.newProviderPriceId, quantity: 1 }],
            proration_billing_mode: request.isUpgrade
              ? 'prorated_immediately'
              : 'do_not_bill',
            ...(request.isUpgrade ? {} : { effective_from: 'next_billing_period' }),
          },
        },
      );

      const subscription = normalizeSubscription(updated);
      return {
        effectiveAt: request.isUpgrade ? null : subscription.currentPeriodEnd,
        subscription,
      };
    },

    async cancelAtPeriodEnd(providerSubscriptionId): Promise<ProviderSubscription> {
      const updated = await api<PaddleSubscriptionPayload>(
        `/subscriptions/${providerSubscriptionId}/cancel`,
        { method: 'POST', body: { effective_from: 'next_billing_period' } },
      );
      return normalizeSubscription(updated);
    },

    async reactivate(providerSubscriptionId): Promise<ProviderSubscription> {
      // Removing the scheduled change is how Paddle un-cancels.
      const updated = await api<PaddleSubscriptionPayload>(
        `/subscriptions/${providerSubscriptionId}`,
        { method: 'PATCH', body: { scheduled_change: null } },
      );
      return normalizeSubscription(updated);
    },

    async getSubscription(providerSubscriptionId): Promise<ProviderSubscription | null> {
      try {
        const found = await api<PaddleSubscriptionPayload>(
          `/subscriptions/${providerSubscriptionId}`,
        );
        return normalizeSubscription(found);
      } catch {
        return null;
      }
    },

    verifyAndParseWebhook(rawBody, headers, secret): NormalizedEvent {
      const { timestamp } = verifyPaddleSignature(
        rawBody,
        headers.get('paddle-signature'),
        secret,
        config.toleranceSeconds,
      );

      const envelope = JSON.parse(rawBody) as PaddleEnvelope;
      const eventType = envelope.event_type ?? 'unknown';
      const data = (envelope.data ?? {}) as PaddleSubscriptionPayload &
        Record<string, unknown>;

      const kind = mapPaddleEventKind(eventType);
      const isSubscription = eventType.startsWith('subscription.');

      const userId =
        typeof data.custom_data?.wintora_user_id === 'string'
          ? (data.custom_data.wintora_user_id as string)
          : undefined;

      return {
        eventId: envelope.event_id ?? `paddle_${timestamp.getTime()}`,
        rawType: eventType,
        kind,
        occurredAt: toDate(envelope.occurred_at) ?? timestamp,
        subscription: isSubscription ? normalizeSubscription(data) : undefined,
        invoice: eventType.startsWith('transaction.')
          ? normalizeTransaction(data as Record<string, unknown>)
          : undefined,
        refund:
          eventType === 'adjustment.created'
            ? normalizeAdjustment(data as Record<string, unknown>)
            : undefined,
        customerRef: typeof data.customer_id === 'string' ? data.customer_id : undefined,
        userId,
      };
    },
  };
}

function normalizeTransaction(data: Record<string, unknown>): ProviderInvoice {
  const details = data.details as { totals?: Record<string, string> } | undefined;
  const totals = details?.totals ?? {};

  return {
    providerInvoiceId: typeof data.id === 'string' ? data.id : '',
    number: typeof data.invoice_number === 'string' ? data.invoice_number : null,
    amountDueCents: toCents(totals.total),
    amountPaidCents: toCents(totals.grand_total ?? totals.total),
    // Paddle remits this. We record it for the customer's invoice history and
    // never calculate or owe it ourselves.
    taxCents: toCents(totals.tax),
    currency: toCurrency(data.currency_code as string | undefined),
    status: typeof data.status === 'string' ? data.status : 'unknown',
    hostedUrl: null,
    pdfUrl: null,
    periodStart: toDate((data.billing_period as { starts_at?: string })?.starts_at),
    periodEnd: toDate((data.billing_period as { ends_at?: string })?.ends_at),
  };
}

function normalizeAdjustment(data: Record<string, unknown>): ProviderRefund {
  const totals = data.totals as Record<string, string> | undefined;
  const action = typeof data.action === 'string' ? data.action : '';

  return {
    providerRefundId: typeof data.id === 'string' ? data.id : '',
    providerPaymentRef: typeof data.transaction_id === 'string' ? data.transaction_id : null,
    amountCents: toCents(totals?.total),
    currency: toCurrency(data.currency_code as string | undefined),
    reason: typeof data.reason === 'string' ? data.reason : null,
    // Paddle distinguishes a full refund from a partial credit by action type.
    isFullRefund: action === 'refund',
  };
}

/** Paddle has no dispute webhook we act on; chargebacks arrive as adjustments. */
export function unsupported(operation: string): never {
  throw new ProviderUnsupportedError('paddle', operation);
}
