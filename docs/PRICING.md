# PRICING

The commercial architecture: what is sold, at what price, why, and which
persuasion techniques are used and which are refused. `src/config/plans.ts`
holds the numbers; this document holds the reasoning.

Target market: consumers in the United States and Canada, sold by the operator
with Razorpay as payment gateway. Not businesses, not teams, not seats.

---

## 1. Structure: one free tier, three paid, good-better-best

| | `free` | `essential` | `plus` | `pro` |
| --- | --- | --- | --- | --- |
| Role | Acquisition | Entry | **Target** | Anchor |
| USD | 0 | 14.99 / mo · 149 / yr | 19.99 / mo · 199 / yr | 29.99 / mo · 299 / yr |
| CAD | 0 | 19.99 / mo · 199 / yr | 25.99 / mo · 259 / yr | 39.99 / mo · 399 / yr |
| Fits | One bill, before paying it | A few bills a year | An ongoing dispute or one episode of care | A household, or caring for someone else |
| Active cases | 1 | 5 | 15 | 50 |
| Analyses / month | 2 | 15 | 50 | 150 |
| Document retention | 30 days | 90 days | 180 days | 365 days |
| Distinguishing features | Same engine as paid | Multiple cases, EOB comparison, reminders | Advanced letters, deadline tracking, exports, extended history | Household (6 people), priority support |

The three paid tiers map onto the standard consumer good-better-best ladder:

- **Essential is the entry point.** It is priced close enough to Plus that
  the comparison is obvious, and it is limited on exactly the dimensions a
  person with a real dispute runs into: cases, analyses, letters, and the
  absence of deadline tracking and exports. It is a genuine product for the
  person with two bills a year; it is not a fake option.
- **Plus is the target.** Five dollars more than Essential for three times the
  volume and every workflow feature. It is marked "Recommended" on the pricing
  page, and it is the only plan that carries that label.
- **Pro is the anchor.** It exists for households and carers, who genuinely
  need six people and fifty cases, and it also does the quiet work of making
  Plus look reasonable. Priority support is on the matrix but is sold only once
  a staffed queue exists (`docs/LIMITATIONS.md`).

The free tier runs the same deterministic engine as every paid tier. What a
free user gets less of is volume and workflow, never truth. That is a product
principle (`docs/AI_SAFETY.md` section 8) and also the acquisition strategy:
the anonymous checker gives five real answers before asking for an account,
and the account is free without a card.

### Why Essential moved from 9.99 to 14.99

`docs/BILLING.md` section 11 identified the problem when Paddle was the
provider: under its 5% + 50¢, a 9.99 plan paid a 10% effective fee, and after
AI, OCR, storage and support the contribution margin on the highest-volume plan
was the thinnest. The three options listed there were: raise Essential, tighten
the free tier, or add annual billing. This change took the first and the third.

The provider has since changed to Razorpay, whose published international card
rate is about 3% plus 18% GST on the fee (roughly 3.5%, with no fixed component),
so the fee argument for the higher entry price is weaker than it was. The
positioning argument is unchanged: at 14.99 against 19.99, Plus is "five
dollars more" for three times the volume and every workflow feature, which is
the honest framing of what Plus adds. The current fee table is in
`docs/BILLING.md` section 11.

### Why annual, and why about two months free

Medical bills are episodic, so monthly churn is structural: a person resolves
the bill and cancels. Annual billing is the one retention lever that is both
effective and honest. It suits people with chronic conditions, households, and
anyone who has learned that bills recur, and it gives them a real discount for
committing.

The discount is roughly two months free (17%) on every plan and both
currencies. `annualSavingPercent()` computes the exact percentage from the
catalog; nothing on the pricing page hand-types it, so the words can never
drift from the numbers. `tests/catalog-parity.test.ts` keeps the saving between
8% and 25%: less is not worth a year's commitment, more suggests the monthly
price is padding.

**What annual billing does not change:** the meaning of "per month". A yearly
period is cut into twelve equal quota windows (`src/domain/usage/period.ts`),
so a Plus customer paying yearly gets 50 analyses a month, not 50 a year.
`tests/billing-intervals.test.ts` pins this.

### Where the interval lives

On the **price**, not the plan (`plan_prices.interval`, migration 0015). Plus
is one plan with four prices. Plan comparison, entitlements and the feature
matrix never see the interval; only checkout and display do. Moving from
monthly to yearly on the same plan is an upgrade (immediate, prorated); moving
back is a downgrade (at period end), via `compareOffers()`.

---

## 2. Retention: what keeps a customer, and what we refuse to do

The techniques below are the ones the product actually uses. Each one is
something we would be comfortable explaining to the customer it is applied to.

**The record is the switching cost.** A person's cases, timelines, findings and
letters accumulate into a record of what happened with their bills. That record
is genuinely valuable, and it stays with them for as long as they keep an
account. This is the legitimate version of "lock-in": the product becomes hard
to leave because it is useful, not because leaving is punished.

**Retention windows grow with the plan.** Documents are kept 30/90/180/365 days
by tier (`RETENTION_DAYS`). Longer history is a real benefit to a person
managing ongoing care, and it is one of the clearest reasons to stay on a paid
plan.

**A lapsed subscription degrades, it does not lock.** This is the "read-only
grace" pattern, and it was already implemented before this document existed:

| State | What the customer has |
| --- | --- |
| `PAST_DUE`, `GRACE` (7 days) | Full paid entitlements. A declined card is not a reason to lose a case workspace. |
| `CANCELED_PENDING_EXPIRY` | Full paid entitlements to the end of the period paid for. |
| `EXPIRED` → `free` | Free-tier limits. Over-limit cases and documents stay **readable**; only creating new ones is blocked. Nothing is deleted because a plan changed. |
| Any state | Data export and account deletion. These are rights, not features. |

See `POLICY.grace`, `POLICY.downgrade` and `POLICY.retention` in
`src/config/policy.ts`, and `docs/ENTITLEMENTS.md`.

**Annual plans.** Covered above. The commitment is paid for with a discount, and
the customer can cancel the renewal at any time from their subscription page.

---

## 3. Persuasion: what is used, what is not, and why

The pricing page uses exactly two persuasive devices:

1. One plan carries a "Recommended" label.
2. Each plan has one sentence saying who it fits.

Both are statements the product can stand behind: a recommendation is an
opinion we hold, and the fit sentences describe the limits. Neither depends on
information we do not have.

The following are deliberately **not** used, and `tests/catalog-parity.test.ts`
rejects the words that usually accompany them in `bestFor`:

| Technique | Why not |
| --- | --- |
| "Most popular" badges | We have no data. Once we do, a true statement of popularity is fine. |
| Countdown timers, "offer ends", scarcity | False urgency on a product for stressed people is both cruel and, in the US, squarely within the FTC's dark-pattern enforcement. Canada's Competition Bureau has taken the same line. |
| Strike-through "was" prices | There was no "was". Introductory pricing, if ever used, will say exactly what the renewal price is, next to the price. |
| Pre-selected upsells, hidden cancellation, "are you sure?" chains | US state auto-renewal laws and Canadian provincial consumer law require clear disclosure and easy cancellation; the product cancels in one click and says so. |
| Holding data hostage on cancellation | Data portability is a right (PIPEDA, Quebec Law 25, CCPA/CPRA, and the product's own `INALIENABLE_FEATURES`). Deleting or hiding a person's medical-bill record to make them resubscribe is exactly the manipulation the product exists to protect people from. Refused on principle, and the entitlement engine is not permitted to do it. |
| Manufactured anxiety in findings | `docs/AI_SAFETY.md` section 8: "Anxiety is never manufactured to sell a subscription. If nothing is wrong, the product says so clearly, even though 'your bill looks consistent' sells nothing." |

The decoy effect, as usually described, is a deliberately unattractive option
that exists only to steer. Essential is not that: it is a real plan with a real
audience. What the ladder does is make the *comparison* between Essential and
Plus easy to see, which is a fair service to the customer as much as to us.

---

## 4. Not applicable: the B2B template

A generic SaaS pricing framework (entry / growth / enterprise with SSO, seats,
SLAs and account managers) does not fit a consumer product about medical bills,
and pretending it does would produce a pricing page nobody in the audience
recognises themselves on. The consumer analogues, where they exist, are:

| B2B lever | Consumer analogue here |
| --- | --- |
| Seats | `HOUSEHOLD_MEMBERS` (Pro: 6 people) |
| Usage caps that force upgrade | Cases, analyses, letters and exports per month |
| Enterprise SSO / SLA | None. Priority support with a published response target is the ceiling, and only once staffed. |
| Custom contracts | None. One set of Terms applies to everyone. |

---

## 5. Consumer law the prices must live with

Not legal advice; a list of the rules the design was built to satisfy, all of
which need a lawyer before launch (`docs/LIMITATIONS.md`, `LEGAL_REVIEW_REQUIRED`).

- **US state auto-renewal statutes** (California ARL, New York, Illinois, and
  others): clear and conspicuous disclosure of the renewal terms before
  purchase, affirmative consent, an acknowledgement with the cancellation
  method, and online cancellation. `src/config/disclosures.ts` carries the
  copy and `tests/disclosures.test.ts` asserts it appears before the pay action.
- **Annual renewal reminders.** Several US states require a reminder notice
  before an annual (or longer) subscription renews; California requires one for
  terms of a year or more, between 15 and 45 days before renewal. **No reminder
  email is built yet.** Until it is, annual plans are a legal risk in those
  states and this is recorded as blocking in `docs/LIMITATIONS.md`.
- **Canada**: Ontario's Consumer Protection Act, Quebec's Consumer Protection
  Act (with its own renewal and contract-language rules), and the Competition
  Act's drip-pricing provisions. The price shown is the price charged; no tax
  is added after the fact. Under a gateway any GST/HST registration above the
  threshold is the operator's, and the checkout would then have to show it
  (`docs/LIMITATIONS.md`, `TAX_REVIEW_REQUIRED`).
- **Grandfathering**: an existing subscriber keeps their price until contacted
  directly, and the pricing page says so. Migration 0015 repriced Essential in
  place only because nothing had been sold; it refuses to run if a subscription
  exists, and after launch a price change must be a new plan version
  (`docs/BILLING.md` section 1).

---

## 6. Open decisions

- **Introductory pricing** for the first month or year: not implemented, not
  decided. If used, the renewal price appears next to the introductory price.
- **Tightening the free tier** (option 2 from `docs/BILLING.md` section 11) has
  not been taken. Two analyses and one letter a month is already tight, and the
  free tier is the acquisition funnel for an organic-first product.
- **Priority support** stays unsold until a queue exists.
- **Trials** remain off (`POLICY.trials.enabled = false`) pending terms review.
