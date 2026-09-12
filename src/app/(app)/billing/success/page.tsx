/**
 * /billing/success
 *
 * IMPORTANT: this page grants nothing.
 *
 * It reads the current subscription from the database and displays it. Access
 * changes only when a signature-verified provider webhook drives the state
 * machine and entitlements are recomputed. If the webhook has not landed yet,
 * this page says so honestly and refreshes, rather than pretending.
 *
 * See docs/BILLING.md section 4.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { buildSubscriptionSummary, type SubscriptionSummary } from '@/lib/billing/summary';
import { createAdminClient } from '@/lib/supabase/server';
import { optionalUser } from '@/lib/http/api';
import { redirect } from 'next/navigation';
import { POLICY } from '@/config/policy';

export const metadata: Metadata = {
  title: 'Subscription confirmed',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function BillingSuccessPage(): Promise<React.ReactElement> {
  // A signed-out visitor has no payment to be told about. Send them to sign
  // in rather than showing anyone a "your payment went through" page.
  const user = await optionalUser();
  if (user === null) redirect('/signin?next=%2Fbilling%2Fsuccess');

  const admin = createAdminClient();
  const summary: SubscriptionSummary = await buildSubscriptionSummary(admin, user.id);

  // Is there actually a payment in flight? Only a checkout this user started
  // within the window, or a subscription the provider has confirmed, earns
  // the "finalising" copy. Anyone else landing here is told the truth.
  const { data: pendingData } = await admin
    .from('subscriptions')
    .select('created_at')
    .eq('user_id', user.id)
    .eq('status', 'CHECKOUT_PENDING')
    .maybeSingle();
  const pending = pendingData as { created_at: string } | null;
  const pendingFresh =
    pending !== null &&
    Date.now() - new Date(pending.created_at).getTime() <
      POLICY.checkout.pendingTtlMinutes * 60 * 1000;

  if (!summary.hasPaidPlan && !pendingFresh) {
    return (
      <div className="narrow page">
        <h1>No recent payment</h1>
        <p className="lede">
          There is no payment being finalised on your account. If you just paid and this
          seems wrong, your subscription page will show the subscription as soon as the
          payment provider confirms it.
        </p>
        <div className="card__actions">
          <Link href="/settings/subscription" className="btn btn--primary">
            Go to your subscription page
          </Link>
          <Link href="/pricing" className="btn btn--secondary">
            See plans
          </Link>
        </div>
      </div>
    );
  }

  // The provider has not confirmed yet. Say that plainly instead of showing a
  // celebration for a subscription we have not verified.
  if (!summary.hasPaidPlan) {
    return (
      <div className="narrow page">
        {/* A short refresh, because the wait is normally a few seconds. */}
        <meta httpEquiv="refresh" content="4" />
        <h1>Finalising your subscription</h1>
        <p className="lede">
          We are waiting for confirmation from the payment provider before switching on
          your new features. This usually takes a few seconds.
        </p>
        <p className="small muted">
          This page refreshes on its own. You do not need to pay again or do anything
          else.
        </p>
        <Link href="/settings/subscription" className="btn btn--secondary">
          Go to your subscription page
        </Link>
      </div>
    );
  }

  return (
    <div className="narrow page">
      <p className="eyebrow">Confirmed</p>
      <h1>You are now subscribed to {summary.planDisplayName}.</h1>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <dl className="stack" style={{ margin: 0, fontSize: '0.95rem' }}>
          <Row label="Plan">{summary.planDisplayName}</Row>
          <Row label="Amount">
            {summary.priceFormatted ?? '—'}
            {summary.priceFormatted !== null ? ` / ${summary.billingInterval}` : ''}
          </Row>
          <Row label="Currency">{summary.currency ?? '—'}</Row>
          <Row label="Next billing date">{formatDate(summary.nextBillingDate)}</Row>
          <Row label="Renews automatically">{summary.autoRenews ? 'Yes' : 'No'}</Row>
        </dl>
      </div>

      {/*
        Two lists, never one. A plan INCLUDES everything in the registry, but
        only some of it is built. Presenting an unbuilt feature as "now active"
        to someone who paid two seconds ago is exactly the claim this product
        promises never to make. See docs/AI_SAFETY.md section 11.
      */}
      <h2 style={{ fontSize: '1.1rem' }}>What you can use now</h2>
      <ul className="plan__features" style={{ marginBottom: '1.5rem' }}>
        {summary.benefits
          .filter((b) => b.available)
          .map((benefit) => (
            <li key={benefit.key}>
              {benefit.limit !== null
                ? `${benefit.limit.toLocaleString('en-US')} ${benefit.unit ?? ''} — ${benefit.text}`.trim()
                : benefit.text}
            </li>
          ))}
      </ul>

      {summary.benefits.some((b) => !b.available) && (
        <>
          <h2 style={{ fontSize: '1.1rem' }}>Included in your plan, not yet available</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            These are part of what you have paid for and are still being built. They
            will appear on your dashboard when they are ready. If that is not
            acceptable, contact us and we will refund you.
          </p>
          <ul className="plan__features muted" style={{ marginBottom: '1.5rem' }}>
            {summary.benefits
              .filter((b) => !b.available)
              .slice(0, 8)
              .map((benefit) => (
                <li key={benefit.key}>
                  {benefit.limit !== null
                    ? `${benefit.limit.toLocaleString('en-US')} ${benefit.unit ?? ''} — ${benefit.text}`.trim()
                    : benefit.text}
                </li>
              ))}
          </ul>
        </>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Link href="/dashboard" className="btn btn--primary">
          Open dashboard
        </Link>
        <Link href="/settings/subscription" className="btn btn--secondary">
          Manage subscription
        </Link>
      </div>

      <p className="notice" style={{ marginTop: '2rem' }}>
        You can cancel at any time from your subscription page. If you cancel, your paid
        features stay active until the end of the period you have already paid for.
      </p>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
      <dt className="muted">{label}</dt>
      <dd style={{ margin: 0, textAlign: 'right' }}>{children}</dd>
    </div>
  );
}
