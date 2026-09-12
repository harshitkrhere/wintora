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

## 3. Razorpay

Razorpay is a **payment gateway**, not a Merchant of Record: the operator is the
legal seller of every subscription. See `docs/BILLING.md`. Everything below is
done in the Razorpay dashboard with **test-mode keys** first; a live key should
not exist anywhere until the section 13 matrix in BILLING.md has passed.

1. **KYC and International Payments.** Complete account activation, then
   Account & Settings → International payments → activate **International
   Cards**. Wintora sells only in USD and CAD, so without this no customer can
   pay. Razorpay's documentation restricts international cards to registered
   businesses; expect to need a sole-proprietorship registration (an Udyam
   certificate is free) and to describe the product plainly: consumer software
   about medical bills, no debt collection, no negotiation, no advice, no
   patient payments through the product.
2. **API keys.** Account & Settings → API Keys. Put them in `.env.local`
   (never in the repository):

   | Value | Variable | Shape |
   | --- | --- | --- |
   | Key id | `RAZORPAY_KEY_ID` | `rzp_test_…` / `rzp_live_…` (public) |
   | Key secret | `RAZORPAY_KEY_SECRET` | no fixed prefix (server-only) |
   | Webhook secret | `RAZORPAY_WEBHOOK_SECRET` | whatever you set on the webhook (server-only) |

   Test and live are told apart by the key id prefix. `npm run doctor` warns
   about a live key outside production.
3. **Plans.** Razorpay Plans are created from `plan_prices`, never by hand:

   ```bash
   npm run razorpay:seed            # dry run
   npm run razorpay:seed -- --apply # create them
   ```

   One Plan per (plan, country, currency, interval); ids are written back to
   `plan_prices.provider_price_id`. Until a row has an id, checkout refuses to
   sell it. Amounts come from the database, so Razorpay cannot drift from what
   the backend enforces.
4. **Webhook.** Settings → Webhooks → Add:
   URL `https://<your-deployment>/api/webhooks/razorpay`, a secret of your own
   choosing (copy it into `RAZORPAY_WEBHOOK_SECRET`), and exactly the events
   listed in `docs/BILLING.md` section 5. The endpoint fails closed without
   the secret, so a customer could pay and never receive their plan.
5. **Checkout** needs no dashboard configuration. `/checkout` opens
   checkout.js for the signed-in customer's own pending subscription; there is
   no payment link and no approved-domain step.
6. **Statement descriptor** — confirm against a real test transaction and update
   `src/config/disclosures.ts`. An unrecognised descriptor is one of the
   commonest causes of consumer chargebacks.

Wintora never stores a card number, CVC or PAN. Collection happens entirely in
Razorpay's checkout iframe. The `payments` table keeps brand and last four only.

### Going live

Test and live are separate worlds at Razorpay: separate key pairs, separate
webhooks with separate secrets, and separate Plans. Going live is therefore
three steps, in this order, and only after the manual matrix in
`docs/BILLING.md` section 13 has passed in test mode:

1. Put the **live** key pair in the production secret store (never in the
   repository or `.env.local`). `npm run doctor` warns about a live key
   anywhere outside production.
2. Create a **live-mode webhook** in the dashboard with a new secret, and set
   `RAZORPAY_WEBHOOK_SECRET` in production to that.
3. Re-run `npm run razorpay:seed -- --apply` against production with the live
   keys. The script checks every stored Plan id against the current key,
   reports the test-mode ones as `stale-id`, and recreates them in live mode.
   Until it has run, checkout refuses every paid plan, which is the correct
   failure.

### Local webhook testing

Razorpay cannot reach `localhost`. Either deploy (see 4a, recommended) or tunnel:

```bash
npx cloudflared tunnel --url http://localhost:3000
```

```bash
npm run tunnel -- --apply
```

That reads the hostname from cloudflared's local metrics server, writes
`NEXT_PUBLIC_APP_URL`, and prints the webhook URL to paste into Razorpay. A
quick tunnel gets a **new hostname on every restart**, which is the main
argument for deploying instead.

---

## 4. Environment variables

Every name is documented in `.env.example`. The security-relevant ones:

| Variable | Exposure | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser | Safe only because RLS is enabled and forced |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Bypasses RLS. Treat as the most sensitive value in the system |
| `RAZORPAY_KEY_ID` | Server, and handed to the browser by the checkout page | Public by design; opens a checkout, cannot create one |
| `RAZORPAY_KEY_SECRET` | Server | Authenticates the API and verifies checkout callbacks |
| `RAZORPAY_WEBHOOK_SECRET` | Server | Endpoint fails closed without it |
| `CRON_SECRET` | Server | Cron routes fail closed without it |
| `LOG_HASH_SECRET` | Server | Keys the opaque user reference in logs. Rotating it breaks correlation with older logs, which is the intended trade |
| `SAFE_MODE` | Server | `true` stops document processing while keeping auth, billing and export working |

Production secrets belong in the platform secret store, injected at runtime.
Never in the repository, never in a build argument, never in a log.

### Rotation

| Secret | Procedure |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Rotate in the Supabase dashboard, update the secret store, redeploy. No downtime: the old key stays valid until revoked. |
| `RAZORPAY_KEY_SECRET` | Regenerate the key pair in the dashboard (this changes the key id too), deploy both, then the old pair stops working. Brief window: do it at a quiet hour. |
| `RAZORPAY_WEBHOOK_SECRET` | Add a second webhook with the new secret, deploy, verify events arrive, remove the old webhook. |
| `CRON_SECRET` | Update the scheduler and the application together; a mismatch fails closed, which is safe. |
| `LOG_HASH_SECRET` | Rotate on a schedule. Old logs stop correlating, which is acceptable. |

---

## 4a. Deploying to Vercel

The first deploy is what gives you a stable HTTPS URL, which is what Razorpay
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

RAZORPAY_KEY_ID                  (test key id, rzp_test_…)
RAZORPAY_KEY_SECRET              (test key secret)
RAZORPAY_WEBHOOK_SECRET          (the secret you set on the webhook)

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

Point Razorpay at the deployment and stop using the tunnel:

- Webhook URL → `https://<your-project>.vercel.app/api/webhooks/razorpay`
- Supabase → Authentication → URL Configuration → add the deployment origin to
  Site URL and Redirect URLs, or the auth callback bounces
- Google Cloud → OAuth client → the Supabase callback URL is unchanged, but the
  Supabase redirect allow-list above must include the new origin

### Preview deployments

Every pull request gets its own URL, and `NEXT_PUBLIC_APP_URL` will not match
it. Previews are therefore fine for looking at pages and useless for checkout or
webhooks. That is the correct trade: a preview should not be able to take a
payment. Test billing on the production deployment with Razorpay test-mode
credentials.

### Custom domain, later

Add it under Settings → Domains, update `NEXT_PUBLIC_APP_URL`, and update the
same places above. It is a DNS change and an env var, not a migration, and
Razorpay needs no domain approval for checkout.

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

### 3. Razorpay -> Webhooks

| Field | Value |
| --- | --- |
| URL | `https://www.wintora.online/api/webhooks/razorpay` |
| Secret | copy into `RAZORPAY_WEBHOOK_SECRET` in Vercel |
| Events | the list in `docs/BILLING.md` section 5 |

The secret belongs to the webhook. Creating a new webhook with a new secret and
not deploying it fails signature verification on every delivery: the customer
pays and is never granted the plan. Checkout itself needs no domain approval and
no payment link.

### 4. Razorpay -> nothing else

There is no hosted checkout page and no customer portal to configure. `/checkout`
and `/settings/subscription` are ours.

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
5. `POST /api/webhooks/razorpay` with no signature returns 400 and writes a
   `security_events` row.
6. A test-mode subscription moves the `subscriptions` row and bumps
   `entitlement_versions.version`, first through the verified checkout
   callback and then, as a duplicate, through the webhook.
7. `/billing/success` shows the "finalising" state before either lands, the
   confirmed state after, and sends a signed-out visitor to sign in. It must
   never grant access itself.
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
