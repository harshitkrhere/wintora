# BILLING

Wintora sells through **Paddle**, a Merchant of Record. That is not a
substitution of one payment button for another, and most of this document
follows from the difference.

**Paddle.com Market Ltd is the legal seller** of every subscription. The
customer's purchase contract is with Paddle. Paddle takes the money, calculates
and remits sales tax, VAT and GST, decides refunds under its own buyer terms,
carries the chargeback liability, and pays us a share. Wintora provides the
software.

## Why an MoR, and not Stripe

Two facts, both recorded in `docs/LIMITATIONS.md`:

1. **Stripe is invite-only in India**, where this service is operated from.
2. **The operator is an individual, not a registered company.** Most MoRs
   require an incorporated entity; Paddle accepts individuals.

There is a third benefit that would matter even without the first two: an
individual seller cannot practically register for and remit sales tax across
fifty US states and thirteen Canadian provinces and territories. Under an MoR
that obligation is Paddle's.

The cost is real and should be seen clearly. Paddle charges **5% + 50¢ flat**,
against roughly 2.9% + 30¢ for a plain gateway. On the Essential plan that is
**10% of revenue**. See section 11.

---

## 1. Plan catalog

Plans are **data**, not code. `src/config/plans.ts` holds the bootstrap catalog
that seeds the database; after seeding, `plans`, `plan_prices` and
`plan_features` in Postgres are the operational source of truth. Prices, limits,
currencies, intervals and availability all change without touching
authorization logic.

| Plan | US | Canada | Positioning |
| --- | --- | --- | --- |
| `free` | 0.00 USD | 0.00 CAD | Genuinely useful. One active case, real analysis, one letter. |
| `essential` | 9.99 USD / mo | 12.99 CAD / mo | More usage, EOB comparison, saved templates. |
| `plus` | 19.99 USD / mo | 25.99 CAD / mo | Advanced workflow: deadline tracking, exports, extended history. |
| `pro` | 29.99 USD / mo | 39.99 CAD / mo | Household cases, high volume, priority support. |

These figures are **placeholders pending commercial review**, and section 11
argues Essential in particular needs revisiting under MoR fees.

### Currency and country

Each plan has explicit per-currency price records. There is no live FX
conversion anywhere in the product. A subscription stores the `country`,
`currency` and `provider_price_id` it was created with.

### Price changes and grandfathering

`plans` rows carry `version`, `effective_from` and `effective_until`. A price
change creates a **new plan version** rather than mutating a row. Existing
subscribers keep their original `plan_id` and `provider_price_id`. Paddle
prices are immutable in the same way, so the two models agree.

---

## 2. Paddle configuration required before launch

Marked `PAYMENT_REVIEW_REQUIRED` in `docs/LIMITATIONS.md`.

1. **Business verification.** Paddle underwrites every seller. Disclose plainly
   that this is consumer software about medical bills, and equally plainly what
   it is not: no debt collection, no negotiation, no legal or medical advice, no
   patient payments, no money moving through the product. Under-describing the
   business is grounds for termination and withheld payouts, and a medical-bill
   product superficially resembles categories MoRs restrict.
2. Run `npm run paddle:seed` (dry run), then `-- --apply`. It creates one
   Product per paid plan and one Price per currency, then writes the ids into
   `plans.provider_product_id` and `plan_prices.provider_price_id`.
3. Set a **default payment link** under Checkout settings. Hosted checkout
   returns no URL without one, and `createCheckout` fails loudly rather than
   silently.
4. Create a **notification destination** pointing at `/api/webhooks/paddle`,
   subscribed to the events in section 5, and store its secret in
   `PADDLE_WEBHOOK_SECRET`.
5. Confirm the **statement descriptor** against a real test transaction and
   update `src/config/disclosures.ts` to match. An unrecognised descriptor is
   one of the commonest causes of consumer chargebacks.
6. Confirm what Paddle provides for **Indian export documentation**. See
   section 12; this is the open question with the largest financial tail.

Wintora never stores a card number, CVC or PAN. Collection happens entirely in
Paddle's checkout and portal.

---

## 3. Subscription state machine

Unchanged by the provider switch, which is the point of the port. Defined in
`src/domain/billing/states.ts`; the full transition table is unchanged from the
original design. Every transition is explicit, logged to `audit_logs`, and
idempotent.

Statuses that **retain** plan entitlements: `TRIALING`, `ACTIVE`, `PAST_DUE`,
`GRACE`, `CANCELED_PENDING_EXPIRY`. A failed renewal does not revoke access, and
a cancelled subscription runs to the end of the period already paid for.

Any transition not in the table is rejected with `BillingTransitionError` and
recorded as an `ILLEGAL_BILLING_TRANSITION` security event.

### Mapping Paddle status to internal status

`src/lib/payments/paddle/adapter.ts`, `mapPaddleStatus()`:

| Paddle status | Internal |
| --- | --- |
| `trialing` | `TRIALING`, or `CANCELED_PENDING_EXPIRY` with a scheduled cancel |
| `active` | `ACTIVE`, or `CANCELED_PENDING_EXPIRY` with a scheduled cancel |
| `past_due` | `PAST_DUE`, or `GRACE` once our grace window is open |
| `paused` | `PAUSED` |
| `canceled` | `EXPIRED` |
| anything else | `EXPIRED` — **fails closed** |

Two details worth knowing. Paddle expresses "cancel at period end" as a
`scheduled_change` with `action: "cancel"`, not a boolean flag. And an
unrecognised status maps to `EXPIRED` rather than `ACTIVE`: a customer
temporarily losing a feature is recoverable and reconciliation flags it,
whereas silently giving away paid access is not.

---

## 4. Checkout, upgrade and downgrade

### New subscription

1. The client posts a **plan slug** and nothing else.
2. The server resolves the price id from `plan_prices` for the user's billing
   country. The client never supplies a price id, an amount or a currency.
3. A Paddle transaction is created with the customer and `custom_data` carrying
   our user id, and its `checkout.url` is returned along with the seller-of-
   record disclosure.
4. `/billing/success` **displays state only**. If the webhook has not landed it
   says "finalising your subscription" and refreshes. It grants nothing.
5. The webhook arrives, is verified, drives the state machine, recomputes
   entitlements and bumps the entitlement version.

### Upgrade

Immediate, with proration: `proration_billing_mode: "prorated_immediately"`.
The customer is paying more for something they want now. Case data, document
history and usage history are preserved, and the larger allowance applies at
once without voiding consumption already recorded.

### Downgrade

At **period end**: `proration_billing_mode: "do_not_bill"` with
`effective_from: "next_billing_period"`. We also record `pending_plan_id` and
`pending_plan_effective_at` so the billing page can state the exact date, and so
the behaviour is identical if a future provider cannot schedule the change
itself — see `downgradeStrategy()` in the port.

**Downgrade never deletes data.** A user with 12 active cases moving to a plan
allowing 5 keeps all 12. Creating a 13th is blocked with `LIMIT_REACHED` and an
honest explanation. The same applies to retention: see `docs/PRIVACY.md`.

---

## 5. Webhooks

`POST /api/webhooks/paddle`, Node runtime, raw body.

1. Read raw bytes. Never parse first: re-serialising invalidates the signature.
2. Verify `Paddle-Signature` (`ts=<unix>;h1=<hex>`). The signed payload is
   `<ts>:<raw body>`, HMAC-SHA256, compared in constant time. An invalid or
   absent signature returns 400, writes a `WEBHOOK_SIGNATURE_INVALID` security
   event, and changes nothing.
3. Claim on `(provider, event_id)`. A unique violation means redelivery: return
   200, apply nothing.
4. Drop events older than the provider timestamp already applied to that
   subscription.
5. Dispatch on the **normalised** event kind, so handlers contain no Paddle
   knowledge at all.

### On the timestamp tolerance

Paddle's own SDKs default to **five seconds**. We default to 300
(`PADDLE_WEBHOOK_TOLERANCE_SECONDS`), deliberately.

Five seconds is tight for a public network hop, and a dropped billing event
means a paying customer does not receive the plan they just bought. The real
replay defence is not the timestamp window: it is the unique
`(provider, event_id)` constraint, which makes a replay a no-op however old it
is. The tolerance is defence in depth, so it is set wide enough not to reject
honest traffic. `payload_hash` additionally makes a modified body reusing a
known event id detectable.

### Subscribed events

```
subscription.created      subscription.activated    subscription.updated
subscription.canceled     subscription.paused       subscription.resumed
subscription.past_due     subscription.trialing
transaction.completed     transaction.paid          transaction.billed
transaction.payment_failed
adjustment.created        (Paddle models refunds and credits as adjustments)
```

Unknown types are stored as `IGNORED`, not treated as errors: a new Paddle
event type must not become a retry storm.

---

## 6. Payment failure and grace

```
PAYMENT_FAILED -> PAST_DUE (entitlements unchanged)
               -> GRACE    (entitlements unchanged, 7 days)
                    -> recovered -> ACTIVE
                    -> elapsed   -> EXPIRED -> FREE entitlements
```

Premium access is not cut at the first failed charge. The message states the
facts and nothing more — amount, date, exactly when access changes — with a
button to the Paddle portal. No countdowns, no capital letters, no threats.

---

## 7. Refunds

**The refund decision is Paddle's, not ours.** As legal seller they honour
refunds under their own buyer terms. What remains ours is the entitlement
consequence, which `handleRefund` records and applies.

| Refund type | `entitlement_effect` | Behaviour |
| --- | --- | --- |
| Full refund | `REVOKE_IMMEDIATELY` | Subscription moves to `REFUNDED`, entitlements recompute to free |
| Full refund with courtesy window | `REVOKE_AT` | Premium retained until a stored date |
| Partial credit | `NONE` | Entitlements unchanged |
| Chargeback | `REVOKE_IMMEDIATELY` + `REVOKED` | Access revoked, security event recorded |

The customer-facing copy says this plainly rather than implying we can grant a
refund we do not control: *"Refunds are handled by Paddle under their buyer
terms. Contact us first and we will help, but the refund decision is theirs."*

---

## 8. Reconciliation

`/api/cron/reconcile-billing`, protected by `CRON_SECRET`, reads through the
provider port and compares status, price id, period dates and cancellation
intent.

On a mismatch it records a `BILLING_STATE_MISMATCH` and alerts. It does **not**
pick a winner: guessing wrong in one direction steals access from a paying
customer, and in the other gives away paid features. The single safe automatic
repair is a stale period date where status and plan already agree.

---

## 9. Cancellation, pause, reactivation

Cancellation is one click from `/settings/subscription` and from the Paddle
portal. It is not hidden behind a support conversation.

> Your subscription is canceled. Plus features stay active until 1 November
> 2026. After that your account moves to Free. Your cases and documents stay in
> your account.

Reactivation before period end clears the scheduled change. After expiry it is a
new checkout.

---

## 10. Seller of record disclosure

This section exists because the MoR model creates disclosure obligations a
plain gateway does not.

A customer must know, **before paying**:

- that the seller is Paddle.com Market Ltd, not Wintora;
- what will appear on their statement (`PADDLE.NET* WINTORA` — verify against a
  real transaction);
- that tax is calculated and shown at checkout;
- that the subscription renews automatically until cancelled;
- that cancelling keeps access to the end of the paid period and deletes
  nothing;
- that refunds are Paddle's decision.

All of it lives in `src/config/disclosures.ts`, is asserted by
`tests/disclosures.test.ts`, and is returned by `/api/billing/checkout` so the
UI cannot render a checkout without it.

The practical reason, beyond compliance: a customer who does not recognise the
name on their statement disputes the charge. A chargeback on a young merchant
account costs far more than a clear sentence at checkout.

---

## 11. Unit economics: read this before launch

MoR fees are materially higher than a gateway's.

| Plan | Paddle 5% + 50¢ | Effective rate |
| --- | --- | --- |
| Essential $9.99 | $1.00 | **10.0%** |
| Plus $19.99 | $1.50 | 7.5% |
| Pro $29.99 | $2.00 | 6.7% |

**Essential at 10% is the problem.** After AI, OCR, storage and support, the
contribution margin on a $9.99 plan is thin, and it is thinnest on the plan most
likely to have the highest volume. Options, in rough order of preference:

1. Raise Essential, or fold it into Plus.
2. Tighten the free tier's quota so Essential has more room to be worth buying.
3. Offer annual billing, where the fixed 50¢ is amortised over twelve months.

Each feature carries a `costLevel`, high-cost operations route to the advanced
model only where the economics justify it, and `AI_MAX_INPUT_CHARS` caps a
single job. Those controls matter more under MoR pricing, not less.

---

## 12. Indian export documentation — OPEN

The largest unresolved financial question, and it is not a code problem.

The seller is established in India. Revenue arrives as an inward remittance from
Paddle. Two things must be settled with a chartered accountant before volume
builds:

1. **GST zero-rating on export of services.** Paddle does not issue
   India-format FIRA/FIRC. Establishing export status may require reconciling
   Paddle payout records against bank statements. If that is not accepted, GST
   could apply to revenue assumed to be zero-rated — which would dwarf the fee
   difference between any two providers.
2. **Purpose code.** Filed as **P0807 – Off-site Software Exports**, which fits
   a digitally delivered product built in India. Worth confirming, because with
   an MoR the arrangement is arguably licensing to a foreign reseller rather
   than performing a service for a client, and that reading could point
   elsewhere.

Both go in one conversation. Recorded in `docs/LIMITATIONS.md` under
`TAX_REVIEW_REQUIRED`.

---

## 13. Test matrix

`tests/billing-state-machine.test.ts`, `tests/webhook-security.test.ts`,
`tests/payment-provider-port.test.ts`, `tests/disclosures.test.ts`,
`tests/entitlements.test.ts`:

every documented transition and rejection of undocumented ones; Paddle status
and event mapping including fail-closed on unknown values; signature forgery,
wrong secret, missing header, malformed header, tampered body, expired
timestamp; duplicate delivery, out-of-order delivery, unknown event types,
handler failure; provider suitability including rejection of polling-only
providers; every required commercial disclosure; and the full plan and
lifecycle entitlement matrix.
