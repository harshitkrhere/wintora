# DEPLOYMENT

Order matters here. Several steps fail closed by design, so doing them out of
sequence produces a confusing error rather than a silently broken system.

---

## 1. Local development

```bash
npm install
cp .env.example .env.local     # fill in the values below
npm run gate                   # must pass before anything else
npm run dev
```

`npm run gate` runs the typecheck, the structural invariants, the secret-leak
scan and the tests. It passes on a clean checkout with no services configured,
because the domain layer has no dependency on them.

---

## 2. Supabase

```bash
npm install -g supabase
supabase init
supabase start                 # local Postgres, auth and storage
supabase db reset              # applies supabase/migrations in order
```

Then verify the two things that matter most:

```bash
# Row Level Security isolation. Must pass before any real data exists.
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
```

Check in the dashboard that the `user-documents` bucket is **private**. The
migration creates it that way and re-asserts it on every run, but confirm it as
deployed rather than as written.

For a hosted project:

```bash
supabase link --project-ref <ref>
supabase db push
```

Copy into your environment:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — safe in the browser only because RLS is on
- `SUPABASE_SERVICE_ROLE_KEY` — **server only, bypasses RLS, never in a
  `NEXT_PUBLIC_` name, never in a client bundle**

---

## 3. Paddle

Paddle is a **Merchant of Record**: the legal seller of every subscription. See
`docs/BILLING.md`. Stripe is not used, because it is invite-only in India where
this service is operated from.

Sandbox and live are **separate accounts with separate dashboards and separate
keys**. Develop against `sandbox-vendors.paddle.com`; live credentials will not
authenticate there and vice versa.

Marked `PAYMENT_REVIEW_REQUIRED` in `docs/LIMITATIONS.md`. Until it is done,
`resolvePriceId` throws rather than charging a default amount, which is the
intended behaviour.

1. **Business verification.** Paddle underwrites every seller. Disclose plainly
   that this is consumer software about medical bills, and equally plainly what
   it is not: no debt collection, no negotiation, no legal or medical advice, no
   patient payments, no money moving through the product. Under-describing a
   business is grounds for termination and withheld payouts.

2. **Credentials**, from Developer Tools → Authentication:

   | Value | Env var | Prefix |
   | --- | --- | --- |
   | API key | `PADDLE_API_KEY` | `pdl_sdbx_apikey_` / `pdl_live_apikey_` |
   | Client-side token | `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | `test_` / `live_` |
   | Notification secret | `PADDLE_WEBHOOK_SECRET` | `pdl_ntfset_` |

   The client-side token is public by design, like a publishable key: it can
   open a checkout for a transaction that already exists, and cannot create one
   or change a price.

3. **Products and prices**:

   ```bash
   npm run paddle:seed            # dry run
   npm run paddle:seed -- --apply # create them
   ```

   Creates one Product per paid plan and one Price per currency, then writes the
   ids into `plans.provider_product_id` and `plan_prices.provider_price_id`.
   Amounts come from `plan_prices`, so Paddle cannot drift from what the backend
   enforces. It is idempotent: re-running adopts what already exists.

4. **Default payment link**, under Checkout → Checkout settings:

   ```
   https://<your-deployment>/checkout
   ```

   Paddle Billing has **no fully-hosted checkout**. `transaction.checkout.url` is
   this link with `?_ptxn=<id>` appended, and `/checkout` in this app opens the
   overlay. Without it Paddle returns no checkout URL at all.

5. **Notification destination** → `https://<your-deployment>/api/webhooks/paddle`,
   subscribed to the 13 events in `docs/BILLING.md` section 5. Store its secret
   in `PADDLE_WEBHOOK_SECRET`. The endpoint fails closed without it, so checkout
   would succeed and entitlements would never arrive.

6. **Statement descriptor** — confirm against a real test transaction and update
   `src/config/disclosures.ts`. An unrecognised descriptor is one of the
   commonest causes of consumer chargebacks.

Wintora never stores a card number, CVC or PAN. Collection happens entirely in
Paddle's checkout and portal.

### Local webhook testing

Paddle cannot reach `localhost`. Either deploy (see 4a, recommended) or tunnel:

```bash
npx cloudflared tunnel --url http://localhost:3000
```

```bash
npm run tunnel -- --apply
```

That reads the hostname from cloudflared's local metrics server, writes
`NEXT_PUBLIC_APP_URL`, and prints the two URLs to paste into Paddle. A quick
tunnel gets a **new hostname on every restart**, and three places need updating
each time, which is the main argument for deploying instead.

---

## 4. Environment variables

Every name is documented in `.env.example`. The security-relevant ones:

| Variable | Exposure | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser | Safe only because RLS is enabled and forced |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Bypasses RLS. Treat as the most sensitive value in the system |
| `PADDLE_API_KEY` | Server | Sandbox and live keys are not interchangeable |
| `PADDLE_WEBHOOK_SECRET` | Server | Endpoint fails closed without it |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | Browser | Public by design; opens a checkout, cannot create one |
| `CRON_SECRET` | Server | Cron routes fail closed without it |
| `LOG_HASH_SECRET` | Server | Keys the opaque user reference in logs. Rotating it breaks correlation with older logs, which is the intended trade |
| `SAFE_MODE` | Server | `true` stops document processing while keeping auth, billing and export working |

Production secrets belong in the platform secret store, injected at runtime.
Never in the repository, never in a build argument, never in a log.

### Rotation

| Secret | Procedure |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Rotate in the Supabase dashboard, update the secret store, redeploy. No downtime: the old key stays valid until revoked. |
| `PADDLE_API_KEY` | Create a new key, deploy, then revoke the old one. |
| `PADDLE_WEBHOOK_SECRET` | Add a second notification destination with the new secret, deploy, verify events arrive, remove the old destination. |
| `CRON_SECRET` | Update the scheduler and the application together; a mismatch fails closed, which is safe. |
| `LOG_HASH_SECRET` | Rotate on a schedule. Old logs stop correlating, which is acceptable. |

---

## 4a. Deploying to Vercel

The first deploy is what gives you a stable HTTPS URL, which is what Paddle
webhooks need. A cloudflared quick tunnel works for a single session and gets a
new hostname every restart; a deployment does not.

### Import

1. Push the repository to GitHub.
2. Vercel → Add New → Project → import the repo. Framework detects as Next.js.
3. Do NOT deploy yet. Add the environment variables first, or the build
   succeeds and every request fails at runtime.

### Environment variables

Add these under Settings → Environment Variables. Everything except the
`NEXT_PUBLIC_` names must be marked **not** exposed to the browser.

Required:

```
NEXT_PUBLIC_APP_URL              https://<your-project>.vercel.app
NEXT_PUBLIC_SUPABASE_URL         (same as local)
NEXT_PUBLIC_SUPABASE_ANON_KEY    (same as local)
SUPABASE_SERVICE_ROLE_KEY        (same as local)
SUPABASE_DB_URL                  (same as local)

PAYMENT_PROVIDER                 paddle
PADDLE_ENVIRONMENT               sandbox
PADDLE_API_KEY                   (sandbox key)
PADDLE_WEBHOOK_SECRET            (from the notification destination)
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN  (sandbox client token)

CRON_SECRET                      generate a NEW one, not the local value
LOG_HASH_SECRET                  generate a NEW one, not the local value
```

Generate the two secrets separately for each environment:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Reusing the local values would mean a leak in one environment compromises both,
and `LOG_HASH_SECRET` in particular is what keeps log user references
non-correlatable across environments.

`NEXT_PUBLIC_APP_URL` must match the deployment origin exactly. It is what the
CSRF origin check compares against, so a mismatch produces a 403 on every
state-changing request. The production build has no loopback allowance.

### After the first deploy

Point Paddle at the deployment and stop using the tunnel:

- Notification destination → `https://<your-project>.vercel.app/api/webhooks/paddle`
- Default payment link → `https://<your-project>.vercel.app/checkout`
- Supabase → Authentication → URL Configuration → add the deployment origin to
  Site URL and Redirect URLs, or the auth callback bounces
- Google Cloud → OAuth client → the Supabase callback URL is unchanged, but the
  Supabase redirect allow-list above must include the new origin

### Preview deployments

Every pull request gets its own URL, and `NEXT_PUBLIC_APP_URL` will not match
it. Previews are therefore fine for looking at pages and useless for checkout or
webhooks. That is the correct trade: a preview should not be able to take a
payment. Test billing on the production deployment with sandbox Paddle
credentials.

### Custom domain, later

Add it under Settings → Domains, update `NEXT_PUBLIC_APP_URL`, and update the
same four places above. It is a DNS change and an env var, not a migration.
Paddle **live** requires domain verification, so the domain has to exist before
going live even though sandbox does not need it.

---

## 4b. Domain and URL wiring

Every external service that needs to know where Wintora lives, and the exact
value each one wants.

**Pick the canonical host once and use that exact string everywhere.** Vercel
serves `www.wintora.online` as Production and 308-redirects the apex to it, so
`www` is canonical. Mixing the two is not cosmetic: `NEXT_PUBLIC_APP_URL` is what
the CSRF origin check compares against, so setting the apex while the browser is
on `www` rejects every POST with a bare 403 and no clue why. Sign-in, sign-up and
checkout all fail while the pages render normally.

Substitute your Supabase project ref for `<ref>` (find it in the Supabase
dashboard URL, or as the subdomain of `NEXT_PUBLIC_SUPABASE_URL`).

### 1. DNS, at the registrar

| Action | Type | Name | Value |
| --- | --- | --- | --- |
| Keep | A | `@` | `216.198.79.1` |
| **Delete** | A | `@` | any other IP, e.g. a parking address |
| Keep | CNAME | `www` | `<hash>.vercel-dns-017.com` |
| Leave alone | MX / TXT | `@`, `_dmarc` | mail records are unrelated |

Two A records on the apex is the usual mistake. DNS round-robins between them, so
a share of traffic reaches the old host, and Vercel cannot verify the domain or
issue a certificate while a foreign IP answers for it. The symptom is "Invalid
Configuration" even though the correct record is present.

### 2. Vercel

- **Settings -> Environment Variables:** `NEXT_PUBLIC_APP_URL=https://www.wintora.online`
- **Redeploy afterwards.** `NEXT_PUBLIC_*` is inlined at build time; saving the
  variable changes nothing until a new build runs.
- **Settings -> Domains:** `www.wintora.online` as Production, apex redirecting to it.

### 3. Paddle -> Checkout settings

| Field | Value |
| --- | --- |
| Approved domain | `www.wintora.online` |
| Default payment link | `https://www.wintora.online/checkout` |

`/checkout` is the page that reads `?_ptxn=` and opens the overlay. It is not
`/billing/success`: Paddle appends the transaction reference to the payment link
and sends the customer there **to pay**. Pointing it at the success page shows a
"thank you" for a transaction nobody paid. An unapproved domain fails earlier,
with `transaction_checkout_url_domain_is_not_approved`.

Approval is per domain. Moving from a `.vercel.app` host to a custom domain means
approving the new one before checkout works again.

### 4. Paddle -> Notifications

| Field | Value |
| --- | --- |
| Destination | `https://www.wintora.online/api/webhooks/paddle` |
| Signing secret | copy into `PADDLE_WEBHOOK_SECRET` in Vercel |

The secret belongs to the destination. Creating a new destination issues a new
secret, and a stale one fails signature verification on every delivery: the
customer pays and is never granted the plan.

### 5. Supabase -> Authentication -> URL Configuration

| Field | Value |
| --- | --- |
| Site URL | `https://www.wintora.online` |
| Redirect URLs | `https://www.wintora.online/auth/callback` |
| Redirect URLs | `http://localhost:3000/auth/callback` (keep, for local work) |

`/auth/callback` is where `src/app/api/auth/oauth/route.ts` sends the provider,
as `${appUrl}/auth/callback?next=...`. A redirect URL missing from this allowlist
makes Supabase refuse the exchange after the user has already approved at Google,
which reads as "sign-in does nothing".

### 6. Google Cloud -> APIs & Services -> Credentials -> OAuth 2.0 Client

| Field | Value |
| --- | --- |
| Authorized redirect URI | `https://<ref>.supabase.co/auth/v1/callback` |
| Authorized JavaScript origin | `https://www.wintora.online` |

The redirect URI is **Supabase's**, not the application's. Google returns the code
to Supabase, which exchanges it and then redirects to `/auth/callback`. Entering
the application URL here is the single most common Google OAuth mistake and
produces `redirect_uri_mismatch`.

Then paste the Client ID and Secret into Supabase -> Authentication -> Providers
-> Google, and enable it.

### 7. Local development

`.env.local` keeps `NEXT_PUBLIC_APP_URL=http://localhost:3000`. The origin check
allows loopback in development specifically so this works while the deployed
value differs. Do not point local at the production domain.

### Verifying

```
curl -s -I https://www.wintora.online/ | grep -i script-src
curl -s https://www.wintora.online/sitemap.xml | grep -m1 "<loc>"
curl -s -o /dev/null -w "%{http_code}
" -X POST   -H "content-type: application/json"   -H "Origin: https://www.wintora.online"   -d "{}" https://www.wintora.online/api/auth/signin
```

The sitemap must show the canonical host, not `localhost`. The sign-in POST must
return **400** (bad body, origin accepted) and not **403** (origin rejected).

---

## 5. Scheduled jobs

Both authenticate with `Authorization: Bearer $CRON_SECRET`, compared in
constant time.

| Job | Route | Suggested cadence |
| --- | --- | --- |
| Retention sweep | `POST /api/cron/retention-sweep` | Hourly |
| Billing reconciliation | `POST /api/cron/reconcile-billing` | Every 6 hours |

**Vercel Hobby runs cron jobs at most once per day.** `vercel.json` in this
repository is therefore set to daily schedules, which work on every plan. Daily
is acceptable for both jobs: retention has a 7-day notice window before anything
is deleted, and reconciliation is a safety net rather than a live path. On Pro,
tighten them to hourly and every six hours respectively.

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/retention-sweep", "schedule": "0 3 * * *" },
    { "path": "/api/cron/reconcile-billing", "schedule": "0 4 * * *" }
  ]
}
```

Both process in batches and report `more: true` when there is further work, so a
backlog drains over successive runs rather than timing out.

---

## 6. Deployment gate

```bash
npm run gate && npm run build
```

The gate fails on: a TypeScript error, any test failure, a table without RLS or
an explicit exemption, a table that enables RLS without forcing it, a
plan-string comparison outside the entitlement layer, `dangerouslySetInnerHTML`
anywhere, a domain module importing infrastructure, SQL built by string
interpolation, a server secret referenced from client code, a secret-shaped
`NEXT_PUBLIC_` name, a committed credential, or a committed `.env` file.

`.github/workflows/ci.yml` runs the same command, so the gate cannot be skipped
by deploying from a workstation.

**Before the first production deploy**, confirm each item in
`docs/LIMITATIONS.md` under "Blocking before public launch". Several are legal
and privacy reviews that no amount of engineering discharges.

---

## 7. Post-deploy verification

1. `GET /robots.txt` disallows `/dashboard`, `/settings`, `/billing`, `/api`.
2. `GET /sitemap.xml` lists only reviewed public pages.
3. A private route responds with `X-Robots-Tag: noindex`.
4. Response headers carry the CSP with a nonce, HSTS, and `nosniff`.
5. `POST /api/webhooks/paddle` with no signature returns 400 and writes a
   `security_events` row.
6. A test subscription in the Paddle sandbox moves the `subscriptions` row and
   bumps `entitlement_versions.version`.
7. `/billing/success` shows the "finalising" state before the webhook lands, and
   the confirmed state after. It must never grant access itself.
8. The storage bucket is not publicly listable.
9. `select count(*) from pg_tables t where t.schemaname = 'public' and not exists
   (select 1 from pg_class c where c.relname = t.tablename and c.relrowsecurity)`
   returns 0.

---

## 8. Incident response

Set `SAFE_MODE=true`, or flip the `safe_mode` row in `feature_flags` for an
immediate effect with no deploy. That stops uploads, extraction, AI processing
and letter generation, while authentication, billing, data export and the public
pages keep working. An incident must not become a data-hostage situation.

For a problem confined to one state or province, use the per-jurisdiction
switches (`enabled`, `processing_enabled`, `publishing_enabled`) instead, which
pauses that jurisdiction without stopping the business.

---

## 9. Rollback

Application code rolls back by redeploying the previous build. Migrations are
forward-only: a bad migration is corrected by a new migration, not by reversing
one. Because schema changes are additive first (add nullable, backfill, then
constrain), the previous application version keeps working against the newer
schema, which is what makes an application rollback safe.

Content rolls back from `content_page_versions`, which stores every published
version.
