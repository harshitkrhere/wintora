/**
 * /checkout
 *
 * Opens the payment form for the checkout THIS user started.
 *
 * There is no transaction reference in the URL to validate or to leak. The
 * page finds the signed-in user's own CHECKOUT_PENDING subscription, created
 * by /api/billing/checkout against a price resolved from `plan_prices`, and
 * hands its id to the browser along with the provider's public key. Someone
 * else's checkout cannot be opened here because it is never looked up.
 *
 * The page grants nothing and charges nothing. Razorpay's form charges; the
 * verified callback and the signed webhook grant.
 *
 * noindex: a checkout page has no business in a search index.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RazorpayCheckout } from '@/components/RazorpayCheckout';
import { CHECKOUT_DISCLOSURES, CHECKOUT_DISCLOSURE_ORDER } from '@/config/disclosures';
import { PLANS, formatPrice, isPlanSlug, type BillingInterval, type CurrencyCode } from '@/config/plans';
import { POLICY } from '@/config/policy';
import { optionalUser } from '@/lib/http/api';
import { razorpayKeyId } from '@/lib/payments';
import { createAdminClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface PendingRow {
  provider_subscription_id: string | null;
  amount_cents: number;
  currency: string;
  billing_interval: BillingInterval;
  created_at: string;
  plans: { slug: string } | null;
}

export default async function CheckoutPage(): Promise<React.ReactElement> {
  const user = await optionalUser();
  if (user === null) redirect('/signin?next=%2Fcheckout');

  const admin = createAdminClient();
  const { data } = await admin
    .from('subscriptions')
    .select('provider_subscription_id, amount_cents, currency, billing_interval, created_at, plans!subscriptions_plan_id_fkey(slug)')
    .eq('user_id', user.id)
    .eq('status', 'CHECKOUT_PENDING')
    .maybeSingle();

  const pending = data as unknown as PendingRow | null;
  const ttlMs = POLICY.checkout.pendingTtlMinutes * 60 * 1000;
  const fresh =
    pending !== null && Date.now() - new Date(pending.created_at).getTime() < ttlMs;

  if (pending === null || pending.provider_subscription_id === null || !fresh) {
    return (
      <div className="narrow page">
        <p className="eyebrow">Checkout</p>
        <h1>No checkout in progress</h1>
        <p className="lede">
          {pending !== null && !fresh
            ? 'That checkout has expired. Nothing was charged.'
            : 'Choose a plan first, and the payment form will open here.'}
        </p>
        <Link href="/pricing" className="btn btn--primary">
          See plans
        </Link>
      </div>
    );
  }

  const slug = pending.plans?.slug;
  const planName = slug !== undefined && isPlanSlug(slug) ? PLANS[slug].displayName : 'your plan';
  const currency: CurrencyCode = pending.currency === 'CAD' ? 'CAD' : 'USD';
  const price = formatPrice(pending.amount_cents, currency);
  const description = `${planName} plan, ${price} every ${pending.billing_interval}`;

  return (
    <div className="narrow page">
      <p className="eyebrow">Checkout</p>
      <h1 className="page__title">Complete your subscription</h1>
      <p className="lede">
        {planName}: <strong>{price}</strong> every {pending.billing_interval}, in{' '}
        {currency}. The secure payment form opens on this page. Your card details go
        straight to Razorpay and never touch Wintora.
      </p>

      <RazorpayCheckout
        keyId={razorpayKeyId()}
        subscriptionId={pending.provider_subscription_id}
        planName={planName}
        description={description}
        email={user.email}
      />

      {/* Consumer-law disclosures, shown BEFORE the customer pays rather than
          buried in Terms. Rendered from the registry in the declared order, so
          a redesign cannot quietly drop one. */}
      <section className="disclosures">
        <h2 className="disclosures__title">Before you pay</h2>
        <ul className="disclosures__list">
          {CHECKOUT_DISCLOSURE_ORDER.map((key) => (
            <li key={key} className="small muted">
              {CHECKOUT_DISCLOSURES[key]}
            </li>
          ))}
        </ul>
      </section>

      <p className="notice">
        Changed your mind? <Link href="/pricing">Go back to plans</Link>. Nothing is
        charged until you complete the form above.
      </p>
    </div>
  );
}
