/**
 * The plan catalog.
 *
 * This is the bootstrap definition that seeds `public.plans`,
 * `public.plan_prices` and `public.plan_features`. After seeding, the database
 * is the operational source of truth: an administrator changes a limit or a
 * price there and enforcement changes immediately, with no deploy.
 *
 * Prices are PLACEHOLDERS pending commercial review. They live here and in the
 * database, and nowhere else. See docs/BILLING.md section 1.
 */

import type { FeatureKey } from './features';

export const PLAN_SLUGS = ['free', 'essential', 'plus', 'pro'] as const;
export type PlanSlug = (typeof PLAN_SLUGS)[number];

export const COUNTRIES = ['US', 'CA'] as const;
export type CountryCode = (typeof COUNTRIES)[number];

export type CurrencyCode = 'USD' | 'CAD';
export type BillingInterval = 'month' | 'year';

export interface PlanPrice {
  readonly country: CountryCode;
  readonly currency: CurrencyCode;
  /** Integer minor units. No float ever touches money. */
  readonly amountCents: number;
  /** Filled in by `npm run paddle:seed -- --apply` before launch. */
  readonly providerPriceIdEnv?: string;
}

export interface PlanFeatureGrant {
  readonly enabled: boolean;
  /** null means unlimited for QUOTA and LIMIT features. */
  readonly limitValue?: number | null;
  readonly limitUnit?: string;
  readonly notes?: string;
}

export interface PlanDefinition {
  readonly slug: PlanSlug;
  readonly version: number;
  readonly displayName: string;
  readonly description: string;
  /** Ordinal used to decide whether a plan change is an upgrade or a downgrade. */
  readonly tier: number;
  readonly isFree: boolean;
  readonly billingInterval: BillingInterval;
  readonly sortOrder: number;
  readonly prices: readonly PlanPrice[];
  readonly features: Readonly<Partial<Record<FeatureKey, PlanFeatureGrant>>>;
}

const on = (): PlanFeatureGrant => ({ enabled: true });
const off = (): PlanFeatureGrant => ({ enabled: false });
const limit = (n: number, unit: string): PlanFeatureGrant => ({
  enabled: true,
  limitValue: n,
  limitUnit: unit,
});

export const PLANS: Readonly<Record<PlanSlug, PlanDefinition>> = {
  free: {
    slug: 'free',
    version: 1,
    displayName: 'Free',
    description:
      'Understand one bill, properly. Real analysis, one case, one letter.',
    tier: 0,
    isFree: true,
    billingInterval: 'month',
    sortOrder: 10,
    prices: [
      { country: 'US', currency: 'USD', amountCents: 0 },
      { country: 'CA', currency: 'CAD', amountCents: 0 },
    ],
    features: {
      DOCUMENT_UPLOAD: on(),
      // The free tier runs the SAME deterministic engine as every paid tier.
      // What a free user gets less of is volume and workflow, never truth.
      BASIC_BILL_ANALYSIS: {
        enabled: true,
        notes: 'Same deterministic engine as every paid tier.',
      },
      ADVANCED_DOCUMENT_ANALYSIS: off(),
      EOB_COMPARISON: {
        enabled: true,
        notes:
          'Basic comparison. Advanced cross-document analysis is a paid feature.',
      },
      LETTER_GENERATION: on(),
      ADVANCED_LETTERS: off(),
      PREMIUM_TEMPLATES: off(),
      CASE_TRACKING: on(),
      MULTIPLE_CASES: off(),
      CASE_TIMELINE: { enabled: true, notes: 'Basic timeline.' },
      REMINDERS: off(),
      DEADLINE_TRACKING: off(),
      ADVANCED_EXPORT: off(),
      HOUSEHOLD_CASES: off(),
      EXTENDED_HISTORY: off(),
      PRIORITY_SUPPORT: off(),
      DATA_EXPORT: { enabled: true, notes: 'A user right. No plan may disable this.' },
      ACCOUNT_DELETION: { enabled: true, notes: 'A user right. No plan may disable this.' },
      MAX_ACTIVE_CASES: limit(1, 'cases'),
      MONTHLY_DOCUMENTS: limit(3, 'documents'),
      MONTHLY_ANALYSES: limit(2, 'analyses'),
      MONTHLY_LETTERS: limit(1, 'letters'),
      MONTHLY_EXPORTS: limit(1, 'exports'),
      MAX_FILE_SIZE_MB: limit(10, 'MB'),
      STORAGE_LIMIT_MB: limit(50, 'MB'),
      RETENTION_DAYS: limit(30, 'days'),
      HOUSEHOLD_MEMBERS: limit(1, 'people'),
    },
  },

  essential: {
    slug: 'essential',
    version: 1,
    displayName: 'Essential',
    description:
      'More room to work: more cases, more uploads, EOB comparison and reminders.',
    tier: 1,
    isFree: false,
    billingInterval: 'month',
    sortOrder: 20,
    prices: [
      {
        country: 'US',
        currency: 'USD',
        amountCents: 999,
        providerPriceIdEnv: 'PADDLE_PRICE_ESSENTIAL_USD',
      },
      {
        country: 'CA',
        currency: 'CAD',
        amountCents: 1299,
        providerPriceIdEnv: 'PADDLE_PRICE_ESSENTIAL_CAD',
      },
    ],
    features: {
      DOCUMENT_UPLOAD: on(),
      BASIC_BILL_ANALYSIS: on(),
      ADVANCED_DOCUMENT_ANALYSIS: on(),
      EOB_COMPARISON: on(),
      LETTER_GENERATION: on(),
      ADVANCED_LETTERS: off(),
      PREMIUM_TEMPLATES: on(),
      CASE_TRACKING: on(),
      MULTIPLE_CASES: on(),
      CASE_TIMELINE: on(),
      REMINDERS: on(),
      DEADLINE_TRACKING: off(),
      ADVANCED_EXPORT: off(),
      HOUSEHOLD_CASES: off(),
      EXTENDED_HISTORY: off(),
      PRIORITY_SUPPORT: off(),
      DATA_EXPORT: on(),
      ACCOUNT_DELETION: on(),
      MAX_ACTIVE_CASES: limit(5, 'cases'),
      MONTHLY_DOCUMENTS: limit(25, 'documents'),
      MONTHLY_ANALYSES: limit(15, 'analyses'),
      MONTHLY_LETTERS: limit(10, 'letters'),
      MONTHLY_EXPORTS: limit(5, 'exports'),
      MAX_FILE_SIZE_MB: limit(20, 'MB'),
      STORAGE_LIMIT_MB: limit(500, 'MB'),
      RETENTION_DAYS: limit(90, 'days'),
      HOUSEHOLD_MEMBERS: limit(1, 'people'),
    },
  },

  plus: {
    slug: 'plus',
    version: 1,
    displayName: 'Plus',
    description:
      'The full workflow: advanced analysis, deadline tracking, exports, longer history.',
    tier: 2,
    isFree: false,
    billingInterval: 'month',
    sortOrder: 30,
    prices: [
      {
        country: 'US',
        currency: 'USD',
        amountCents: 1999,
        providerPriceIdEnv: 'PADDLE_PRICE_PLUS_USD',
      },
      {
        country: 'CA',
        currency: 'CAD',
        amountCents: 2599,
        providerPriceIdEnv: 'PADDLE_PRICE_PLUS_CAD',
      },
    ],
    features: {
      DOCUMENT_UPLOAD: on(),
      BASIC_BILL_ANALYSIS: on(),
      ADVANCED_DOCUMENT_ANALYSIS: on(),
      EOB_COMPARISON: on(),
      LETTER_GENERATION: on(),
      ADVANCED_LETTERS: on(),
      PREMIUM_TEMPLATES: on(),
      CASE_TRACKING: on(),
      MULTIPLE_CASES: on(),
      CASE_TIMELINE: on(),
      REMINDERS: on(),
      DEADLINE_TRACKING: on(),
      ADVANCED_EXPORT: on(),
      HOUSEHOLD_CASES: off(),
      EXTENDED_HISTORY: on(),
      PRIORITY_SUPPORT: off(),
      DATA_EXPORT: on(),
      ACCOUNT_DELETION: on(),
      MAX_ACTIVE_CASES: limit(15, 'cases'),
      MONTHLY_DOCUMENTS: limit(100, 'documents'),
      MONTHLY_ANALYSES: limit(50, 'analyses'),
      MONTHLY_LETTERS: limit(30, 'letters'),
      MONTHLY_EXPORTS: limit(20, 'exports'),
      MAX_FILE_SIZE_MB: limit(25, 'MB'),
      STORAGE_LIMIT_MB: limit(2000, 'MB'),
      RETENTION_DAYS: limit(180, 'days'),
      HOUSEHOLD_MEMBERS: limit(1, 'people'),
    },
  },

  pro: {
    slug: 'pro',
    version: 1,
    displayName: 'Pro',
    description: 'For households and high volume, with priority support.',
    tier: 3,
    isFree: false,
    billingInterval: 'month',
    sortOrder: 40,
    prices: [
      {
        country: 'US',
        currency: 'USD',
        amountCents: 2999,
        providerPriceIdEnv: 'PADDLE_PRICE_PRO_USD',
      },
      {
        country: 'CA',
        currency: 'CAD',
        amountCents: 3999,
        providerPriceIdEnv: 'PADDLE_PRICE_PRO_CAD',
      },
    ],
    features: {
      DOCUMENT_UPLOAD: on(),
      BASIC_BILL_ANALYSIS: on(),
      ADVANCED_DOCUMENT_ANALYSIS: on(),
      EOB_COMPARISON: on(),
      LETTER_GENERATION: on(),
      ADVANCED_LETTERS: on(),
      PREMIUM_TEMPLATES: on(),
      CASE_TRACKING: on(),
      MULTIPLE_CASES: on(),
      CASE_TIMELINE: on(),
      REMINDERS: on(),
      DEADLINE_TRACKING: on(),
      ADVANCED_EXPORT: on(),
      HOUSEHOLD_CASES: on(),
      EXTENDED_HISTORY: on(),
      // Sold only once a staffed queue exists. See docs/LIMITATIONS.md.
      PRIORITY_SUPPORT: {
        enabled: true,
        notes:
          'Published response target. Requires a staffed queue before this is sold.',
      },
      DATA_EXPORT: on(),
      ACCOUNT_DELETION: on(),
      MAX_ACTIVE_CASES: limit(50, 'cases'),
      MONTHLY_DOCUMENTS: limit(300, 'documents'),
      MONTHLY_ANALYSES: limit(150, 'analyses'),
      MONTHLY_LETTERS: limit(90, 'letters'),
      MONTHLY_EXPORTS: limit(60, 'exports'),
      MAX_FILE_SIZE_MB: limit(25, 'MB'),
      STORAGE_LIMIT_MB: limit(5000, 'MB'),
      RETENTION_DAYS: limit(365, 'days'),
      HOUSEHOLD_MEMBERS: limit(6, 'people'),
    },
  },
};

export const ALL_PLANS: readonly PlanDefinition[] = PLAN_SLUGS.map((s) => PLANS[s]);

export function isPlanSlug(value: string): value is PlanSlug {
  return (PLAN_SLUGS as readonly string[]).includes(value);
}

export function getPlan(slug: PlanSlug): PlanDefinition {
  return PLANS[slug];
}

export function priceFor(
  slug: PlanSlug,
  country: CountryCode,
): PlanPrice | undefined {
  return PLANS[slug].prices.find((p) => p.country === country);
}

/**
 * Predicates rather than string comparisons.
 *
 * Call sites outside the entitlement layer ask "is this a paid plan?" instead
 * of `plan === 'free'`, so the notion of a free tier lives in the catalog. A
 * second free tier, or a rename, then changes one place rather than several.
 * `scripts/verify-sql-invariants.mjs` enforces the rule.
 */
export function isFreePlan(slug: PlanSlug): boolean {
  return PLANS[slug].isFree;
}

export function isPaidPlan(slug: PlanSlug): boolean {
  return !PLANS[slug].isFree;
}

/** A free plan needs no checkout session, so asking for one is a client error. */
export function requiresCheckout(slug: PlanSlug): boolean {
  return isPaidPlan(slug);
}

/**
 * Upgrade or downgrade. Used to decide proration and effective timing:
 * upgrades apply immediately, downgrades at period end.
 */
export function comparePlans(from: PlanSlug, to: PlanSlug): -1 | 0 | 1 {
  const a = PLANS[from].tier;
  const b = PLANS[to].tier;
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

export function formatPrice(amountCents: number, currency: CurrencyCode): string {
  const locale = currency === 'CAD' ? 'en-CA' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amountCents / 100);
}
