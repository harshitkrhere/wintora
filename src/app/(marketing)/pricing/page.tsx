/**
 * Pricing and plan comparison.
 *
 * Every row and every cell is generated from the feature registry and the plan
 * catalog. Nothing on this page is hand-typed, so an advertised feature cannot
 * drift away from what the backend enforces.
 * `tests/catalog-parity.test.ts` asserts the registry matches the database seed.
 *
 * The page is a pure function of two inputs: the URL (billing interval, and
 * country for visitors) and the account (country for customers). The interval
 * switch is two links, so the choice lives in the address bar, survives a
 * reload, can be shared, and needs no JavaScript to work.
 *
 * Persuasion on this page is limited to two things the product can stand
 * behind: one plan is marked as recommended, and each plan says in one sentence
 * who it fits. There is no countdown, no "most popular", no strike-through
 * price and no anxiety. See docs/PRICING.md section 3.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckoutButton } from '@/components/CheckoutButton';
import { ALL_FEATURES, FEATURES, type FeatureKey } from '@/config/features';
import {
  ALL_PLANS,
  annualSavingPercent,
  formatPrice,
  isBillingInterval,
  isPlanSlug,
  perMonthEquivalentCents,
  priceFor,
  type BillingInterval,
  type CountryCode,
  type PlanDefinition,
  type PlanSlug,
} from '@/config/plans';
import { optionalUser } from '@/lib/http/api';
import { billingCountry } from '@/lib/payments';
import { createAdminClient } from '@/lib/supabase/server';

/** Units in the catalog are plural. "1 cases" reads like a bug, so one is singular. */
function unitLabel(count: number, unit: string): string {
  return count === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit;
}

/** The one line a plan gets in the at-a-glance strip. */
function glancePrice(plan: PlanDefinition, state: Pick<PageState, 'country' | 'interval'>): string {
  if (plan.isFree) return 'Free';
  const price = priceFor(plan.slug, state.country, state.interval);
  if (price === undefined) return '—';
  return `${formatPrice(price.amountCents, price.currency)} / ${price.interval}`;
}

export const metadata: Metadata = {
  title: 'Plans and pricing',
  description:
    'Four plans with published limits, billed monthly or yearly. Cancel any time and keep access until the period you paid for ends.',
};

const HIGHLIGHT_FEATURES: readonly FeatureKey[] = [
  'BASIC_BILL_ANALYSIS',
  'EOB_COMPARISON',
  'ADVANCED_DOCUMENT_ANALYSIS',
  'MAX_ACTIVE_CASES',
  'MONTHLY_ANALYSES',
  'MONTHLY_LETTERS',
  'DEADLINE_TRACKING',
  'HOUSEHOLD_CASES',
];

/** Everything the page needs to render, resolved once. */
interface PageState {
  readonly interval: BillingInterval;
  readonly country: CountryCode;
  /** True when the country came from the account rather than the URL. */
  readonly countryFromAccount: boolean;
  readonly signedIn: boolean;
  /** A plan the visitor was choosing before being sent to sign in. */
  readonly resumingPlan: PlanSlug | null;
}

function pricingHref(state: Pick<PageState, 'interval' | 'country'>, patch: Partial<Pick<PageState, 'interval' | 'country'>>): string {
  const next = { ...state, ...patch };
  const params = new URLSearchParams();
  if (next.interval !== 'month') params.set('interval', next.interval);
  if (next.country !== 'US') params.set('country', next.country);
  const query = params.toString();
  return query.length > 0 ? `/pricing?${query}` : '/pricing';
}

function cell(plan: PlanDefinition, key: FeatureKey): React.ReactElement {
  const grant = plan.features[key];
  const definition = FEATURES[key];

  if (grant === undefined || !grant.enabled) {
    return (
      <span className="no" aria-label="Not included">
        —
      </span>
    );
  }

  if (grant.limitValue !== undefined && grant.limitValue !== null) {
    return (
      <>
        {grant.limitValue.toLocaleString('en-US')}
        {grant.limitUnit !== undefined ? (
          <span className="muted small"> {unitLabel(grant.limitValue, grant.limitUnit)}</span>
        ) : null}
      </>
    );
  }

  if (definition.type === 'LIMIT' || definition.type === 'QUOTA') {
    return <span className="yes">Unlimited</span>;
  }

  return (
    <span className="yes" aria-label="Included">
      Included
    </span>
  );
}

function PlanPriceBlock({
  plan,
  state,
}: {
  plan: PlanDefinition;
  state: PageState;
}): React.ReactElement {
  if (plan.isFree) {
    return (
      <div className="plan__pricing">
        <p className="plan__price">
          Free
          <span className="plan__interval">no card needed</span>
        </p>
      </div>
    );
  }

  const price = priceFor(plan.slug, state.country, state.interval);
  if (price === undefined) {
    return (
      <div className="plan__pricing">
        <p className="plan__price">—</p>
      </div>
    );
  }

  const saving = annualSavingPercent(plan.slug, state.country);

  return (
    <div className="plan__pricing">
      <p className="plan__price">
        {formatPrice(price.amountCents, price.currency)}
        <span className="plan__interval">/ {price.interval}</span>
      </p>
      {price.interval === 'year' ? (
        <p className="plan__equiv small muted">
          {formatPrice(perMonthEquivalentCents(price), price.currency)} a month, billed
          once a year
          {saving !== null && saving > 0 ? (
            <>
              . <span className="plan__saving">Saves {saving}%</span> against monthly.
            </>
          ) : null}
        </p>
      ) : saving !== null && saving > 0 ? (
        <p className="plan__equiv small muted">
          <Link href={pricingHref(state, { interval: 'year' })}>
            Pay yearly and save {saving}%
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function PlanCard({ plan, state }: { plan: PlanDefinition; state: PageState }): React.ReactElement {
  const highlights = HIGHLIGHT_FEATURES.map((key) => ({
    key,
    grant: plan.features[key],
  })).filter((row) => row.grant?.enabled === true);

  const classes = ['card', 'plan'];
  if (plan.recommended) classes.push('plan--recommended');
  if (state.resumingPlan === plan.slug) classes.push('plan--resuming');

  const headingId = `plan-${plan.slug}-name`;

  return (
    <article className={classes.join(' ')} id={`plan-${plan.slug}`} aria-labelledby={headingId}>
      <header className="plan__head">
        {plan.recommended ? <p className="plan__eyebrow">Recommended</p> : null}
        <h2 id={headingId} className="plan__name">
          {plan.displayName}
        </h2>
        <p className="plan__fit">{plan.bestFor}</p>
      </header>

      <PlanPriceBlock plan={plan} state={state} />

      <ul className="plan__features" aria-label={`What ${plan.displayName} includes`}>
        {highlights.slice(0, 6).map(({ key, grant }) => (
          <li key={key} className={FEATURES[key].available ? undefined : 'muted'}>
            <span>
              {grant?.limitValue !== undefined && grant.limitValue !== null
                ? `${grant.limitValue.toLocaleString('en-US')} ${
                    grant.limitUnit === undefined ? '' : unitLabel(grant.limitValue, grant.limitUnit)
                  }`.trim()
                : FEATURES[key].benefitText}
              {/* Said on the pricing page, before money changes hands, not after. */}
              {!FEATURES[key].available && (
                <span className="small muted"> — not yet available</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {plan.isFree ? (
        <div className="plan__cta">
          <Link href="/medical-bill-checker" className="btn btn--secondary btn--block">
            Start free
          </Link>
        </div>
      ) : (
        <CheckoutButton
          planSlug={plan.slug}
          planName={plan.displayName}
          interval={state.interval}
          variant={plan.recommended ? 'primary' : 'secondary'}
        />
      )}
    </article>
  );
}

function IntervalSwitch({ state }: { state: PageState }): React.ReactElement {
  const options: readonly { interval: BillingInterval; label: string }[] = [
    { interval: 'month', label: 'Monthly' },
    { interval: 'year', label: 'Yearly' },
  ];

  return (
    <nav className="interval-switch" aria-label="Billing interval">
      {options.map((option) => {
        const active = option.interval === state.interval;
        return (
          <Link
            key={option.interval}
            href={pricingHref(state, { interval: option.interval })}
            className="interval-switch__option"
            aria-current={active ? 'page' : undefined}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

async function resolveState(
  params: Record<string, string | string[] | undefined>,
): Promise<PageState> {
  const rawInterval = typeof params.interval === 'string' ? params.interval : 'month';
  const interval: BillingInterval = isBillingInterval(rawInterval) ? rawInterval : 'month';

  const rawPlan = typeof params.plan === 'string' ? params.plan : null;
  const resumingPlan = rawPlan !== null && isPlanSlug(rawPlan) ? rawPlan : null;

  // Anything other than an explicit CA falls back to US rather than guessing.
  const urlCountry: CountryCode = params.country === 'CA' ? 'CA' : 'US';

  // A customer sees the currency they will actually be charged in. Their
  // country comes from the account, and the URL cannot override it, because a
  // page that shows one currency and charges another is not a pricing page.
  const user = await optionalUser();
  if (user === null) {
    return { interval, country: urlCountry, countryFromAccount: false, signedIn: false, resumingPlan };
  }

  const country = await billingCountry(createAdminClient(), user.id);
  return { interval, country, countryFromAccount: true, signedIn: true, resumingPlan };
}

const TERMS: readonly { title: string; text: string }[] = [
  {
    title: 'Billing',
    text: 'Plans bill monthly or yearly, in the currency shown, and renew automatically until you cancel. A yearly plan is one payment for twelve months; your monthly allowances still reset every month. The renewal date and amount are always visible on your subscription page.',
  },
  {
    title: 'Cancelling',
    text: 'One click, from your subscription page or the payment portal. Your paid features stay active until the end of the period you have already paid for. We do not ask you to contact support to cancel.',
  },
  {
    title: 'Changing plan',
    text: 'Upgrades, including a move from monthly to yearly, take effect immediately with a prorated charge. Downgrades take effect at the end of your current period, so you keep what you paid for.',
  },
  {
    title: 'If a payment fails',
    text: 'Your features stay active for a grace period while you update your payment method. We will tell you the amount, the date and exactly when access would change.',
  },
  {
    title: 'Your data',
    text: 'Downgrading or cancelling never deletes your cases, documents or letters. If a lower plan has a shorter document retention window, you get 30 days notice and a full list of what is affected before anything is removed.',
  },
  {
    title: 'Export and deletion',
    text: 'Available on every plan, including free and expired accounts. These are rights, not features, so no plan can switch them off.',
  },
];

export default async function PricingPage({
  searchParams,
}: {
  // Next.js 15 passes search params as a promise.
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const state = await resolveState((await searchParams) ?? {});
  const countryName = state.country === 'CA' ? 'Canada (CAD)' : 'the United States (USD)';

  return (
    <div className="shell pricing">
      <section className="pricing__intro">
        <p className="eyebrow">Pricing</p>
        <h1>Plans and pricing</h1>
        <p className="lede">
          Every limit below is the limit the software actually enforces. There is no
          feature on this page that the backend does not implement.
        </p>

        <div className="pricing__controls">
          <IntervalSwitch state={state} />
          <p className="small pricing__country">
            {state.countryFromAccount ? (
              <>
                Prices for <strong>{countryName}</strong>, the country on your account.
              </>
            ) : (
              <>
                Showing prices for <strong>{countryName}</strong>.{' '}
                <Link href={pricingHref(state, { country: state.country === 'CA' ? 'US' : 'CA' })}>
                  Show {state.country === 'CA' ? 'United States (USD)' : 'Canada (CAD)'}
                </Link>
              </>
            )}
          </p>
        </div>

        {state.signedIn && state.resumingPlan !== null ? (
          <p className="notice notice--info pricing__resume" role="status">
            You are signed in. Choose {ALL_PLANS.find((p) => p.slug === state.resumingPlan)?.displayName ?? 'a plan'}{' '}
            below to continue to checkout.
          </p>
        ) : null}
      </section>

      {/* On a phone the four cards stack to several screens. This strip shows
          every price at once, first, and jumps to the card. It is hidden where
          the grid already shows the cards side by side. */}
      <nav className="glance" aria-label="Plans at a glance">
        <ol className="glance__list">
          {ALL_PLANS.map((plan) => (
            <li key={plan.slug}>
              <a
                href={`#plan-${plan.slug}`}
                className={`glance__row${plan.recommended ? ' glance__row--recommended' : ''}`}
              >
                <span className="glance__name">
                  {plan.displayName}
                  {plan.recommended ? <span className="badge">Recommended</span> : null}
                </span>
                <span className="glance__price">{glancePrice(plan, state)}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section>
        <div className="plan-grid">
          {ALL_PLANS.map((plan) => (
            <PlanCard key={plan.slug} plan={plan} state={state} />
          ))}
        </div>
      </section>

      <section>
        <div className="section-head mb-4">
          <h2>Everything, side by side</h2>
        </div>
        <p className="small muted table-hint">Swipe sideways to see every plan.</p>
        <div className="table-scroll table--hover">
          <table>
            <caption className="sr-only">
              Feature comparison across the {ALL_PLANS.map((p) => p.displayName).join(', ')} plans
            </caption>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                {ALL_PLANS.map((plan) => (
                  <th key={plan.slug} scope="col">
                    {plan.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_FEATURES.map((feature) => (
                <tr key={feature.key}>
                  <th scope="row" className="table__feature">
                    {feature.name}
                    {!feature.available && (
                      <span className="small muted"> · not yet available</span>
                    )}
                    <span className="muted small table__feature-desc">{feature.description}</span>
                  </th>
                  {ALL_PLANS.map((plan) => (
                    <td key={plan.slug}>{cell(plan, feature.key)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="section-intro">
          <h2>The terms, in plain words</h2>
        </div>
        <div className="terms-grid">
          {TERMS.map((term) => (
            <div key={term.title} className="card">
              <h3>{term.title}</h3>
              <p>{term.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <p className="small muted">
          The full <Link href="/terms">terms of service</Link>,{' '}
          <Link href="/refunds">refund and cancellation policy</Link> and{' '}
          <Link href="/privacy">privacy policy</Link> say the same things at greater
          length.
        </p>
        <p className="notice notice--info">
          Prices shown are current for new subscriptions. If we change a price, existing
          subscribers stay on the price they signed up at until we contact them
          directly. Applicable taxes are calculated at checkout and shown before you
          pay.
        </p>
      </section>
    </div>
  );
}
