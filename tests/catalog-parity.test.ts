/**
 * Catalog parity.
 *
 * `src/config/*` seeds the database, and after seeding the database is the
 * operational source of truth. If the two ever disagree, the pricing page shows
 * one thing and the backend enforces another, which is the exact failure the
 * whole entitlement design exists to prevent.
 *
 * This suite parses the seed migration and compares it against the registry.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS, FEATURES, INALIENABLE_FEATURES } from '@/config/features';
import { ALL_PLANS, PLANS, PLAN_SLUGS, priceFor } from '@/config/plans';

const SEED = readFileSync('supabase/migrations/0012_seed_catalog.sql', 'utf8');
const TYPES = readFileSync('supabase/migrations/0001_extensions_and_types.sql', 'utf8');

/** Feature keys as seeded into `public.features`. */
function seededFeatureKeys(): string[] {
  const section = SEED.slice(
    SEED.indexOf('insert into public.features'),
    SEED.indexOf('on conflict (key) do update'),
  );
  return [...section.matchAll(/^\s*\('([A-Z0-9_]+)',/gm)].map((m) => m[1]!);
}

/** Rows of the plan matrix as seeded into `public.plan_features`. */
interface SeedRow {
  plan: string;
  feature: string;
  enabled: boolean;
  limitValue: number | null;
}

function seededPlanFeatures(): SeedRow[] {
  const start = SEED.indexOf('insert into public.plan_features');
  const end = SEED.indexOf('as v(plan_slug, feature_key', start);
  const section = SEED.slice(start, end);

  const rowRe =
    /\('(free|essential|plus|pro)','([A-Z0-9_]+)',\s*(true|false),\s*(null|\d+),/g;

  return [...section.matchAll(rowRe)].map((m) => ({
    plan: m[1]!,
    feature: m[2]!,
    enabled: m[3] === 'true',
    limitValue: m[4] === 'null' ? null : Number(m[4]),
  }));
}

const SEEDED_FEATURES = seededFeatureKeys();
const SEEDED_MATRIX = seededPlanFeatures();

describe('feature registry', () => {
  it('parsed the seed successfully', () => {
    expect(SEEDED_FEATURES.length).toBeGreaterThan(20);
    expect(SEEDED_MATRIX.length).toBeGreaterThan(80);
  });

  it('seeds exactly the features the registry declares', () => {
    expect([...SEEDED_FEATURES].sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it('gives every feature a customer-facing benefit sentence', () => {
    // The pricing page renders this text. A feature with no words cannot be
    // advertised, which is the point.
    for (const key of FEATURE_KEYS) {
      expect(FEATURES[key].benefitText.length, key).toBeGreaterThan(3);
      expect(FEATURES[key].description.length, key).toBeGreaterThan(3);
    }
  });

  it('declares a cost level for every feature, so nothing routes to an expensive model by accident', () => {
    for (const key of FEATURE_KEYS) {
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(FEATURES[key].costLevel);
    }
  });

  it('marks exactly the user rights as inalienable', () => {
    expect([...INALIENABLE_FEATURES].sort()).toEqual(['ACCOUNT_DELETION', 'DATA_EXPORT']);
  });
});

describe('plan matrix', () => {
  it('seeds every plan and feature combination', () => {
    for (const slug of PLAN_SLUGS) {
      for (const key of FEATURE_KEYS) {
        const row = SEEDED_MATRIX.find((r) => r.plan === slug && r.feature === key);
        expect(row, `${slug} / ${key} missing from seed`).toBeDefined();
      }
    }
  });

  it('matches the config registry cell for cell', () => {
    for (const row of SEEDED_MATRIX) {
      const grant = PLANS[row.plan as (typeof PLAN_SLUGS)[number]].features[
        row.feature as (typeof FEATURE_KEYS)[number]
      ];

      expect(grant, `${row.plan} / ${row.feature} missing from config`).toBeDefined();
      expect(grant!.enabled, `${row.plan} / ${row.feature} enabled`).toBe(row.enabled);
      expect(grant!.limitValue ?? null, `${row.plan} / ${row.feature} limit`).toBe(
        row.limitValue,
      );
    }
  });

  it('enables the user rights on every plan in the seed', () => {
    for (const slug of PLAN_SLUGS) {
      for (const key of INALIENABLE_FEATURES) {
        const row = SEEDED_MATRIX.find((r) => r.plan === slug && r.feature === key)!;
        expect(row.enabled, `${slug} / ${key}`).toBe(true);
      }
    }
  });
});

describe('prices', () => {
  it('seeds a price for every plan in both countries', () => {
    for (const slug of PLAN_SLUGS) {
      for (const [country, currency] of [
        ['US', 'USD'],
        ['CA', 'CAD'],
      ] as const) {
        const config = priceFor(slug, country)!;
        expect(config, `${slug} / ${country}`).toBeDefined();
        expect(config.currency).toBe(currency);

        const pattern = new RegExp(
          `\\('${slug}',\\s*'${currency}',\\s*'${country}',\\s*${config.amountCents}\\)`,
        );
        expect(pattern.test(SEED), `${slug} ${country} price not in seed`).toBe(true);
      }
    }
  });

  it('prices Canada in CAD and the US in USD, with no FX conversion', () => {
    // Deliberately separate, chosen numbers rather than a converted rate.
    for (const plan of ALL_PLANS) {
      const us = priceFor(plan.slug, 'US')!;
      const ca = priceFor(plan.slug, 'CA')!;
      expect(us.currency).toBe('USD');
      expect(ca.currency).toBe('CAD');
      if (!plan.isFree) {
        expect(ca.amountCents).not.toBe(us.amountCents);
      }
    }
  });

  it('keeps money as integer minor units everywhere', () => {
    for (const plan of ALL_PLANS) {
      for (const price of plan.prices) {
        expect(Number.isInteger(price.amountCents), plan.slug).toBe(true);
      }
    }
  });

  it('orders plans by tier and price consistently', () => {
    const ordered = [...ALL_PLANS].sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = priceFor(ordered[i - 1]!.slug, 'US')!.amountCents;
      const current = priceFor(ordered[i]!.slug, 'US')!.amountCents;
      expect(current, `${ordered[i]!.slug} costs more than ${ordered[i - 1]!.slug}`)
        .toBeGreaterThan(previous);
    }
  });
});

describe('enum parity with the database', () => {
  it('declares every subscription status the state machine uses', async () => {
    const { SUBSCRIPTION_STATUSES } = await import('@/domain/billing/states');
    const enumBlock = TYPES.slice(
      TYPES.indexOf('create type subscription_status as enum'),
      TYPES.indexOf(');', TYPES.indexOf('create type subscription_status as enum')),
    );

    for (const status of SUBSCRIPTION_STATUSES) {
      expect(enumBlock, `subscription_status missing ${status}`).toContain(`'${status}'`);
    }
  });

  it('declares every feature type the registry uses', async () => {
    const { FEATURE_TYPES } = await import('@/config/features');
    for (const type of FEATURE_TYPES) {
      expect(TYPES).toContain(`'${type}'`);
    }
  });
});

describe('seed safety', () => {
  it('never ships a hardcoded Stripe price id', () => {
    // Price ids are environment-specific and are filled in from the dashboard.
    // A committed one would charge the wrong account.
    expect(SEED).not.toMatch(/price_[A-Za-z0-9]{10,}/);
    expect(SEED).not.toMatch(/prod_[A-Za-z0-9]{10,}/);
  });

  it('seeds every jurisdiction disabled, pending review', () => {
    // A state or province is opened only after its content is reviewed and
    // sourced. The column defaults enforce this; the seed must not override it.
    const jurisdictionInsert = SEED.slice(SEED.indexOf('insert into public.jurisdictions'));
    expect(jurisdictionInsert).not.toMatch(/enabled\s*\)\s*values/);
    expect(jurisdictionInsert).toContain('on conflict (country, region_code) do nothing');
  });

  it('leaves safe mode off and unreviewed subsystems disabled by default', () => {
    expect(SEED).toContain("('safe_mode',            false,");
    expect(SEED).toContain("('ocr_enabled',          false,");
    expect(SEED).toContain("('trials_enabled',       false,");
    // Fail closed: an unconfigured scanner must block extraction.
    expect(SEED).toContain("('malware_scan_required', true,");
  });

  it('keeps the unreviewed appeal template out of circulation', () => {
    // The one template that needs legal review before it is offered.
    const appeal = SEED.slice(SEED.indexOf("'INSURANCE_APPEAL'"));
    expect(appeal).toContain("'DRAFT'");
  });
});
