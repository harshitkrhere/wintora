# LIMITATIONS

What is implemented, what is not, and what needs review by someone qualified.

This document exists because the alternative is a launch built on the assumption
that everything in the other documents is finished. Nothing here is hidden in a
footnote.

---

## What is NOT claimed

Stated explicitly, because these are the claims a product in this space is most
tempted to make:

- **Not** HIPAA certified. There is no such thing as HIPAA certification, and no
  HIPAA applicability assessment has been done. No HIPAA claim appears anywhere
  in the product.
- **Not** "fully compliant" with any privacy regime. The architecture is built
  with PIPEDA, Quebec Law 25 and US state privacy law in mind; whether it meets
  them is a legal conclusion nobody here is qualified to draw.
- **Not** "100% secure". Controls are implemented and listed; residual risks are
  named in `docs/THREAT_MODEL.md`.
- **Not** government approved, affiliated or endorsed.
- **Not** penetration tested.
- **Not** SOC 2 audited.
- **Not** a guarantee of any outcome with a provider, insurer, agency or court.

What the system does guarantee is its own behaviour: entitlements follow
verified billing state, expiry revokes premium access per policy, usage limits
are enforced atomically, cancellation is recorded, and documents are protected
by the controls described in `docs/SECURITY.md`.

---

## Blocking before public launch

### `LEGAL_REVIEW_REQUIRED`

| Item | Why |
| --- | --- |
| Terms of service and privacy notice | None have been drafted. The generated policy pages describe implemented behaviour; they are not legally reviewed documents. |
| `INSURANCE_APPEAL` template | Seeded as `DRAFT` and unreachable by users. An appeal letter is the one template that comes closest to legal work. |
| Unauthorized practice of law analysis | Preparing correspondence for a consumer to send themselves is ordinary software. That boundary needs confirming per jurisdiction before any US state or Canadian province is enabled. |
| **Operator identity** | `OPERATOR.legalName` and `contactEmail` in `src/config/disclosures.ts` are deliberately `null`, and `operatorIdentityComplete()` returns false. A subscription is a contract and a contract needs a named party. Trading as an individual is lawful; trading as nobody is not. This must be filled in before taking a payment. |
| **Selling into US/CA from India as an individual** | Consumer-protection obligations, the enforceability of the Terms, and which forum governs a dispute all need review. Being unregistered does not remove obligations to a US or Canadian consumer. |
| Consumer subscription law | US state auto-renewal statutes and Canadian provincial requirements have specific disclosure, consent and cancellation rules. The disclosures in `src/config/disclosures.ts` are designed to satisfy them and are asserted by `tests/disclosures.test.ts`; they have not been checked by a lawyer. |
| Merchant of Record disclosure | The customer contracts with Paddle, not Wintora. Confirm the disclosure copy is sufficient, and that our Terms correctly describe the split between what Paddle sells and what we operate. |
| Every jurisdiction page | No state or province is enabled. Each one needs its content and sources reviewed before `jurisdictions.publishing_enabled` is set. |
| Debt-relief and credit-repair statutes | The product deliberately does not negotiate or advertise debt reduction. Confirm the framing keeps it outside those regimes. |

### `PRIVACY_REVIEW_REQUIRED`

| Item | Why |
| --- | --- |
| HIPAA applicability | Wintora is not a covered entity and not a business associate. A consumer uploading their own records is a different posture. Needs counsel. |
| PIPEDA and provincial regimes | Including Quebec Law 25 on transparency, automated decision-making disclosure and portability. |
| US state privacy statutes | CCPA/CPRA and the several state laws treating consumer health data as a special category. |
| Data residency | Currently a single deployment region. Canadian users may reasonably expect Canadian storage. A business and legal decision, not an engineering default. |
| Subprocessor agreements | AI, OCR, malware scanning, email and hosting all need data processing agreements with zero-retention or short-retention terms for prompt data. |
| Free AI endpoints are not contractually guaranteed | The default models are free OpenRouter endpoints. Requests carry a `data_collection: 'deny'` routing constraint and no raw document text, but a routing preference is not a data processing agreement. Before the AI phrasing feature is used with real customer documents at any scale, either obtain retention terms in writing or leave `AI_PROVIDER=none`, which is fully supported. |
| Free endpoint availability | Free model ids are withdrawn without notice. When that happens, phrasing falls back to deterministic wording silently and correctly, but nothing currently alerts the operator. `npm run ai:models` must be re-run manually. |
| Breached-password rejection | `src/lib/auth/password.ts` enforces a 12-character minimum. Checking a password against a breached-credential list is a Supabase Auth project setting and has **not** been enabled. |
| Retention periods | The plan-based windows are product policy placeholders, not legal requirements. The 7-year billing retention needs confirming against tax obligations. |

### `SECURITY_REVIEW_REQUIRED`

| Item | Why |
| --- | --- |
| Penetration test | Not performed. |
| Production configuration review | Network policy, secret management and backup access still need checking as deployed rather than as written. Storage bucket privacy and RLS coverage are now verified against the live project. |
| Backup restore rehearsal | The procedure is documented, not rehearsed. An untested backup is not a backup. |
| No signature-based antivirus | `MALWARE_SCAN_PROVIDER=structural` verifies the file type from its bytes and rejects PDFs carrying scripts, launch actions, embedded files, rich media, XFA or encryption. It does **not** match files against a virus signature database. For a file that is only parsed, never executed and never served, the structural checks cover the realistic attacks; but this is a deliberate cost decision by a bootstrapped operator, not a claim of equivalence, and a signature scanner (e.g. a private-scanning API) should be added behind the same variable before scale. |
| Photographs need Azure | PDFs with a text layer are read in-process. Photographs, scans and PDFs without a text layer are read only when `OCR_PROVIDER=azure` is configured; otherwise they are stored and the customer types the figures in. Azure's free tier is 500 pages/month and becomes a subprocessor. |
| Export and deletion are fulfilled by hand | `/settings/privacy` records a request immediately with its 30-day statutory deadline, and deletion starts its 7-day cooling-off. The automated workers that produce the export file and perform the deletion are not built. Until they are, the operator fulfils each request manually within the deadline. The page tells the customer this plainly rather than implying it is instant. |
| Free-check cap is per browser | The anonymous checker allows five checks before asking for an account, counted in a signed httpOnly cookie. Clearing cookies or a private window starts the count again. This is deliberate: tying it to an IP would punish everyone on a shared connection and would mean keeping IP-linked records this product does not keep. The per-IP rate limit still bounds abuse. |
| Orphaned uploads | A browser that obtains an upload URL and never calls finalize leaves an object in storage and a `PENDING` row. Nothing sweeps these yet. They cannot be read (not `CLEAN`), count against no quota, and are bounded by the bucket's per-file limit, but they occupy storage until a cleanup job exists. |

### `PAYMENT_REVIEW_REQUIRED`

Subscriptions are sold through **Paddle** as Merchant of Record. Paddle is the
legal seller; Wintora provides the software. See `docs/BILLING.md`.

| Item | Why |
| --- | --- |
| **Paddle business verification** | Not done, and it is the item that can stop the project outright. Paddle underwrites every seller, and a consumer product about medical bills superficially resembles categories MoRs restrict: medical debt collection, credit repair, debt settlement. Disclose plainly what the product is and is not, in writing, before building further on Paddle. Under-describing a business is grounds for termination and withheld payouts. |
| Products and prices | None created. `plan_prices.provider_price_id` is null and `resolvePriceId` throws rather than charging a default. Run `npm run paddle:seed`. |
| Default payment link | Required under Paddle Checkout settings, or hosted checkout returns no URL. |
| Notification destination | Must point at `/api/webhooks/paddle` with its secret in `PADDLE_WEBHOOK_SECRET`. Until then the endpoint fails closed, so a customer could pay and never receive their plan. |
| Statement descriptor | `src/config/disclosures.ts` carries an assumed value. Verify against a real test transaction. An unrecognised descriptor is one of the commonest causes of consumer chargebacks. |
| Refund policy | The refund **decision** is Paddle's under their buyer terms. Our copy says so. Confirm that matches the commercial intent. |
| Paddle status and event names | `mapPaddleStatus` and `mapPaddleEventKind` were written against Paddle's documented Billing API. Verify the exact status strings and event names in a sandbox before launch. Unknown values fail closed to `EXPIRED`, so the failure mode is a customer temporarily losing a feature that reconciliation flags, not an unpaid account keeping access. |
| End-to-end sandbox test | No real checkout has run. Subscribe, upgrade, downgrade, cancel, reactivate, fail a payment and refund, all in sandbox, before launch. |

### `TAX_REVIEW_REQUIRED`

**Buyer-side tax is now Paddle's obligation.** As Merchant of Record they
calculate and remit US sales tax and Canadian GST/HST/QST. That is one of the
main reasons for choosing an MoR, and it removes an obligation an individual
seller could not practically discharge across fifty states and thirteen
provinces.

**Seller-side tax is not, and is the largest open financial question.** The
operator is established in India and receives an inward remittance from Paddle.
Two things must be settled with a chartered accountant before volume builds:

| Item | Why |
| --- | --- |
| **GST zero-rating on export of services** | Paddle does not issue India-format FIRA/FIRC. Establishing export status may require reconciling Paddle payout records against bank statements. If that is not accepted, GST could apply to revenue assumed to be zero-rated, which would dwarf the fee difference between any two providers. |
| **Purpose code** | Filed as **P0807 – Off-site Software Exports**, which fits a digitally delivered product built in India. Worth confirming: under an MoR the arrangement is arguably licensing to a foreign reseller rather than performing a service for a client, and that reading could point to a different code. |
| Income characterisation | Platform payout, royalty, service income or software sale. It affects both the purpose code and the GST position. |

Both questions belong in one conversation with the same CA.

---

## Implemented but not yet wired to a provider

These fail closed rather than degrading silently.

| Subsystem | State | Consequence |
| --- | --- | --- |
| Supabase | Not provisioned | Auth, database and storage are unavailable. Migrations are written and ordered but unapplied. |
| Paddle | Not configured | Checkout, portal and plan changes throw a typed billing error. The webhook endpoint fails closed without its secret. |
| AI provider | Optional | `getProvider()` returns null and every finding uses its deterministic wording. The product works fully without it, because the model is not what finds problems. |
| OCR | `none` | Extraction from scanned documents does not run. The manual-entry path and the anonymous tool work fully. |
| Malware scanning | `structural` | Byte sniffing plus PDF structure checks, in-process. Not signature antivirus; see above. |
| OCR | `none` | Photos and scans are stored but not read until Azure Document Intelligence is configured. |
| Email | `none` | Notification jobs queue but do not send. |
| Analytics | Not configured | No marketing analytics loads. |

---

## Known technical limitations

**Rate limiting is in-memory.** Correct for a single instance; a multi-region
deployment needs a shared store (Redis or the Supabase database). The interface
in `src/lib/http/ratelimit.ts` is designed for that swap.

**The job queue is a database table, not a worker.** `jobs`, `export_jobs` and
`deletion_jobs` are written correctly with idempotency keys, and the cron routes
process retention and reconciliation. The OCR, AI, export and deletion workers
themselves are not implemented; the rows queue and wait.

**Document upload has no route yet.** The entitlement checks, quota metering,
storage policy, retention model and validation rules all exist and are tested.
The `POST /api/documents` handler that ties them together, with content-type
sniffing and the malware-scan gate, is not written. The manual-entry analysis
path is complete and works end to end.

**Extraction is not implemented.** `document_extractions` is modelled and the
analysis engine consumes its shape, but nothing populates it. Analyses today run
on values the user provides.

**The AI phrasing layer is not called from any route.** `phraseFinding` is
implemented, guarded and tested, but the analysis route stores deterministic
findings only. Wiring it in is a small change; leaving it out changes nothing a
user relies on.

**Auth pages are not built.** Sign-in, sign-up, password reset and MFA
enrolment. Session handling, `requireUser()` and step-up checks are implemented
and used.

**The admin surfaces are not built.** The entitlement inspector, plan editor,
revenue and margin dashboards, and content editor are specified in the docs and
modelled in the schema, with no UI.

**Household cases are modelled, not implemented.** `case_members` and
`HOUSEHOLD_MEMBERS` exist; no UI assigns a case to a household member. Pro
should not be sold on that feature until it does.

**Priority support is a plan feature with no staffed queue.** It must not be
advertised until there is one. This is exactly the "do not sell what you do not
provide" rule, and it currently fails.

**No French localisation.** The architecture supports it; no translation exists,
and machine-translating regulatory content for Quebec would be worse than not
offering it.

**Native apps do not exist.** The cross-platform entitlement model is designed
for it: platform purchases would map into the same `user_entitlements`. No
receipt validation is implemented.

---

## Deliberate omissions

Choices made on purpose, not gaps:

- **No device fingerprinting.** Building a persistent cross-session identity
  graph into a health-adjacent product to catch a small amount of trial abuse is
  a worse trade than absorbing the abuse.
- **No advertising or remarketing tags**, anywhere, including the public tool
  pages. Retargeting someone because they visited a medical-bill tool is exactly
  the inference this product exists to avoid.
- **No model training on customer documents.** Changing this would need a
  separately reviewed, explicit, revocable opt-in that is actually implemented,
  applying only prospectively.
- **No automated sending.** No email, fax, filing, call or payment on a user's
  behalf. This is a product boundary, not a missing feature.
- **No savings estimates.** The product cannot know what a bill "should" cost,
  so it does not guess, and it never displays a projected saving.
- **No Razorpay.** It has no place in a US/CA consumer subscription product.

---

## Concentration risk worth naming

With a Merchant of Record, the customer's subscription contract is with Paddle,
not with us. That has a consequence worth stating plainly rather than
discovering later: **migrating away is materially harder than changing a payment
gateway**, because the subscriptions cannot simply be ported. Customers would
need to re-subscribe.

The `PaymentProvider` port keeps the *code* portable, which is the part we
control. It does not make the *commercial relationship* portable, and nothing
in engineering can.

That is an argument for taking the Paddle underwriting conversation seriously up
front, rather than discovering a policy problem after there are paying
subscribers.

---

## Test coverage: what is and is not proven

**Proven by `npm test` (299 tests):** the entitlement matrix across every plan
and every lifecycle state; inalienable rights in all twelve states; scheduled
downgrade timing; quota windows including month-end, leap-day and DST edges;
atomic metering including a twenty-way concurrent race; idempotent retries;
rollback policy; every documented billing transition plus rejection of
undocumented ones; Paddle status and event mapping; webhook signature forgery, replay,
tampering, out-of-order delivery and unknown types; every analysis rule
including the cases where it must stay silent; redaction and log safety;
letter rendering and injection resistance; retention transition planning; AI
output validation and prompt injection; frontend tampering and cross-user
access; and catalog parity between the config registry and the SQL seed.

**Proven against the live database** (`npm run db:verify`, 57 assertions): user A
cannot select, update or delete user B's cases, documents, letters, invoices,
subscriptions, usage counters, entitlements or profile; cannot attach a child
row to another user's parent; cannot grant themselves a staff role, an
entitlement, a usage counter, a subscription, a verified deadline, a forged
SYSTEM timeline event or an analysis finding; cannot see any internal table; and
no SECURITY DEFINER function is callable by `anon` or `authenticated`.
`npm run db:advisors` reports zero security findings.

### One real vulnerability was found and fixed here

Supabase's security advisor caught a **live quota bypass** that the TypeScript
suite could not see, because it tested the metering logic rather than the
Postgres grants.

Migration 0011 revoked EXECUTE on the usage functions from `public` and `anon`,
but not from `authenticated`. Supabase grants EXECUTE on public-schema functions
to `authenticated` by default and exposes them at `/rest/v1/rpc/<name>`, so any
signed-in user could have called them directly. `consume_usage` takes `p_limit`
from the caller and adopts a larger limit than the one recorded, so a free user
could have posted `p_limit: 999999` and granted themselves unlimited analyses;
`rollback_usage` would have let them refund their own consumption at will.

Fixed in `0013_harden_function_grants.sql`, which also pins `search_path` on
every SECURITY DEFINER function, drops the unused `citext` extension, and sets
default privileges so a future function added to `public` does not silently
reopen the same hole. `supabase/tests/rls_isolation.sql` now asserts the grants
directly, and reproduces the failure (11 assertions) if 0013 is reverted.

The lesson worth keeping: RLS protects tables, not functions. Enabling RLS on
everything, which `npm run verify:sql` checks, said nothing about this.

**Not proven, because it needs a live Paddle sandbox:** end-to-end checkout,
proration on a real upgrade, the scheduled downgrade, and the hosted portal. The
state machine, the status and event mapping, and the whole webhook path are
tested against constructed events with real HMAC signatures, but no money has
moved.

**Not proven, because the code does not exist:** upload, extraction, OCR, export
and deletion job execution, and email delivery.
