# Checkout chain audit

Findings from a 7-dimension audit of the Paddle checkout to entitlement
chain, each put to two independent adversarial verifiers. The run was stopped
early to conserve usage, so some findings carry no verdict.

- CONFIRMED: neither verifier could refute it.
- REFUTED: at least one verifier refuted it. Treat as probably not a defect.
- UNVERIFIED: the verifiers were stopped before reaching it. Judge it yourself.

`billing_provider` missing `paddle` (the first CRITICAL) was fixed in
migration `0014_billing_provider_paddle.sql` and verified against the live database.

**Superseded in large part by the move to Razorpay** (migrations 0017 and
0018, `docs/BILLING.md`). Paddle has been removed entirely, so every finding
about Paddle's checkout URL, default payment link, domain approval, client
token, `_ptxn` handling, `effective_from`, or `PADDLE_*` configuration is
moot. The Razorpay integration was built with these findings in hand and
closes the structural ones regardless of provider:

- **Checkout has a server-side record.** The provider subscription is created
  and written as `CHECKOUT_PENDING` before the browser sees it; a second click
  reuses it inside the checkout window, so `attemptKey` is no longer the only
  dedupe. `/checkout` opens only the signed-in user's own pending subscription.
- **A failed webhook can be retried.** A redelivery of an event whose handler
  failed reopens the claim instead of being swallowed as a duplicate.
- **Deferred downgrades are real.** Razorpay's `schedule_change_at: cycle_end`
  holds the change; `pending_plan_id` is set for display and cleared when the
  provider reports the new plan.
- **The success page** sends signed-out visitors to sign in, shows "finalising"
  only when a checkout this user started is actually in flight, and the
  verified callback activates the subscription without waiting for the webhook.
- **Plan changes are refused** while a renewal is outstanding, while paused,
  and once a cancellation is scheduled, with a plain message each time.
- **Sync errors are raised**, not discarded; a rejected subscriptions write
  fails the event so the provider retries it.
- **Refunds and disputes** are attributed through the `payments` table, which
  is now populated from every charge.
- **A provider outage** is counted separately by reconciliation rather than
  recorded as a thousand missing subscriptions.

Still open, and provider-independent: no automated reconciliation path for a
subscription the provider has and we do not; `pending_plan_id` is cleared only
when a webhook reports the new plan, so a cancelled scheduled change would leave
a stale notice until reconciliation; and nothing has run against real
credentials in test mode yet.

Addressed alongside the pricing restructure (migrations 0015 and 0016,
`docs/PRICING.md`):

- **profiles.country never populated from sign-up** (CRITICAL unverified / HIGH
  confirmed): the profile trigger now reads the sign-up country from auth
  metadata, and existing profiles are repaired (`0016`).
- **Price shown and price charged keyed on different countries** (HIGH
  unverified): `/pricing` and `/api/billing/checkout` both resolve a signed-in
  customer's country through `billingCountry()`; the URL cannot override it for
  a customer. `formatPrice` now renders CAD as `CA$25.99`, so the two currencies
  are no longer visually identical. The displayed amount still comes from
  `src/config/plans.ts` rather than the database; `tests/catalog-parity.test.ts`
  asserts the two match the seed.
- **An unresolvable Paddle price silently writes an ACTIVE subscription on the
  FREE plan** (HIGH unverified, twice): `syncSubscription` now throws when a
  live subscription's price id is not in `plan_prices`, so the event fails
  visibly instead of recording a paying customer on Free-tier quotas. The
  separate finding that a failed handler is never retried still stands.
- **Six `PADDLE_PRICE_*` names are dead config** (MEDIUM confirmed): removed
  from `.env.example` and from `PlanPrice`.

Everything else in this document remains open unless a later note says
otherwise. In particular the downgrade findings (`effective_from` is not a
Paddle field; `pending_plan_id` is never cleared) apply equally to the new
yearly-to-monthly downgrade path.

| severity | confirmed | refuted | unverified |
|---|---|---|---|
| CRITICAL | 6 | 0 | 6 |
| HIGH | 12 | 0 | 11 |
| MEDIUM | 9 | 6 | 4 |
| LOW | 3 | 3 | 3 |

---

## [CRITICAL] CONFIRMED — checkout.url is set to the success URL: either no customer can pay, or every customer is told their payment succeeded without paying

`src/lib/payments/paddle/adapter.ts:380`

**Defect.** The transaction body sets `checkout: { url: request.successUrl }`. Paddle treats checkout.url as the page that HOSTS the checkout and returns it with `?_ptxn=<txn_id>` appended; it is not a post-payment redirect. The value passed is `${appUrl}/billing/success` (route.ts:141), a page that ignores _ptxn, never loads Paddle.js, and renders a payment confirmation. The app's real checkout host is `/checkout` (src/app/checkout/page.tsx reads _ptxn, PaddleCheckout.tsx calls Paddle.Checkout.open), which is also what scripts/tunnel-url.mjs:61 prints as the value for Paddle's default payment link.

**How it fails.** Regime A, today: the domain is not on Paddle's approved list, Paddle returns HTTP 400 transaction_checkout_url_domain_is_not_approved, api() throws PROVIDER_ERROR, and CheckoutButton shows "We could not reach the service." Every paid signup fails; revenue is zero and the adapter's own targeted BILLING_ERROR text about the default payment link never fires, so the operator is pointed at the wrong cause. Regime B, after the operator adds the vercel.app domain to approved domains (the stated next step): the call returns 201 with checkout.url = https://<app>/billing/success?_ptxn=txn_xxx. CheckoutButton does window.location.href = that URL. The customer lands on /billing/success, which ignores _ptxn, finds no paid plan, and renders "Your payment went through. We are waiting for confirmation from our payment provider..." with <meta http-equiv="refresh" content="4"> — forever. No payment form is ever shown, no money is collected, no webhook will ever arrive, and the customer has been told in plain English that they paid. Support then has no record either (see the transaction-id finding).

**Fix.** Minimal and sufficient: delete the `checkout` key from the request body. Measurement already confirms omitting it returns 201 with a working URL built from the default payment link, and that link is meant to be ${APP_URL}/checkout. No change to CheckoutRequest is needed for this fix. A new port field is only required if the hosting URL must be per-request rather than per-dashboard (e.g. rotating preview deployments) — and it buys little, because Paddle requires any explicitly-passed domain to be on the approved list anyway. If you do want it explicit, add `readonly checkoutUrl: string` to CheckoutRequest, set it in route.ts to `${appUrl}/checkout`, pass it as `checkout: { url: request.checkoutUrl }`, and add that origin to Paddle's approved domains. Never pass successUrl there. Separately, fix the dead default payment link (currently the expired trycloudflare tunnel) before going live, since with checkout.url omitted it becomes the single source of the checkout host.


## [CRITICAL] CONFIRMED — billing_provider enum has no 'paddle' value: every webhook 500s and nothing is ever recorded

`supabase/migrations/0001_extensions_and_types.sql:18`

**Defect.** The Postgres enum `billing_provider` is created as ('stripe', 'apple', 'google'). No migration ever adds 'paddle'. Every billing write in the money path sends provider = 'paddle': webhook_events (handlers.ts:38), subscriptions (handlers.ts:206), billing_customers (index.ts:148), invoices (handlers.ts:405), refunds (handlers.ts:451). I confirmed against the live Supabase project that the enum still has exactly three values and that filtering on 'paddle' returns HTTP 400 `{"code":"22P02","message":"invalid input value for enum billing_provider: \"paddle\""}`. The webhook_events insert in claim() therefore fails with code 22P02, which is not 23505, so handlers.ts:50 throws. That throw happens at webhook.ts:87, which is OUTSIDE the try block that wraps only the handler dispatch (webhook.ts:120), and route.ts:71 does not wrap processWebhookEvent in try/catch — so the request dies as an unhandled rejection and Next returns 500. No webhook_events row, no subscriptions row, no security_events row, no billing_reconciliations row, no entitlements. Paddle retries, fails identically, and gives up. The live subscriptions, webhook_events and billing_customers tables are all empty, which is exactly what this predicts.

**How it fails.** A customer completes checkout for Plus/USD and is charged by Paddle (Paddle is Merchant of Record, so the money is taken). Paddle POSTs subscription.created. Signature verification passes. createWebhookStore.claim() inserts provider:'paddle' into webhook_events -> 400 / 22P02 -> throw 'webhook claim failed: 22P02' -> 500. Paddle retries and exhausts. The customer has paid, holds free-plan entitlements, and /billing/success (src/app/billing/success/page.tsx:49-68) sits on 'Finalising your subscription' refreshing every 4 seconds forever. Clicking 'Manage billing' also fails: src/app/api/billing/portal/route.ts:34 filters billing_customers on provider='paddle', gets a 400 with the error discarded, and the route tells the paying customer 'You do not have a billing account yet' — a false statement. There is no record anywhere in the database that the payment happened.

**Fix.** Add a migration: `alter type public.billing_provider add value if not exists 'paddle';` (and change the column defaults from 'stripe' to 'paddle' to match docs/DATABASE.md:184, which already documents the default as 'paddle'). Also wrap the processWebhookEvent call in route.ts in try/catch so an infrastructure failure writes a security_events row and returns a controlled 500 instead of an unhandled throw, and add a startup/doctor assertion that every PAYMENT_PROVIDER value is a member of the billing_provider enum.


## [CRITICAL] CONFIRMED — Paddle webhook notification destination points at a dead Cloudflare tunnel, so no entitlement-granting event can ever arrive

`src/app/api/webhooks/paddle/route.ts:27`

**Defect.** The live Paddle sandbox notification setting named 'webhook' is active:true with destination https://upgrading-attempted-migration-loved.trycloudflare.com/api/webhooks/paddle — the same dead ephemeral trycloudflare host already established for the payment link. It is subscribed to the right events (subscription.created, subscription.activated, subscription.updated, subscription.canceled/paused/resumed/past_due, transaction.completed/paid/billed/payment_failed, adjustment.created are all present), so the subscription list is not the problem; the destination host is. Since the signed webhook is the only inbound path that changes subscription state (route.ts header comment, and docs/BILLING.md section 4 step 5), a dead destination means the grant never happens for anyone. This is independent of Finding 1: fixing the enum changes nothing while deliveries go to a host that no longer exists.

**How it fails.** Customer pays. Paddle attempts delivery to the trycloudflare host, which no longer resolves/serves. All retries fail. No event ever reaches /api/webhooks/paddle, so no subscriptions row is written and entitlements stay on the free plan. The customer is charged and receives nothing, and because nothing reached the app there is not even a FAILED webhook_events row to alert on.

**Fix.** Repoint the notification destination at the stable deployment origin (the vercel.app host, later wintora.online) as https://<host>/api/webhooks/paddle, rotate PADDLE_WEBHOOK_SECRET to the new destination's secret, and set NEXT_PUBLIC_APP_URL to the same origin. Add the destination URL to scripts/doctor.mjs as a live assertion (fetch /notification-settings and fail if the destination host does not match NEXT_PUBLIC_APP_URL) so an ephemeral tunnel can never be the configured destination again.


## [CRITICAL] UNVERIFIED — A webhook that fails mid-handler can never be retried: the idempotency claim is taken before dispatch and never released

`src/lib/payments/webhook.ts:87`

**Defect.** processWebhookEvent claims (inserts) the event row BEFORE dispatching the handler, and on handler failure calls markFailed — which sets status='FAILED' but leaves the row in place. The route then returns 500 specifically so Paddle will retry (route.ts:88-92). But every retry re-enters claim(), hits the unique (provider, event_id) constraint, returns 'DUPLICATE', and returns 200 having applied nothing (webhook.ts:95-97). Retries are therefore a guaranteed no-op, not a recovery. The handler is also not atomic: syncSubscription writes the subscriptions row (handlers.ts:226/228) and only then calls recomputeEntitlements (handlers.ts:232), which throws on any upsert error (stores.ts:394-396). So a partial application is permanent. Nothing in the repo reprocesses FAILED webhook_events rows — I grepped; webhook_events is only touched by handlers.ts and the RLS migration. The code comments ('The idempotency claim in step 3 is what makes that retry safe', route.ts:88-89; docs/BILLING.md section 5) assert the opposite of what the code does.

**How it fails.** subscription.created arrives. claim() succeeds. syncSubscription writes the subscriptions row with status ACTIVE. recomputeEntitlements then fails transiently (a Supabase timeout, or the bump_entitlement_version RPC erroring) and throws. markFailed marks the event FAILED; the route returns 500; Paddle retries. Every retry returns DUPLICATE/200 and does nothing. Final state: the customer is charged, subscriptions says ACTIVE on the paid plan, but user_entitlements still holds free-plan rows and entitlement_versions was never bumped — so every feature check (src/domain/entitlements/check.ts reading user_entitlements) denies the paid features indefinitely. Symmetrically, a transient failure before the subscription write leaves no subscription at all, also permanently.

**Fix.** Make the claim releasable: on handler failure, delete the webhook_events row (or mark it FAILED and have claim() treat a FAILED row as re-claimable rather than DUPLICATE) so the provider's retry actually re-runs the handler — the handler body is already idempotent (recomputeEntitlements is declared idempotent, and the subscription write is an upsert on provider_subscription_id). Additionally add a sweeper cron that re-dispatches webhook_events rows left in FAILED or RECEIVED status for more than a few minutes, and alert on any such row, since Paddle's retry budget is finite.


## [CRITICAL] UNVERIFIED — billing_provider enum has no 'paddle' value: every write in the Paddle money path is rejected by Postgres, so a paying customer is never granted their plan

`supabase/migrations/0001_extensions_and_types.sql:18`

**Defect.** The billing_provider enum is declared as ('stripe','apple','google'). No migration ever adds 'paddle'. Every provider column in the billing schema uses this type (supabase/migrations/0003_catalog.sql:43, 0004_billing.sql:11,31,130,160,192,216), while src/lib/env.ts:39 pins PAYMENT_PROVIDER to the literal 'paddle' and the adapter reports name:'paddle'. Every insert and every filter that carries the string 'paddle' is therefore rejected by Postgres with SQLSTATE 22P02. I confirmed this against the live database, not by inference.

**How it fails.** A customer completes payment on Paddle. Paddle POSTs subscription.created to /api/webhooks/paddle. The signature verifies. processWebhookEvent calls store.claim(), which inserts into webhook_events with provider:'paddle' and gets 22P02 back. createWebhookStore.claim (src/lib/payments/handlers.ts:48-51) sees error.code !== '23505' and throws 'webhook claim failed: 22P02'. That throw is outside the try block in src/lib/payments/webhook.ts:120 and the route's POST does not wrap processWebhookEvent, so Next.js returns 500. Paddle retries on its schedule, fails identically every time, and eventually abandons the event. No subscriptions row is ever written (that insert would fail with 22P02 too), recomputeEntitlements never runs, and no webhook_events row exists to show anything was attempted. The customer's card is charged every month by Paddle and they remain on the Free tier forever, with no error surfaced to them and no reconciliation record. The safety net is disabled by the same bug: /api/cron/reconcile-billing:42 filters .eq('provider', provider.name), gets a 400, destructures only { data: rows }, and '(rows ?? [])' makes it iterate zero subscriptions while reporting success. ensureCustomer is broken the same way and worse, because src/lib/payments/index.ts:146 does not destructure error at all, so the failed billing_customers insert is swallowed in total silence and the customer-id mapping that resolveUserId falls back on is never written.

**Fix.** Add a migration: `alter type billing_provider add value if not exists 'paddle';` (must be committed before any transaction uses the new value, so put it in its own migration file). Then change the column defaults from 'stripe' to 'paddle' in plans, billing_customers, subscriptions, invoices, payments and refunds so a row written without an explicit provider is not silently mislabelled. Separately, stop swallowing these errors: check and throw on the error from the billing_customers insert in src/lib/payments/index.ts:146 and from the subscriptions insert/update in handlers.ts:226-228, and add an assertion at startup (or in scripts/verify-sql-invariants.mjs) that the configured PAYMENT_PROVIDER is a member of the billing_provider enum.


## [CRITICAL] UNVERIFIED — profiles.country is never populated from signup, so every customer including Canadians is charged the US/USD price

`supabase/migrations/0002_identity.sql:80`

**Defect.** public.handle_new_user() inserts only the id into public.profiles. It never reads new.raw_user_meta_data->>'country'. Nothing else in the codebase ever writes profiles.country — the only two places that touch the profiles table are a read of 'country' in the checkout route and a read of 'created_at' in stores.ts. profiles.country therefore always equals its column default 'US' (supabase/migrations/0002_identity.sql:10). The checkout route reads exactly that column to choose which currency to charge in.

**How it fails.** A Canadian signs up and selects 'Canada' in the AuthForm country selector. src/app/api/auth/signup/route.ts:72 passes { country: 'CA' } into auth.signUp options.data, which lands in auth.users.raw_user_meta_data. The profile trigger fires and writes a profiles row with country='US'. The customer browses /pricing?country=CA, sees Essential at $12.99, and clicks Subscribe. src/app/api/billing/checkout/route.ts:58 reads profile.country, gets 'US', and resolvePriceId returns the USD price id pri_01m25sna9qrkkf0tcqxvpj9sn2 at 999 USD. Paddle charges 9.99 USD, which at roughly 1.37 CAD/USD is about CAD 13.69 plus the card issuer's foreign-transaction fee — more than the CAD 12.99 the page advertised, in a currency the page did not name. The same holds for Plus (19.99 USD vs 25.99 CAD advertised) and Pro (29.99 USD vs 39.99 CAD). No Canadian customer can ever reach the CAD price ids, so three of the six Paddle prices are unreachable by construction. The subscriptions row compounds it: syncSubscription's row object (src/lib/payments/handlers.ts:205-223) never sets country, so subscriptions.country also stays at its default 'US' for a Canadian subscriber, which is wrong data for any later tax or jurisdiction reporting keyed on that column.

**Fix.** Make handle_new_user() seed the column: `insert into public.profiles (id, country) values (new.id, coalesce(nullif(new.raw_user_meta_data->>'country',''), 'US')::country_code)`. Add a backfill for existing users from auth.users.raw_user_meta_data. Give the customer a way to correct it (a country field in settings that updates profiles.country), and set subscriptions.country from the resolved billing country in syncSubscription so the stored row reflects what was actually charged. Treat the default 'US' as a fallback that is logged, not as a silent answer.


## [CRITICAL] UNVERIFIED — Downgrade takes effect immediately: `effective_from` is not a field on Paddle's update-subscription endpoint and is silently discarded

`src/lib/payments/paddle/adapter.ts:437`

**Defect.** changePlan tries to defer a downgrade with a top-level `effective_from: 'next_billing_period'` on PATCH /subscriptions/{id}. That field does not exist on this endpoint. Paddle drops unknown top-level fields without error, so the request that reaches Paddle is just an item replacement with `proration_billing_mode: 'do_not_bill'` — which governs billing only, never when the item swap applies. Nothing in the request defers anything. The plan swap is applied at once, and because the mode is do_not_bill, the customer receives no credit or refund for the portion of the higher plan they already paid for.

**How it fails.** A customer on Pro ($ for the month, already charged, 20 days left in the period) asks to move to Essential. The route calls changePlan with isUpgrade=false. Paddle replaces the item with the Essential price immediately and bills nothing. Paddle emits subscription.updated carrying the Essential price. syncSubscription (src/lib/payments/handlers.ts:163) resolves plan_id from that price and calls recomputeEntitlements, so checkEntitlement now answers with Essential limits. The customer paid for 30 days of Pro, got 10, received no credit, and lost Pro features the same minute they asked for a change they were told would happen in 20 days. POLICY.downgrade.effectiveAt is 'period_end' and src/config/policy.ts states 'immediate' is 'only ever appropriate with a proration refund, and is not the default'.

**Fix.** Paddle Billing cannot defer an item change. Do not call changePlan at all for a downgrade: record pending_plan_id/pending_plan_effective_at only, and perform the PATCH when the period actually rolls over (a scheduled job, or on the renewal webhook). Set capabilities.scheduledPlanChange to false so downgradeStrategy() reports APPLICATION_SCHEDULED honestly, and delete the `effective_from` key so no future reader believes it does something.


## [CRITICAL] UNVERIFIED — The customer and the settings page are told the downgrade has not happened yet, while it already has

`src/app/api/billing/checkout/route.ts:126`

**Defect.** The API response states 'Your plan change is scheduled for the end of your current billing period. Nothing changes until then.' and the settings page states 'Until then you keep everything your current plan includes, and nothing is removed from your account.' Both are false the moment the subscription.updated webhook lands, which is seconds later. The settings page then contradicts itself, because summary.plan is recomputed from the new lower plan_id while the pending notice still announces a future change to that same plan.

**How it fails.** A Pro customer downgrades to Essential on day 10 of 30. The UI tells them they keep Pro until day 30. They return to /settings/subscription: the heading now reads 'Essential', and directly beneath it a notice reads 'Your plan changes to essential on <day 30>. Until then you keep everything your current plan includes.' They then hit LIMIT_REACHED on a Pro-only allowance that the page just promised them, having been told in writing nothing was removed. For a product whose customers are managing medical bills, a false statement about what access they still hold is the failure mode that matters most.

**Fix.** Fix the underlying deferral first. Until it is fixed, do not claim a downgrade is deferred: the copy must match what the provider actually did. The page should also never render a pending-change notice whose target plan equals the current plan.


## [CRITICAL] UNVERIFIED — pending_plan_id is never cleared, and effectivePlan applies it forever — a downgrade then upgrade permanently caps a paying customer at the lower plan

`src/domain/entitlements/compute.ts:67`

**Defect.** pending_plan_id / pending_plan_effective_at are written in exactly one place (the downgrade branch of the checkout route) and cleared in no place. syncSubscription's update row omits both columns, the reconcile cron never reads them, and no other writer exists in the repo. effectivePlan returns pendingPlanSlug unconditionally once pendingPlanEffectiveAt has passed, without checking whether the pending plan is still wanted, whether it is lower than the current plan, or whether the subscription has since changed.

**How it fails.** A Pro customer downgrades to Essential (pending_plan_id=essential, effective_at=period end). Having immediately lost Pro features (see the first finding), they click Pro again. comparePlans sees essential->pro, so this is an upgrade: Paddle charges the prorated difference immediately and the webhook sets plan_id back to pro. pending_plan_id is still essential and nothing clears it. At the original period end, effectivePlan sees pendingPlanEffectiveAt <= now and returns 'essential' — and keeps returning it for every subsequent renewal, because the timestamp never moves and the row is never cleared. The customer is billed Pro every month forever and receives Essential entitlements forever. The reconcile cron cannot catch it: it compares status, price id, period and cancel flag only, and all four agree.

**Fix.** Clear pending_plan_id and pending_plan_effective_at whenever the plan changes for any reason — in the upgrade branch of the route and in syncSubscription once the provider reports a price that matches (or no longer matches) the pending plan. Additionally make effectivePlan ignore a pending plan that is not strictly lower than the current plan, so a stale row can never silently cap entitlements.


## [CRITICAL] CONFIRMED — Paddle.Checkout.open is called with no settings.successUrl, so a paying customer never lands anywhere

`src/components/PaddleCheckout.tsx:107`

**Defect.** The overlay is opened as `paddle.Checkout.open({ transactionId })` with no `settings` object at all, so no `successUrl` is ever handed to Paddle.js. The success URL that /api/billing/checkout computes (`${appUrl}/billing/success`, route.ts:141) is passed to the server adapter and then spent on Paddle's `checkout: { url: ... }` field (adapter.ts:380), which is the page that HOSTS the checkout, not a post-payment redirect. The result is that no code path in the repository ever navigates a browser to /billing/success: grep for `billing/success` finds only the page itself, the adapter line, docs, and a test. Worse, the completion handler makes the page actively lie: on `checkout.completed` it sets phase to 'open' and message to null (lines 99-102), and the non-error render for phase 'open' says "Opening checkout for <plan>" / "The payment form should appear in a moment." (lines 145-155). There is no success state in the component at all.

**How it fails.** Customer clicks "Choose Plus", the overlay opens, they enter a card and pay. Paddle charges them and shows its own inline success panel. The Wintora page underneath still reads "Opening checkout for plus — The payment form should appear in a moment." Nothing redirects. The customer closes the overlay and is left on /checkout, which now says the payment form is about to appear, with a "Back to plans" route and no confirmation, no receipt reference, and no link to the dashboard. They have been charged and the app tells them checkout has not started yet. docs/ARCHITECTURE.md:150 (`PAY -.-> SUCCESS["/billing/success page"]`) and docs/BILLING.md:140 both describe a landing that does not exist, so a maintainer reading the docs will not look for this.

**Fix.** Pass the success URL to Paddle.js, not to the transaction: widen the `open` signature to `{ transactionId, settings: { successUrl } }` and supply `${NEXT_PUBLIC_APP_URL}/billing/success` from the page (it is already a server component and can read publicEnv().NEXT_PUBLIC_APP_URL). Remove `checkout: { url: ... }` from the transaction body so Paddle builds the hosting URL from the default payment link, and keep `checkout.url`'s only job as pointing at /checkout.


## [CRITICAL] CONFIRMED — attemptKey is never used to dedupe anything; it is written to Paddle custom_data and read by nothing

`src/app/api/billing/checkout/route.ts:140`

**Defect.** The route accepts attemptKey, validates only its length (route.ts:36), and forwards it to provider.createCheckout, which embeds it in Paddle custom_data.attempt (src/lib/payments/paddle/adapter.ts:378). It is never persisted, never looked up, and never compared. No table, column, or query in the repository is keyed on it: grep for "checkout" across supabase/migrations returns zero hits, and the only custom_data field read anywhere in src is wintora_user_id (adapter.ts:494). Two POSTs carrying the same attemptKey create two Paddle transactions, not one. The doc comment at CheckoutButton.tsx:28-34 asserts the opposite: "It must survive a retry (so a double click or a refresh does not create a second transaction)" and "a timestamp or a fresh random value here would defeat the whole point of an idempotency key." There is no idempotency key. The only protection is the client-side disabled={busy} flag.

**How it fails.** Customer clicks Choose Plus. Server creates Paddle transaction txn_A, browser navigates to /checkout?_ptxn=txn_A. Customer decides to re-read the pricing page, presses Back. /pricing reloads, busy resets to false, sessionStorage still holds the same attemptKey. Customer clicks Choose Plus again. The server creates txn_B — the identical attemptKey changes nothing, because no code reads it. The customer now has two live payable transactions for the same plan. If they complete txn_A, then return to the still-open txn_B tab and complete it too, Paddle creates two subscriptions for one customer and bills both monthly. Wintora never created anything that could have prevented or even noticed the second one.

**Fix.** Persist the attempt server-side before calling the provider: a table keyed unique on (user_id, plan_slug, attempt_key) storing the returned provider transaction id. On a second POST with a key that already has a row, return the stored checkout URL instead of calling provider.createCheckout again. Until that exists, delete the attemptKey parameter and its comments rather than leave a key that implies a guarantee it does not provide.


## [CRITICAL] CONFIRMED — A second paid subscription is silently discarded by the webhook: unchecked insert error, 200 returned, no retry, no reconciliation row

`src/lib/payments/handlers.ts:226`

**Defect.** syncSubscription inserts the subscription row without checking the returned error: `await client.from('subscriptions').insert(row);`. supabase-js resolves with {data, error} and does not throw, and createAdminClient (src/lib/supabase/server.ts) sets no throwOnError. The partial unique index subscriptions_one_live_per_user (supabase/migrations/0004_billing.sql:79-84) permits only one row per user_id in ACTIVE/TRIALING/PAST_DUE/GRACE/PAUSED/CANCELED_PENDING_EXPIRY/CHECKOUT_PENDING/INCOMPLETE. So when a second genuinely distinct paid subscription arrives for a user who already has a live one, the insert fails with 23505, the error is swallowed, execution continues to auditTransition (handlers.ts:231) which writes an audit_logs row with outcome SUCCESS claiming a FREE to ACTIVE transition that never happened, recomputeEntitlements runs, processWebhookEvent marks the event PROCESSED, and the route returns HTTP 200. Paddle therefore never retries. The paid subscription exists at Paddle, bills every month, and has no representation in Wintora at all.

**How it fails.** Customer completes two checkouts (two tabs, or Back-then-retry per finding 1). Paddle sends subscription.activated for sub_A: inserted, status ACTIVE, entitlements granted. Paddle sends subscription.activated for sub_B: lookup by provider_subscription_id finds nothing, previous is null, insert of a second ACTIVE row for the same user_id violates subscriptions_one_live_per_user, error is discarded, webhook answers 200. The customer is charged for two subscriptions every month. /settings/subscription shows one. Nobody is alerted. Both invoices ARE recorded (upsertInvoice is keyed on provider_invoice_id and succeeds), so the customer can see two charges a month in their invoice history that the product insists is a single subscription.

**Fix.** Destructure and check the error on both the insert and the update. On 23505 against subscriptions_one_live_per_user, write a billing_reconciliations row with mismatch_type DUPLICATE_LIVE_SUBSCRIPTION plus a security_event, and throw so processWebhookEvent records FAILED and the route returns 500 — a provider retry is harmless and an operator alert is the point. Never continue to auditTransition or recomputeEntitlements after a failed write.


## [HIGH] CONFIRMED — successUrl and cancelUrl never reach Paddle, so a paying customer is never redirected anywhere and /billing/success is unreachable from the real flow

`src/lib/payments/paddle/adapter.ts:380`

**Defect.** `request.cancelUrl` is never referenced anywhere in the adapter, and `request.successUrl` is only referenced in the misused checkout.url slot — so once that is fixed, neither field reaches Paddle at all. The overlay is opened with `Paddle.Checkout.open({ transactionId })` and the component's own TypeScript interface forbids anything else (`open(options: { transactionId: string })`), so no `settings.successUrl` can be supplied. Paddle Billing's overlay only redirects after payment when given a success URL.

**How it fails.** Customer completes payment in the overlay on /checkout. Paddle fires checkout.completed; the eventCallback sets phase to 'open' and clears the message, so the page behind the overlay reads "Opening checkout … The payment form should appear in a moment." after the money has already been taken. There is no redirect. The customer closes the overlay and sits on a checkout page telling them a form is about to appear, with no confirmation, no next step, and no link to the dashboard. /billing/success — the page written specifically to handle webhook lag honestly — is never reached by anyone who actually pays. A customer in this state reasonably concludes the purchase failed and either retries (see the idempotency finding) or opens a dispute.

**Fix.** Plumb the success URL to the browser and hand it to Paddle.js: render it into the /checkout page from publicEnv().NEXT_PUBLIC_APP_URL and call `Paddle.Checkout.open({ transactionId, settings: { successUrl } })`, widening the component's interface accordingly. Then either wire cancelUrl to the overlay's close path or delete it from CheckoutRequest so the port stops promising plumbing no adapter honours.


## [HIGH] CONFIRMED — Every Canadian customer is charged in USD because profiles.country is permanently 'US' — the signup country is written to auth metadata and never copied into the profile

`supabase/migrations/0002_identity.sql:73`

**Defect.** `handle_new_user()` inserts `public.profiles (id) values (new.id)` and never reads `new.raw_user_meta_data->>'country'`, which is the only place signup stores the selected country (src/app/api/auth/signup/route.ts:72 passes it as auth `data`). No other code path in the repo writes profiles.country — the only two `from('profiles')` call sites are a `select('country')` in the checkout route and a `select('created_at')` in stores.ts. So profiles.country is forever the column default `'US'` (0002_identity.sql:10), the checkout route always resolves the US/USD price id, and the CAD price ids are unreachable. This is the real answer to the currency question: `currency_code: undefined` in the adapter is not the cause — JSON.stringify drops that key, and each seeded Paddle price carries exactly one base currency with no unit_price_overrides, so the price id alone pins the currency.

**How it fails.** A Canadian signs up, selects Canada in the signup form (AuthForm.tsx:204), and browses /pricing?country=CA, which states "Prices are shown for Canada (CAD)" and quotes the CAD amount from plan_prices. They click Choose Plus. The route reads profiles.country → 'US', resolvePriceId returns the US/USD Paddle price id, and the transaction is created in USD. They are charged a USD amount they were never quoted, their card issuer adds an FX/foreign-transaction fee, and the Paddle receipt currency contradicts the price they agreed to. The subscription then syncs back with currency 'USD' while subscriptions.country sits at its 'US' default, so nothing downstream flags the mismatch.

**Fix.** In handle_new_user(), insert the country from metadata: `insert into public.profiles (id, country) values (new.id, coalesce((new.raw_user_meta_data->>'country')::country_code, 'US'))`. Add a settings path so an existing user can correct it, and backfill existing profiles from auth.users.raw_user_meta_data. Until that lands, treat the pricing page's CAD quote as false advertising for CA visitors. Separately, replace the bare `currency_code: undefined` line with either nothing or a one-line comment saying the price id determines the currency — as written it looks like a deliberate instruction to Paddle but is dropped by JSON.stringify, inviting a maintainer to "fix" it to a literal and start getting currency-mismatch 400s.


## [HIGH] CONFIRMED — transaction.completed carries no subscription reference, so the documented provider re-read fallback is dead code

`src/lib/payments/handlers.ts:344`

**Defect.** The PAYMENT_SUCCEEDED handler is written as 'A successful payment may or may not carry the subscription object. When it does not, re-read from the provider rather than inferring' and calls syncFromProvider. But syncFromProvider's first act is `const ref = event.subscription?.providerSubscriptionId; if (ref === undefined || ref.length === 0) return;` — and the adapter only populates event.subscription when the raw event type starts with 'subscription.' (adapter.ts:503). transaction.completed and transaction.paid are the only events that reach this branch, and for them event.subscription is always undefined. So the fallback returns immediately, 100% of the time. Paddle's transaction payload does carry `subscription_id`, but neither normalizeTransaction (adapter.ts:518-537) nor verifyAndParseWebhook reads it. The same dead branch exists for PAYMENT_FAILED (handlers.ts:353) on transaction.payment_failed. Net effect: the entire entitlement grant rests on a single event type, subscription.created, with the advertised safety net inoperative.

**How it fails.** Paddle delivers transaction.completed successfully (the customer's money has moved) but subscription.created is lost — dropped by the destination, rejected by a transient 5xx that exhausts Paddle's retries, or permanently no-op'd by the retry defect in Finding 3. The PAYMENT_SUCCEEDED handler upserts an invoices row showing the customer paid, then calls syncFromProvider, which returns on the first line. No subscriptions row is created and no entitlements are recomputed. The database now contains proof of payment and no grant, the webhook is recorded as PROCESSED, nothing alerts, and the reconcile cron cannot see it (Finding 8).

**Fix.** In verifyAndParseWebhook, extract `data.subscription_id` from transaction.* payloads and surface it on the normalized event (e.g. a `subscriptionRef` field, or a minimal subscription stub), then have syncFromProvider use that ref to call provider.getSubscription() and syncSubscription(). That makes transaction.completed a genuine second path to the grant, which is what the comment and docs/BILLING.md already promise.


## [HIGH] UNVERIFIED — syncSubscription discards the subscriptions insert/update error, so a rejected write still reports PROCESSED and leaves the customer on free

`src/lib/payments/handlers.ts:226`

**Defect.** Both writes ignore their result: `await client.from('subscriptions').insert(row);` and `await client.from('subscriptions').update(row).eq('id', previous.id);`. Neither destructures or checks `error`. Control then falls through to recomputeEntitlements, which does NOT use the in-memory row — it re-reads the subscription from the database (stores.ts:337 -> createEntitlementStore.getSubscription). So when the write is rejected, entitlements are computed from whatever row was already there (or none, which yields the free snapshot at stores.ts:340-350), the handler returns normally, the event is marked PROCESSED, and the route returns 200. The failure is invisible: no throw, no 500, no security_events row, no billing_reconciliations row.

**How it fails.** A user clicks Buy, the checkout page is slow, they open a second tab and complete checkout again before the first webhook lands (the duplicate guard at src/app/api/billing/checkout/route.ts:62-67 only looks for an already-recorded live subscription, which does not exist yet). Paddle now has two subscriptions and bills both. subscription.created for sub A inserts a row with status ACTIVE. subscription.created for sub B finds no existing row by provider_subscription_id, inserts, and violates the partial unique index subscriptions_one_live_per_user (0004_billing.sql:79-84) with 23505. The error is discarded; recomputeEntitlements re-reads sub A and produces correct entitlements for A only. The customer is charged twice, subscription B exists only at Paddle, webhook_events says PROCESSED, and nothing in the system records that a second paid subscription exists.

**Fix.** Destructure `{ error }` from both writes and throw on a non-null error so the event is marked FAILED and surfaced (paired with the retry fix in Finding 3). Handle 23505 on subscriptions_one_live_per_user explicitly: write a billing_reconciliations row of type DUPLICATE_LIVE_SUBSCRIPTION with both provider subscription ids so a human can cancel and refund one, rather than silently dropping it. The same unchecked-insert pattern needs fixing at src/lib/payments/index.ts:146 (billing_customers), which is the fallback correlation table.


## [HIGH] UNVERIFIED — An unresolvable Paddle price silently writes an ACTIVE subscription on the FREE plan

`src/lib/payments/handlers.ts:164`

**Defect.** `const planId = plan?.planId ?? (await freePlanId(client));` — when resolvePlanFromPrice cannot match the subscription's provider_price_id in plan_prices it returns null, and the code falls back to the free plan's id while still writing the provider's status (ACTIVE) and the real amount_cents/currency. recomputeEntitlements then resolves the plan from that row and grants free-plan features. There is no error, no security_events row and no billing_reconciliations row for this case. resolvePlanFromPrice also returns null on a Supabase error, which .maybeSingle() produces if more than one plan_prices row shares a provider_price_id. This directly contradicts the sibling function src/lib/payments/index.ts:111-118, which for the checkout direction explicitly chooses to 'Fail loudly rather than charging a wrong or default amount'.

**How it fails.** Prices are re-created in Paddle (a price edit that requires a new price id, or a reseed via scripts/seed-paddle.mjs) and plan_prices is updated with the new ids. An existing Pro subscriber's Paddle subscription still references the old, now-absent price id. The next subscription.updated webhook — which fires on every billing-period roll — hits resolvePlanFromPrice, gets null, and rewrites that subscriber's row with plan_id = free while status stays ACTIVE. recomputeEntitlements drops them to free-plan limits. The customer keeps being charged Pro by Paddle, sees 'Your subscription is active' on the billing page, and is blocked by LIMIT_REACHED on features they are paying for. No alert fires, and the reconcile cron cannot catch it either: it compares remote.providerPriceId against our stored provider_price_id, which syncSubscription wrote faithfully, so planAgrees is true and nothing is flagged.

**Fix.** Never silently substitute the free plan for a paid, live provider status. When resolvePlanFromPrice returns null and the provider status is in ENTITLED_STATUSES, write a billing_reconciliations row of type UNKNOWN_PRICE_ID (carrying the price id and subscription id), leave the existing plan_id untouched if a row already exists, and throw so the event surfaces as FAILED rather than applying a downgrade. Keep the free-plan fallback only for statuses that do not grant entitlements.


## [HIGH] UNVERIFIED — isFullRefund is derived from Paddle's `action`, so partial refunds revoke all access and chargebacks revoke none

`src/lib/payments/paddle/adapter.ts:550`

**Defect.** normalizeAdjustment sets `isFullRefund: action === 'refund'`. In Paddle Billing, `action` is one of credit | credit_reverse | refund | chargeback | chargeback_warning | chargeback_reverse; it says what kind of adjustment it is, not whether it is full or partial (full vs partial is expressed per-item / by comparing totals to the transaction). Two opposite errors follow from the same line, both consumed at handlers.ts:444-446. (1) A partial refund has action 'refund', so isFullRefund is true and POLICY.refunds.fullRefundEffect = 'REVOKE_IMMEDIATELY' fires — a paying customer is stripped of access. (2) A chargeback has action 'chargeback', so isFullRefund is false and POLICY.refunds.partialRefundEffect = 'NONE' applies — the customer took the money back and keeps full premium access. POLICY.refunds.disputeEffect = 'REVOKE_IMMEDIATELY' (src/config/policy.ts:57) is read by no code anywhere; and although createHandlers registers a DISPUTE_OPENED handler (handlers.ts:364), mapPaddleEventKind never returns DISPUTE_OPENED, so handleDispute is unreachable. Both are dead configuration a maintainer would reasonably trust.

**How it fails.** Case A: support issues a $4 goodwill credit on a $29 Plus charge. Paddle sends adjustment.created with action 'refund' and a partial total. isFullRefund = true -> effect REVOKE_IMMEDIATELY -> handlers.ts:464-472 flips the subscription to REFUNDED and recomputes entitlements to free. The customer who paid $29 and was refunded $4 loses everything mid-period. Case B: a customer disputes the $29 charge with their bank. Paddle sends adjustment.created with action 'chargeback'. isFullRefund = false -> partialRefundEffect 'NONE' -> no status change, no recompute, and the refunds row is recorded with entitlement_effect 'NONE'. The customer has their money back and retains paid features indefinitely, and no security_events row is written even though POLICY says a chargeback should revoke.

**Fix.** Carry Paddle's `action` through on ProviderRefund as a discriminator (refund | credit | chargeback | chargeback_reverse | ...), and determine full vs partial by comparing the adjustment total against the original transaction total rather than by action. Route action 'chargeback' / 'chargeback_warning' to DISPUTE_OPENED so handleDispute and POLICY.refunds.disputeEffect actually run, and route 'credit' (money not returned to the customer) away from the refunds/revocation path entirely.


## [HIGH] UNVERIFIED — The price shown to the customer and the price charged come from different sources keyed on different countries, and can differ in both amount and currency

`src/app/pricing/page.tsx:141`

**Defect.** /pricing renders prices from the compile-time constant in src/config/plans.ts via priceFor(), with the country taken from the ?country= URL query parameter. /api/billing/checkout resolves the price from plan_prices in Postgres, with the country taken from profiles.country. Nothing ties the two together: the displayed amount is never read from the database, and the resolved amount is never shown. resolvePriceId even returns amountCents and currency, and its single caller (src/app/api/billing/checkout/route.ts:59) destructures only { priceId } and discards them. Compounding it, formatPrice (src/config/plans.ts:337-343) renders CAD through Intl with locale en-CA, which produces "$12.99" — no CA$ or CAD marker — so the CAD card is visually indistinguishable from a USD card.

**How it fails.** Any visitor opens /pricing?country=CA (the page's own 'Show Canada (CAD)' link produces this URL). The Plus card reads "$12.99 / month" — actually $25.99 for Plus; the ambiguity is the point, since the glyph is a bare dollar sign either way. They click Subscribe. Because profiles.country is always 'US' (see the separate finding), checkout resolves the USD price and Paddle charges 19.99 USD. The customer was shown one number in one currency and charged a different number in a different currency. The page asserts the opposite in two places: "Plans bill monthly in the currency shown" (line 212-215) and "Showing prices for Canada (CAD)" (line 154). Both statements become false. Even after profiles.country is fixed, the defect survives in the other direction: a customer whose profile says CA can open /pricing (no query param, defaults to US), see the USD numbers, and be charged the CAD price — or an admin can change amount_cents in plan_prices, which the plans.ts doc comment explicitly says is the supported no-deploy workflow, and the pricing page will keep advertising the stale compiled number indefinitely.

**Fix.** Render the pricing page from plan_prices (it is a server component and can query directly), so the displayed amount and currency are the same row the checkout resolves. Derive the displayed country from the signed-in customer's billing country rather than a query parameter, falling back to the query parameter only for anonymous visitors and labelling it as such. Make formatPrice emit an unambiguous currency (currencyDisplay:'narrowSymbol' with an explicit 'CAD'/'USD' suffix, or locale 'en-US' for CAD so Intl renders 'CA$'). Have the checkout route compare the resolved amountCents/currency against what the client was shown and refuse the transaction on a mismatch rather than silently charging the other number.


## [HIGH] UNVERIFIED — resolvePriceId's maybeSingle() turns two matching price rows into "not available in your country", which the documented price-change procedure will trigger

`src/lib/payments/index.ts:97`

**Defect.** resolvePriceId filters on plans.slug, plans.active, plan_prices.country and plan_prices.active, then calls .maybeSingle(). It does not filter on currency, plan version, or plans.effective_until. The unique constraint is (plan_id, country, currency), so two active rows for one plan and one country in different currencies are explicitly permitted by the schema. Two concurrently active plan versions are also permitted: the partial unique index plans_one_active_version_per_slug only covers rows where active AND effective_until is null, so a retired-but-still-active v1 (effective_until set) coexists with v2 and both satisfy .eq('plans.active', true). In either case the query returns two rows, and maybeSingle() converts that into error PGRST116 with data null — it does not throw. resolvePriceId's single combined guard `if (error !== null || data === null)` then reports the customer's country as the cause.

**How it fails.** The operator raises the Plus price. supabase/migrations/0003_catalog.sql:46-47 documents the intended procedure: "a price change creates a NEW version rather than mutating a row, which is what makes grandfathering possible." So they insert plans('plus', version 2, active=true) and set effective_until on version 1 — keeping it active so existing subscribers' entitlements still resolve through it — and add plan_prices rows for v2. A new US customer clicks Subscribe on Plus. The embed now matches two rows (v1 US/USD and v2 US/USD), both active, both on an active plan. maybeSingle() returns {data:null, error:{code:'PGRST116'}}. resolvePriceId throws AppError('BILLING_ERROR','That plan is not available in your country.'). Every purchase of Plus is dead, in both countries, with a customer-facing message that is factually false — the plan is available in their country, the catalog just has two rows. The identical failure occurs if anyone adds a USD price for country CA, which the (plan_id, country, currency) constraint invites and the CurrencyCode union permits. Nothing detects it: the row count is valid per the constraint, so no test or invariant check fires.

**Fix.** Make the query deterministic and the failure honest. Add .eq('currency', currencyFor(country)) — or better, add the explicit version/effective-date predicates the versioning model requires: filter to the plan version that is currently sellable (effective_from <= now() and (effective_until is null or effective_until > now())). Then separate the error branches: a PGRST116 multi-row result is an operator misconfiguration and must raise a distinct internal error (and a billing_reconciliations or security_events row), never the customer-facing 'not available in your country'. Also add a uniqueness invariant to scripts/verify-sql-invariants.mjs asserting at most one sellable price per (plan slug, country).


## [HIGH] UNVERIFIED — Nothing reconciles plan_prices.amount_cents against what Paddle holds, and migration 0012 will silently revert any DB price change while the Paddle price id stays put

`scripts/seed-paddle.mjs:173`

**Defect.** The amount lives in three independent stores — src/config/plans.ts (what the customer is shown), plan_prices.amount_cents (what checkout reads), and the Paddle price object (what the customer is actually charged) — and no code compares the third against the other two. seed-paddle.mjs short-circuits on any row that already has a provider_price_id, so it can only ever fill a blank; it never detects or corrects an amount that has changed. /api/cron/reconcile-billing compares status, provider_price_id, period end and cancel_at_period_end, and never amount_cents or currency. tests/catalog-parity.test.ts parses the SQL seed file and compares it to the TypeScript registry, so it covers config-vs-migration but reads neither the live database nor Paddle. scripts/doctor.mjs contains no price or amount check at all. Meanwhile migration 0012's upsert actively reverts DB price edits.

**How it fails.** An operator raises Pro from 2999 to 3499 the way src/config/plans.ts:5-10 says to — by editing plan_prices in the database, no deploy. Nothing propagates that to Paddle: the provider_price_id on that row is already set, so `npm run paddle:seed -- --apply` prints 'already-set' and moves on (scripts/seed-paddle.mjs:173-176), creating no new Paddle price and emitting no warning, and its final verification pass only checks for NULL ids. Checkout keeps handing Paddle pri_01m25snfgqn0r1805q0ednhqd1, so the customer is charged 29.99 USD while the database says the price is 34.99. The reconcile cron will never notice, because it does not compare amounts. Then someone re-runs the migrations: supabase/migrations/0012_seed_catalog.sql:85-87 is `on conflict (plan_id, country, currency) do update set amount_cents = excluded.amount_cents, active = true`, which silently overwrites 3499 back to 2999 — the DB edit vanishes with no record that it ever happened. The inverse is equally available: editing a price in the Paddle dashboard changes what every existing and new subscriber is charged while plan_prices and the pricing page keep showing the old number, and no check anywhere would report the divergence. Today the two sides do agree, so this is a live drift mechanism with no detector, not a present mismatch.

**Fix.** Give the seed script a --verify mode (and run it in CI or from scripts/doctor.mjs) that fetches every Paddle price named in plan_prices and asserts unit_price.amount === String(amount_cents), unit_price.currency_code === currency, billing_cycle.interval === plan.billing_interval, tax_mode matches tax_behavior, and status === 'active' — exiting non-zero on any mismatch. Make a price change create a new Paddle price and write the new id back rather than mutating an amount in place. Add amount_cents and currency to the reconcile cron's comparison so a live subscription billed at an unexpected amount raises a BILLING_STATE_MISMATCH. Finally, either remove the amount_cents overwrite from 0012's on-conflict clause or move the seed out of the migration chain, so re-running migrations cannot revert a deliberate price.


## [HIGH] UNVERIFIED — An unrecognised Paddle price id silently assigns the Free plan to a paying subscriber, with no error and no reconciliation record

`src/lib/payments/handlers.ts:164`

**Defect.** syncSubscription resolves the plan from the subscription's provider_price_id via resolvePlanFromPrice, and when that lookup returns null it falls back to freePlanId() and writes the subscription with the Free plan's plan_id. There is no error, no log, and no billing_reconciliations row — the function proceeds to auditTransition and recomputeEntitlements as if the plan had resolved. The contrast with the sibling path is stark: an unattributable subscription does insert an UNATTRIBUTED_SUBSCRIPTION reconciliation row (handlers.ts:309-316), but an unresolvable price just quietly downgrades the customer.

**How it fails.** A price id reaches the webhook that is not in plan_prices — because a price was recreated in Paddle and the new id was never written back (which the seed script cannot do, see the drift finding), or because a subscription was created against a price added in the Paddle dashboard. resolvePlanFromPrice returns null, planId becomes the Free plan's id, and the subscriptions row is written with status ACTIVE, amount_cents 2999, currency USD — and plan_id pointing at Free. recomputeEntitlements then grants the Free tier's limits: 1 active case, 3 documents, 2 analyses, 1 letter per month. The customer is being billed 29.99 USD a month by Paddle and has Free-tier quotas. auditTransition records a clean FREE -> ACTIVE transition, which the state machine accepts, so no ILLEGAL_BILLING_TRANSITION security event fires either. Nothing anywhere reports a problem; the only symptom is a customer complaint. The reconcile cron cannot catch it because it compares provider_price_id against the stored provider_price_id (which matches) and never checks that the stored plan_id corresponds to that price.

**Fix.** Do not fall back to Free for a paid subscription. When resolvePlanFromPrice returns null and the subscription status is a paying one, insert a billing_reconciliations row (a new mismatch type such as UNRESOLVED_PRICE carrying the price id and subscription id) and throw, so the webhook returns 500 and Paddle retries while an operator fixes the catalog — the same fail-loud-and-retry shape the unattributed path uses. Reserve the Free fallback for subscriptions whose status is genuinely terminal. Also teach the reconcile cron to verify that the stored plan_id is the plan that owns the stored provider_price_id.


## [HIGH] UNVERIFIED — capabilities.scheduledPlanChange is declared true for Paddle, which cannot schedule plan changes — and is reported to the client as fact

`src/lib/payments/paddle/adapter.ts:335`

**Defect.** The Paddle adapter declares `scheduledPlanChange: true`. Paddle Billing has no mechanism to defer an item change: there is no top-level effective_from on update-subscription and proration_billing_mode controls billing only. downgradeStrategy() therefore returns 'PROVIDER_SCHEDULED', and the route returns that verbatim to the client as `downgradeHandledBy`. The route's own compensating branch is written as if it were only a fallback ('If the provider cannot defer the change itself, we hold it and apply it at period end'), and the port's doc comment promises 'we hold it ourselves in pending_plan_id and apply it at period end' — but no code applies it at the provider, and the capability flag asserts the compensation is unnecessary.

**How it fails.** A maintainer adding a second provider, or debugging why a customer lost access early, reads capabilities.scheduledPlanChange=true, downgradeHandledBy='PROVIDER_SCHEDULED', and docs/BILLING.md section 4 ('At period end: proration_billing_mode: "do_not_bill" with effective_from: "next_billing_period"'), and concludes Paddle is holding the change. They trust a guarantee no system provides, and the wrong layer gets investigated while customers keep losing paid access on request. The response body also ships this false claim to the browser.

**Fix.** Set scheduledPlanChange: false for Paddle, which makes downgradeStrategy() return APPLICATION_SCHEDULED and matches reality; then build the application-side applier that flag is promising. Correct docs/BILLING.md section 4 so it stops documenting a field Paddle does not accept.


## [HIGH] UNVERIFIED — Nothing applies a pending plan change at the provider, and the only scheduled job that could is unreachable by its own cron (POST-only route, Vercel cron sends GET)

`src/app/api/cron/reconcile-billing/route.ts:30`

**Defect.** There is no code anywhere in the repo that reads pending_plan_id and issues the provider-side plan change at pending_plan_effective_at. The entitlement layer applies it at read time (effectivePlan), but the provider is never told, so billing and entitlements are driven by two unsynchronised mechanisms. Compounding that, both scheduled jobs in vercel.json export only POST, while Vercel Cron invokes the configured path with a GET request — so the reconciliation that would at least surface the resulting drift never executes and has presumably never executed.

**How it fails.** Because no job applies a pending change, the design can only work by accident. And because reconcile-billing answers 405 to its own 04:00 schedule, the safety net is absent: in the downgrade-then-upgrade case above, provider price (Pro) and stored provider_price_id (Pro) agree, status agrees, period agrees — while entitlements silently serve Essential. No BILLING_STATE_MISMATCH is ever recorded, because the one job that writes billing_reconciliations rows cannot be invoked. The operator's first signal is a customer complaint.

**Fix.** Export GET on both cron routes (assertCronAuthorized already checks the Bearer secret, so method choice is not the security boundary), or invoke them from an external scheduler that sends POST. Then add a job that applies due pending plan changes at the provider, and extend the reconciler to flag a subscription whose effective entitlement plan disagrees with the plan its provider price maps to.


## [HIGH] UNVERIFIED — Plan change is offered in PAST_DUE and GRACE, which Paddle refuses outright, and the customer is shown a provider-outage message instead

`src/app/api/billing/checkout/route.ts:66`

**Defect.** The live-subscription query admits PAST_DUE and GRACE (GRACE is this codebase's own label for a Paddle past_due subscription inside the 7-day window), and the route proceeds straight to changePlan. Paddle documents that you cannot make changes to a subscription whose status is past_due, or when the next billing period is within 30 minutes. changePlan already performs a GET on the subscription but never inspects `current.status` or the next billing date, so the PATCH is sent and fails, surfacing as the generic AppError('PROVIDER_ERROR', 'We could not reach the payment provider.').

**How it fails.** A customer's renewal card is declined, so they are PAST_DUE/GRACE with 7 days of retained access and a banner asking them to fix billing. They reasonably try to move to a cheaper plan they can afford, or to upgrade. Paddle rejects the PATCH because the status is past_due. They see 'We could not reach the payment provider' — a false statement, since the provider was reached and answered — and have no way to change plan. Seven days later their access lapses. The same failure hits any customer who attempts a plan change within 30 minutes of renewal.

**Fix.** Check `current.status` (and next_billed_at against a 30-minute margin) inside changePlan and throw a typed, specific error; in the route, exclude PAST_DUE/GRACE from the plan-change branch and return an honest message directing the customer to update their payment method first.


## [HIGH] UNVERIFIED — An upgrade grants the higher plan on the item change alone, regardless of whether the immediate prorated charge was actually collected

`src/lib/payments/handlers.ts:163`

**Defect.** syncSubscription derives plan_id exclusively from the price id on the subscription object, with no reference to whether the prorated upgrade transaction was paid. PAST_DUE and GRACE are both in ENTITLED_STATUSES, and POLICY.grace.retainEntitlements opens a 7-day window of full access on any payment failure. That grace policy is written for a renewal failure on a plan the customer already paid for; applied to a failed upgrade charge, it hands over a plan that was never paid for at all.

**How it fails.** A customer on Essential upgrades to Pro. The adapter sends proration_billing_mode 'prorated_immediately', so Paddle swaps the item to the Pro price and attempts to collect the prorated difference. The card declines. The subscription reports the Pro price with status past_due. syncSubscription writes plan_id=pro, maps status to PAST_DUE, and opens a 7-day grace window — so checkEntitlement serves full Pro entitlements to a customer who has paid nothing toward Pro, for at least a week, and across the remainder of the period if any later payment succeeds. This is access granted that was not paid for.

**Fix.** Do not raise plan_id above the plan that has actually been paid for. Either gate the upgrade grant on the prorated transaction reaching a paid state (the transaction.paid/completed webhook already arrives), or scope grace retention to the plan in force before the change, so a failed upgrade charge falls back to the previously paid plan rather than granting the new one.


## [HIGH] CONFIRMED — The checkout.closed handler tells a customer who just paid that nothing was charged

`src/components/PaddleCheckout.tsx:95`

**Defect.** The `checkout.closed` branch unconditionally sets the error phase with "Checkout was closed before payment completed.", and the error card then adds "Nothing has been charged." There is no guard on whether `checkout.completed` was already observed — no ref, no flag, no ordering check — even though the component explicitly handles `checkout.completed` four lines below and therefore knows the completed state exists. Because no successUrl is passed (finding 1), the overlay is NOT dismissed by a redirect after payment, so the customer closing the overlay themselves after paying is the normal exit, not an edge case.

**How it fails.** Customer pays successfully. Paddle shows its success panel inside the overlay. The customer clicks the overlay's close button (the only way out, since nothing redirects). Paddle emits checkout.closed. The page replaces itself with a red-flag card: "We could not open checkout — Checkout was closed before payment completed. Nothing has been charged." The customer has been charged, believes they have not, and either re-runs checkout (a second transaction, since attemptKey dedupes nothing — see finding 8) or disputes the charge with their bank. A chargeback against a brand-new Paddle seller account is the worst possible outcome for an unregistered operator in underwriting.

**Fix.** Track completion in a ref set by the checkout.completed handler and make checkout.closed a no-op (or a neutral "finishing up" state) once completion has been seen. The 'Nothing has been charged' sentence must be conditional on that ref, never unconditional.


## [HIGH] CONFIRMED — /billing/success tells any visitor "Your payment went through", including signed-out ones, and meta-refreshes forever

`src/app/billing/success/page.tsx:56`

**Defect.** The page's pending branch states as fact "Your payment went through." It is reached whenever `summary === null || !summary.hasPaidPlan`, and `summary` is set to null by a bare `catch {}` around `requireUser()` — so an unauthenticated visitor, a signed-in free user who abandoned the overlay, a customer whose card was declined, and a customer whose draft transaction was never paid all receive the same assertion that their payment succeeded. The page asserts nothing about the transaction: it does not read _ptxn, does not query the provider, does not look at `subscriptions.status`. On top of that it emits `<meta httpEquiv="refresh" content="4" />` with no attempt counter, deadline, or give-up state, so the claim is re-rendered every four seconds indefinitely.

**How it fails.** A customer's card is declined inside the Paddle overlay and they abandon it. Later they reopen the tab from history, or simply follow the URL that docs/DEPLOYMENT.md:317 tells the operator to verify by visiting. They get "Finalising your subscription — Your payment went through. We are waiting for confirmation from our payment provider before switching on your new features… You will not be charged twice, and you do not need to do anything." They wait; the page reloads every four seconds for as long as the tab is open; features never unlock because no payment was made. They conclude they have bought the plan and either open a support ticket asserting they paid, or check their statement and see nothing and conclude Wintora took money and lost it. A signed-out stranger who is handed the URL gets the identical congratulation instead of a sign-in redirect. The repo's own test at tests/frontend-tamper.test.ts:83 names this exact scenario ("landing on it after abandoning payment") but only asserts that entitlements do not move — the copy was never checked.

**Fix.** Separate the three states. Let an unauthenticated request redirect to /signin?next=/billing/success instead of being swallowed. Only claim payment when there is evidence — e.g. a transaction id carried through and confirmed server-side, or a subscription row in CHECKOUT_PENDING for this user; otherwise say "We have not recorded a payment for your account" and offer /pricing. Cap the refresh (a client poll with an attempt limit and a terminal "this is taking longer than expected, contact support" state) rather than an unbounded meta refresh.


## [HIGH] CONFIRMED — Once the Paddle domain is approved, the returned checkout URL sends the customer to a success page that has no payment form

`src/components/CheckoutButton.tsx:102`

**Defect.** CheckoutButton follows `json.url` with `window.location.href` and trusts whatever the server returned. That URL is `transaction.checkout.url`, which Paddle builds as the value of `checkout.url` plus `?_ptxn=<id>` — and `checkout.url` is set to the SUCCESS url (adapter.ts:380). Today that combination is masked because Paddle rejects the unapproved localhost domain with HTTP 400, so the POST fails and the button shows an error. The obvious remedy a maintainer will apply to clear that 400 is to approve the app's domain in Paddle — at which point the call succeeds and the browser is sent to /billing/success?_ptxn=txn_xxx. That page renders no PaddleCheckout, loads no Paddle.js, and ignores _ptxn entirely; its only possible output for a user with no paid plan is the "Your payment went through" card from finding 3.

**How it fails.** Operator approves wintora.vercel.app in Paddle to fix the 400, then tests checkout. Customer clicks "Choose Pro" on /pricing, is redirected straight to /billing/success?_ptxn=txn_01…, and is told "Your payment went through. We are waiting for confirmation from our payment provider" — having never seen a card form and never paid a cent. The page refreshes every four seconds forever. There is no route back into the transaction: /checkout is never reached, so the draft transaction can never be paid. Every single purchase attempt fails while telling the customer it succeeded, and no charge is ever collected.

**Fix.** Fix the adapter (omit `checkout.url` so Paddle uses the default payment link pointing at /checkout, per the page's own docstring at checkout/page.tsx:4). Additionally, have CheckoutButton refuse to navigate to a URL whose pathname is not /checkout, so a misconfigured hosting URL surfaces as a visible error instead of a silent redirect to a congratulation page.


## [HIGH] CONFIRMED — isConfigured() has zero callers: nothing stops checkout opening with no webhook secret, so a customer can pay and never receive their plan

`src/lib/env.ts:144`

**Defect.** `isConfigured()` is exported with the doc comment "Used to fail closed rather than half-work", and its `payments` case states the exact money-path reason: "Both are required: without the webhook secret the endpoint fails closed, so checkout would succeed and entitlements would never arrive." A grep for `isConfigured` across src and tests returns no call sites outside its own definition. The function is never invoked, so the guard does not exist. `getPaymentProvider()` (src/lib/payments/index.ts:45) requires only PADDLE_API_KEY, and `assertProviderSuitable()` (src/domain/billing/provider.ts:251-268) checks only the webhookSupport capability and the currency list — neither looks at PADDLE_WEBHOOK_SECRET. The claim in .env.example and docs/DEPLOYMENT.md that the endpoint "fails closed without it" is true but protects the endpoint, not the purchase.

**How it fails.** PADDLE_WEBHOOK_SECRET is left unset on the Vercel deployment (it is one of seven Paddle-related values in the DEPLOYMENT.md §4a list, and nothing in the build or gate checks it). A customer clicks Subscribe: /api/billing/checkout resolves the price, creates a real Paddle transaction and returns a working checkout URL. The customer pays; Paddle charges the card. Paddle POSTs subscription.activated to /api/webhooks/paddle, which passes `serverEnv().PADDLE_WEBHOOK_SECRET` (route.ts:43) — undefined — into verifyPaddleSignature, which throws MISSING_SECRET and returns 400. Paddle retries and eventually stops. The subscriptions row is never written, entitlements are never recomputed, and the customer is on the Free plan having been charged. /billing/success keeps saying "finalising your subscription" forever.

**Fix.** Call it where it matters: in /api/billing/checkout before createCheckout, reject with BILLING_ERROR when `isConfigured('payments')` is false, so a misconfigured deployment refuses to take money rather than taking it and dropping the entitlement. Either that, or move the webhookSecret requirement into getPaymentProvider() alongside the PADDLE_API_KEY check. If isConfigured() is not meant to be the guard, delete it — a dead safety function reads as coverage that is not there.


## [HIGH] CONFIRMED — NEXT_PUBLIC_APP_URL silently defaults to http://localhost:3000 in production, breaking every POST and every checkout with no startup error

`src/lib/env.ts:17`

**Defect.** `NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000')` applies the localhost default in every NODE_ENV, including production. A deployment that is missing the variable, has it scoped to the wrong Vercel environment, or was built before it was set boots cleanly and serves traffic with appUrl = http://localhost:3000. Compounding it: the file's own comment at lines 113-114 records that "Next.js inlines NEXT_PUBLIC_ values at build time", so setting the variable in the Vercel dashboard without triggering a rebuild leaves localhost baked into the bundle — and docs/DEPLOYMENT.md never says to redeploy after changing it (its "Custom domain, later" section at line 246-247 says "update `NEXT_PUBLIC_APP_URL`... It is a DNS change and an env var, not a migration").

**How it fails.** The vercel.app deployment goes live with NEXT_PUBLIC_APP_URL unset, or set after the build. Nothing fails at boot. A customer loads /pricing (GET, fine) and clicks Subscribe. `assertSameOrigin` (src/lib/http/api.ts:48-61) compares Origin `https://wintora.vercel.app` against configured `http://localhost:3000`; NODE_ENV is production so the loopback allowance at src/lib/http/origin.ts:66-68 does not apply, and the request 403s. Every POST fails the same way — sign-up, sign-in, checkout. If the origin check is somehow satisfied, createCheckout then sends `checkout.url = http://localhost:3000/billing/success` and Paddle returns HTTP 400 transaction_checkout_url_domain_is_not_approved (measured). Separately, robots.ts:10, sitemap.ts:28 and layout.tsx:7 publish localhost URLs in the sitemap and canonical tags.

**Fix.** Make it required in production: drop the default when `process.env.NODE_ENV === 'production'` (or `.refine()` that a production value is neither loopback nor http:) so the deployment fails at first request with a named cause instead of 403ing every customer. Add a line to DEPLOYMENT.md §4a and the "Custom domain, later" section stating that NEXT_PUBLIC_* values are build-time inlined and changing one requires a redeploy, not just an env-var edit. For the vercel.app deployment to work at all, three things must be simultaneously true: NEXT_PUBLIC_APP_URL is exactly `https://<project>.vercel.app` (no trailing slash, set before the build), that origin is an approved/verified domain on the Paddle account, and the Paddle default payment link is `https://<project>.vercel.app/checkout`.


## [HIGH] CONFIRMED — Nothing at runtime ties PADDLE_ENVIRONMENT to the credentials, and the webhook path ignores it entirely — a sandbox notification destination grants real paid entitlements

`src/app/api/webhooks/paddle/route.ts:39`

**Defect.** PADDLE_ENVIRONMENT selects only the outbound API base URL (src/lib/payments/paddle/adapter.ts:37-40) and the Paddle.js environment (src/app/checkout/page.tsx:47). Nothing validates that PADDLE_API_KEY, NEXT_PUBLIC_PADDLE_CLIENT_TOKEN and PADDLE_WEBHOOK_SECRET belong to the same Paddle account as each other or as PADDLE_ENVIRONMENT. The only such check in the repository is scripts/doctor.mjs:383-397, which (a) parses `.env.local` off the local filesystem and therefore cannot see Vercel environment variables, and (b) is absent from `npm run gate` (package.json:22 = typecheck && verify:sql && verify:secrets && test), so CI and the deploy never run it. The inbound path is the dangerous half: the webhook route verifies the HMAC against PADDLE_WEBHOOK_SECRET and nothing else, Paddle notification payloads carry no environment marker, and sandbox object ids are indistinguishable in shape from live ones.

**How it fails.** Following docs/DEPLOYMENT.md §4a, the operator runs the production Vercel deployment with PADDLE_ENVIRONMENT=sandbox and sandbox credentials ("Test billing on the production deployment with sandbox Paddle credentials"), and the sandbox notification destination points at https://<project>.vercel.app/api/webhooks/paddle. Go-live day: they swap PADDLE_API_KEY, the client token and PADDLE_ENVIRONMENT to live, and either forget PADDLE_WEBHOOK_SECRET or simply leave the sandbox destination in place (the go-live checklist at DEPLOYMENT.md:227-234 never says to delete or re-point it). Anyone who can reach the sandbox dashboard — or any leftover sandbox test flow — now subscribes with Paddle's test card. The sandbox event verifies against the stored secret, claims idempotency, drives the state machine and recomputes entitlements; resolveUserId (src/lib/payments/handlers.ts:96-117) maps the sandbox customer id to a real user through the billing_customers rows written during sandbox testing. A real account holds paid Pro entitlements for a transaction in which no money moved. Detection is the once-daily reconcile cron, which looks the subscription up on the live account, finds nothing, and deliberately records PROVIDER_SUBSCRIPTION_MISSING without revoking (reconcile-billing/route.ts:72-81) — so the unpaid access persists until a human acts on the alert.

**Fix.** Cross-check the credential shapes inside serverEnv() / getPaymentProvider(), not only in a local script: refuse to boot when PADDLE_API_KEY contains `_live_` and PADDLE_ENVIRONMENT !== 'production', when it contains `_sdbx_` and PADDLE_ENVIRONMENT === 'production', or when NEXT_PUBLIC_PADDLE_CLIENT_TOKEN's `test_`/`live_` prefix disagrees with PADDLE_ENVIRONMENT. Add a go-live step to DEPLOYMENT.md: delete the sandbox notification destination before or at the moment live credentials are installed, and verify in the Paddle sandbox dashboard that no destination points at a production origin. Consider recording the PADDLE_ENVIRONMENT in use on each webhook_events row so a cross-environment event is visible in the data rather than only in a cron alert.


## [HIGH] CONFIRMED — No server-side record that a checkout was started: CHECKOUT_PENDING is dead state, so the one-live-per-user index never guards the checkout window

`src/app/api/billing/checkout/route.ts:133`

**Defect.** The route calls provider.createCheckout and returns the URL without writing anything to the database. CHECKOUT_PENDING exists as a subscription_status enum value (0001_extensions_and_types.sql:29), is a legal target of CHECKOUT_STARTED in the state machine (src/domain/billing/states.ts:60,127,131), is included in the subscriptions_one_live_per_user index (0004_billing.sql:82), has user-facing copy (states.ts:252), and is covered by tests (tests/billing-state-machine.test.ts:29-32) — but grep shows no code path anywhere that ever writes it. Because no CHECKOUT_PENDING row is ever created, the database-level at-most-one-live-subscription guarantee is inert for the entire window between starting a checkout and the webhook landing, which is exactly the window in which a duplicate is created.

**How it fails.** Two tabs, two POSTs thirty seconds apart. Each resolves a price, each calls Paddle, each returns a URL. Neither POST can see the other, because the only shared state that could have recorded the first attempt (a CHECKOUT_PENDING subscriptions row, whose partial unique index would have made the second insert fail loudly) is never written. A future maintainer reading states.ts, the migration, and the passing state-machine tests will reasonably believe a checkout-in-progress is tracked and guarded. It is not.

**Fix.** Either write the CHECKOUT_PENDING row the state machine already models (insert before calling the provider, let the partial unique index reject a concurrent second attempt, and return the existing checkout URL on conflict), or delete CHECKOUT_PENDING from the state machine, the index, and the copy so nothing implies a guard that does not run.


## [HIGH] CONFIRMED — Reconciliation is one-directional and structurally cannot detect a duplicate provider subscription

`src/app/api/cron/reconcile-billing/route.ts:37`

**Defect.** The cron selects rows from the local subscriptions table and, for each, fetches the matching remote object. It never enumerates the provider's subscriptions for a customer and compares against what we hold. Therefore a subscription that is live and billing at Paddle but has no local row — precisely the output of the duplicate-insert failure in handlers.ts:226 — is outside the loop's reach forever. The file's own header claims it "Compares the provider's subscription state against ours", which is only half true: it compares ours against theirs, never theirs against ours.

**How it fails.** Customer has sub_A recorded and sub_B live at Paddle but unrecorded. The nightly reconcile iterates the one local row, fetches sub_A, finds status, plan, period, and cancel flag all agreeing, and `continue`s. Checked: 1. Mismatches: 0. It reports a clean run while the customer is double-billed indefinitely. The only mismatch types the job can emit are PROVIDER_SUBSCRIPTION_MISSING (they have less than us) and BILLING_STATE_MISMATCH (fields differ) — there is no code path for they-have-more-than-us.

**Fix.** Add a provider-side sweep: for each billing_customers row, list the provider's subscriptions for that customer id and record a billing_reconciliations row of type UNRECORDED_PROVIDER_SUBSCRIPTION for any active one with no local subscriptions row. This requires adding a listSubscriptions(customerId) operation to the PaymentProvider port. Without it, double billing has no detector anywhere in the system.


## [HIGH] CONFIRMED — The upgrade path has no idempotency key at all, and its only guard reads state that only the webhook writes

`src/app/api/billing/checkout/route.ts:76`

**Defect.** For a user with an existing live subscription the route takes the plan-change branch and calls provider.changePlan, which PATCHes Paddle with proration_billing_mode: 'prorated_immediately' for an upgrade (adapter.ts, changePlan). PlanChangeRequest (src/domain/billing/provider.ts:178-183) has no attemptKey field, so attemptKey is not even nominally carried here. The only duplicate guard is `if (direction === 0) throw CONFLICT` at route.ts:76, computed from live.plans.slug — a column that, by the route's own design comment ("Entitlements change on the verified webhook, not here"), is not updated by this request. So a second request issued before the webhook lands still sees the OLD plan slug, still computes direction === 1, and still issues a second immediate-proration billing PATCH. CheckoutButton makes this trivially reachable: on an UPGRADED response it calls setBusy(false) at line 92 and re-enables the button while showing the message as if it were an error.

**How it fails.** Customer on Essential clicks Choose Pro. The server upgrades at Paddle with prorated_immediately and returns kind UPGRADED. CheckoutButton renders the message "Your new plan is being activated" inside a role=alert error paragraph and re-enables the button (line 92). The customer, seeing what looks like an error, clicks Choose Pro again two seconds later. The webhook has not landed, so the subscriptions row still says essential, so direction === 0 does not fire, and the route issues a second PATCH with proration_billing_mode prorated_immediately against the same subscription. Paddle is asked to bill a prorated charge twice for the same upgrade. Best case the second is a zero-value transaction; either way a second provider-side billing mutation and its invoice events are produced for a single customer action, with no key that could have suppressed it.

**Fix.** Carry the attemptKey into PlanChangeRequest and make the change conditional on it server-side (record the attempt before the PATCH, return the prior result on replay). Separately, stop re-enabling the button after UPGRADED in CheckoutButton.tsx:92 and render the message as a success notice rather than role=alert, so the UI does not invite the second click.


## [MEDIUM] CONFIRMED — attemptKey provides no idempotency at all, despite two comments promising it does — a retry creates a second chargeable transaction

`src/lib/payments/paddle/adapter.ts:378`

**Defect.** attemptKey is written into Paddle custom_data as `attempt` and is read by nothing: grep for `plan_slug` / `attempt` across src/, scripts/ and supabase/ finds no consumer of either custom_data field. No Paddle idempotency header is sent, no row is stored keyed on the attempt, and the route does not look for an existing open transaction before creating one. So POST /api/billing/checkout unconditionally creates a new Paddle transaction on every call. Two comments state the opposite: CheckoutButton.tsx:28-34 ("It must survive a retry (so a double click or a refresh does not create a second transaction)") and provider.ts:168 ("Stable across retries of the same attempt").

**How it fails.** Customer clicks Choose Plus, the tab is slow, they reload and click again. Two Paddle transactions now exist for the same price, each with its own live checkout URL. They complete the first, the page gives them no confirmation (see the successUrl finding), so they go back and complete the second. Paddle creates two subscriptions and charges two monthly prices. Our pre-checkout guard cannot prevent this because it only runs before checkout, and it then breaks: route.ts:62-67 uses `.maybeSingle()` on a query that now matches two subscription rows, PostgREST returns an error, the code discards the error and reads `data` as null, so the user appears unsubscribed — they can start a third checkout, and every later upgrade/downgrade silently falls through to the new-checkout branch instead of changePlan.

**Fix.** Persist the attempt: a table keyed `unique (user_id, attempt_key)` holding provider, plan, price id, returned transaction id and checkout URL. On a repeat POST with the same attemptKey, return the stored URL instead of creating a second transaction. Also make the existing-subscription guard use a list query plus an explicit count rather than .maybeSingle(), and stop discarding that error. Until idempotency is real, delete or correct the two comments that claim it — they are exactly the kind of statement a maintainer trusts on a money path.


## [MEDIUM] CONFIRMED — The returned transaction id is never persisted, and the transaction→subscription link is dropped in normalization, making syncFromProvider permanently dead code

`src/lib/payments/paddle/adapter.ts:394`

**Defect.** `return { url, sessionId: transaction.id }` flows only into the HTTP response body (route.ts:148) and is then discarded; no table in supabase/migrations holds a Paddle transaction id except invoices.provider_invoice_id, which is written only if and when a webhook arrives. Separately, verifyAndParseWebhook never extracts `subscription_id` from a transaction payload — the string `subscription_id` does not appear in the adapter or in the port — and NormalizedEvent has no field to carry it. For any `transaction.*` event, `isSubscription` is false, so `subscription` is undefined.

**How it fails.** Two consequences. (1) No correlation: a customer says "I started a purchase and was charged / was not charged." There is no row linking their user id to the transaction id, the attempt, the price or the time, so the only way to answer is to search the Paddle dashboard by email. An abandoned or 400-failed checkout leaves no trace at all. (2) Dead safety net: PAYMENT_SUCCEEDED on `transaction.completed` calls syncFromProvider (handlers.ts:374), whose first act is `const ref = event.subscription?.providerSubscriptionId` — always undefined for a transaction event — so it returns immediately having done nothing. The documented fallback "A successful payment may or may not carry the subscription object. When it does not, re-read from the provider rather than inferring" can never execute for Paddle. Activation therefore depends entirely on subscription.created/activated arriving; if one of those is dropped or permanently fails while transaction.completed succeeds, the customer is charged, the invoice row is written, and they are never granted the plan, with no second path to recover.

**Fix.** Store sessionId on the attempt row from the previous finding (user_id, attempt_key, provider, transaction id, plan, price id, status, created_at), which also gives checkout a reconciliation surface. Add `readonly subscriptionRef?: string` to NormalizedEvent, populate it in verifyAndParseWebhook from the transaction payload's `subscription_id`, and have syncFromProvider fall back to it so the re-read path can actually run.


## [MEDIUM] UNVERIFIED — No reconciliation path exists for a subscription that Paddle has and we do not, so every 'paid and got nothing' case is permanent and silent

`src/app/api/cron/reconcile-billing/route.ts:44`

**Defect.** The reconcile cron iterates only rows that already exist in our own subscriptions table with a non-null provider_subscription_id and a live status. It can detect 'we think it is live and Paddle does not' (PROVIDER_SUBSCRIPTION_MISSING) but never the inverse — a paid Paddle subscription with no local row. Every failure mode in Findings 1-6 produces exactly that inverse state. Meanwhile the handlers silently drop unattributable events: `sync` at least writes an UNATTRIBUTED_SUBSCRIPTION reconciliation row (handlers.ts:309-316), but syncFromProvider (handlers.ts:385-386) and upsertInvoice (handlers.ts:397-398) just `return;` when userId is null, leaving no trace at all. Nothing consumes billing_reconciliations to retry or re-attribute; the row is a note for a human that no alerting path surfaces.

**How it fails.** A subscription.created event is lost or its handler is permanently no-op'd (Findings 1, 3). No subscriptions row exists. The next reconcile run selects from subscriptions, finds nothing for that user, and reports checked=0 mismatches=0 — a clean bill of health while a charged customer holds free entitlements. The only way anyone learns is the customer emailing support. Similarly, if custom_data is absent and the billing_customers mapping is missing (which it always is today, per Finding 1), the subscription event writes one UNATTRIBUTED_SUBSCRIPTION row and stops; no job ever revisits it, so the customer stays unpaid-for forever.

**Fix.** Add the opposite sweep: list Paddle subscriptions with status active/trialing/past_due (GET /subscriptions) and flag any whose id has no row in our subscriptions table as PROVIDER_SUBSCRIPTION_UNRECORDED, attempting attribution via the subscription's customer_id -> billing_customers and custom_data. Make syncFromProvider and upsertInvoice write an UNATTRIBUTED_PAYMENT reconciliation row instead of returning silently, and alert on any unresolved billing_reconciliations row older than a few minutes.


## [MEDIUM] UNVERIFIED — Every plan row says provider='stripe' while holding Paddle product and price ids, and the documentation claims the opposite

`supabase/migrations/0003_catalog.sql:43`

**Defect.** plans.provider is declared `billing_provider not null default 'stripe'` and supabase/migrations/0012_seed_catalog.sql never sets it, so all four live plan rows carry provider='stripe' while their provider_product_id columns hold Paddle product ids and their plan_prices rows hold Paddle price ids. The seed migration's own comment compounds it by saying the ids come from Stripe. docs/DATABASE.md then documents the column as defaulting to 'paddle', which the enum cannot even represent. Nothing in the money path reads plans.provider today, so no charge is wrong because of this — but it is configuration that a future maintainer would reasonably trust, and it is the same root confusion that produced the enum defect.

**How it fails.** A maintainer adds a second payment provider, or writes a reporting query, or builds the per-provider routing the provider column exists for, and filters plans on provider. Under Paddle every plan row answers 'stripe', so a filter for the live provider returns zero plans and a filter for 'stripe' returns all of them — the opposite of the truth in both directions. A maintainer reading docs/DATABASE.md:184 instead believes the default is already 'paddle' and writes code that assumes it, which fails at runtime on the enum. Separately, plan_prices_provider_price_unique (0003_catalog.sql:93-95) is a global unique index on provider_price_id with no provider dimension, so a future second provider that reuses an id string collides.

**Fix.** After adding 'paddle' to the enum, change the defaults on plans and the five billing tables to 'paddle' and update the existing plan rows. Set provider explicitly in the 0012 seed insert rather than relying on a default. Fix the Stripe references in the 0012 comments and correct docs/DATABASE.md so it describes the schema the migrations actually create. Consider widening plan_prices_provider_price_unique to (provider, provider_price_id) before a second provider exists.


## [MEDIUM] UNVERIFIED — attemptKey is required by the schema, then ignored in the plan-change branch, leaving the only synchronous money-moving call with no idempotency

`src/app/api/billing/checkout/route.ts:82`

**Defect.** attemptKey is parsed and documented as the guard that 'distinguishes a genuine second purchase from a retry of the first', but it is passed only to createCheckout. The plan-change branch never uses it, and there is no other idempotency key on that path. The CONFLICT guard cannot substitute for one, because it compares against the stored plan slug, which does not change until the webhook lands.

**How it fails.** A customer clicks 'Choose Pro' while on Essential. CheckoutButton receives kind='UPGRADED', calls setBusy(false) and renders the message in the error slot, so the button is live again. The webhook has not landed, so the stored plan is still Essential. An impatient or confused second click (or a refresh plus retry, which deliberately reuses the same sessionStorage attemptKey) sends a second PATCH with proration_billing_mode 'prorated_immediately'. Two immediate proration transactions are created against the customer's card for one intended upgrade, with nothing in the request or the route able to recognise the second as a retry of the first.

**Fix.** Thread attemptKey into PlanChangeRequest and record it (for example a unique (subscription_id, attempt_key) row written before the PATCH) so a repeat is answered from the stored result instead of re-issuing a live charge. Keep the button disabled after an UPGRADED response until a fresh summary confirms the new plan.


## [MEDIUM] UNVERIFIED — Upgrading a subscription that is already scheduled to cancel charges the proration immediately and leaves the cancellation in place

`src/app/api/billing/checkout/route.ts:66`

**Defect.** CANCELED_PENDING_EXPIRY is admitted to the plan-change branch. For such a subscription Paddle holds a scheduled_change with action 'cancel'. The PATCH changes items and bills the prorated upgrade immediately; it does not clear scheduled_change (the adapter's reactivate() is the only code that does that, and no route calls it). The customer pays extra now for a plan that terminates at period end, and the response tells them their new plan is being activated with no mention that the cancellation still stands.

**How it fails.** A customer cancels Plus on day 5; status becomes CANCELED_PENDING_EXPIRY with access through day 30. On day 12 they decide they need Pro for one more document and click Pro. comparePlans says upgrade, so Paddle charges a prorated Plus-to-Pro difference immediately. The scheduled cancellation is untouched, so on day 30 the subscription ends. They were charged an upgrade fee for 18 days, were told 'Your new plan is being activated', and were never told the cancellation remained — or alternatively they believe the upgrade reactivated their subscription and are surprised when it ends.

**Fix.** Either exclude CANCELED_PENDING_EXPIRY from the plan-change branch and require the customer to resume first, or clear scheduled_change as part of the upgrade and say plainly in the response that the pending cancellation was removed.


## [MEDIUM] REFUTED — Permissions-Policy payment=(self) denies the Payment Request API to the cross-origin Paddle checkout iframe

`src/middleware.ts:57`

**Defect.** The response header sets `payment=(self)`, whose allowlist contains only the top-level Wintora origin. Permissions Policy is one of the few response headers that propagates into cross-origin subframes: a frame from https://buy.paddle.com (or sandbox-buy.paddle.com) can only use the `payment` feature if the top-level policy's allowlist includes its origin, regardless of any `allow="payment"` attribute Paddle.js puts on the iframe it creates. The Paddle overlay's Apple Pay and Google Pay flows depend on that feature. Nothing in the repo reconciles this with the CSP work that was done specifically to let the overlay run — csp.ts was carefully widened for Paddle, middleware.ts's Permissions-Policy was not, and docs/SECURITY.md:179 records the header as-is without noting the interaction.

**How it fails.** A US customer on Safari/iOS opens checkout intending to pay with Apple Pay. The Payment Request API is unavailable in the Paddle frame, so Paddle either hides the wallet option or its button fails, leaving only manual card entry. A mobile customer who does not have their card to hand abandons the purchase. The failure is invisible server-side — it looks like a normal abandoned checkout — so conversion loss from it will never be attributed to a header.

**Fix.** Extend only the payment feature to Paddle's checkout origins, e.g. `payment=(self "https://buy.paddle.com" "https://sandbox-buy.paddle.com")`, and pin it in tests/csp.test.ts alongside the frame-src assertion so the two cannot drift apart again. Verify wallet methods render in a sandbox checkout before launch.

**Why refuted.** The header text is quoted accurately (C:\Users\conta\OneDrive\Documents\Wintora\src\middleware.ts:56-58 sets `camera=(), microphone=(), geolocation=(), payment=(self), interest-cohort=()`, and C:\Users\conta\OneDrive\Documents\Wintora\src\lib\http\csp.ts:62 does allow `frame-src https://*.paddle.com`), and /checkout is inside the middleware matcher, so the header does reach the page that hosts the overlay. But the finding fails the reachability test on four counts.

1. THE NAMED SCENARIO IS UNREACHABLE IN THE NAMED BROWSER. The scenario is "a US customer on Safari/iOS ... intending to pay with Apple Pay." WebKit does not implement the `Permissions-Policy` response header at all (it honors only the iframe `allow` attribute for a handful of features). Firefox does not implement it either. The header is Chromium-only, so the one customer the finding describes is entirely unaffected by it. Apple Pay in the Paddle frame on Safari/iOS cannot be broken by this line.

2. THE MECHANISM IS MIS-STATED IN A WAY THAT MATTERS. The finding asserts the frame is denied the feature "regardless of any allow='payment' attribute Paddle.js puts on the iframe." That is wrong: cross-origin delegation requires BOTH the parent's declared allowlist to cover the child origin AND the `allow` attribute on the iframe. The `allow` attribute is necessary, not irrelevant. This matters for reachability in both directions — if Paddle.js does not set `allow="payment"` on its overlay iframe, the wallet is unavailable no matter what Wintora's header says, and widening the header is a no-op. The finding's own evidence does not establish which half is actually operative, and nothing in the repo can establish it (paddle.js is loaded from cdn.paddle.com at runtime, src/components/PaddleCheckout.tsx:39).

3. THE REMAINING CHROMIUM SLIVER DEPENDS ON A CHAIN OF PRECONDITIONS NONE OF WHICH ARE ESTABLISHED. For a real customer to lose anything, all of these must hold simultaneously: customer on Chromium; wallets enabled and offered on this operator's Paddle account for US/CA (not true in sandbox, where this account currently is, per PADDLE_ENVIRONMENT handling at src/app/checkout/page.tsx:47); Paddle routing that wallet through the Payment Request API rather than its own popup; and Paddle setting `allow="payment"`. That is a speculative chain, not a reachable defect.

4. IT IS NOT A DEFECT UNDER THE AUDIT'S OWN DEFINITION, EVEN AT WORST CASE. The `payment` feature gates only the Payment Request API / wallet path. Plain card entry in a cross-origin iframe needs nothing from Permissions Policy, so no customer is ever blocked from paying, charged wrongly, left uncharged on a completed purchase, or granted unpaid access. And nothing false is shown: a grep across all of src/ and docs/ for "apple pay|applepay|google pay|googlepay|wallet|paypal" returns ZERO matches — the product never advertises a wallet method, and src/config/disclosures.ts speaks only generically of "card or bank statement." So there is no promise the header contradicts. The stated harm is abandoned-checkout conversion loss on an unadvertised payment method, which is a conversion-optimization opinion, explicitly outside "report DEFECTS, not opinions."

WHAT IS LEFT, AND WHY IT DOES NOT CARRY MEDIUM SEVERITY IN A MONEY-PATH AUDIT: the one accurate residual is that explicit `payment=(self)` is genuinely narrower than omitting the directive — with the directive absent, a child with `allow="payment"` would inherit the feature, so this is not a no-op write of the spec default. That makes it a defensible hardening note for a Chromium wallet flow the operator has not enabled yet, not a payments-go-live defect. Separately and unrelated to this finding, I did notice real doc drift worth a line somewhere: docs/SECURITY.md:179 records the header as `camera=(), microphone=(), geolocation=(), payment=(self)` and omits the `interest-cohort=()` token that middleware.ts:58 actually sends, and tests/csp.test.ts pins the CSP only — it contains no assertion about Permissions-Policy at all, so neither the doc nor the test suite would catch a change to that header.


## [MEDIUM] CONFIRMED — /checkout opens any well-formed _ptxn with no check that the transaction belongs to the visitor

`src/app/checkout/page.tsx:41`

**Defect.** _ptxn is validated for FORMAT only (`/^txn_[A-Za-z0-9]+$/`) and then handed straight to Paddle.js. The page is not authenticated — it calls neither requireUser nor any session read (middleware.ts lists /checkout in PRIVATE_PREFIXES, but that block only sets X-Robots-Tag and Cache-Control, it performs no auth gate) — and nothing compares the transaction's `custom_data.wintora_user_id` against the current session. So the page will open a payment form for an arbitrary third party's transaction. Format validation is safe against injection (the value is never interpolated into HTML and the page is noindex/no-store, so the regex is doing its job); ownership is the missing check.

**How it fails.** Attacker signs up, clicks Choose Pro, and captures the /checkout?_ptxn=txn_A URL for their own transaction — which carries custom_data.wintora_user_id = attacker. They send it to a victim as "complete your Wintora subscription". The victim (signed in or not — the page does not care) lands on a genuine Wintora-branded checkout page with the real disclosures, pays, and Paddle collects from the victim's card. The webhook resolves custom_data to the ATTACKER's user id, so the attacker's account is upgraded to Pro. The victim is charged and granted nothing, and the Wintora page gives them no indication whose subscription they just funded.

**Fix.** On the server, fetch the transaction for the supplied _ptxn (GET /transactions/{id}) and render the overlay only when its custom_data.wintora_user_id equals the signed-in user's id, redirecting to /signin?next=... when there is no session. Accept the cost of one API call; it is the only thing standing between a phished link and a mis-attributed charge.


## [MEDIUM] CONFIRMED — Any asynchronous Paddle.js failure leaves the page permanently claiming the payment form is about to appear

`src/components/PaddleCheckout.tsx:106`

**Defect.** `setPhase('opening')` is immediately followed by `paddle.Checkout.open(...)` and then `setPhase('open')` on the next line, synchronously. `Checkout.open` does its work asynchronously, so the try/catch around it cannot observe a failed open, and the component subscribes to no failure event — the eventCallback handles only `checkout.closed` and `checkout.completed`, not Paddle's error events, and there is no timeout that escalates a never-opened overlay into the error state.

**How it fails.** The transaction id is stale (already completed, or voided after Paddle's 24h draft expiry), or PADDLE_ENVIRONMENT is production while NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is a sandbox test_ token (nothing in src/lib/env.ts cross-checks the two: both are plain optional/enum fields). Paddle.js rejects asynchronously and logs to the console. The customer sees a card reading "Opening checkout for plus — The payment form should appear in a moment." and nothing else, forever. There is no error, no retry button, no "Back to plans" (that link exists only in the error card), and no telemetry: the customer cannot pay and the operator never learns that anyone tried.

**Fix.** Set 'open' from Paddle's loaded event rather than synchronously, handle its error events by calling fail() with the reason, and add a timeout (e.g. 15s with no loaded event) that falls back to the error card. Separately, validate in env.ts that a sandbox PADDLE_ENVIRONMENT pairs with a test_-prefixed client token, so the mismatch fails at boot rather than silently at the customer's checkout.


## [MEDIUM] CONFIRMED — attemptKey is dead: the documented retry-deduplication does not exist, so every click mints a new Paddle transaction

`src/components/CheckoutButton.tsx:30`

**Defect.** CheckoutButton builds and persists a per-plan sessionStorage key with the stated purpose "so a double click or a refresh does not create a second transaction", and the route's schema comment calls it the thing that "distinguishes a genuine second purchase from a retry of the first". Neither is true. The value travels through the route into the Paddle transaction's `custom_data.attempt` (adapter.ts:378) and is read by nothing: grep for attemptKey/attempt across src/ finds only the definition, the request body, the type, and that one write. No query, no unique index, no lookup before creating a transaction.

**How it fails.** Customer clicks "Choose Pro", the overlay opens, they hesitate and hit browser Back, then click "Choose Pro" again — or open /pricing in a second tab and click there. Each click creates a fresh Paddle transaction for the same price; the identical attemptKey in custom_data prevents nothing. If the customer pays in two tabs (plausible when the first overlay appears stuck, which finding 7 makes likely), Paddle collects twice and emits two subscription-creation events for one user. The browser-side claim that a retry is safe is exactly what makes a maintainer skip adding real idempotency.

**Fix.** Either implement it — persist (user_id, attemptKey) with a unique constraint and return the existing transaction's checkout URL on a repeat — or delete the mechanism and the two comments that promise it. Leaving a named idempotency key that dedupes nothing is worse than having none.


## [MEDIUM] CONFIRMED — /billing/success shows the "Confirmed / renews automatically" celebration for PAST_DUE and GRACE subscriptions

`src/app/billing/success/page.tsx:73`

**Defect.** The confirmed branch is gated only on `summary.hasPaidPlan`, which is `isPaidPlan(effectivePlan(snapshot))`. PAST_DUE and GRACE are deliberately entitlement-granting statuses (src/domain/billing/states.ts:141-149: "PAST_DUE and GRACE are deliberately included: premium access is not cut"), so a customer whose renewal payment has FAILED satisfies hasPaidPlan. The page then renders "Confirmed — You are now subscribed to <plan>" plus a row "Renews automatically: Yes" (autoRenews is `!cancelAtPeriodEnd && isPaidPlan(plan)`, which ignores status entirely). `summary.statusDescription` — which for GRACE reads "Your payment has not gone through yet" — is loaded and never rendered.

**How it fails.** A subscriber's card expires; the renewal fails; the subscription moves to GRACE and dunning starts. The customer revisits /billing/success from browser history (it is the page they were on when they first subscribed, and the page they are refreshed onto by the pending branch). They read "Confirmed. You are now subscribed to Pro. Renews automatically: Yes. Next billing date: <date>." They do not update their card, the grace period expires, and they lose access having been told days earlier that everything was confirmed and auto-renewing.

**Fix.** Gate the celebration on `summary.status === 'ACTIVE' || summary.status === 'TRIALING'` and render `summary.statusDescription` for every other status, with a link to update payment details for PAST_DUE/GRACE. Derive autoRenews from status as well as plan.


## [MEDIUM] CONFIRMED — Client-token environment is never validated, and PaddleCheckout reports success on a token Paddle.js rejects — the customer is told the payment form is coming and it never arrives

`src/components/PaddleCheckout.tsx:86`

**Defect.** NEXT_PUBLIC_PADDLE_CLIENT_TOKEN carries a `test_` or `live_` prefix (documented in docs/DEPLOYMENT.md:84) that must match PADDLE_ENVIRONMENT, and nothing checks it: the env schema treats it as an optional opaque string (src/lib/env.ts:21) and scripts/doctor.mjs lists it only under "Not configured yet" (:422) with no prefix check, unlike the API key. The component then converts a mismatch into a false positive: `paddle.Initialize()` and `paddle.Checkout.open()` sit in one try/catch, and `setPhase('open')` runs unconditionally on the line after open() returns, so a token Paddle.js rejects asynchronously never reaches the error branch.

**How it fails.** Go-live leaves a sandbox `test_...` client token in place while PADDLE_API_KEY and PADDLE_ENVIRONMENT are live. A customer clicks Subscribe. The server creates a real transaction on the live Paddle account and returns its checkout URL; the browser lands on /checkout?_ptxn=txn_... The page loads Paddle.js, skips Environment.set (environment is 'production'), calls Initialize with a sandbox token — rejected by Paddle asynchronously, so the synchronous try/catch does not fire — then calls Checkout.open and immediately sets phase 'open'. The overlay never appears. The customer sits on "Opening checkout" / "The payment form should appear in a moment." with no error, no retry prompt and no way to pay, while an open transaction exists on the live account.

**Fix.** Validate the pairing where it is cheap: reject at boot (or in the checkout page) when the token prefix and PADDLE_ENVIRONMENT disagree. In the component, do not treat Checkout.open() returning as success — set a timeout that flips to the error state if no `checkout.loaded`/`checkout.completed` event arrives within a few seconds, and surface Paddle.js error events from eventCallback rather than only `checkout.closed`.


## [MEDIUM] REFUTED — `npm run doctor` reports ok for the exact NEXT_PUBLIC_APP_URL that cannot take a payment

`scripts/doctor.mjs:353`

**Defect.** The doctor's placeholder list is `['something.trycloudflare.com', 'example.com', 'yourdomain.com', 'your-domain.com']` — localhost is absent, so the current value http://localhost:3000 is reported as `[ok  ] NEXT_PUBLIC_APP_URL — http://localhost:3000`. The same omission exists in the runtime helper `isPlaceholderAppUrl` (src/lib/http/origin.ts:80-86), so the 403 hint never fires for localhost either. The doctor additionally never checks that the app URL is https, that a Paddle default payment link exists, or that the link's origin equals NEXT_PUBLIC_APP_URL — the three facts that actually decide whether a checkout can be created. Paddle's default payment link is in fact set but points at a dead ephemeral tunnel (https://upgrading-attempted-migration-loved.trycloudflare.com/checkout), and nothing in the repository can see or flag that.

**How it fails.** Before going live the operator runs `npm run doctor`, the tool built to answer "is my configuration right?". It prints "No blocking problems." with NEXT_PUBLIC_APP_URL marked ok. They then enable payments. Every checkout attempt fails: createCheckout sends checkout.url = http://localhost:3000/billing/success and Paddle returns HTTP 400 transaction_checkout_url_domain_is_not_approved (measured), surfacing to the customer as the generic "We could not reach the payment provider." The operator has a green diagnostic and a 100% checkout failure rate, with nothing connecting the two.

**Fix.** In the doctor, treat a loopback or http: NEXT_PUBLIC_APP_URL as FAIL whenever PADDLE_API_KEY is present, with the reason spelled out (Paddle rejects an unapproved checkout URL domain). Add an active check that calls the Paddle API for the account's default payment link and fails when its origin does not equal NEXT_PUBLIC_APP_URL or when its host is a *.trycloudflare.com tunnel. Add localhost and 127.0.0.1 to PLACEHOLDER_HOSTS in origin.ts so the production 403 hint names the real cause.

**Why refuted.** The code facts are accurate, but the defect is not reachable and the flagged omission is deliberate, not an oversight.

1. localhost's absence from the placeholder list is intentional and test-asserted. `tests/origin.test.ts:126` explicitly asserts `expect(isPlaceholderAppUrl('http://localhost:3000')).toBe(false)`. The list's documented purpose (src/lib/http/origin.ts:76-79, scripts/doctor.mjs:345-351) is narrow: catch hostnames pasted out of documentation that break the CSRF origin check. localhost is the correct local dev value, so adding it would make `npm run doctor` FAIL for every developer in a normal, correct setup.

2. The sub-claim "the 403 hint never fires for localhost either" describes a case that cannot occur. In development, `checkOrigin` explicitly allows loopback and LAN origins (src/lib/http/origin.ts:66-68), so there is no 403 to hint about. In production with appUrl=localhost there is no loopback allowance, but the thrown reason already names both origins verbatim — "cross-origin request from https://x.vercel.app, expected http://localhost:3000" (origin.ts:70-73) — which is a strictly better diagnostic than the placeholder hint. Nothing is hidden.

3. The customer-facing harm is unreachable. The failing value lives in `.env.local` (doctor's default target, scripts/doctor.mjs:19), which is not the deployed configuration — Vercel env vars are set separately, and docs/DEPLOYMENT.md:195 specifies `NEXT_PUBLIC_APP_URL https://<your-project>.vercel.app`. With localhost in .env.local there are no real customers. And if localhost somehow reached a deployment, `assertSameOrigin` (src/lib/http/api.ts:52-72) would 403 every state-changing request under NODE_ENV=production — sign-in, upload, everything — so no customer could ever reach a checkout. The described outcome (green diagnostic, 100% silent checkout failure for paying customers) is guarded by a far earlier and far louder failure.

4. "Nothing in the repository can see or flag that" is false. `scripts/tunnel-url.mjs:61` prints the exact required value (`Default payment link  ${base}/checkout`) and its header states that the tunnel hostname must be copied into three places including the Paddle default payment link; `scripts/seed-paddle.mjs:245` lists it as a required manual step; docs/DEPLOYMENT.md:103-111 explains that `transaction.checkout.url` is this link with `?_ptxn=` appended and that "Without it Paddle returns no checkout URL at all"; :127 states plainly "Paddle cannot reach localhost"; :221-223 states `NEXT_PUBLIC_APP_URL` must match the deployment origin exactly and "The production build has no loopback allowance"; :226-234 is an after-first-deploy checklist that sets the payment link to the deployment origin. The three facts the finding says nothing covers are each covered in the repo's own deployment doc.

5. The doctor is not the go-live gate it is portrayed as. Its header (scripts/doctor.mjs:7-8) scopes it to ".env.local is filled in correctly and the services it points at actually respond," and it is absent from `npm run gate` (package.json). `[ok] NEXT_PUBLIC_APP_URL — http://localhost:3000` is a true statement about a variable that is present and parseable; the tool never claims checkout will succeed.

What is real here is the separately-reported adapter bug (`checkout: { url: request.successUrl }`) and the stale dashboard link — not this. This finding is a wish for a more thorough diagnostic, dressed as a MEDIUM money-path defect.


## [MEDIUM] CONFIRMED — Six PADDLE_PRICE_* names are dead config presented as authoritative, with a false claim that the seed script populates them

`src/config/plans.ts:29`

**Defect.** Dead config, not a half-built fallback. `PlanPrice.providerPriceIdEnv` names PADDLE_PRICE_ESSENTIAL_USD/CAD, PADDLE_PRICE_PLUS_USD/CAD and PADDLE_PRICE_PRO_USD/CAD (plans.ts:133, 139, 188, 194, 242, 248). None of the six appears in serverSchema (src/lib/env.ts:26-103), so `serverEnv()` could not expose them even if something asked; the field itself is read by nothing (grep for `providerPriceIdEnv` returns only the interface and the six literals); and `resolvePriceId` (src/lib/payments/index.ts:85-125) reads plan_prices exclusively and throws when provider_price_id is null with the explicit comment "Fail loudly rather than charging a wrong or default amount." Worse than dead, the provenance comments are false. plans.ts:29 says the field is "Filled in by `npm run paddle:seed -- --apply` before launch", and .env.example says the six vars are "Filled in automatically by `npm run paddle:seed -- --apply`" — scripts/seed-paddle.mjs writes only to Postgres via the Supabase REST API (plans.provider_product_id at :141-144 and :162-166, plan_prices.provider_price_id at :213-216) and never opens .env.local for writing. .env.example then contradicts itself two lines later with "these exist only for reference", and points at "docs/BILLING.md section 2", which does not mention env-held price ids at all.

**How it fails.** A maintainer runs `npm run paddle:seed -- --apply`. It succeeds and prints "Every paid plan now resolves to a Paddle price." They open .env.local, see all six PADDLE_PRICE_* keys still empty as the template promised they would be filled, and conclude the seed failed — or they fill them in by hand from the Paddle dashboard, believing that is what makes checkout work, and then cannot explain why editing them changes nothing. `npm run env:sync -- --apply` keeps re-adding the six empty keys from the template forever (scripts/sync-env.mjs:123-136), so the trap never ages out. The latent version is worse: a future maintainer, reading providerPriceIdEnv as an intended fallback, wires it up; an env-supplied price id that disagrees with the plan_prices row then shows the customer the row's amount_cents on /pricing while charging the Paddle price's amount.

**Fix.** Delete, do not build. Remove `providerPriceIdEnv` from the PlanPrice interface and all six literals from plans.ts; remove the six keys and their comment block from .env.example. Keep the database as the single source of the price id, which it already is. Fix the remaining comment so it names the real destination: the seed writes `plan_prices.provider_price_id` in Postgres. An env-var fallback must never be added here, because plan_prices.amount_cents is what the pricing page renders while the Paddle price id is what determines the charge — two sources that can disagree means a customer shown one price and charged another.


## [MEDIUM] REFUTED — Docs state the wrong Paddle prerequisite for the checkout URL the code sends, and explicitly tell the reader sandbox needs no domain approval

`docs/DEPLOYMENT.md:248`

**Defect.** No document mentions Paddle's approved-domain requirement for the URL the application sends, and one document denies it for sandbox. DEPLOYMENT.md:248 reads "Paddle **live** requires domain verification, so the domain has to exist before going live even though sandbox does not need it." Measurement contradicts this: creating a sandbox transaction with checkout.url = http://localhost:3000/billing/success returns HTTP 400 transaction_checkout_url_domain_is_not_approved. BILLING.md:78-80 states the prerequisite as "Set a default payment link under Checkout settings. Hosted checkout returns no URL without one, and `createCheckout` fails loudly rather than silently" — but because the adapter supplies `checkout: { url: ... }` (adapter.ts:380), Paddle never consults the default payment link, so the documented failure mode (no URL returned, handled by the adapter's BILLING_ERROR at :386-392) is not the one that occurs. BILLING.md §4 step 3 (:138-140) describes checkout.url purely as a value Paddle returns, so no reader would learn that the app sends it. Neither doc names the approved-domains setting or the error code.

**How it fails.** The operator follows DEPLOYMENT.md §3 exactly: sets the default payment link to their deployment's /checkout, skips domain approval because line 248 says sandbox does not need it, and starts testing. Every checkout fails with "We could not reach the payment provider." They search BILLING.md §2 item 3 and DEPLOYMENT.md §3 item 4, both of which describe the default payment link as the prerequisite, confirm it is set, and have no documented path to the actual cause. Nothing in any document connects transaction_checkout_url_domain_is_not_approved to either the approved-domains setting or to the fact that the app itself supplies the URL.

**Fix.** Correct line 248 — sandbox also rejects an unapproved checkout URL domain — and add an explicit prerequisite to DEPLOYMENT.md §3 and BILLING.md §2: the deployment origin must be added as an approved domain on the Paddle account (sandbox and live separately), and the default payment link must be `https://<origin>/checkout` matching NEXT_PUBLIC_APP_URL exactly. Name the error code transaction_checkout_url_domain_is_not_approved so a search lands on the fix. State in BILLING.md §4 whether the app supplies checkout.url or relies on the default payment link — and make the code and the doc agree on one answer.

**Why refuted.** The headline claim — "Docs state the wrong Paddle prerequisite for the checkout URL the code sends" — is refuted by the very section the finding cites but evidently did not read in full. C:\Users\conta\OneDrive\Documents\Wintora\docs\DEPLOYMENT.md:102-110 (§3 item 4) says: "**Default payment link**, under Checkout → Checkout settings: `https://<your-deployment>/checkout` … Paddle Billing has **no fully-hosted checkout**. `transaction.checkout.url` is this link with `?_ptxn=<id>` appended, and `/checkout` in this app opens the overlay. Without it Paddle returns no checkout URL at all." That is a precise, correct statement of the exact semantics the adapter violates (checkout.url = the page that HOSTS the overlay, ?_ptxn appended, app's /checkout is the target), and DEPLOYMENT.md:230 tells the operator to point the default payment link at `https://<project>.vercel.app/checkout` — also correct per established fact 4. So the docs state the right prerequisite for the right design.

Each doc citation, checked against the file:
(1) DEPLOYMENT.md:248 is quoted verbatim — correct quote, but it sits under "### Custom domain, later" and its subject is Paddle **live** seller/website *verification* of a custom domain. Paddle's live website-verification step genuinely has no sandbox equivalent; sandbox lets you add a domain with no verification. The measured 400 was for `http://localhost:3000`, a domain never added to that account — that is the approved-domains list, a different setting. Reading line 248 as "explicitly tells the reader sandbox needs no domain approval" conflates verification with approval; the sentence as written is defensible.
(2) BILLING.md:78-80 and LIMITATIONS.md:84 are accurate statements of Paddle behaviour (no default payment link → checkout.url null) and of the *intended* code path. They read as wrong only because adapter.ts:380 deviates. Fixing the doc would be the wrong repair; fixing `checkout: { url: request.successUrl }` makes both docs exactly right. Documentation that correctly describes intended behaviour the code fails to implement is the code's defect, already reported separately.
(3) BILLING.md:138-140 does describe checkout.url as a returned value — which is correct for the intended design, and DEPLOYMENT.md:102-110 supplies the sending-side semantics the finding says no reader could learn.

The scenario is also not reproducible as written. DEPLOYMENT.md §4 requires NEXT_PUBLIC_APP_URL to equal the deployment origin, and the default payment link to be on that same origin. src\app\api\billing\checkout\route.ts:141 sends `successUrl: ${appUrl}/billing/success`, so on the documented deployment the URL's *domain* equals the approved default-payment-link domain, and Paddle's check is domain-scoped (`transaction_checkout_url_domain_is_not_approved`). The transaction would be created; the failure would be the separately-reported one — customer lands on /billing/success?_ptxn=… which "displays state only" and never opens a checkout. "Every checkout fails with 'We could not reach the payment provider.'" (adapter.ts:320, string verified) is the localhost-only symptom, and DEPLOYMENT.md explicitly says to test billing on the deployment, not locally or on previews. Also, the adapter's api() passes Paddle's own `json.error.detail` into AppError.detail, so the real cause is surfaced server-side rather than being undiagnosable.

What survives is narrow and below the defect bar: no document names the approved-domains setting or the error code, and a careless reader of line 248 might assume sandbox never cares about domains. That affects a developer's localhost session, not a customer's charge, and the configuration instructions a maintainer would actually follow are correct. Severity MEDIUM is not supportable; this is a doc-completeness nit attached to a code bug that is already reported on its own.


## [MEDIUM] CONFIRMED — successUrl and cancelUrl are built from NEXT_PUBLIC_APP_URL and documented as redirect targets, but one is used as the checkout host page and the other is discarded

`src/app/api/billing/checkout/route.ts:141`

**Defect.** The checkout route constructs `successUrl: ${appUrl}/billing/success` and `cancelUrl: ${appUrl}/pricing?checkout=canceled`, and the port declares both as required fields (src/domain/billing/provider.ts:170-171). The Paddle adapter passes successUrl as `checkout.url` — the page that HOSTS the overlay, not a post-payment redirect — and never reads cancelUrl at all (grep for cancelUrl returns only the route and the interface). So two settings that read as controlling the post-payment experience control nothing, and one of them is silently repurposed into something semantically different.

**How it fails.** Once the adapter is corrected to stop sending checkout.url, Paddle builds the URL from the default payment link and the customer completes payment inside the overlay on /checkout. `checkout.completed` fires and PaddleCheckout's handler only clears its message (PaddleCheckout.tsx:99-102), leaving the paying customer on the heading "Opening checkout" and the line "The payment form should appear in a moment." They are never taken to /billing/success — the page BILLING.md §4 step 4 makes the post-payment destination and DEPLOYMENT.md §7 item 7 makes a post-deploy verification item. A maintainer editing successUrl or cancelUrl to fix this finds the change has no effect anywhere.

**Fix.** Stop overloading successUrl as the checkout host URL. Either drop both fields from CheckoutRequest for the Paddle adapter and document that the post-payment destination is the overlay's completion handler, or keep them and make them real: navigate to successUrl on `checkout.completed` and to cancelUrl on `checkout.closed` in PaddleCheckout, so /billing/success is reachable and the two configured URLs mean what their names say.


## [MEDIUM] REFUTED — attemptKey lifetime is backwards for dedupe: reused across genuinely different purchases, distinct across tabs of one purchase

`src/components/CheckoutButton.tsx:35`

**Defect.** attemptKeyFor stores one key per plan slug in sessionStorage and never clears it — not after a successful purchase, not after a cancellation, not after a completed checkout. sessionStorage is scoped per browsing context, so two independently opened tabs get two different keys for what is semantically one purchase attempt, while one tab reuses a single key across purchases that are genuinely distinct commercial events. Both halves are the wrong way round for an idempotency key, and the catch branch at line 43-46 additionally returns a fresh per-render key whenever storage is unavailable (private browsing), so in that mode even a retry gets a new key. The comment at line 30-34 states the opposite intent on both points.

**How it fails.** Customer subscribes to Plus, later cancels, then in the same tab session resubscribes to Plus. Both purchases carry the identical custom_data.attempt value, so the two distinct Paddle transactions are indistinguishable by that field in any future dedupe, forensic, or reconciliation query. Conversely, the same customer with /pricing open in two tabs produces two different keys for one intended purchase — so even if server-side dedupe were implemented exactly as the comment describes, it would fail to collapse the two-tab case, which is the main double-charge path. And in private browsing the key is regenerated every render, so a retry after a transient 500 always looks like a new purchase.

**Fix.** Derive the key from the purchase intent server-side rather than from browser storage, or at minimum scope it to a single checkout lifecycle: clear it on a successful CHECKOUT response after navigation and on a completed or cancelled checkout, and use localStorage rather than sessionStorage so two tabs of one purchase share it. Any fix here is only meaningful once the server actually reads the key (finding 1).

**Why refuted.** REFUTED on reachability: every harm the finding asserts depends on something reading `attemptKey`, and nothing does. I traced the field end to end.

Full chain, with the only four sites that touch it:
1. `src/components/CheckoutButton.tsx:70` sends it in the POST body.
2. `src/app/api/billing/checkout/route.ts:36` validates it (`z.string().min(8).max(64)`) and line 43 destructures it. The route NEVER queries on it — no select, no insert, no unique constraint, no lookup of a prior attempt. It is passed straight through at line 140.
3. `src/lib/payments/paddle/adapter.ts:375-378` writes it into `custom_data: { wintora_user_id, plan_slug, attempt: request.attemptKey }`. It is NOT sent as a Paddle `Idempotency-Key` header — `grep -rni idempotenc` over src/supabase/docs returns zero hits in the Paddle adapter or its `api()` helper.
4. Nothing reads it back. `grep -rn "custom_data|customData" src/lib/payments src/app/api` returns only five hits; the sole read path is adapter.ts:494-495, which extracts `custom_data.wintora_user_id` and nothing else. `custom_data.attempt` is write-only.

So the key is inert plumbing, and each asserted consequence fails:

(a) "Indistinguishable in any future dedupe, forensic, or reconciliation query" — there is no such query, now or latently. Webhook idempotency is `unique (provider, event_id)` on `public.webhook_events` (supabase/migrations/0004_billing.sql:227, with the table comment stating that constraint IS the mechanism) plus a payload SHA-256 to catch modified replays. Transactions are distinguished by the Paddle transaction id, returned as `sessionId` at adapter.ts:394. No table has an attempt/attempt_key column — the `attempt_count` (0004_billing.sql:220) and `attempts` (0009_ops_privacy.sql:134) columns are webhook-delivery and job retry counters, unrelated.

(b) The two-tab case — the finding concedes its own counterfactual ("even if server-side dedupe were implemented"). Two tabs do each create a transaction, but that is caused by the absence of any server-side dedupe, not by sessionStorage scoping. Changing the key to localStorage, or to a single shared value, would change nothing observable, because the second POST would still create a second Paddle transaction. That makes this half a property of unwritten code, not a reachable defect.

(c) Private browsing — minor factual slip: `attemptKeyFor` is called inside `start()` (line 70), i.e. per click, not "every render" as the evidence states. Either way the value is discarded by the server, so the distinction is moot.

(d) The in-tab double click the comment frets about is actually prevented, by `disabled={busy}` at line 114 with `setBusy(true)` at line 63 — a real guard elsewhere in the chain, and not one that depends on the key.

No customer is charged wrongly, left uncharged, charged without access, granted unpaid access, or shown anything false by the key's lifetime. The narrow subscribe/cancel/resubscribe-in-one-tab path is additionally gated by route.ts:62-78, which routes any live subscription to the plan-change branch or throws CONFLICT — but the outcome is inert regardless, so that gate is not load-bearing for the refutal.

The code-reading half of the evidence is accurate (sessionStorage per plan slug, no removeItem in the file, catch returns an unstored UUID). What is wrong is the impact: this is dead plumbing, not a backwards idempotency key. See `correction` for the accurate residual claim, which I'd report separately rather than as a lifetime bug.


## [MEDIUM] REFUTED — webhook_events.payload_hash is written but never compared, so the documented modified-replay detection does not exist

`src/lib/payments/webhook.ts:95`

**Defect.** The migration comments payload_hash as "SHA-256 of the raw body. Makes a modified replay of a known id detectable" (0004_billing.sql:221). The claim path inserts the hash (handlers.ts:41) and, on a unique violation, returns 'DUPLICATE' (handlers.ts:49). processWebhookEvent then returns immediately at webhook.ts:95-97 without reading the stored hash or comparing it to the incoming one. Nothing anywhere selects payload_hash. A replay of a known event_id carrying a different, validly-signed body is therefore treated as an ordinary duplicate and discarded silently — the detection the schema advertises is not implemented. The in-memory test store (webhook.ts:137-148) faithfully reproduces the same gap, so no test can catch it.

**How it fails.** An event_id that Wintora has already processed is redelivered with a different payload. claim() hits the unique constraint, returns DUPLICATE, the route answers 200, and no security_event is written. Operationally this means the one signal the schema promises for detecting tampering or provider-side payload mutation behind a reused id is dead, and a maintainer reading the migration comment will believe it is live.

**Fix.** On a 23505 in claim(), select the stored payload_hash for (provider, event_id) and compare it with the incoming hash; on mismatch insert a security_events row (WEBHOOK_SIGNATURE_INVALID or a new PAYLOAD_HASH_MISMATCH type) and return a distinguishable result. Otherwise delete the column and its comment rather than leave a detection claim nothing implements.

**Why refuted.** The finding's CODE claims are all factually accurate — I confirmed every one. `hashPayload` is computed at src/app/api/webhooks/paddle/route.ts:76, passed through processWebhookEvent (src/lib/payments/webhook.ts:82,91) into claim(), inserted at src/lib/payments/handlers.ts:41, and a 23505 returns 'DUPLICATE' at handlers.ts:48-50 with no SELECT. webhook.ts:95-97 returns immediately. A repo-wide grep for payload_hash/payloadHash/hashPayload finds zero reads of the stored column anywhere in src, in any migration, or in any trigger. The in-memory test store (webhook.ts:144-148) does mirror the gap. So the mechanism description is correct.

It fails the reachability lens on three independent grounds.

1. The precondition requires the webhook secret, and holding the secret makes the control moot. To reach processWebhookEvent at all, the body must clear HMAC-SHA256 over `<timestamp>:<raw body>` with constant-time comparison inside the 300s tolerance (route.ts:38-42; failures 400 + security_events row and never reach the claim). A "different, validly-signed body" is therefore not producible by an outsider. An attacker who does hold PADDLE_WEBHOOK_SECRET would never reuse a known event_id — they would sign a fresh one, which inserts as NEW and never touches the unique constraint, so a hash comparison would never fire. The check guards only the one case an adversary has no reason to choose. The residual-risk section of docs/THREAT_MODEL.md already scopes a leaked secret as residual, mitigated by rotation and reconciliation.

2. Implementing the comparison would change no state whatsoever. The claim already returned DUPLICATE, so the event is discarded before any handler, before the ordering check, before any subscription or entitlement write. Adding a hash compare would add a log line or a security_events row and nothing else. No customer can be charged wrongly, charged and denied access, granted unpaid access, or shown anything false by this gap — the outcome on the mismatch path is identical to the outcome on the matched path: nothing is applied. That is the safe direction, and it fails the audit's own definition of a defect.

3. The "misleading documentation" branch does not hold either, because every claim says *detectable*, not *detected*. 0004_billing.sql:221 "Makes a modified replay of a known id detectable"; docs/DATABASE.md:246 "so a tampered replay of a known event id is detectable"; docs/SECURITY.md:150 "stored so a modified body reusing a known event id is detectable"; docs/BILLING.md:192 "additionally makes a modified body reusing a known event id detectable"; THREAT_MODEL.md:114 "`payload_hash` making a modified replay detectable". None promises automatic rejection or alerting. Storing a SHA-256 genuinely does make a tampered body detectable — by querying the stored hash against a captured body after the fact — which is the normal reason a forensic column exists and is why the adjacent table comment says "Payload bodies are deliberately not stored." Both SECURITY.md and BILLING.md explicitly name the unique (provider, event_id) constraint as "the **real** replay defence" and relegate everything else to defence in depth, so no maintainer is being told the hash is the load-bearing control. The column is also not dead configuration in the sense the audit brief means (contrast PADDLE_PRICE_*, which nothing reads at all): it is populated on every event and the stored value retains its forensic use.

The one sliver that survives is not a defect: THREAT_MODEL.md:119-121 claims tests/webhook-security.test.ts "covers ... modified body with a valid id," and the test at line 159-164 only asserts `hashPayload(a) !== hashPayload(b)` — it proves the hash discriminates, not that the pipeline reacts. That is a doc-precision nit worth at most a word change ("detectable by inspection"), several tiers below MEDIUM and not in the money path.


## [MEDIUM] REFUTED — The success page tells the customer "You will not be charged twice", an assurance the system cannot make

`src/app/billing/success/page.tsx:61`

**Defect.** The waiting state of /billing/success states flatly: "This page refreshes on its own. You will not be charged twice, and you do not need to do anything." The first clause is true of refreshing that page. The unqualified second clause is not true of the system: with no server-side dedupe (finding 1), a customer who double-submitted in the preceding minute has already created a second payable transaction, and if they complete it they are charged twice with no detection path (findings 2 and 4). The page is shown at exactly the moment a customer is most likely to be worried about that.

**How it fails.** Customer completes txn_A and txn_B from two tabs. On the success page they read "You will not be charged twice" and stop worrying. Two charges appear on the card, two paid invoice rows exist in invoices, and /settings/subscription shows one subscription. The customer was shown a statement the product cannot honour, at the moment it mattered.

**Fix.** Scope the claim to what the page actually controls, e.g. "Refreshing this page will not charge you again", until a server-side dedupe and a duplicate-subscription detector exist. Then the stronger sentence can be made honestly.

**Why refuted.** The string exists exactly as quoted (src/app/billing/success/page.tsx:60-63), and the underlying dedupe gap it leans on is real — but the alleged harm is blocked by two independent reachability barriers verified in code, and the sentence is true of the action the page actually invites.

1) BRANCH EXCLUSIVITY — the sentence is never shown to a double-charged customer. The clause lives only inside the `if (summary === null || !summary.hasPaidPlan)` branch. `hasPaidPlan` is `isPaidPlan(plan)` (src/lib/billing/summary.ts:153), so the waiting copy renders only while the user is still resolved to a free plan, i.e. before ANY webhook has landed. The moment the first subscription webhook lands, `upsertSubscription` inserts the row and calls `recomputeEntitlements` (src/lib/payments/handlers.ts:226,232), and the page flips to the confirmed branch — which contains no such sentence. The finding's scenario requires a customer who has completed BOTH txn_A and txn_B yet still has no paid plan; that is a few-seconds window between the second completion and the first webhook. Outside that window the statement is simply not on screen. The state the finding's scenario actually ends in ("two charges, one subscription shown") is the confirmed branch, where the claim does not appear.

2) PAGE REACHABILITY — no code path sends a paying customer to /billing/success at all. `successUrl` has exactly one consumer in the repo: the misapplied `checkout: { url: request.successUrl }` in src/lib/payments/paddle/adapter.ts:380 (established fact 3 — that is the page that HOSTS checkout, not a post-payment redirect). `Paddle.Checkout.open({ transactionId })` is called with no `settings.successUrl` (src/components/PaddleCheckout.tsx:108), and the `checkout.completed` callback only does `setPhase('open'); setMessage(null)` — it never navigates (PaddleCheckout.tsx:99-102). Grep for successUrl/success_url/location.href confirms no redirect to /billing/success anywhere. A customer who pays stays on /checkout with Paddle's own overlay confirmation. The page is reachable today only by manual navigation or out-of-band Paddle dashboard config.

3) THE CLAIM IS TRUE OF WHAT THE PAGE DOES, AND IS PROTECTIVE. Read in its own sentence — "This page refreshes on its own. You will not be charged twice, and you do not need to do anything." — it scopes to the auto-refresh: the `<meta httpEquiv="refresh" content="4">` loop is a pure read (requireUser + buildSubscriptionSummary) and creates no transaction, so refreshing genuinely cannot charge again. Moreover, the realistic double-charge path runs the opposite way from the finding: first webhook delayed → customer sees no change → returns to /pricing → CheckoutButton POSTs again → the route's live-subscription guard (src/app/api/billing/checkout/route.ts:62-69) finds nothing, so it creates a second transaction rather than a plan change → second charge. "You do not need to do anything" is precisely the copy that suppresses that path. Qualifying or removing it would make double charging MORE likely, not less.

4) IT IS A RESTATEMENT, NOT AN INDEPENDENT DEFECT. Everything load-bearing here is the dedupe gap already filed as finding 1, which I confirmed independently and which is real: `attemptKey` is documented as an idempotency key in both bodySchema (route.ts:32-36) and CheckoutButton.attemptKeyFor's comment ("so a double click or a refresh does not create a second transaction"), but its only use is Paddle `custom_data: { attempt: ... }` (adapter.ts:378) — nothing compares it to a prior attempt, so an identical attemptKey still mints a second payable transaction. I also found a worse, separately-reportable consequence the parent should fold into finding 1 rather than this one: a second subscription hits the partial unique index `subscriptions_one_live_per_user` (supabase/migrations/0004_billing.sql:79-84), and handlers.ts:226 does `await client.from('subscriptions').insert(row)` with the result discarded — no error check, no throwOnError — so the 23505 violation is swallowed, entitlements are recomputed anyway, and the webhook is marked processed. That is the real silent-double-charge hole. Fixing the UI string would not touch it.

Net: the money-path problem is real and already filed; this MEDIUM finding adds a copy-precision nit about a sentence that is true of the refresh it describes, is not displayed in the state the scenario requires, and sits on a page customers do not currently reach after paying. Caveat on my confidence: I cannot inspect the Paddle dashboard, so an out-of-band success-URL setting could make the page reachable — but barrier (1) holds regardless of that.


## [LOW] REFUTED — CheckoutRequest declares fields the only adapter silently ignores (country, email, cancelUrl, planSlug)

`src/domain/billing/provider.ts:160`

**Defect.** Of the ten fields on CheckoutRequest, the Paddle adapter uses four (providerPriceId, providerCustomerId, userId, and successUrl — the last one incorrectly). `country` is computed by the route and dropped entirely: nothing about the customer's country is sent to Paddle. `email` is dropped (covered by customer_id, but silently). `cancelUrl` is dropped. `planSlug` and `attemptKey` go only into custom_data fields that have no readers. Nothing in the port or the adapter records that these are no-ops.

**How it fails.** A maintainer adds a second provider adapter (the port's stated reason for existing, and PAYMENT_PROVIDERS already lists stripe/dodo/kelviq) and reads CheckoutRequest as the contract. They reasonably assume country drives the provider-side currency or tax locale and that cancelUrl is honoured on abandonment, because the port documents both as inputs. Both assumptions are untested and unhonoured by the reference implementation, so the first adapter written against the contract inherits behaviour the contract does not actually describe. Compounding it, nothing in tests/ exercises the Paddle transaction POST body at all, so no test pins any of this down.

**Fix.** Either use the fields or delete them. Concretely: drop `cancelUrl` and `email` from CheckoutRequest unless an adapter needs them; keep `country` only if the adapter passes it to the provider. Add a test that calls createPaddleProvider with a stubbed fetch and asserts the exact POST /transactions body — no `checkout` key, items from the resolved price id, custom_data carrying wintora_user_id — so the checkout.url regression cannot come back.

**Why refuted.** The finding's file-level observations are accurate, but nothing bad is reachable by a real customer, and the fields it calls "silently ignored" are correctly ignored by design for Paddle.

1. `country` — NOT dropped in any way that matters. `src/app/api/billing/checkout/route.ts:58-59` reads `profiles.country` and passes it to `resolvePriceId` (`src/lib/payments/index.ts:85-125`), which selects the `plan_prices` row `.eq('country', country)` and returns that row's `provider_price_id`. Paddle prices are per-currency (established fact 1: 6 distinct price ids, US/USD and CA/CAD), so the price id the adapter sends IS the currency decision. `adapter.ts` deliberately sends `currency_code: undefined` so Paddle derives it from the price. Country therefore reaches Paddle encoded in `price_id`; the adapter has no second use for it. Paddle is the MoR (`remitsTax: true`) and collects the buyer's address itself at the overlay for tax — a country field on POST /transactions would not change tax locale. No customer can be charged in a wrong currency via this path.

2. `email` — structurally redundant, not "silently" dropped. The only call site passes `providerCustomerId: customerId` from `ensureCustomer` (`src/lib/payments/index.ts:128-153`), which returns a non-null string or throws. So `providerCustomerId` is never null in practice, and the Paddle customer was itself created with that email (`adapter.ts:355-361`). Paddle needs customer_id OR email; it has customer_id. Unreachable.

3. `cancelUrl` — Paddle Billing's POST /transactions has no cancel-URL concept, and cancellation is already handled in-app: `PaddleCheckout.tsx` subscribes to `checkout.closed` and renders "Nothing has been charged" plus a "Back to plans" link, and `checkout/page.tsx` carries its own "Go back to plans" link. Nothing reads `checkout=canceled` anywhere in `src/`, so no page shows a false or missing state. The abandonment UX the contract implies is delivered by a different (working) mechanism.

4. `planSlug` / `attemptKey` in `custom_data` — confirmed no readers (`adapter.ts:494` reads only `wintora_user_id`), but entitlement after payment is resolved from the webhook's subscription/price, not from these, so their being unread grants no unpaid access and denies no paid access.

5. The scenario is a hypothetical second adapter, not a customer. It also rests on a wrong premise: a Stripe/Dodo adapter would also resolve currency from the per-currency price id it is handed, so it would not "inherit behaviour the contract does not describe" on the `country` point at all.

Internal inconsistencies also weaken it: it says "ten fields" (there are nine) and "uses four" then lists six it references.

Severity LOW and the framing ("a maintainer would reasonably assume") concede this is contract hygiene, not a money-path defect. Under the audit's own bar — charged wrongly / not charged / charged without access / access without payment / shown something false — nothing here qualifies.


## [LOW] UNVERIFIED — Webhook event status updates key on event_id alone, ignoring the (provider, event_id) composite the table is keyed by

`src/lib/payments/handlers.ts:55`

**Defect.** markProcessed and markFailed both filter with `.eq('event_id', eventId)` and no provider predicate, while webhook_events is unique on (provider, event_id) and the store is explicitly multi-provider (claim() takes provider, and ProviderName spans stripe/paddle/dodo/kelviq). markFailed also does a non-atomic read-modify-write of attempt_count (select, then update with value+1), and neither call checks its error, so a failed status update leaves the row stuck at RECEIVED. A row stuck at RECEIVED is indistinguishable from a crashed delivery and is also un-retryable because of Finding 3.

**How it fails.** After a provider migration or while running two providers in parallel, two rows share an event_id across providers. markProcessed updates both, marking another provider's still-unprocessed event as PROCESSED, so it is never investigated. Independently, two concurrent retries of the same failing event both read attempt_count = 2 and both write 3, so the attempt counter under-reports and any alerting threshold on it fires late or never.

**Fix.** Pass provider into markProcessed/markFailed and add `.eq('provider', provider)` to both, check the returned error, and replace the attempt_count read-modify-write with a SQL-side increment (an RPC or a Postgres function) so concurrent retries cannot lose a count.


## [LOW] UNVERIFIED — Webhook-written subscription rows always record country 'US', even for CAD customers

`src/lib/payments/handlers.ts:205`

**Defect.** The `row` object built in syncSubscription sets currency (from the Paddle subscription) but never sets `country`, and subscriptions.country is `country_code not null default 'US'` (0004_billing.sql:36). Every webhook-created subscription therefore says country = 'US' regardless of the buyer. A Canadian customer ends up with the internally contradictory pair country='US', currency='CAD'. The checkout route already knows the correct country (it reads profiles.country and resolves the CA price with it, src/app/api/billing/checkout/route.ts:58-59) but never persists it onto the subscription. No current code reads subscriptions.country, so nothing is wrong for a customer today — but it is a not-null column with a silently wrong value that a maintainer building revenue-by-geography reporting or any jurisdiction check would reasonably trust.

**How it fails.** The operator later builds a revenue or compliance report grouped by subscriptions.country, or a future feature gates Canadian-specific content on it. Every Canadian subscriber is classified as US, because the column has only ever held its default. The error is invisible because the column is not null and looks populated.

**Fix.** Derive country on the subscription write — either from the resolved plan_prices row matching subscription.providerPriceId (which already carries country), or from the buyer's profiles.country — and include it in the row so currency and country cannot disagree.


## [LOW] UNVERIFIED — `itemId` in changePlan is a price id under an item-id name, read only as an existence guard and never sent

`src/lib/payments/paddle/adapter.ts:417`

**Defect.** `const itemId = current.items?.[0]?.price?.id` reads a Paddle PRICE id (pri_…) and names it itemId. The value is used for nothing except the undefined check on the next line; it is never included in the PATCH. The PATCH itself is correct — `items: [{ price_id, quantity }]` is the shape Paddle's schema accepts — so the misnomer causes no mischarge today. What it leaves behind is a false mental model and a GET whose result is otherwise discarded at exactly the point where the subscription's real state (status, next_billed_at, currency) needed checking.

**How it fails.** A maintainer adding per-item handling reads `itemId` and concludes Paddle subscription items carry their own identifiers, then passes this pri_… value somewhere an item identifier is expected — or, more likely given the adjacent code, treats the guard as proof that the current subscription was validated before the PATCH and adds no status check, reproducing the PAST_DUE failure. The GET already in hand makes both mistakes cheap to avoid.

**Fix.** Rename it to currentPriceId, and use the GET for the checks that actually matter: refuse the change when current.status is past_due, when next_billed_at is within 30 minutes, and when the new price's currency differs from the subscription's currency_code.


## [LOW] CONFIRMED — The plan query parameter is rendered unvalidated on the checkout page and is never set by the real flow

`src/app/checkout/page.tsx:62`

**Defect.** `planName` is taken verbatim from `params.plan` with no check against PLAN_SLUGS and no relation to the transaction actually being paid, then rendered as "Opening checkout for {planName}". Separately it is dead in practice: the only way a browser reaches /checkout is Paddle's payment link, and Paddle appends only `_ptxn` — nothing in the codebase ever produces /checkout?plan=..., so in the real flow the heading is always the generic "Opening checkout".

**How it fails.** An attacker (or a careless support link) sends /checkout?_ptxn=txn_X&plan=Pro%20annual%20-%20first%20month%20free. The genuine, correctly-branded, noindexed Wintora checkout page renders that attacker-supplied phrase as the product being purchased, immediately above the real Paddle overlay. React escaping prevents script injection, but the customer reads a description of the purchase that the server never validated and that need not match the transaction's actual price or plan.

**Fix.** Resolve the plan from the transaction server-side (the same fetch that finding 6 needs), or at minimum narrow it to `PLAN_SLUGS.includes(params.plan) ? PLANS[params.plan].displayName : null` so only catalogue names can ever appear.


## [LOW] REFUTED — On a client-side remount the script-already-present shortcut can report a load failure that did not happen

`src/components/PaddleCheckout.tsx:115`

**Defect.** The effect treats the mere presence of a `script[src=...paddle.js]` tag as proof that Paddle.js has finished evaluating, and calls `open()` immediately; `open()` then fails with "We could not load the payment form" if `window.Paddle` is still undefined. It also calls `paddle.Initialize(...)` again on that path. The `initialised` ref that would prevent a re-run is per-instance, so a Next client-side navigation away from /checkout and back (or any remount) gets a fresh ref while the old script tag remains in document.head.

**How it fails.** Customer on /checkout clicks "Go back to plans", then uses the browser Back button to return. The component remounts, sees the existing script tag, and calls open(). If the script has not re-evaluated (or Paddle.js refuses a second Initialize), the customer gets the red error card "We could not open checkout — We could not load the payment form. Please refresh and try again." for a transaction that is perfectly valid. Some customers will read that as "this site is broken" and leave rather than refreshing.

**Fix.** Branch on `window.Paddle !== undefined` rather than on the tag's existence; when the tag exists but the global does not, attach a load listener instead of failing. Guard Initialize with a module-level flag so it runs at most once per page load.

**Why refuted.** The finding describes the mechanism correctly but the customer-visible outcome it claims is not reachable by the path it names.

Chain as actually written:
1. Entry to /checkout is ALWAYS a full document navigation. src/components/CheckoutButton.tsx:102 does `window.location.href = json.url` (and :78 for the signin bounce). So the first mount of PaddleCheckout always happens in a fresh document with no pre-existing script tag, and correctly takes the append-script + onload path.
2. The only way to remount PaddleCheckout in the SAME document is the scenario's own trigger: the `<Link href="/pricing">` "Go back to plans" at src/app/checkout/page.tsx:80 (next/link, client-side), then browser Back. Back from a client-side route change is popstate in the same document.
3. In that same document, paddle.js already finished evaluating during the first mount and set `window.Paddle` on the window. A client-side route change does not tear down `window`. So on the remount `window.Paddle !== undefined`, and the `fail('We could not load the payment form...')` branch at PaddleCheckout.tsx:81-84 — the entire claimed defect — does not execute. The red card the finding quotes is not reached.
4. PaddleCheckout is mounted on exactly one route and only once (grep confirms no other mount site), and nothing else in the repo loads cdn.paddle.com/paddle/v2/paddle.js (only src/lib/http/csp.ts:36 allowlists it). So no second consumer can leave the tag present with `window.Paddle` undefined.

The two states that genuinely reach line 82 with a tag already in head are both benign:
(a) The first mount's `script.onerror` already fired (CDN blocked / offline). Then Paddle really is not loaded, so "We could not load the payment form. Please refresh and try again." is a TRUE report with the correct remedy, not a false failure.
(b) A race where the customer clicks "Go back to plans" and presses Back while the CDN fetch is still in flight — a sub-second window on a cold cache, requiring two deliberate navigations inside it. Not a path a real customer walks, and the displayed remedy (refresh) resolves it.

React StrictMode's double-invoked effect does not trigger this either: the ref survives the double invoke, so the second run returns at line 65.

Blast radius is also bounded by guards elsewhere: no charge and no entitlement occur on any of these paths, the transaction stays valid and reopenable, the card states "Nothing has been charged", and the attemptKey in sessionStorage (CheckoutButton.tsx:35-48) means the advised refresh-and-retry reuses the same idempotency key rather than creating a second transaction. Worst case across every path is a cosmetic error card cleared by a refresh — nothing in the money path.


## [LOW] CONFIRMED — docs/LIMITATIONS.md states the Paddle price ids are null when all six are populated, steering a maintainer away from the real checkout defect

`docs/LIMITATIONS.md:83`

**Defect.** The PAYMENT_REVIEW_REQUIRED table asserts as present-tense fact: "Products and prices | None created. `plan_prices.provider_price_id` is null and `resolvePriceId` throws rather than charging a default. Run `npm run paddle:seed`." This is false — all three paid plans carry active Paddle price ids for both US/USD and CA/CAD, confirmed against Paddle's own /prices endpoint. LIMITATIONS.md is the document DEPLOYMENT.md §6 names as the pre-launch gate ("Before the first production deploy, confirm each item in docs/LIMITATIONS.md"), so a stale entry here is load-bearing.

**How it fails.** Checkout fails. The operator consults the launch-blocking table, reads that no products or prices exist, and re-runs `npm run paddle:seed` — which reports everything already set. Having eliminated the one cause the document offers, they have no documented next step, while the real causes (a default payment link pointing at a dead tunnel, an unapproved checkout URL domain, localhost in NEXT_PUBLIC_APP_URL) appear nowhere in that table.

**Fix.** Update the row to reflect the measured state and move the still-open items into it: default payment link currently points at a dead trycloudflare.com tunnel; the deployment origin is not an approved Paddle domain; NEXT_PUBLIC_APP_URL is still localhost. Date the row, since this table is the pre-launch gate and a stale entry in it costs more than a missing one.


## [LOW] CONFIRMED — Three API-key variables are templated, leak-scanned, and read by nothing; MALWARE_SCAN_PROVIDER is a switch with no implementation behind it

`.env.example:1`

**Defect.** OCR_API_KEY, MALWARE_SCAN_API_KEY and EMAIL_API_KEY appear in .env.example and in the secret-leak scanner's denylist (scripts/verify-no-secret-leaks.mjs:30-32), are absent from serverSchema (src/lib/env.ts:26-103), and are read by no runtime code — `grep -rn "OCR_API_KEY\|MALWARE_SCAN_API_KEY\|EMAIL_API_KEY" src` returns nothing. Related: there is no malware-scanning implementation anywhere in src (grep for malware across src returns only env.ts), so MALWARE_SCAN_PROVIDER is a provider switch with nothing behind it, and the only function that reads it — `isConfigured('malwareScan')` — has no callers, the same dead-guard pattern as the payments case. scripts/doctor.mjs:425 lists MALWARE_SCAN_API_KEY under "Not configured yet" with the consequence "document upload stays blocked by design", which implies setting it would unblock uploads; setting it would do nothing at all.

**How it fails.** A maintainer enabling uploads sets MALWARE_SCAN_PROVIDER=clamav and MALWARE_SCAN_API_KEY=..., because both are in the template and the doctor names the key as the thing that is missing. Nothing reads either value. `isConfigured('malwareScan')` would now return true, but it is never called, so the switch neither enables a scanner nor blocks uploads — the maintainer has changed configuration that has no effect while believing they have turned scanning on. The env.ts comment at :139-143 ("An unconfigured malware scanner, for example, must block extraction rather than let documents through unscanned") describes a behaviour no code implements.

**Fix.** Either remove the three unread key names from .env.example until the subsystem that consumes them exists, or add them to serverSchema so the declared surface matches the template. Change the doctor's MALWARE_SCAN_API_KEY line so it does not imply that setting a key changes behaviour. And either call isConfigured() at the upload/extraction gate it was written for, or delete it — as with the payments case, a documented fail-closed guard with no callers reads as protection that is not present.


## [LOW] REFUTED — markProcessed and markFailed key on event_id alone while the uniqueness contract is (provider, event_id)

`src/lib/payments/handlers.ts:59`

**Defect.** webhook_events is unique on (provider, event_id) (0004_billing.sql:229) and claim() inserts both columns. But markProcessed (handlers.ts:56-60), markFailed's read (66) and markFailed's write (70-77) all filter on .eq('event_id', eventId) only, with no provider predicate. The idempotency table's key and its update path disagree. With a single provider configured this cannot currently mis-target a row, so it is latent — but billing_provider is an enum that already includes stripe, every billing table defaults provider to 'stripe', and the whole payments layer is deliberately written to be provider-swappable, so the latency is by design rather than permanent.

**How it fails.** A second provider is added (the PaymentProvider port exists precisely to allow this) and two providers issue the same event_id string — Paddle and Stripe ids are opaque and nothing guarantees disjointness. markProcessed then updates whichever row matches first, or both: one provider's event can be marked PROCESSED while its handler failed, permanently suppressing the retry that would have granted or revoked the right entitlement. Also, markFailed's attempt_count read-then-write is not atomic, so concurrent retries of the same event can both read the same count and lose an increment.

**Fix.** Thread the provider through the WebhookEventStore methods and add .eq('provider', provider) to all three queries so the lookup matches the unique key. Increment attempt_count with a single atomic SQL expression or an RPC rather than a read-then-write.

**Why refuted.** REFUTED on reachability, and the claimed harm mechanism is independently false.

(1) The second provider is blocked by a TYPE, not a convention. src/lib/env.ts:39 declares `PAYMENT_PROVIDER: z.enum(['paddle']).default('paddle')` — a single-member Zod enum, so no other provider name can even be set in the environment without failing boot validation. src/lib/payments/index.ts:39 re-checks and throws ("Only \"paddle\" has an adapter"). There is exactly one webhook route (src/app/api/webhooks/paddle/route.ts), which passes provider.name into processWebhookEvent. Therefore every row webhook_events can ever receive carries the same single provider value, and `.eq('event_id', eventId)` selects precisely the row that `(provider, event_id)` would. The predicates are EQUIVALENT in every reachable state — not coincidentally aligned. Reaching the collision requires a new adapter, a new route, an env-schema change, and a code change to the guard; that is a future refactor, not a reachable customer outcome.

(2) The scenario's stated harm is false on its own terms even if a collision occurred. webhook_events.status is read by NO code anywhere (grep over all .ts/.tsx/.sql: webhook_events appears only in handlers.ts lines 37/57/64/70 plus migrations and an RLS test). claim() (handlers.ts:37-52) inserts unconditionally and maps any 23505 to DUPLICATE without ever inspecting status, and webhook.ts:95-97 returns before dispatch on DUPLICATE. So a redelivery of a genuinely failed event is ALREADY a no-op regardless of whether the row says FAILED, PROCESSED or RECEIVED. Marking a row PROCESSED cannot "permanently suppress the retry that would have granted or revoked the right entitlement", because no retry ever re-dispatches under any status. The status column is purely observational.

(3) The attempt_count read-then-write race has neither a reachable consequence nor a reachable race. attempt_count is written only by markFailed and read only by markFailed's own read-then-write (handlers.ts:65, 74); nothing else in the repo reads it — no retry threshold, no dead-letter, no alert, no operator query. A lost increment changes nothing any customer or operator acts on. And two deliveries of one event_id cannot both reach markFailed: the loser of the insert race gets 23505 -> DUPLICATE -> returns before dispatch, and a sequential retry is likewise DUPLICATE. The counter can never exceed 1, so there is no increment to lose.

The finding's raw code citations are accurate (handlers.ts:59, 66, 76 do omit provider; 0004_billing.sql:229 is `unique (provider, event_id)`). But an accurate observation with no reachable bad outcome is a consistency nit, not a defect under the audit rubric (no customer is charged wrongly, denied a charge, denied access, granted unpaid access, or shown anything false), and it is code rather than "configuration a future maintainer would reasonably trust" — the table comment at 0004_billing.sql:230 already documents the constraint explicitly.

SEPARATE issue noticed while tracing this chain, which should be filed on its own rather than folded in: billing_provider is created in supabase/migrations/0001_extensions_and_types.sql:18 as enum ('stripe','apple','google') and is never ALTERed anywhere in supabase/ — 'paddle' is not a member. If the deployed schema matches the migrations, claim()'s insert of provider:'paddle' fails on invalid enum input, markProcessed/markFailed are never reached at all, and every Paddle webhook 500s. That is a hard money-path blocker of a different and much higher severity.

