#!/usr/bin/env node
/**
 * Configuration doctor.
 *
 *   npm run doctor
 *
 * Checks that .env.local is filled in correctly and that the services it points
 * at actually respond. It reports SHAPE and STATUS only: no secret value is ever
 * printed, logged, or returned.
 *
 * The most important check here is that the anon key and the service_role key
 * have not been swapped. Putting a service_role key behind a NEXT_PUBLIC_ name
 * ships a key that bypasses Row Level Security to every browser that loads the
 * site, which defeats the entire database authorization layer at once.
 */

import { existsSync, readFileSync } from 'node:fs';

const ENV_FILE = process.argv[2] ?? '.env.local';

const OK = 'ok  ';
const WARN = 'warn';
const FAIL = 'FAIL';
const SKIP = 'skip';

const results = [];
let failures = 0;

function report(status, label, detail = '') {
  results.push({ status, label, detail });
  if (status === FAIL) failures += 1;
}

// ---------------------------------------------------------------------------
// Load .env.local without evaluating it
// ---------------------------------------------------------------------------

if (!existsSync(ENV_FILE)) {
  console.error(`${ENV_FILE} not found. Copy .env.example and fill it in.`);
  process.exit(1);
}

const env = {};
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

const present = (key) => typeof env[key] === 'string' && env[key].length > 0;

// ---------------------------------------------------------------------------
// Key shape
//
// Supabase issues two generations of keys. Legacy projects use signed JWTs
// carrying a `role` claim; newer ones use opaque sb_publishable_ / sb_secret_
// strings. Both are handled, and both must be distinguishable.
// ---------------------------------------------------------------------------

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Returns 'anon' | 'service_role' | 'unknown', without revealing the key. */
function classifyKey(token) {
  if (token.startsWith('sb_publishable_')) return 'anon';
  if (token.startsWith('sb_secret_')) return 'service_role';

  const payload = decodeJwtPayload(token);
  if (payload === null) return 'unknown';
  if (payload.role === 'anon') return 'anon';
  if (payload.role === 'service_role') return 'service_role';
  return 'unknown';
}

function jwtExpiry(token) {
  const payload = decodeJwtPayload(token);
  if (payload === null || typeof payload.exp !== 'number') return null;
  return new Date(payload.exp * 1000);
}

// --- URL ---

let projectRef = null;

if (!present('NEXT_PUBLIC_SUPABASE_URL')) {
  report(FAIL, 'NEXT_PUBLIC_SUPABASE_URL', 'missing');
} else {
  const raw = env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      report(FAIL, 'NEXT_PUBLIC_SUPABASE_URL', `must be https, got ${url.protocol}`);
    } else {
      const match = /^([a-z0-9]{20})\.supabase\.(co|in)$/.exec(url.hostname);
      projectRef = match?.[1] ?? null;
      // The project ref appears in every request from the browser, so it is not
      // a secret and is safe to display.
      report(
        OK,
        'NEXT_PUBLIC_SUPABASE_URL',
        projectRef !== null ? `project ${projectRef}` : url.origin,
      );
      if (raw.endsWith('/')) {
        report(WARN, 'NEXT_PUBLIC_SUPABASE_URL', 'has a trailing slash; remove it');
      }
    }
  } catch {
    report(FAIL, 'NEXT_PUBLIC_SUPABASE_URL', 'not a valid URL');
  }
}

// --- anon key ---

let anonClass = null;

if (!present('NEXT_PUBLIC_SUPABASE_ANON_KEY')) {
  report(FAIL, 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'missing');
} else {
  anonClass = classifyKey(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (anonClass === 'service_role') {
    report(
      FAIL,
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'this is a SERVICE_ROLE key behind a NEXT_PUBLIC_ name. It bypasses RLS and would ship to every browser. Rotate it and swap the two values.',
    );
  } else if (anonClass === 'unknown') {
    report(WARN, 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'unrecognised key format');
  } else {
    const exp = jwtExpiry(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    report(
      OK,
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      exp === null ? 'anon key' : `anon key, expires ${exp.toISOString().slice(0, 10)}`,
    );
  }
}

// --- service_role key ---

let serviceClass = null;

if (!present('SUPABASE_SERVICE_ROLE_KEY')) {
  report(FAIL, 'SUPABASE_SERVICE_ROLE_KEY', 'missing');
} else {
  serviceClass = classifyKey(env.SUPABASE_SERVICE_ROLE_KEY);
  if (serviceClass === 'anon') {
    report(
      FAIL,
      'SUPABASE_SERVICE_ROLE_KEY',
      'this is an ANON key. Server writes that must bypass RLS will fail.',
    );
  } else if (serviceClass === 'unknown') {
    report(WARN, 'SUPABASE_SERVICE_ROLE_KEY', 'unrecognised key format');
  } else {
    const exp = jwtExpiry(env.SUPABASE_SERVICE_ROLE_KEY);
    report(
      OK,
      'SUPABASE_SERVICE_ROLE_KEY',
      exp === null ? 'service_role key' : `service_role key, expires ${exp.toISOString().slice(0, 10)}`,
    );
  }
}

if (
  anonClass !== null &&
  serviceClass !== null &&
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY === env.SUPABASE_SERVICE_ROLE_KEY
) {
  report(FAIL, 'supabase keys', 'the anon and service_role keys are identical');
}

// --- database URL ---

if (!present('SUPABASE_DB_URL')) {
  report(WARN, 'SUPABASE_DB_URL', 'missing; needed to run migrations and the RLS test');
} else {
  const raw = env.SUPABASE_DB_URL;
  if (!/^postgres(ql)?:\/\//.test(raw)) {
    report(FAIL, 'SUPABASE_DB_URL', 'not a postgres:// connection string');
  } else {
    try {
      const url = new URL(raw);
      const hasPassword = url.password.length > 0;
      const placeholder = /\[?YOUR-PASSWORD\]?|\[?password\]?/i.test(url.password);
      if (!hasPassword) {
        report(FAIL, 'SUPABASE_DB_URL', 'has no password');
      } else if (placeholder) {
        report(FAIL, 'SUPABASE_DB_URL', 'still contains the dashboard placeholder password');
      } else {
        report(OK, 'SUPABASE_DB_URL', `${url.hostname}:${url.port || '5432'}`);
      }
    } catch {
      report(FAIL, 'SUPABASE_DB_URL', 'not parseable');
    }
  }
}

// ---------------------------------------------------------------------------
// Live checks
// ---------------------------------------------------------------------------

async function probe(label, url, key, expectation) {
  try {
    const response = await fetch(url, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    return expectation(response);
  } catch (error) {
    report(FAIL, label, error instanceof Error ? error.name : 'request failed');
    return null;
  }
}

const canProbe =
  present('NEXT_PUBLIC_SUPABASE_URL') &&
  present('NEXT_PUBLIC_SUPABASE_ANON_KEY') &&
  present('SUPABASE_SERVICE_ROLE_KEY') &&
  anonClass !== 'service_role';

if (!canProbe) {
  report(SKIP, 'live checks', 'fix the configuration above first');
} else {
  const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '');

  // Project liveness. Deliberately NOT the /rest/v1/ root: that endpoint
  // answers "Only the service_role API key can be used for this endpoint" to an
  // anon key, so a 401 there means the endpoint is restricted, not that the key
  // is bad. Reading it as a key failure sends people to rotate a working key.
  try {
    const health = await fetch(`${base}/auth/v1/health`, {
      // The health endpoint still requires the apikey header; without it every
      // project looks down.
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(10_000),
    });
    if (health.ok) {
      const body = await health.json().catch(() => ({}));
      report(OK, 'project reachable', body.version ? `auth ${body.version}` : 'auth healthy');
    } else {
      report(FAIL, 'project reachable', `auth endpoint returned HTTP ${health.status}`);
    }
  } catch (error) {
    report(
      FAIL,
      'project reachable',
      error instanceof Error ? error.name : 'request failed',
    );
  }

  // Auth AND schema state in one probe. PostgREST distinguishes them cleanly:
  //   401           -> the key is genuinely rejected
  //   404 PGRST205  -> the key is fine, the table does not exist yet
  //   200           -> both fine
  await probe(
    'anon key accepted',
    `${base}/rest/v1/plans?select=slug&limit=10`,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    async (r) => {
      if (r.status === 401) {
        report(FAIL, 'anon key accepted', 'rejected by this project; wrong project or rotated key');
        return;
      }
      report(OK, 'anon key accepted', 'authenticates against PostgREST');

      if (r.status === 404 || r.status === 400) {
        report(WARN, 'migrations applied', 'table "plans" not found; apply the migrations');
      } else if (r.ok) {
        const rows = await r.json();
        report(
          rows.length >= 4 ? OK : WARN,
          'migrations applied',
          `${rows.length} plan(s) seeded`,
        );
      } else {
        report(WARN, 'migrations applied', `HTTP ${r.status}`);
      }
    },
  );

  // The one that actually proves RLS is doing its job: an internal table must
  // be invisible to the anon key.
  await probe(
    'RLS blocks anon',
    `${base}/rest/v1/webhook_events?select=id&limit=1`,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    async (r) => {
      if (r.status === 404 || r.status === 400) {
        report(SKIP, 'RLS blocks anon', 'migrations not applied yet');
        return;
      }
      if (!r.ok) {
        report(OK, 'RLS blocks anon', `internal table refused (HTTP ${r.status})`);
        return;
      }
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length === 0) {
        report(OK, 'RLS blocks anon', 'internal table returns no rows');
      } else {
        report(
          FAIL,
          'RLS blocks anon',
          'webhook_events is READABLE with the anon key. RLS is not protecting internal tables.',
        );
      }
    },
  );

  // And the service_role key must be able to see what anon cannot.
  await probe(
    'service_role bypasses RLS',
    `${base}/rest/v1/webhook_events?select=id&limit=1`,
    env.SUPABASE_SERVICE_ROLE_KEY,
    (r) => {
      if (r.status === 404 || r.status === 400) {
        report(SKIP, 'service_role bypasses RLS', 'migrations not applied yet');
      } else if (r.ok) {
        report(OK, 'service_role bypasses RLS', 'internal table reachable server-side');
      } else if (r.status === 401) {
        report(FAIL, 'service_role bypasses RLS', 'service_role key rejected');
      } else {
        report(WARN, 'service_role bypasses RLS', `HTTP ${r.status}`);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// App URL
//
// A documentation placeholder here produces a 403 on every state-changing
// request, because the CSRF origin check compares against it. That failure
// looks like a permissions bug and is a configuration typo.
// ---------------------------------------------------------------------------

const PLACEHOLDER_APP_HOSTS = [
  'something.trycloudflare.com',
  'example.com',
  'yourdomain.com',
  'your-domain.com',
];

if (!present('NEXT_PUBLIC_APP_URL')) {
  report(FAIL, 'NEXT_PUBLIC_APP_URL', 'missing');
} else {
  try {
    const url = new URL(env.NEXT_PUBLIC_APP_URL);
    if (PLACEHOLDER_APP_HOSTS.includes(url.hostname)) {
      report(
        FAIL,
        'NEXT_PUBLIC_APP_URL',
        `still a documentation placeholder (${url.hostname}). Run: npm run tunnel -- --apply`,
      );
    } else {
      report(OK, 'NEXT_PUBLIC_APP_URL', url.origin);
    }
  } catch {
    report(FAIL, 'NEXT_PUBLIC_APP_URL', 'not a valid URL');
  }
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

if (present('RAZORPAY_KEY_ID')) {
  const keyId = env.RAZORPAY_KEY_ID;
  const isLive = keyId.startsWith('rzp_live_');
  const isTest = keyId.startsWith('rzp_test_');

  if (!isLive && !isTest) {
    report(FAIL, 'RAZORPAY_KEY_ID', 'does not look like a Razorpay key id (rzp_test_… or rzp_live_…)');
  } else if (isLive && env.NODE_ENV !== 'production') {
    // A live key outside production charges real cards from a developer's laptop.
    report(WARN, 'RAZORPAY_KEY_ID', 'LIVE key in a non-production environment');
  } else {
    report(OK, 'RAZORPAY_KEY_ID', isLive ? 'live key' : 'test key');
  }

  if (!present('RAZORPAY_KEY_SECRET')) {
    report(FAIL, 'RAZORPAY_KEY_SECRET', 'missing: the API cannot be called and checkout callbacks cannot be verified');
  } else {
    report(OK, 'RAZORPAY_KEY_SECRET', 'set');
  }

  if (!present('RAZORPAY_WEBHOOK_SECRET')) {
    report(
      FAIL,
      'RAZORPAY_WEBHOOK_SECRET',
      'missing: the webhook endpoint fails closed, so a customer could pay and never receive their plan',
    );
  } else {
    report(OK, 'RAZORPAY_WEBHOOK_SECRET', 'set');
  }
}

// ---------------------------------------------------------------------------
// Not-yet-configured subsystems, reported as information rather than failure
// ---------------------------------------------------------------------------

const OPTIONAL = [
  ['RAZORPAY_KEY_ID', 'checkout and plan changes are unavailable'],
  ['RAZORPAY_KEY_SECRET', 'checkout and plan changes are unavailable'],
  ['RAZORPAY_WEBHOOK_SECRET', 'the webhook endpoint fails closed, so entitlements never arrive'],
  ['NEXT_PUBLIC_APP_URL', 'checkout redirects and canonical URLs will be wrong'],
  ['CRON_SECRET', 'scheduled jobs fail closed'],
  ['LOG_HASH_SECRET', 'IP hashes fall back to a known development salt'],
  ['OPENROUTER_API_KEY', 'findings use their deterministic wording (fully correct)'],
  ['MALWARE_SCAN_API_KEY', 'document upload stays blocked by design'],
];

const pending = OPTIONAL.filter(([key]) => !present(key));

// ---------------------------------------------------------------------------

console.log(`\nConfiguration doctor  (${ENV_FILE})\n`);
for (const { status, label, detail } of results) {
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ''}`);
}

if (pending.length > 0) {
  console.log('\nNot configured yet:');
  for (const [key, consequence] of pending) {
    console.log(`  - ${key}: ${consequence}`);
  }
}

console.log(
  failures === 0
    ? '\nNo blocking problems. No secret value was printed.\n'
    : `\n${failures} blocking problem(s). No secret value was printed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
