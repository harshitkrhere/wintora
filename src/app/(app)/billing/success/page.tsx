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
import { Icon } from '@/components/Icons';

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
        <div className="empty">
          <div className="empty__mark" aria-hidden>
            <span>
              <Icon name="card" className="empty__icon" />
            </span>
          </div>
          <h1 className="empty__title">No recent payment</h1>
          <p className="empty__body">
            There is no payment being finalised on your account. If you just paid and this
            seems wrong, your subscription page will show the subscription as soon as the
            payment provider confirms it.
          </p>
          <div className="empty__actions">
            <Link href="/settings/subscription" className="btn btn--primary">
              Go to your subscription page
            </Link>
            <Link href="/pricing" className="btn btn--secondary">
              See plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // The provider has not confirmed yet. Say that plainly instead of showing a
  // celebration for a subscription we have not verified.
  if (!summary.hasPaidPlan) {
    return (
      <div className="narrow page stack">
        {/* A short refresh, because the wait is normally a few seconds. */}
        <meta httpEquiv="refresh" content="4" />
        <div className="page-head__text">
          <p className="eyebrow">Almost there</p>
          <h1>Finalising your subscription</h1>
          <p className="lede">
            We are waiting for confirmation from the payment provider before switching on
            your new features. This usually takes a few seconds.
          </p>
        </div>
        <div className="wait" role="status" aria-live="polite">
          <div className="progress" aria-hidden>
            <div className="progress__bar" />
          </div>
          <p className="wait__note">Waiting for the payment provider</p>
          <p className="small muted card__last">
            This page refreshes on its own. You do not need to pay again or do anything
            else.
          </p>
        </div>
        <div className="actions">
          <Link href="/settings/subscription" className="btn btn--secondary">
            Go to your subscription page
          </Link>
        </div>
      </div>
    );
  }

  const availableBenefits = summary.benefits.filter((b) => b.available);
  const pendingBenefits = summary.benefits.filter((b) => !b.available).slice(0, 8);

  return (
    <div className="narrow page stack--md">
      <div className="text-center">
        <div className="icon-tile icon-tile--lg icon-tile--success mx-auto" aria-hidden>
          <Icon name="check" />
        </div>
        <p className="eyebrow mt-4">Confirmed</p>
        <h1>You are now subscribed to {summary.planDisplayName}.</h1>
      </div>

      <div className="card">
        <dl className="dl">
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
      <div className="card">
        <h2 className="card__title">What you can use now</h2>
        <ul className="check-list">
          {availableBenefits.map((benefit) => (
            <li key={benefit.key}>
              {benefit.limit !== null
                ? `${benefit.limit.toLocaleString('en-US')} ${benefit.unit ?? ''} — ${benefit.text}`.trim()
                : benefit.text}
            </li>
          ))}
        </ul>

        {pendingBenefits.length > 0 && (
          <>
            <h2 className="card__title card__title--spaced">Included in your plan, not yet available</h2>
            <p className="caption card__lead">
              These are part of what you have paid for and are still being built. They
              will appear on your dashboard when they are ready. If that is not
              acceptable, contact us and we will refund you.
            </p>
            <ul className="check-list muted">
              {pendingBenefits.map((benefit) => (
                <li key={benefit.key} className="muted">
                  {benefit.limit !== null
                    ? `${benefit.limit.toLocaleString('en-US')} ${benefit.unit ?? ''} — ${benefit.text}`.trim()
                    : benefit.text}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="actions">
        <Link href="/dashboard" className="btn btn--primary">
          Open dashboard
          <Icon name="arrow-right" />
        </Link>
        <Link href="/settings/subscription" className="btn btn--secondary">
          Manage subscription
        </Link>
      </div>

      <p className="notice">
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
    <div className="dl__row">
      <dt>{label}</dt>
      <dd className="dl__value">{children}</dd>
    </div>
  );
}
