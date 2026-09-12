#!/usr/bin/env node
/**
 * Create the Razorpay Plans, and write their ids back into the database.
 *
 *   npm run razorpay:seed            # dry run: shows exactly what it would do
 *   npm run razorpay:seed -- --apply # actually create them
 *
 * Amounts come from `plan_prices` in Postgres, which is the same table the
 * pricing page is checked against and the checkout route resolves against.
 * Reading them from there rather than restating them here is what stops
 * Razorpay and the application from drifting apart.
 *
 * One Razorpay Plan per price row: (plan, country, currency, interval). Razorpay
 * plans are immutable, so a price change means a new Razorpay plan and a new
 * id, which is exactly what grandfathering needs.
 *
 * Idempotent: an existing Razorpay plan is matched on its notes and adopted
 * rather than duplicated. Nothing is ever deleted.
 *
 * Mode-aware: test and live are separate worlds at Razorpay. A stored plan id
 * that the current key cannot see (because it was created in the other mode)
 * is treated as unset and recreated, so going live is: swap the keys, create
 * the live-mode webhook, re-run this script.
 *
 * Never prints the key secret.
 */

import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

// Read .env.local without printing anything from it.
const env = { ...process.env };
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  // No .env.local: rely on the process environment.
}

const need = (name) => {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    console.error(`Missing ${name}. Set it in .env.local.`);
    process.exit(1);
  }
  return value.trim();
};

const KEY_ID = need('RAZORPAY_KEY_ID');
const KEY_SECRET = need('RAZORPAY_KEY_SECRET');
const SUPABASE_URL = need('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_ROLE = need('SUPABASE_SERVICE_ROLE_KEY');

const mode = KEY_ID.startsWith('rzp_live_') ? 'LIVE' : 'TEST';
console.log(`\nRazorpay ${mode} mode (${KEY_ID.slice(0, 12)}…). ${APPLY ? 'APPLYING.' : 'Dry run.'}\n`);

const authorization = `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`;

async function razorpay(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { authorization, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Razorpay ${method} ${path} -> ${response.status}: ${json.error?.description ?? 'error'}`,
    );
  }
  return json;
}

async function supabase(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE,
      authorization: `Bearer ${SERVICE_ROLE}`,
      'content-type': 'application/json',
      prefer: method === 'PATCH' ? 'return=minimal' : 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Supabase ${method} ${path} -> ${response.status}: ${await response.text()}`);
  }
  return method === 'PATCH' ? null : response.json();
}

const money = (cents, currency) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

/** Can the current key see this Plan? Razorpay answers a foreign id with 400. */
async function planExists(planId) {
  try {
    await razorpay(`/plans/${encodeURIComponent(planId)}`);
    return true;
  } catch (error) {
    const message = String(error?.message ?? '').toLowerCase();
    if (message.includes('does not exist') || message.includes('not found') || message.includes('-> 400')) {
      return false;
    }
    // Auth failure, network error: do not guess. Stop rather than recreate.
    throw error;
  }
}

const PERIOD = { month: 'monthly', year: 'yearly' };

// ---------------------------------------------------------------------------

const plans = await supabase(
  '/plans?select=id,slug,display_name,description,is_free&active=is.true&order=sort_order',
);
const priceRows = await supabase(
  '/plan_prices?select=id,plan_id,country,currency,interval,amount_cents,provider_price_id&active=is.true',
);

const paidPlans = plans.filter((p) => p.is_free === false);

// Existing Razorpay plans, matched on our notes rather than on amount alone, so
// a plan created by hand in the dashboard is never mistaken for ours.
let existing = [];
if (APPLY) {
  const page = await razorpay('/plans?count=100');
  existing = page.items ?? [];
}

const actions = [];

for (const plan of paidPlans) {
  for (const row of priceRows.filter((r) => r.plan_id === plan.id)) {
    const label = `${plan.slug} ${row.country}/${row.currency} ${money(row.amount_cents, row.currency)}/${row.interval}`;

    if (row.provider_price_id !== null) {
      // Test and live are separate worlds at Razorpay: a Plan created with a
      // test key does not exist under a live key, and vice versa. A stored id
      // is therefore trusted only if the CURRENT key can see it. Otherwise it
      // is a leftover from the other mode and is recreated, so switching modes
      // is "swap the keys and re-run", not a manual SQL step.
      if (await planExists(row.provider_price_id)) {
        actions.push({ kind: 'already-set', label, id: row.provider_price_id });
        continue;
      }
      actions.push({
        kind: APPLY ? 'stale-id' : 'stale-id (would recreate)',
        label,
        id: `${row.provider_price_id} not visible in ${mode} mode`,
      });
      if (!APPLY) continue;
    } else if (!APPLY) {
      actions.push({ kind: 'would-create', label, id: '(new)' });
      continue;
    }

    const match = existing.find(
      (p) =>
        p.notes?.wintora_plan_slug === plan.slug &&
        p.notes?.wintora_country === row.country &&
        p.notes?.wintora_interval === row.interval &&
        p.item?.currency === row.currency &&
        Number(p.item?.amount) === Number(row.amount_cents) &&
        p.period === PERIOD[row.interval] &&
        Number(p.interval) === 1,
    );

    let planId = match?.id ?? null;

    if (planId === null) {
      let created;
      try {
        created = await razorpay('/plans', {
          method: 'POST',
          body: {
            period: PERIOD[row.interval],
            interval: 1,
            item: {
              name: `Wintora ${plan.display_name} (${row.country}, ${row.interval}ly)`,
              // Integer subunits, exactly as stored. No float ever touches money.
              amount: row.amount_cents,
              currency: row.currency,
              description: plan.description,
            },
            notes: {
              wintora_plan_slug: plan.slug,
              wintora_country: row.country,
              wintora_interval: row.interval,
              wintora_currency: row.currency,
            },
          },
        });
      } catch (error) {
        const message = String(error?.message ?? '');
        if (/currency provided is not supported/i.test(message)) {
          // The account only accepts INR. Every Wintora price is USD or CAD, so
          // every remaining row would fail the same way; say why, once, and
          // leave the database untouched (nothing has been written for this
          // row, and the script is re-runnable).
          for (const a of actions) console.log(`  ${a.kind.padEnd(12)} ${a.label.padEnd(44)} ${a.id}`);
          console.error(
            `\nRazorpay refused ${row.currency} for "${label}": this account is not enabled for\n` +
              'international currencies, so it can only create INR plans today.\n\n' +
              '  Wintora sells only in USD and CAD. To create these plans:\n' +
              '    1. Razorpay dashboard -> Account & Settings -> International Payments (or\n' +
              '       Payment Methods -> International) and enable it. In test mode this may\n' +
              '       be a toggle; for live it requires account activation (KYC).\n' +
              '    2. Razorpay documents that INDIVIDUALS cannot accept international cards,\n' +
              '       only PayPal or international bank transfer. Card subscriptions from US\n' +
              '       and Canadian customers therefore need at least a sole-proprietorship\n' +
              '       registration (an Udyam certificate is free) on the account.\n' +
              '    3. Re-run this script. It resumes where it stopped.\n\n' +
              '  See docs/LIMITATIONS.md, PAYMENT_REVIEW_REQUIRED -> International Payments activation.\n',
          );
          process.exit(1);
        }
        throw error;
      }
      planId = created.id;
      actions.push({ kind: 'created', label, id: planId });
    } else {
      actions.push({ kind: 'adopted', label, id: planId });
    }

    await supabase(`/plan_prices?id=eq.${row.id}`, {
      method: 'PATCH',
      body: { provider_price_id: planId },
    });
  }
}

for (const a of actions) {
  console.log(`  ${a.kind.padEnd(12)} ${a.label.padEnd(44)} ${a.id}`);
}

const after = await supabase(
  '/plan_prices?select=provider_price_id,country,currency,interval,plans!inner(slug,is_free)&active=is.true',
);
const unset = after.filter((r) => r.plans.is_free === false && r.provider_price_id === null);

if (unset.length > 0) {
  console.log(
    `\n${unset.length} paid price(s) still have no provider_price_id. Checkout will refuse for these.` +
      (APPLY ? '' : ' Re-run with --apply to create them.') +
      '\n',
  );
} else {
  console.log('\nEvery paid price has a Razorpay plan id. Checkout can resolve every offer.\n');
}

console.log('Webhook: in the Razorpay dashboard, point a webhook at');
console.log(`  ${(env.NEXT_PUBLIC_APP_URL ?? 'https://<your-deployment>').replace(/\/$/, '')}/api/webhooks/razorpay`);
console.log('with the secret from RAZORPAY_WEBHOOK_SECRET and these events enabled:');
console.log(
  '  subscription.authenticated, subscription.activated, subscription.charged,\n' +
    '  subscription.pending, subscription.halted, subscription.updated,\n' +
    '  subscription.cancelled, subscription.completed, subscription.paused,\n' +
    '  subscription.resumed, invoice.paid, refund.created, refund.processed,\n' +
    '  payment.dispute.created\n',
);
