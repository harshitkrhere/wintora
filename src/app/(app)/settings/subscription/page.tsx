/**
 * /settings/subscription
 *
 * Every value on this page comes from live data: the plan catalog, the computed
 * entitlements, the usage counters, the provider's invoice list and the last
 * recorded payment. Nothing is hand-typed.
 *
 * The page answers, without the customer having to ask: what plan am I on, what
 * do I get, how much have I used, when does it reset, when does it expire, what
 * happens if I cancel, what happens if a payment fails. And it lets them act:
 * cancel, pause, resume and update the card are here, one click each, because
 * the provider has no customer portal of its own.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ManageSubscription } from '@/components/ManageSubscription';
import { Icon } from '@/components/Icons';
import { BILLING_PAGE_DISCLOSURES } from '@/config/disclosures';
import { formatPrice, type CurrencyCode } from '@/config/plans';
import { POLICY } from '@/config/policy';
import type { ProviderInvoice } from '@/domain/billing/provider';
import { buildSubscriptionSummary, type SubscriptionSummary } from '@/lib/billing/summary';
import { createAdminClient } from '@/lib/supabase/server';
import { getPaymentProvider } from '@/lib/payments';
import { optionalUser } from '@/lib/http/api';
import { log } from '@/lib/logging';

export const metadata: Metadata = {
  title: 'Your subscription',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function formatDate(iso: string | Date | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

interface LastPayment {
  card_brand: string | null;
  card_last4: string | null;
  processed_at: string | null;
}

interface LiveRef {
  provider_subscription_id: string | null;
}

/** The provider's own invoice list. A provider outage degrades to a sentence. */
async function loadInvoices(
  providerSubscriptionId: string | null,
): Promise<{ invoices: readonly ProviderInvoice[]; unavailable: boolean }> {
  if (providerSubscriptionId === null) return { invoices: [], unavailable: false };
  try {
    const invoices = await getPaymentProvider().listInvoices(providerSubscriptionId);
    return { invoices, unavailable: false };
  } catch (error) {
    log.warn('invoice list unavailable', {
      route: '/settings/subscription',
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return { invoices: [], unavailable: true };
  }
}

/** The colour a subscription status wears. Amber for anything that needs a hand. */
function statusTone(status: string): string {
  switch (status) {
    case 'ACTIVE':
    case 'TRIALING':
      return 'badge--success';
    case 'PAST_DUE':
    case 'GRACE':
      return 'badge--warning';
    case 'PAUSED':
    case 'CANCELED_PENDING_EXPIRY':
      return 'badge--info';
    default:
      return 'badge--neutral';
  }
}

function invoiceTone(status: string): string {
  const s = status.toLowerCase();
  if (s === 'paid') return 'badge--success';
  if (s === 'issued' || s === 'pending') return 'badge--info';
  if (s === 'failed' || s === 'expired') return 'badge--warning';
  return 'badge--neutral';
}

export default async function SubscriptionPage(): Promise<React.ReactElement> {
  const user = await optionalUser();

  if (user === null) {
    return (
      <div className="narrow page">
        <h1>Your subscription</h1>
        <p className="lede">Sign in to see your plan, your usage and your invoices.</p>
        <Link href="/signin?next=%2Fsettings%2Fsubscription" className="btn btn--primary">
          Sign in
        </Link>
      </div>
    );
  }

  const admin = createAdminClient();
  const summary: SubscriptionSummary = await buildSubscriptionSummary(admin, user.id);

  const [{ data: liveData }, { data: paymentData }] = await Promise.all([
    admin
      .from('subscriptions')
      .select('provider_subscription_id')
      .eq('user_id', user.id)
      .in('status', ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'PAUSED', 'CANCELED_PENDING_EXPIRY'])
      .maybeSingle(),
    admin
      .from('payments')
      .select('card_brand, card_last4, processed_at')
      .eq('user_id', user.id)
      .eq('status', 'captured')
      .order('processed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const live = liveData as LiveRef | null;
  const lastPayment = paymentData as LastPayment | null;
  const manageable = summary.hasPaidPlan && live?.provider_subscription_id != null;
  const { invoices, unavailable } = manageable
    ? await loadInvoices(live?.provider_subscription_id ?? null)
    : { invoices: [], unavailable: false };

  const availableBenefits = summary.benefits.filter((b) => b.available);
  const pendingBenefits = summary.benefits.filter((b) => !b.available);

  return (
    <div className="shell page stack--lg">
      <div className="page-head">
        <div className="page-head__text">
          <p className="eyebrow">
            Settings · <Link href="/settings/privacy">Your data</Link>
          </p>
          <h1 className="page__title">
            {summary.planDisplayName}
            <span className={`badge ${statusTone(summary.status)} badge--dot`}>{summary.status}</span>
          </h1>
          <p className="lede">{summary.statusDescription}</p>
        </div>
        <div className="page-head__actions">
          <Link href="/pricing" className="btn btn--secondary">
            {summary.hasPaidPlan ? 'Change plan' : 'See plans'}
          </Link>
        </div>
      </div>

      {/* A scheduled downgrade is stated with its exact effective date. Paid
          access is never revoked early. */}
      {summary.pendingPlan !== null ||
      summary.status === 'PAST_DUE' ||
      summary.status === 'GRACE' ||
      summary.cancelAtPeriodEnd ||
      summary.status === 'PAUSED' ? (
        <div className="stack--sm">
          {summary.pendingPlan !== null ? (
            <p className="notice notice--info">
              Your plan changes to {summary.pendingPlan} on{' '}
              {formatDate(summary.pendingPlanEffectiveAt)}. Until then you keep everything
              your current plan includes, and nothing is removed from your account.
            </p>
          ) : null}

          {summary.status === 'PAST_DUE' || summary.status === 'GRACE' ? (
            <p className="notice notice--warning">
              We could not process your renewal payment
              {summary.priceFormatted !== null ? ` of ${summary.priceFormatted}` : ''}. Your
              features stay active until {formatDate(summary.gracePeriodEnd)}. Update your
              card below to keep them.
            </p>
          ) : null}

          {summary.cancelAtPeriodEnd ? (
            <p className="notice notice--info">
              Your subscription is set to end on {formatDate(summary.currentPeriodEnd)}. Your{' '}
              {summary.planDisplayName} features stay active until then. After that your
              account moves to Free, and your cases and documents stay in your account.
            </p>
          ) : null}

          {summary.status === 'PAUSED' ? (
            <p className="notice notice--info">
              Your subscription is paused and you are not being charged. Your account is on the
              Free plan while it is paused; nothing has been deleted. It resumes automatically
              after {POLICY.pause.maxDays} days, or sooner if you resume it below.
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="two-col">
        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Billing</h2>
            <span className="icon-tile" aria-hidden>
              <Icon name="card" />
            </span>
          </div>
          <dl className="dl">
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
            {lastPayment !== null && lastPayment.card_last4 !== null ? (
              <Row label="Card">
                {lastPayment.card_brand ?? 'Card'} ending {lastPayment.card_last4}
              </Row>
            ) : null}
          </dl>

          {manageable ? (
            <ManageSubscription
              status={summary.status}
              cancelAtPeriodEnd={summary.cancelAtPeriodEnd}
              canPause={POLICY.pause.enabled && getPaymentProvider().capabilities.pause}
              periodEndLabel={formatDate(summary.currentPeriodEnd)}
              email={user.email}
            />
          ) : null}

          <div className="card__footer">
            <p className="caption card__last">{BILLING_PAGE_DISCLOSURES.whoCharged}</p>
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Available now</h2>
            <span className="icon-tile icon-tile--success" aria-hidden>
              <Icon name="shield" />
            </span>
          </div>
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
              <h2 className="card__title card__title--spaced">Included, not yet available</h2>
              <p className="caption card__lead">
                Part of your plan, still being built. Nothing here is counted against you
                and nothing expires while you wait.
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
      </section>

      <section className="stack">
        <div className="section-head">
          <h2>Remaining this period</h2>
          <span className="caption">Resets on {formatDate(summary.quotaResetsAt)}</span>
        </div>
        <div className="stats">
          {summary.usage.map((line) => {
            const pct =
              line.limit === null || line.limit === 0
                ? 0
                : Math.min(100, Math.round((line.used / line.limit) * 100));

            return (
              <div className="stat" key={line.featureKey}>
                <span className="stat__label">{line.label}</span>
                <span className="stat__value">
                  {line.limit === null ? (
                    <>
                      {line.used.toLocaleString('en-US')} <small>used · unlimited</small>
                    </>
                  ) : (
                    <>
                      {(line.remaining ?? 0).toLocaleString('en-US')}{' '}
                      <small>of {line.limit.toLocaleString('en-US')} left</small>
                    </>
                  )}
                </span>
                {line.limit !== null ? (
                  <div
                    className="usage-bar stat__meta"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${line.label} used`}
                  >
                    {/* The one inline style on the page: a value, not a design. */}
                    <div className="usage-bar__fill" style={{ width: `${pct}%` }} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="caption m-0">
          Quota periods follow your billing period, not the calendar month; on a yearly plan
          they still reset every month.
        </p>
      </section>

      {manageable ? (
        <section className="stack">
          <div className="section-head">
            <h2>Invoices</h2>
            <span className="caption">{BILLING_PAGE_DISCLOSURES.invoiceSource}</span>
          </div>
          {unavailable ? (
            <p className="notice notice--warning">
              Invoices are temporarily unavailable from the payment provider. Nothing is
              wrong with your subscription; try again in a few minutes.
            </p>
          ) : invoices.length === 0 ? (
            <p className="caption m-0">No invoices yet.</p>
          ) : (
            <div className="table-scroll table--responsive">
              <table>
                <caption className="sr-only">Your invoices, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Number</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Link</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.providerInvoiceId}>
                      <td data-label="Date">{formatDate(invoice.issuedAt)}</td>
                      <td data-label="Number">{invoice.number ?? '—'}</td>
                      <td data-label="Amount" className="tnum">
                        {formatPrice(invoice.amountDueCents, invoice.currency as CurrencyCode)}
                      </td>
                      <td data-label="Status">
                        <span className={`badge ${invoiceTone(invoice.status)}`}>{invoice.status}</span>
                      </td>
                      <td data-label="Invoice">
                        {invoice.hostedUrl !== null ? (
                          <a href={invoice.hostedUrl} rel="noopener noreferrer" target="_blank">
                            View
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="caption m-0">{BILLING_PAGE_DISCLOSURES.refundRoute}</p>
        </section>
      ) : null}

      <section className="stack">
        <div className="section-head">
          <h2>What happens if…</h2>
        </div>
        <div className="terms-grid">
          <div className="card">
            <h3>You cancel</h3>
            <p>
              Your paid features stay active until {formatDate(summary.currentPeriodEnd)}.
              After that your account moves to Free. Your cases, documents, findings and
              letters stay in your account.
            </p>
          </div>
          <div className="card">
            <h3>A payment fails</h3>
            <p>
              Nothing changes immediately. You keep your features for {POLICY.grace.days}{' '}
              days while you update your card, and we tell you the exact date access would
              change if it is not resolved.
            </p>
          </div>
          <div className="card">
            <h3>You downgrade</h3>
            <p>
              The change takes effect at the end of your current period. Nothing is
              deleted. If you are over the new limit, existing items stay readable and
              only new ones are blocked.
            </p>
          </div>
          <div className="card">
            <h3>You want your data</h3>
            <p>
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
    <div className="dl__row">
      <dt>{label}</dt>
      <dd className="dl__value">{children}</dd>
    </div>
  );
}
