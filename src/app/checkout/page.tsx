/**
 * /checkout
 *
 * The **default payment link** configured in Paddle must point here.
 *
 * Paddle Billing has no fully-hosted checkout: `transaction.checkout.url` is
 * this URL with `?_ptxn=<transaction id>` appended, and this page opens the
 * overlay. Without it, `/api/billing/checkout` redirects somewhere that does
 * not exist.
 *
 * The page grants nothing and charges nothing. It opens a transaction the
 * server already created against a price resolved from `plan_prices`.
 *
 * noindex: a checkout URL carries a transaction reference and has no business
 * in a search index.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { PaddleCheckout } from '@/components/PaddleCheckout';
import { CHECKOUT_DISCLOSURES, CHECKOUT_DISCLOSURE_ORDER } from '@/config/disclosures';
import { publicEnv, serverEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = (await searchParams) ?? {};

  // Paddle appends _ptxn. Accept only a single well-formed value.
  const raw = params._ptxn;
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const transactionId =
    typeof candidate === 'string' && /^txn_[A-Za-z0-9]+$/.test(candidate)
      ? candidate
      : null;

  const clientToken = publicEnv().NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? null;
  const environment = serverEnv().PADDLE_ENVIRONMENT;

  return (
    <div className="narrow" style={{ paddingTop: '3rem' }}>
      <p className="eyebrow">Checkout</p>
      <h1 style={{ marginBottom: '0.35rem' }}>Complete your subscription</h1>
      <p className="lede">
        The secure payment form opens on this page. Your card details go straight to
        the payment provider and never touch Wintora.
      </p>

      <PaddleCheckout
        transactionId={transactionId}
        clientToken={clientToken}
        environment={environment}
        planName={typeof params.plan === 'string' ? params.plan : null}
      />

      {/* Consumer-law disclosures, shown BEFORE the customer pays rather than
          buried in Terms. Rendered from the registry in the declared order, so
          a redesign cannot quietly drop one. */}
      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>Before you pay</h2>
        <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: '0.6rem' }}>
          {CHECKOUT_DISCLOSURE_ORDER.map((key) => (
            <li key={key} className="small muted">
              {CHECKOUT_DISCLOSURES[key]}
            </li>
          ))}
        </ul>
      </section>

      <p className="notice" style={{ marginTop: '1.5rem' }}>
        Changed your mind? <Link href="/pricing">Go back to plans</Link>. Nothing is
        charged until you complete the form above.
      </p>
    </div>
  );
}
