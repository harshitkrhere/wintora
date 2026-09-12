/**
 * /settings/subscription
 *
 * Every value on this page comes from live data: the plan catalog, the computed
 * entitlements, and the usage counters. Nothing is hand-typed.
 *
 * The page answers, without the customer having to ask: what plan am I on, what
 * do I get, how much have I used, when does it reset, when does it expire, what
 * happens if I cancel, what happens if a payment fails.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { buildSubscriptionSummary, type SubscriptionSummary } from '@/lib/billing/summary';
import { createAdminClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/http/api';

export const metadata: Metadata = {
  title: 'Your subscription',
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

export default async function SubscriptionPage(): Promise<React.ReactElement> {
  let summary: SubscriptionSummary;

  try {
    const user = await requireUser();
    summary = await buildSubscriptionSummary(createAdminClient(), user.id);
  } catch {
    return (
      <div className="narrow" style={{ paddingTop: '4rem' }}>
        <h1>Your subscription</h1>
        <p className="lede">Sign in to see your plan, your usage and your invoices.</p>
        <Link href="/dashboard" className="btn btn--primary">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="shell" style={{ paddingTop: '3rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <p className="eyebrow">Subscription</p>
        <h1 style={{ marginBottom: '0.25rem' }}>
          {summary.planDisplayName} <span className="pill">{summary.status}</span>
        </h1>
        <p className="lede">{summary.statusDescription}</p>
      </header>

      {/* A scheduled downgrade is stated with its exact effective date. Paid
          access is never revoked early. */}
      {summary.pendingPlan !== null ? (
        <p className="notice notice--accent">
          Your plan changes to {summary.pendingPlan} on{' '}
          {formatDate(summary.pendingPlanEffectiveAt)}. Until then you keep everything
          your current plan includes, and nothing is removed from your account.
        </p>
      ) : null}

      {summary.status === 'PAST_DUE' || summary.status === 'GRACE' ? (
        <p className="notice notice--accent">
          We could not process your renewal payment
          {summary.priceFormatted !== null ? ` of ${summary.priceFormatted}` : ''}. Your
          features stay active until {formatDate(summary.gracePeriodEnd)}. Update your
          payment method to keep them.{' '}
          <Link href="/settings/billing">Update payment method</Link>
        </p>
      ) : null}

      {summary.cancelAtPeriodEnd ? (
        <p className="notice">
          Your subscription is canceled. Your {summary.planDisplayName} features stay
          active until {formatDate(summary.currentPeriodEnd)}. After that your account
          moves to Free. Your cases and documents stay in your account.
        </p>
      ) : null}

      <section>
        <div className="two-col">
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Billing</h2>
            <dl className="stack" style={{ margin: 0, fontSize: '0.94rem' }}>
              <Row label="Price">
                {summary.priceFormatted ?? 'Free'}
                {summary.priceFormatted !== null ? ` / ${summary.billingInterval}` : ''}
              </Row>
              <Row label="Currency">{summary.currency ?? '—'}</Row>
              <Row label="Current period">
                {formatDate(summary.currentPeriodStart)} to{' '}
                {formatDate(summary.currentPeriodEnd)}
              </Row>
              <Row label="Next billing date">{formatDate(summary.nextBillingDate)}</Row>
              <Row label="Auto-renewal">{summary.autoRenews ? 'On' : 'Off'}</Row>
            </dl>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
              <Link href="/pricing" className="btn btn--secondary">
                Change plan
              </Link>
              <Link href="/settings/billing" className="btn btn--secondary">
                Manage payment and invoices
              </Link>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Available now</h2>
            <ul className="plan__features">
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
                <h2 style={{ fontSize: '1.05rem' }}>Included, not yet available</h2>
                <p className="muted small" style={{ marginTop: 0 }}>
                  Part of your plan, still being built. Nothing here is counted
                  against you and nothing expires while you wait.
                </p>
                <ul className="plan__features muted">
                  {summary.benefits
                    .filter((b) => !b.available)
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
          </div>
        </div>
      </section>

      <section>
        <h2>Remaining this period</h2>
        <p className="small muted">
          Resets on {formatDate(summary.quotaResetsAt)}. Quota periods follow your
          billing period, not the calendar month.
        </p>

        <div className="two-col">
          {summary.usage.map((line) => {
            const pct =
              line.limit === null || line.limit === 0
                ? 0
                : Math.min(100, Math.round((line.used / line.limit) * 100));

            return (
              <div className="card" key={line.featureKey}>
                <h3 style={{ marginTop: 0, fontSize: '0.98rem' }}>{line.label}</h3>
                <p style={{ marginBottom: '0.5rem' }}>
                  {line.limit === null ? (
                    <>Unlimited — {line.used.toLocaleString('en-US')} used</>
                  ) : (
                    <>
                      <strong>{(line.remaining ?? 0).toLocaleString('en-US')}</strong> of{' '}
                      {line.limit.toLocaleString('en-US')} remaining
                    </>
                  )}
                </p>
                {line.limit !== null ? (
                  <div
                    className="usage-bar"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${line.label} used`}
                  >
                    <div className="usage-bar__fill" style={{ width: `${pct}%` }} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2>What happens if…</h2>
        <div className="two-col">
          <div>
            <h3 style={{ fontSize: '1rem' }}>You cancel</h3>
            <p className="small">
              Your paid features stay active until {formatDate(summary.currentPeriodEnd)}.
              After that your account moves to Free. Your cases, documents, findings and
              letters stay in your account.
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: '1rem' }}>A payment fails</h3>
            <p className="small">
              Nothing changes immediately. You keep your features through a grace period
              while you update your payment method, and we tell you the exact date access
              would change if it is not resolved.
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: '1rem' }}>You downgrade</h3>
            <p className="small">
              The change takes effect at the end of your current period. Nothing is
              deleted. If you are over the new limit, existing items stay readable and
              only new ones are blocked.
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: '1rem' }}>You want your data</h3>
            <p className="small">
              Export and deletion work on every plan, including Free and expired
              accounts. <Link href="/settings/privacy">Export or delete your data</Link>.
            </p>
          </div>
        </div>
      </section>
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
