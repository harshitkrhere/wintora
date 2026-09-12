# BILLING

Wintora sells through **Razorpay**, a payment gateway based in India. That is
not a substitution of one payment button for another, and much of this document
follows from what a gateway is and is not.

**Wintora's operator is the legal seller** of every subscription. Razorpay
processes the card, runs the recurring charges, and settles the money to an
Indian bank account in INR. It does not calculate or remit any tax where the
customer lives, it does not decide refunds, and the customer's contract is with
the operator, not with Razorpay.

## Why Razorpay, and what it costs

Three facts, all recorded in `docs/LIMITATIONS.md`:

1. **Stripe is invite-only in India**, where this service is operated from.
2. **Paddle, the previous provider, was a Merchant of Record.** It was the
   legal seller and remitted tax on our behalf, at 5% + 50¢ per transaction
   (10% of revenue on a $9.99 plan). It has been removed completely; the
   `billing_provider` enum still lists it because Postgres cannot drop an enum
   value, and `webhook_events` rows from that period are kept as history.
3. **Razorpay onboards Indian individuals for domestic payments, but its own
   documentation restricts international cards to registered businesses.**
   Wintora sells in USD and CAD, so International Payments must be activated
   on the account, which in practice means at least a sole-proprietorship
   registration (an Udyam certificate is free). Until then the code is correct
   and no card from the US or Canada can be charged.

The trade the switch makes is explicit:

| | Paddle (MoR) | Razorpay (gateway) |
| --- | --- | --- |
| Legal seller | Paddle | The operator |
| Sales tax / GST/HST where the customer lives | Paddle's | The operator's, once thresholds are crossed |
| Refund decision | Paddle's | The operator's |
| Fee (published, verify on the account) | 5% + 50¢ | ~3% on international cards, plus 18% GST on the fee |
| Settlement | Payout, no FIRC | INR to an Indian account; FIRC/FIRA available |
| Customer portal | Hosted | None; built in-app (`/settings/subscription`) |

Section 11 has the fee arithmetic. Section 12 has the tax consequences.

---

## 1. Plan catalog

Plans are **data**, not code. `src/config/plans.ts` holds the bootstrap catalog
that seeds the database; after seeding, `plans`, `plan_prices` and
`plan_features` in Postgres are the operational source of truth. Prices, limits,
currencies, intervals and availability all change without touching
authorization logic.

| Plan | US | Canada | Positioning |
| --- | --- | --- | --- |
| `free` | 0 | 0 | Genuinely useful. One active case, real analysis, one letter. |
| `essential` | 14.99 / mo · 149 / yr USD | 19.99 / mo · 199 / yr CAD | Entry: a few bills a year, one dispute at a time. |
| `plus` | 19.99 / mo · 199 / yr USD | 25.99 / mo · 259 / yr CAD | **Recommended.** The full workflow: deadline tracking, exports, extended history. |
| `pro` | 29.99 / mo · 299 / yr USD | 39.99 / mo · 399 / yr CAD | Household cases, high volume, priority support. |

The reasoning behind these numbers is in `docs/PRICING.md`.

### Razorpay vocabulary

| Ours | Razorpay's |
| --- | --- |
| A `plan_prices` row (plan × country × currency × interval) | A **Plan** (`plan_…`), immutable |
| `plan_prices.provider_price_id` | That Plan's id |
| A customer's subscription | A **Subscription** (`sub_…`) to one Plan |
| The first payment, made in the browser | The **authentication transaction** |
| `plans.provider_product_id` | Nothing. Razorpay has no product object; the column stays null. |

### Billing interval

The interval lives on the **price**, not the plan (`plan_prices.interval`,
migration 0015). Plus is one plan with four prices: USD/CAD × month/year, which
is four Razorpay Plans. Plan comparison, entitlements and the feature matrix
never see the interval; only checkout and display do.

Quota windows on an annual subscription are cut to the month in progress
(`src/domain/usage/period.ts`), so "50 analyses a month" means the same thing
at either interval. A move from monthly to yearly on the same plan is an
upgrade; back to monthly is a downgrade and waits for the period end.

Razorpay requires a finite cycle count on every subscription. We use 120 monthly
or 10 yearly cycles (`TOTAL_CYCLES` in the adapter); when one completes,
Razorpay sends `subscription.completed`, which we treat as the subscription
ending, and the customer subscribes again.

### Currency and country

Each plan has explicit per-currency price records. There is no live FX
conversion anywhere in the product. A subscription stores the `country`,
`currency` and `provider_price_id` it was created with. Razorpay converts to
INR at settlement; that rate and its spread are Razorpay's and are recorded on
the settlement, never shown to a customer.

### Price changes and grandfathering

`plans` rows carry `version`, `effective_from` and `effective_until`. A price
change creates a **new plan version** rather than mutating a row. Existing
subscribers keep their original `plan_id` and `provider_price_id`. Razorpay
Plans are immutable in the same way, so the two models agree: a new price is a
new Razorpay Plan with a new id, and existing subscriptions keep charging the
old one.

---

## 2. Razorpay configuration required before launch

Marked `PAYMENT_REVIEW_REQUIRED` in `docs/LIMITATIONS.md`.

1. **Account and activation.** Complete Razorpay KYC. Then activate
   **International Payments → International Cards**, which is what USD and CAD
   card subscriptions need. Razorpay's documentation states that individuals
   cannot accept international cards; expect to need a sole-proprietorship
   registration. Disclose plainly that this is consumer software about medical
   bills, and equally plainly what it is not: no debt collection, no
   negotiation, no legal or medical advice, no patient payments, no money
   moving through the product.
2. **Credentials.** `RAZORPAY_KEY_ID` (public; `rzp_test_` or `rzp_live_`) and
   `RAZORPAY_KEY_SECRET` (server-only). Test and live are told apart by the key
   prefix; there is no separate environment variable to get out of step with
   the credentials.
3. Run `npm run razorpay:seed` (dry run), then `-- --apply`. It creates one
   Razorpay Plan per `plan_prices` row, matched on our notes so a re-run adopts
   rather than duplicates, and writes the ids into
   `plan_prices.provider_price_id`. Until a row has an id, `resolvePriceId()`
   refuses to sell it.
4. **Webhook.** Settings → Webhooks, URL `https://<deployment>/api/webhooks/razorpay`,
   secret in `RAZORPAY_WEBHOOK_SECRET`, subscribed to the events in section 5.
   The endpoint fails closed without the secret, so a customer could pay and
   never receive their plan.
5. Confirm the **statement descriptor** against a real test transaction and
   update `src/config/disclosures.ts` to match. An unrecognised descriptor is
   one of the commonest causes of consumer chargebacks.
6. Run the **sandbox matrix** in section 13 end to end in test mode before a
   live key exists anywhere.

Wintora never stores a card number, CVC or PAN. Collection happens entirely in
Razorpay's checkout, which renders in an iframe from `api.razorpay.com`. The
`payments` table keeps brand and last four only, and a database check refuses
anything longer.

---

## 3. Subscription state machine

Unchanged by the provider switch, which is the point of the port. Defined in
`src/domain/billing/states.ts`. Every transition is explicit, logged to
`audit_logs`, and idempotent.

Statuses that **retain** plan entitlements: `TRIALING`, `ACTIVE`, `PAST_DUE`,
`GRACE`, `CANCELED_PENDING_EXPIRY`. A failed renewal does not revoke access, and
a cancelled subscription runs to the end of the period already paid for.

Any transition not in the table is rejected with `BillingTransitionError` and
recorded as an `ILLEGAL_BILLING_TRANSITION` security event.

### Mapping Razorpay status to internal status

`src/lib/payments/razorpay/adapter.ts`, `mapRazorpayStatus()`:

| Razorpay status | Meaning | Internal |
| --- | --- | --- |
| `created` | exists, not yet paid | `CHECKOUT_PENDING` |
| `authenticated` | first payment made, cycle about to start | `ACTIVE` |
| `active` | billing cycle running | `ACTIVE`, or `CANCELED_PENDING_EXPIRY` if we hold a scheduled cancellation |
| `pending` | a charge failed, Razorpay is retrying | `PAST_DUE` (`GRACE` is our clock on top) |
| `halted` | retries exhausted, no more auto-charges | `PAST_DUE`, expiring when the grace window ends |
| `paused` | paused by us at the customer's request | `PAUSED` |
| `cancelled`, `completed`, `expired` | over | `EXPIRED` |
| anything else | | `EXPIRED` — **fails closed** |

Three details worth knowing. Razorpay does **not** expose "cancel at cycle end"
on the subscription object, so a scheduled cancellation is our record: the
provider keeps saying `active` until the cycle ends and sends
`subscription.cancelled` then. Razorpay stamps no last-modified time on the
object, so event ordering uses the webhook's `created_at`. And an unrecognised
status maps to `EXPIRED` rather than `ACTIVE`: a customer temporarily losing a
feature is recoverable and reconciliation flags it, whereas silently giving
away paid access is not.

---

## 4. Checkout, upgrade and downgrade

### New subscription

1. The client posts a **plan slug** and an **interval** and nothing else.
2. The server resolves the Razorpay Plan id, amount and currency from
   `plan_prices` for the user's billing country. The client never supplies a
   price id, an amount or a currency.
3. The server creates the Razorpay Subscription (status `created`, with our user
   id in `notes`) and records it as `CHECKOUT_PENDING` **before** the browser
   sees anything. Clicking again inside the checkout window
   (`POLICY.checkout.pendingTtlMinutes`) reuses it; after the window it is
   abandoned and a fresh one created. A double click, a refresh or a back
   button therefore cannot create a second subscription.
4. `/checkout` finds the signed-in user's own pending subscription and opens
   checkout.js with the public key and that id. There is no reference in the
   URL to validate or to leak.
5. checkout.js hands back `payment_id`, `subscription_id` and a signature over
   `payment_id|subscription_id` made with the key secret. `/api/billing/verify`
   checks it in constant time, checks the subscription belongs to the user,
   then **reads the subscription back from Razorpay** and mirrors that. The
   browser's report is never the source of an entitlement.
6. `subscription.authenticated` / `subscription.activated` / `subscription.charged`
   arrive by webhook and are then harmless duplicates of the same state.
7. `/billing/success` **displays state only**. If neither the callback nor the
   webhook has landed it says so and refreshes. It grants nothing, and it sends
   a signed-out visitor to sign in rather than telling anyone their payment went
   through.

### Upgrade

Immediate, with proration handled by Razorpay: `PATCH /subscriptions/:id`
with the new `plan_id` and `schedule_change_at: "now"`. Razorpay charges the
prorated difference (or refunds it) and reports the result in
`subscription.updated`. The route also mirrors the returned state at once so
the customer does not wait on webhook delivery. Case data, document history and
usage history are preserved, and the larger allowance applies immediately
without voiding consumption already recorded.

Razorpay only updates subscriptions in `authenticated` or `active`. A plan
change is refused with a plain message while a renewal is outstanding
(`PAST_DUE`, `GRACE`), while paused, and once a cancellation is scheduled.

### Downgrade

At **period end**: the same PATCH with `schedule_change_at: "cycle_end"`, which
Razorpay holds itself. We also record `pending_plan_id` and
`pending_plan_effective_at` so the billing page can state the exact date, and
so the behaviour would be identical under a provider that could not schedule
the change — see `downgradeStrategy()` in the port.

**Downgrade never deletes data.** A user with 12 active cases moving to a plan
allowing 5 keeps all 12. Creating a 13th is blocked with `LIMIT_REACHED` and an
honest explanation. The same applies to retention: see `docs/PRIVACY.md`.

---

## 5. Webhooks

`POST /api/webhooks/razorpay`, Node runtime, raw body.

1. Read raw bytes. Never parse first: re-serialising invalidates the signature.
2. Verify `X-Razorpay-Signature`: HMAC-SHA256 of the raw body with the webhook
   secret, hex, compared in constant time. An invalid or absent signature
   returns 400, writes a `WEBHOOK_SIGNATURE_INVALID` security event, and
   changes nothing.
3. Claim on `(provider, event_id)`, the id from `X-Razorpay-Event-Id`. A unique
   violation means redelivery. If the earlier attempt **processed**, return 200
   and apply nothing. If it **failed**, the row is reopened and the event runs
   again: the 500 we returned was a request to retry, and a claim that could
   never be released would turn every transient failure into a customer who
   paid and received nothing.
4. Drop events older than the provider timestamp already applied to that
   subscription.
5. Dispatch on the **normalised** event kind, so handlers contain no Razorpay
   knowledge at all.

### On freshness

Razorpay signs no timestamp. Freshness comes from the event's own `created_at`,
refused beyond `RAZORPAY_EVENT_MAX_AGE_SECONDS` (default three days, wider than
Razorpay's retry window so an honest late retry is never refused). The real
replay defence is the unique `(provider, event_id)` constraint, which makes a
replay a no-op however old it is; `payload_hash` additionally makes a modified
body reusing a known event id detectable.

### Subscribed events

```
subscription.authenticated  subscription.activated   subscription.charged
subscription.pending        subscription.halted      subscription.updated
subscription.cancelled      subscription.completed   subscription.paused
subscription.resumed
invoice.paid                (invoice number and hosted link)
refund.created              refund.processed
payment.dispute.created
```

Unknown types are stored as `IGNORED`, not treated as errors: a new Razorpay
event type must not become a retry storm.

### What each event writes

| Event | Writes |
| --- | --- |
| `subscription.*` | `subscriptions` (status, plan, period), `billing_customers` (first time the customer id is seen), entitlements recomputed |
| `subscription.charged`, `.authenticated`, `.activated` | plus a `payments` row (brand, last four, status) and an `invoices` row keyed on the payment's invoice id |
| `invoice.paid` | completes the `invoices` row with number and hosted link |
| `refund.*` | `refunds` row; a full refund moves the subscription to `REFUNDED` per policy |
| `payment.dispute.created` | `REVOKED`, plus a security event |

Refunds and disputes reference a payment, not a subscription. They are
attributed through the `payments` table, which is why payments are recorded
first.

---

## 6. Payment failure and grace

```
PAYMENT_FAILED -> PAST_DUE (entitlements unchanged)
               -> GRACE    (entitlements unchanged, 7 days)
                    -> recovered -> ACTIVE
                    -> elapsed   -> EXPIRED -> FREE entitlements
```

Razorpay retries a failed charge itself (`pending`) and stops after its retry
schedule (`halted`). Both map to `PAST_DUE`; the sync opens the 7-day grace
window on the first failure and keeps it stable; the daily reconciliation job
moves the subscription to `EXPIRED` when the window the customer was told about
has passed. Premium access is not cut at the first failed charge.

The message states the facts and nothing more — amount, date, exactly when
access changes — with an **Update card** button that opens Razorpay's card-change
form against the same subscription. No countdowns, no capital letters, no
threats.

---

## 7. Refunds

**The refund decision is ours.** Under a gateway there is no third party
honouring buyer terms. Refunds are issued in the Razorpay dashboard (or its
API), Razorpay reports them back as `refund.created` / `refund.processed`, and
`handleRefund` records the refund and applies the entitlement consequence the
policy prescribes.

| Refund type | `entitlement_effect` | Behaviour |
| --- | --- | --- |
| Full refund | `REVOKE_IMMEDIATELY` | Subscription moves to `REFUNDED`, entitlements recompute to free |
| Full refund with courtesy window | `REVOKE_AT` | Premium retained until a stored date |
| Partial refund | `NONE` | Entitlements unchanged |
| Chargeback | `REVOKE_IMMEDIATELY` + `REVOKED` | Access revoked, security event recorded |

Whether a refund is full is decided by comparing the refund amount with the
payment it refunds; a refund whose payment is not in the event is treated as
partial, because a partial refund touches nothing.

The customer-facing copy says plainly that the decision is ours and promises no
outcome. A written refund policy is `LEGAL_REVIEW_REQUIRED`.

---

## 8. Reconciliation

`/api/cron/reconcile-billing`, protected by `CRON_SECRET`, runs daily and does
five things:

1. closes `CHECKOUT_PENDING` rows older than the checkout window;
2. expires `PAST_DUE` / `GRACE` subscriptions whose grace window has passed;
3. resumes `PAUSED` subscriptions that have reached `POLICY.pause.maxDays`;
4. reads every live subscription back through the provider port and compares
   status, price id, period dates and cancellation intent;
5. counts provider errors separately, so an outage never looks like a thousand
   vanished subscriptions.

On a mismatch it records a `BILLING_STATE_MISMATCH` and alerts. It does **not**
pick a winner: guessing wrong in one direction steals access from a paying
customer, and in the other gives away paid features. The single safe automatic
repair is a stale period date where status and plan already agree.

---

## 9. Cancellation, pause, resumption

Razorpay has no customer portal, so all of this is on `/settings/subscription`,
through `/api/billing/manage`, and is one click each. Cancellation is not hidden
behind a support conversation.

- **Cancel**: `POST /subscriptions/:id/cancel` with `cancel_at_cycle_end: 1`.
  Razorpay keeps the status `active` until the cycle ends; we record the
  scheduled cancellation and show `CANCELED_PENDING_EXPIRY`.

  > Your subscription will end at the close of the current period. Until then
  > nothing changes, and your cases and documents stay in your account afterwards.

- **Undo a cancellation**: not possible at Razorpay. The page says so before
  the customer confirms, and after expiry it is a new checkout.
- **Pause**: `POST /subscriptions/:id/pause`. Charges stop; entitlements drop
  to Free per `POLICY.pause`; nothing is deleted. `pause_end` is set to
  `POLICY.pause.maxDays` ahead and the reconciliation job resumes the
  subscription then if the customer has not.
- **Resume**: `POST /subscriptions/:id/resume`. Active again at once.
- **Update card**: checkout.js with `subscription_card_change: 1` against the
  same subscription. Verifies a new card for future charges and takes no
  payment. VERIFY in test mode: this is the one flow whose option name is taken
  from Razorpay's integration guide rather than observed.

---

## 10. Seller disclosure

A customer must know, **before paying**:

- that the seller is Wintora's operator, and that Razorpay processes the payment;
- what will appear on their statement (`RAZORPAY*WINTORA` — verify against a
  real transaction and update `src/config/disclosures.ts`);
- that the price shown is the price charged, and any tax is shown before paying;
- that the subscription renews automatically until cancelled;
- that cancelling keeps access to the end of the paid period and deletes
  nothing;
- that refunds are our decision, with no outcome promised.

All of it lives in `src/config/disclosures.ts`, is asserted by
`tests/disclosures.test.ts`, and is returned by `/api/billing/checkout` so the
UI cannot render a checkout without it.

The practical reason, beyond compliance: a customer who does not recognise the
name on their statement disputes the charge. A chargeback on a young merchant
account costs far more than a clear sentence at checkout.

---

## 11. Unit economics: read this before launch

Razorpay's published rate for international cards at the time of writing is
about 3% per transaction, with 18% GST charged on the fee, so roughly **3.5%**
effective. Confirm the rate on the account; it can differ by card type and by
negotiation.

| Offer | Fee at 3% + GST | Effective rate |
| --- | --- | --- |
| Essential $14.99 / mo | $0.53 | 3.5% |
| Plus $19.99 / mo | $0.71 | 3.5% |
| Pro $29.99 / mo | $1.06 | 3.5% |
| Plus $199 / yr | $7.04 | 3.5% |

Against Paddle's 5% + 50¢ this is less than half the fee on every plan, and
without the fixed 50¢ the penalty on the cheapest plan disappears. Three costs
replace it:

1. **FX.** Settlement is in INR at Razorpay's rate. The spread is a cost that
   does not appear on the fee schedule; watch the first settlements.
2. **Tax where the customer lives.** Paddle remitted US sales tax and Canadian
   GST/HST as the seller. Now the operator is the seller; see section 12.
3. **Refunds.** Razorpay does not return its fee on a refund.

Each feature carries a `costLevel`, high-cost operations route to the advanced
model only where the economics justify it, and `AI_MAX_INPUT_CHARS` caps a
single job.

---

## 12. Tax — OPEN, and larger than before

Two questions, both `TAX_REVIEW_REQUIRED`, both for one conversation with a
chartered accountant.

**Where the customer lives.** Under Paddle this was not ours. Under Razorpay it
is. Most US states tax SaaS sold to consumers only once an economic-nexus
threshold is crossed (commonly $100,000 or 200 transactions a year, per state);
Canada requires a non-resident digital supplier to register for GST/HST once
sales exceed CAD 30,000 in twelve months, with Quebec's QST separate. Below
those thresholds there is nothing to register for; above them, registration and
remittance are the operator's job, and the price shown must then include or
add the tax honestly. The product does not calculate tax today; the disclosure
copy says the price shown is the price charged. That statement must be
revisited before any threshold is approached.

**In India.** Revenue arrives as a Razorpay settlement in INR.

1. **GST zero-rating on export of services.** Razorpay issues FIRC/FIRA for
   international payments, which is what establishing export status needs and
   what Paddle could not provide. Confirm the documents meet the bank's and the
   department's requirements.
2. **Purpose code.** Filed as **P0807 – Off-site Software Exports**, which fits
   a digitally delivered product built in India; under a gateway this reading
   is more natural than it was under an MoR.

---

## 13. Test matrix

Automated (`tests/billing-state-machine.test.ts`, `tests/webhook-security.test.ts`,
`tests/payment-provider-port.test.ts`, `tests/disclosures.test.ts`,
`tests/entitlements.test.ts`, `tests/billing-intervals.test.ts`):

every documented transition and rejection of undocumented ones; Razorpay status
and event mapping including fail-closed on unknown values; webhook signature
forgery, wrong secret, missing header, malformed digest, tampered body, stale
event; checkout callback signature with the wrong secret or a swapped id;
duplicate delivery, retry after handler failure, out-of-order delivery, unknown
event types; card data reduced to brand and last four; refund attribution and
full-versus-partial; provider suitability; every required commercial
disclosure; the full plan and lifecycle entitlement matrix; and monthly quota
windows on annual subscriptions.

Manual, in **test mode**, before any live key exists: subscribe on each plan
and interval in USD and CAD; verify the callback path activates without the
webhook and that the webhook is then a duplicate; upgrade (prorated charge
visible in Razorpay); downgrade (scheduled, nothing charged, applied at cycle
end); cancel at cycle end and observe `subscription.cancelled` at the end;
pause, resume, and the automatic resume at `pause_end`; update card; fail a
renewal with a test card that declines and observe `pending` → grace → expiry;
refund in full and in part; open a dispute; replay a webhook and confirm the
duplicate outcome.
