/**
 * Pricing and plan comparison.
 *
 * Every row and every cell is generated from the feature registry and the plan
 * catalog. Nothing on this page is hand-typed, so an advertised feature cannot
 * drift away from what the backend enforces.
 * `tests/catalog-parity.test.ts` asserts the registry matches the database seed.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckoutButton } from '@/components/CheckoutButton';
import { ALL_FEATURES, FEATURES, type FeatureKey } from '@/config/features';
import {
  ALL_PLANS,
  formatPrice,
  priceFor,
  type CountryCode,
  type PlanDefinition,
} from '@/config/plans';

export const metadata: Metadata = {
  title: 'Plans and pricing',
  description:
    'Four plans with published limits. Cancel any time and keep access until the period you paid for ends.',
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
          <span className="muted small"> {grant.limitUnit}</span>
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

function PlanCard({
  plan,
  country,
}: {
  plan: PlanDefinition;
  country: CountryCode;
}): React.ReactElement {
  const price = priceFor(plan.slug, country);
  const highlights = HIGHLIGHT_FEATURES.map((key) => ({
    key,
    grant: plan.features[key],
  })).filter((row) => row.grant?.enabled === true);

  return (
    <article className="card plan">
      <div>
        <h2 style={{ fontSize: '1.15rem', marginBottom: '0.15rem' }}>
          {plan.displayName}
        </h2>
        <p className="small muted" style={{ minHeight: '3.2em' }}>
          {plan.description}
        </p>
      </div>

      <div className="plan__price">
        {price !== undefined ? formatPrice(price.amountCents, price.currency) : '—'}
        <span className="plan__interval">
          {plan.isFree ? '' : ` / ${plan.billingInterval}`}
        </span>
      </div>

      <ul className="plan__features">
        {highlights.slice(0, 6).map(({ key, grant }) => (
          <li key={key}>
            {grant?.limitValue !== undefined && grant.limitValue !== null
              ? `${grant.limitValue.toLocaleString('en-US')} ${grant.limitUnit ?? ''}`.trim()
              : FEATURES[key].benefitText}
          </li>
        ))}
      </ul>

      {plan.isFree ? (
        <Link
          href="/medical-bill-checker"
          className="btn btn--secondary"
          style={{ marginTop: 'auto' }}
        >
          Start free
        </Link>
      ) : (
        <CheckoutButton
          planSlug={plan.slug}
          planName={plan.displayName}
          variant={plan.slug === 'plus' ? 'primary' : 'secondary'}
        />
      )}
    </article>
  );
}

export default async function PricingPage({
  searchParams,
}: {
  // Next.js 15 passes search params as a promise.
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = (await searchParams) ?? {};
  // Anything other than an explicit CA falls back to US rather than guessing.
  const country: CountryCode = params.country === 'CA' ? 'CA' : 'US';

  return (
    <div className="shell" style={{ paddingTop: '3rem' }}>
      <section>
        <h1>Plans and pricing</h1>
        <p className="lede">
          Every limit below is the limit the software actually enforces. There is no
          feature on this page that the backend does not implement.
        </p>

        <p className="small">
          Showing prices for{' '}
          <strong>{country === 'CA' ? 'Canada (CAD)' : 'the United States (USD)'}</strong>.{' '}
          <Link href={`/pricing?country=${country === 'CA' ? 'US' : 'CA'}`}>
            Show {country === 'CA' ? 'United States (USD)' : 'Canada (CAD)'}
          </Link>
        </p>
      </section>

      <section>
        <div className="plan-grid">
          {ALL_PLANS.map((plan) => (
            <PlanCard key={plan.slug} plan={plan} country={country} />
          ))}
        </div>
      </section>

      <section>
        <h2>Everything, side by side</h2>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">
              Feature comparison across the Free, Essential, Plus and Pro plans
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
                  <th scope="row" style={{ fontWeight: 500 }}>
                    {feature.name}
                    <span className="muted small" style={{ display: 'block' }}>
                      {feature.description}
                    </span>
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
        <h2>The terms, in plain words</h2>
        <div className="two-col">
          <div className="stack">
            <div>
              <h3>Billing</h3>
              <p className="small">
                Plans bill monthly in the currency shown, and renew automatically until
                you cancel. The renewal date and amount are always visible on your
                subscription page.
              </p>
            </div>
            <div>
              <h3>Cancelling</h3>
              <p className="small">
                One click, from your subscription page or the payment portal. Your paid
                features stay active until the end of the period you have already paid
                for. We do not ask you to contact support to cancel.
              </p>
            </div>
            <div>
              <h3>Changing plan</h3>
              <p className="small">
                Upgrades take effect immediately with a prorated charge. Downgrades take
                effect at the end of your current period, so you keep what you paid for.
              </p>
            </div>
          </div>
          <div className="stack">
            <div>
              <h3>If a payment fails</h3>
              <p className="small">
                Your features stay active for a grace period while you update your
                payment method. We will tell you the amount, the date and exactly when
                access would change.
              </p>
            </div>
            <div>
              <h3>Your data</h3>
              <p className="small">
                Downgrading or cancelling never deletes your cases, documents or
                letters. If a lower plan has a shorter document retention window, you
                get 30 days notice and a full list of what is affected before anything
                is removed.
              </p>
            </div>
            <div>
              <h3>Export and deletion</h3>
              <p className="small">
                Available on every plan, including free and expired accounts. These are
                rights, not features, so no plan can switch them off.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <p className="notice notice--accent">
          Prices shown are current for new subscriptions. If we change a price, existing
          subscribers stay on the price they signed up at until we contact them
          directly. Applicable taxes are calculated at checkout and shown before you
          pay.
        </p>
      </section>
    </div>
  );
}
