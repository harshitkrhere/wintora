/**
 * Provider selection and the provider-independent billing helpers.
 *
 * Exactly one place decides which provider is in use. Everything else takes a
 * `PaymentProvider` and does not care.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BillingInterval, CountryCode, CurrencyCode, PlanSlug } from '@/config/plans';
import {
  assertProviderSuitable,
  type PaymentProvider,
  type ProviderName,
} from '@/domain/billing/provider';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { createRazorpayProvider } from './razorpay/adapter';

let cached: PaymentProvider | null = null;

/**
 * The configured provider.
 *
 * Razorpay is a gateway based in India, which is what made it reachable for an
 * individual operator there after Stripe (invite-only) and Paddle (Merchant of
 * Record, since replaced). It is NOT a Merchant of Record: the operator is the
 * legal seller, the refund decision is the operator's, and any consumption tax
 * where the customer lives is the operator's obligation once a threshold is
 * crossed. Those facts are recorded in docs/BILLING.md and docs/LIMITATIONS.md
 * rather than in the adapter, which only moves money.
 */
export function getPaymentProvider(): PaymentProvider {
  if (typeof window !== 'undefined') {
    throw new Error('getPaymentProvider() must never run in a browser context.');
  }
  if (cached !== null) return cached;

  const env = serverEnv();

  if (env.RAZORPAY_KEY_ID === undefined || env.RAZORPAY_KEY_SECRET === undefined) {
    throw new AppError('BILLING_ERROR', 'Payments are not available right now.', {
      detail: 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be configured.',
    });
  }

  const provider = createRazorpayProvider({
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    maxEventAgeSeconds: env.RAZORPAY_EVENT_MAX_AGE_SECONDS,
  });

  // Fails at startup rather than at the moment a customer's quota needs
  // enforcing. See docs/BILLING.md.
  assertProviderSuitable(provider);

  cached = provider;
  return provider;
}

/**
 * The public half of the credentials, for the checkout page. Read through the
 * server so the browser bundle never needs a NEXT_PUBLIC_ copy that could
 * drift from the secret it pairs with.
 */
export function razorpayKeyId(): string {
  const key = serverEnv().RAZORPAY_KEY_ID;
  if (key === undefined) {
    throw new AppError('BILLING_ERROR', 'Payments are not available right now.', {
      detail: 'RAZORPAY_KEY_ID is not configured.',
    });
  }
  return key;
}

export function __resetPaymentProvider(): void {
  cached = null;
}

export function providerName(): ProviderName {
  return 'razorpay';
}

// ---------------------------------------------------------------------------
// Provider-independent helpers
// ---------------------------------------------------------------------------

/**
 * The country a customer is billed in: set from the sign-up form, US when
 * unknown. The pricing page and the checkout route BOTH read this, so the
 * currency a signed-in customer is shown is the currency they are charged in.
 */
export async function billingCountry(
  client: SupabaseClient,
  userId: string,
): Promise<CountryCode> {
  const { data } = await client
    .from('profiles')
    .select('country')
    .eq('id', userId)
    .maybeSingle();
  const value = (data as { country: string } | null)?.country;
  return value === 'CA' ? 'CA' : 'US';
}

/**
 * Resolve the provider price for a plan, country and interval. Server-side only.
 *
 * The client sends a plan SLUG and an INTERVAL and nothing else. Price ids,
 * amounts and currencies come from `plan_prices`, so a tampered request cannot
 * buy Pro at the Essential price, or a year at the monthly price.
 */
export async function resolvePriceId(
  client: SupabaseClient,
  planSlug: PlanSlug,
  country: CountryCode,
  interval: BillingInterval,
): Promise<{ priceId: string; planId: string; amountCents: number; currency: CurrencyCode }> {
  const { data, error } = await client
    .from('plan_prices')
    .select('provider_price_id, plan_id, amount_cents, currency, plans!inner(slug, active)')
    .eq('plans.slug', planSlug)
    .eq('plans.active', true)
    .eq('country', country)
    .eq('interval', interval)
    .eq('active', true)
    .maybeSingle();

  if (error !== null || data === null) {
    throw new AppError('BILLING_ERROR', 'That plan is not available in your country.', {
      detail: `No active ${interval}ly price for ${planSlug} in ${country}`,
    });
  }

  const row = data as unknown as {
    provider_price_id: string | null;
    plan_id: string;
    amount_cents: number;
    currency: string;
  };

  if (row.provider_price_id === null) {
    // Fail loudly rather than charging a wrong or default amount.
    throw new AppError('BILLING_ERROR', 'That plan is not available right now.', {
      detail:
        `plan_prices.provider_price_id is null for ${planSlug}/${country}/${interval}. ` +
        'Run `npm run razorpay:seed -- --apply`. See docs/BILLING.md section 2.',
    });
  }

  return {
    priceId: row.provider_price_id,
    planId: row.plan_id,
    amountCents: row.amount_cents,
    currency: row.currency === 'CAD' ? 'CAD' : 'USD',
  };
}

/** Find or create the provider-side customer, and remember the mapping. */
export async function ensureCustomer(
  client: SupabaseClient,
  provider: PaymentProvider,
  user: { id: string; email: string | null },
): Promise<string> {
  const { data: existing } = await client
    .from('billing_customers')
    .select('provider_customer_id')
    .eq('user_id', user.id)
    .eq('provider', provider.name)
    .maybeSingle();

  const found = (existing as { provider_customer_id: string } | null)
    ?.provider_customer_id;
  if (found !== undefined) return found;

  const providerCustomerId = await provider.ensureCustomer(user);

  await client.from('billing_customers').insert({
    user_id: user.id,
    provider: provider.name,
    provider_customer_id: providerCustomerId,
  });

  return providerCustomerId;
}
