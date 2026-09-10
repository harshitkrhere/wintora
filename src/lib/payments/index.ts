/**
 * Provider selection and the provider-independent billing helpers.
 *
 * Exactly one place decides which provider is in use. Everything else takes a
 * `PaymentProvider` and does not care.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CountryCode, PlanSlug } from '@/config/plans';
import {
  assertProviderSuitable,
  type PaymentProvider,
  type ProviderName,
} from '@/domain/billing/provider';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { createPaddleProvider } from './paddle/adapter';

let cached: PaymentProvider | null = null;

/**
 * The configured provider.
 *
 * Paddle is a Merchant of Record. That choice was forced by two facts, both
 * recorded in docs/LIMITATIONS.md: Stripe is invite-only in India, and the
 * seller is an individual rather than a registered company. An MoR is the
 * realistic route to selling a subscription to US and Canadian consumers from
 * India, and it also removes the sales-tax obligation the seller could not
 * practically discharge across fifty states and thirteen provinces.
 */
export function getPaymentProvider(): PaymentProvider {
  if (typeof window !== 'undefined') {
    throw new Error('getPaymentProvider() must never run in a browser context.');
  }
  if (cached !== null) return cached;

  const env = serverEnv();

  if (env.PAYMENT_PROVIDER !== 'paddle') {
    throw new AppError('BILLING_ERROR', 'Payments are not available right now.', {
      detail: `Unsupported PAYMENT_PROVIDER "${env.PAYMENT_PROVIDER}". Only "paddle" has an adapter.`,
    });
  }

  if (env.PADDLE_API_KEY === undefined) {
    throw new AppError('BILLING_ERROR', 'Payments are not available right now.', {
      detail: 'PADDLE_API_KEY is not configured.',
    });
  }

  const provider = createPaddleProvider({
    apiKey: env.PADDLE_API_KEY,
    webhookSecret: env.PADDLE_WEBHOOK_SECRET,
    environment: env.PADDLE_ENVIRONMENT,
    toleranceSeconds: env.PADDLE_WEBHOOK_TOLERANCE_SECONDS,
  });

  // Fails at startup rather than at the moment a customer's quota needs
  // enforcing. See docs/BILLING.md.
  assertProviderSuitable(provider);

  cached = provider;
  return provider;
}

export function __resetPaymentProvider(): void {
  cached = null;
}

export function providerName(): ProviderName {
  return serverEnv().PAYMENT_PROVIDER as ProviderName;
}

// ---------------------------------------------------------------------------
// Provider-independent helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the provider price for a plan and country. Server-side only.
 *
 * The client sends a plan SLUG and nothing else. Price ids, amounts and
 * currencies come from `plan_prices`, so a tampered request cannot buy Pro at
 * the Essential price.
 */
export async function resolvePriceId(
  client: SupabaseClient,
  planSlug: PlanSlug,
  country: CountryCode,
): Promise<{ priceId: string; amountCents: number; currency: string }> {
  const { data, error } = await client
    .from('plan_prices')
    .select('provider_price_id, amount_cents, currency, plans!inner(slug, active)')
    .eq('plans.slug', planSlug)
    .eq('plans.active', true)
    .eq('country', country)
    .eq('active', true)
    .maybeSingle();

  if (error !== null || data === null) {
    throw new AppError('BILLING_ERROR', 'That plan is not available in your country.', {
      detail: `No active price for ${planSlug} in ${country}`,
    });
  }

  const row = data as unknown as {
    provider_price_id: string | null;
    amount_cents: number;
    currency: string;
  };

  if (row.provider_price_id === null) {
    // Fail loudly rather than charging a wrong or default amount.
    throw new AppError('BILLING_ERROR', 'That plan is not available right now.', {
      detail:
        `plan_prices.provider_price_id is null for ${planSlug}/${country}. ` +
        'Run `npm run paddle:seed -- --apply`. See docs/BILLING.md section 2.',
    });
  }

  return {
    priceId: row.provider_price_id,
    amountCents: row.amount_cents,
    currency: row.currency,
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
