#!/usr/bin/env node
/**
 * Create the Paddle Products and Prices, and write their ids back into the
 * database.
 *
 *   npm run paddle:seed            # dry run: shows exactly what it would do
 *   npm run paddle:seed -- --apply # actually create them
 *
 * Amounts come from `plan_prices` in Postgres, which is the same table the
 * pricing page renders and the checkout route resolves against. Reading them
 * from there rather than restating them here is what stops Paddle and the
 * application from drifting apart.
 *
 * Idempotent: products and prices are matched on custom_data before anything
 * is created, so re-running adopts what already exists rather than duplicating
 * it.
 *
 * Never prints the API key.
 */

import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const t = line.trim();
  if (t.length === 0 || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[t.slice(0, i).trim()] = v;
}

function require_(key) {
  if (typeof env[key] !== 'string' || env[key].length === 0) {
    console.error(`${key} is not set in .env.local`);
    process.exit(1);
  }
  return env[key];
}

const apiKey = require_('PADDLE_API_KEY');
const supabaseUrl = require_('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
const serviceKey = require_('SUPABASE_SERVICE_ROLE_KEY');
const environment = env.PADDLE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

const PADDLE_BASE =
  environment === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';

// A live key creates real, sellable products. Require it to be said out loud.
if (environment === 'production' && !process.argv.includes('--allow-production')) {
  console.error(
    '\nPADDLE_ENVIRONMENT is "production". This would create real products on your\n' +
      'live Paddle account. Re-run with --allow-production if that is intended.\n',
  );
  process.exit(1);
}

async function paddle(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${PADDLE_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'paddle-version': '1',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(
      `Paddle ${method} ${path}: ${json?.error?.detail ?? json?.error?.code ?? response.status}`,
    );
  }
  return json.data;
}

async function supabase(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${method} ${path}: ${text.slice(0, 200)}`);
  return text.length > 0 ? JSON.parse(text) : null;
}

const money = (cents, currency) =>
  new Intl.NumberFormat(currency === 'CAD' ? 'en-CA' : 'en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);

// ---------------------------------------------------------------------------

console.log(`\nPaddle catalog seed  (${environment}, ${APPLY ? 'APPLY' : 'dry run'})\n`);

const plans = await supabase(
  '/plans?select=id,slug,version,display_name,description,billing_interval,is_free,provider_product_id&active=is.true&order=sort_order',
);
const priceRows = await supabase(
  '/plan_prices?select=id,plan_id,country,currency,amount_cents,tax_behavior,provider_price_id&active=is.true',
);

const paidPlans = plans.filter((p) => !p.is_free);
if (paidPlans.length === 0) {
  console.error('No paid plans found. Apply the migrations first.');
  process.exit(1);
}

const actions = [];
let existingProducts = [];
if (APPLY) {
  existingProducts = (await paddle('/products?per_page=200')) ?? [];
}

for (const plan of paidPlans) {
  let productId = plan.provider_product_id;

  if (productId === null && APPLY) {
    const match = existingProducts.find(
      (p) => p.custom_data?.wintora_plan_slug === plan.slug,
    );
    if (match !== undefined) {
      productId = match.id;
      actions.push({ kind: 'adopt-product', label: plan.slug, id: productId });
      await supabase(`/plans?id=eq.${plan.id}`, {
        method: 'PATCH',
        body: { provider_product_id: productId },
      });
    }
  }

  if (productId === null) {
    if (!APPLY) {
      actions.push({ kind: 'would-create-product', label: plan.slug, id: '(new)' });
    } else {
      const product = await paddle('/products', {
        method: 'POST',
        body: {
          name: `Wintora ${plan.display_name}`,
          description: plan.description,
          tax_category: 'standard',
          custom_data: { wintora_plan_slug: plan.slug, wintora_plan_version: plan.version },
        },
      });
      productId = product.id;
      await supabase(`/plans?id=eq.${plan.id}`, {
        method: 'PATCH',
        body: { provider_product_id: productId },
      });
      actions.push({ kind: 'created-product', label: plan.slug, id: productId });
    }
  }

  for (const row of priceRows.filter((r) => r.plan_id === plan.id)) {
    const label = `${plan.slug} ${row.country}/${row.currency} ${money(row.amount_cents, row.currency)}`;

    if (row.provider_price_id !== null) {
      actions.push({ kind: 'already-set', label, id: row.provider_price_id });
      continue;
    }
    if (!APPLY || productId === null) {
      actions.push({ kind: 'would-create-price', label, id: '(new)' });
      continue;
    }

    const existing = (await paddle(`/prices?product_id=${productId}&per_page=200`)) ?? [];
    const match = existing.find(
      (p) =>
        p.custom_data?.wintora_country === row.country &&
        p.unit_price?.currency_code === row.currency &&
        p.unit_price?.amount === String(row.amount_cents) &&
        p.billing_cycle?.interval === plan.billing_interval,
    );

    let priceId = match?.id ?? null;

    if (priceId === null) {
      const price = await paddle('/prices', {
        method: 'POST',
        body: {
          product_id: productId,
          description: `${plan.display_name} (${row.country})`,
          // Paddle expects the amount as a STRING in minor units.
          unit_price: { amount: String(row.amount_cents), currency_code: row.currency },
          billing_cycle: { interval: plan.billing_interval, frequency: 1 },
          // Paddle is the merchant of record: it calculates and remits tax.
          tax_mode: row.tax_behavior === 'inclusive' ? 'internal' : 'external',
          custom_data: { wintora_plan_slug: plan.slug, wintora_country: row.country },
        },
      });
      priceId = price.id;
      actions.push({ kind: 'created-price', label, id: priceId });
    } else {
      actions.push({ kind: 'adopt-price', label, id: priceId });
    }

    await supabase(`/plan_prices?id=eq.${row.id}`, {
      method: 'PATCH',
      body: { provider_price_id: priceId },
    });
  }
}

for (const a of actions) {
  console.log(`  ${a.kind.padEnd(22)} ${a.label.padEnd(34)} ${a.id}`);
}

if (!APPLY) {
  console.log('\nDry run. Nothing was created. Re-run with --apply to create them.\n');
  process.exit(0);
}

// Verify every paid price resolves, since resolvePriceId throws otherwise.
const after = await supabase(
  '/plan_prices?select=provider_price_id,country,currency,plans!inner(slug,is_free)&active=is.true',
);
const unset = after.filter((r) => r.plans.is_free === false && r.provider_price_id === null);

if (unset.length > 0) {
  console.error(
    `\n${unset.length} paid price(s) still have no provider_price_id. Checkout will refuse for these.\n`,
  );
  process.exit(1);
}

console.log('\nEvery paid plan now resolves to a Paddle price. Checkout can run.');
console.log('Still to do by hand in the Paddle dashboard:');
console.log('  - Notification destination -> /api/webhooks/paddle, then set PADDLE_WEBHOOK_SECRET');
console.log('  - Default payment link under Checkout settings (required for hosted checkout)');
console.log('  - Confirm the statement descriptor matches src/config/disclosures.ts');
console.log('  - Business verification and the medical-bills disclosure with Paddle\n');
