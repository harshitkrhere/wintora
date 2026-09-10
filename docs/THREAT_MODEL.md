# THREAT MODEL

Assets, ranked by what an attacker gains and what a user loses:

1. **Uploaded documents and extractions.** Health-adjacent, identifying,
   irreversible once disclosed.
2. **Account access.** A takeover yields everything in category 1.
3. **Entitlements and quota.** Revenue integrity.
4. **Billing records.** Financial and identifying.
5. **Published content integrity.** Wrong guidance harms users at scale.
6. **Availability.** A stressed user with a deadline needs the product to work.

Trust boundaries are drawn in `docs/ARCHITECTURE.md`, section 8.

---

## T1. Account takeover

**Vectors:** credential stuffing, phishing, session theft, password reset abuse,
email change hijack.

**Controls:** breached-password rejection; TOTP MFA available to all and
mandatory for staff; httpOnly `SameSite=Lax` cookies with no token in
`localStorage`; rate limiting per IP and per account with backoff; step-up
re-authentication for export, deletion, email change and support grants; email
change requires confirmation at both the old and new address; sessions
invalidated on password change; new-device sign-in notification.

**Residual:** a phished user who also completes MFA. Mitigated by the sign-in
notification and by the 7-day cooling-off window on deletion, which gives a real
user time to notice and cancel.

---

## T2. Cross-user data access

**Vectors:** IDOR by substituting another user's `case_id` or `document_id`; a
forged parent id on an insert; a missing filter in a query; a signed storage URL
leaking; a bug in one route handler.

**Controls:** ownership is checked in the application **and** enforced by RLS
with `force row level security`; child tables verify ownership through the
parent with an `exists` subquery, so a forged `case_id` cannot attach a row to
someone else; storage keys are prefixed by user id and the storage policy is
scoped to that first path segment; signed URLs are short-lived, single-purpose
and audited; every ownership failure writes a `security_events` row and returns
a generic not-found rather than confirming that the resource exists.

**Tests:** `supabase/tests/rls_isolation.sql` runs the adversarial matrix
against a live database; `tests/frontend-tamper.test.ts` covers the application
layer.

**Residual:** a compromised `service_role` key bypasses RLS entirely. Mitigated
by server-only usage, the CI secret-leak gate, rotation, and alerting on
anomalous query volume.

---

## T3. Malicious documents

**Vectors:** malware-carrying PDF; PDF with embedded JavaScript or launch
actions; zip and decompression bombs; XXE via embedded XML; a parser crash or
memory exhaustion; polyglot files that pass a content-type check; SVG or HTML
disguised as an image.

**Controls:** content-type determined by sniffing actual bytes, never the
client-supplied header or extension; strict format allowlist; size caps per plan
and per platform; PDF structure checks rejecting embedded JavaScript, launch
actions and embedded files; malware scanning with a **fail-closed** default, so
an unconfigured scanner blocks extraction rather than waving files through;
extraction runs in an isolated worker with CPU, memory and wall-clock limits, no
network access, and no filesystem access outside a scratch directory;
decompression limits; files are never served from an executable origin and
always with `nosniff` and `Content-Disposition: attachment`.

**Residual:** a zero-day in a PDF parser. Mitigated by isolation, resource
limits, and the fact that the worker holds no secrets and cannot reach the
database directly.

---

## T4. Prompt injection

**Vectors:** instructions embedded in document text; instructions in a filename
or in document metadata; text crafted to suppress a genuine finding or to
manufacture a false one; attempts to extract the system prompt or another
user's data.

**Controls:** findings come from the deterministic rule engine, so injected text
cannot create, suppress or alter one; document text is passed in a delimited,
explicitly untrusted data section; instruction-shaped content is detected,
stripped and recorded as `PROMPT_INJECTION_SUSPECTED`; the model has **no tools,
no network, no database access** on this path, so a successful injection has
nothing to actuate; outputs are schema-constrained and validated against
banned claims and unsupported numbers; the prompt contains no secrets, no
internal identifiers and no other user's data, so there is nothing to
exfiltrate; filenames are sanitised and never passed to the model.

**Residual:** a document that degrades the *quality* of a summary without
triggering detection. The deterministic finding is still correct, and the
evidence is shown alongside it, so the user can check.

---

## T5. Webhook spoofing and replay

**Vectors:** forged Stripe webhook granting a subscription; replay of a captured
legitimate event; modified body reusing a valid event id; out-of-order delivery
rolling a subscription backwards; a flood of events.

**Controls:** HMAC signature verification against the raw body before any
parsing, using the official library and constant-time comparison; timestamp
tolerance rejecting old signatures; unique `(provider, event_id)` making
redelivery a no-op; `payload_hash` making a modified replay detectable;
`provider_object_updated_at` making stale events non-applicable; invalid
signatures return 400, write a security event, and change nothing; rate limiting
and alerting on the endpoint.

**Tests:** `tests/webhook-security.test.ts` covers forged signature, absent
signature, replayed event, modified body with a valid id, out-of-order arrival,
and an unknown event type.

**Residual:** a leaked webhook secret. Mitigated by rotation, by the fact that
the secret alone still cannot invent a Stripe customer that maps to a real user
row, and by reconciliation, which would surface a subscription that Stripe has
no record of.

---

## T6. Entitlement and quota bypass

**Vectors:** editing `localStorage` or a cookie to claim a plan; calling a
premium API route directly; replaying `/billing/success`; racing concurrent
requests past a quota; retrying to get a second result for one credit;
manipulating a period boundary; using another user's resource id while holding a
valid entitlement.

**Controls:** authorization is entirely server-side and the client cache is
display-only; `/billing/success` grants nothing and only reads state; quota
consumption uses `SELECT ... FOR UPDATE` inside a transaction, so concurrency
resolves to exactly the limit; idempotency keys make retries free rather than
double-charged; quota windows derive from the billing period stored server-side;
entitlement and ownership are separate checks, so a Pro subscription does not
authorise operating on someone else's case.

**Tests:** `tests/frontend-tamper.test.ts` and `tests/usage-metering.test.ts`
including a ten-way concurrent race against a limit of two.

---

## T7. Payment fraud and abuse

**Vectors:** stolen cards; trial farming with disposable emails; refund abuse;
friendly fraud chargebacks; referral farming with self-referrals or duplicate
accounts.

**Controls:** Stripe Radar rather than home-grown card scoring; no raw card data
ever touches our systems; trial eligibility rules; rate-limited account
creation; referral rewards only on qualified activation, never on signup, with
self-referral detection across account, email normalisation and payment
fingerprint, plus per-account caps and manual review above a threshold; rewards
are product credit rather than cash; chargebacks move the subscription to
`REVOKED` and write a security event.

**Deliberate non-control:** no invasive device fingerprinting. This is a
health-adjacent service, and building a persistent cross-session identity graph
to catch a small amount of trial abuse would be a worse trade than absorbing the
abuse.

---

## T8. Insider and support abuse

**Vectors:** a support agent browsing documents out of curiosity or malice; an
admin escalating their own role; a compromised staff account.

**Controls:** roles separate billing access from document access, so no billing
task requires reading a case; document access requires a `support_access_grants`
row that the **user** creates, naming a specific case, carrying a stated reason
and an expiry; every access under a grant is audited; role assignment lives in
`user_roles`, which no user-facing path can write; MFA is mandatory for staff;
`security_events` records any document read attempted without a live grant; an
entitlement inspector exists for support that shows plan, status, usage and
period **without** exposing any case content.

---

## T9. Content integrity

**Vectors:** publishing outdated law after a source changes; a jurisdiction page
asserting another jurisdiction's rule; AI-generated content published without
review; a malicious or careless edit.

**Controls:** every rule and page carries a jurisdiction, sources, effective
dates and a review status; scheduled source re-fetching with content hashing
marks dependents `STALE` and opens a review ticket; the publishing layer refuses
to serve `DRAFT` or `STALE` content; nothing AI-drafted publishes without human
editorial review; every publish is versioned and rollback-able; per-jurisdiction
kill switches allow one state or province to be paused without affecting the
rest; user-reported corrections become tracked review items.

---

## T10. Denial of service and cost exhaustion

**Vectors:** flooding uploads or analyses to burn AI and OCR spend; enormous
files; expensive regular expressions on extracted text; scraping the public
site; a queue flooded so paying users wait behind abuse.

**Controls:** per-account and per-IP rate limits on every expensive route; plan
quotas as the primary economic bound; `AI_MAX_INPUT_CHARS` capping any single
call; cost-level routing so cheap work never reaches an expensive model;
per-user and per-plan spend tracking with alerting; queue priority favouring
paying users; timeouts and resource limits on every worker; regular expressions
reviewed for catastrophic backtracking; static and ISR public pages served from
cache.

---

## T11. Supply chain

**Vectors:** a malicious npm dependency; a compromised transitive package; a
typosquat; a compromised CI action.

**Controls:** a committed lockfile with exact resolution; automated dependency
audit in CI; a deliberately small dependency surface; CI actions pinned to
commit SHAs; least-privilege deploy credentials; a review requirement for any
new runtime dependency added to a path that touches documents or billing.

---

## T12. Third-party compromise

**Vectors:** a breach at the AI provider, OCR provider, email provider, or
analytics vendor.

**Controls:** minimisation, so a provider receives only redacted, minimised
content and never a whole document unnecessarily; zero-retention or
short-retention contractual terms for prompt data; no health content ever sent
to analytics or email; providers behind an abstraction so one can be replaced
quickly; safe mode able to disable an entire provider path in one flag; a
published subprocessor list so users can see who is involved.

---

## T13. Physical and operational

**Vectors:** a stolen laptop with production access; an exposed backup; a
misconfigured public bucket.

**Controls:** no production data on developer machines; disk encryption and MFA
required for admin access; backups encrypted with keys separate from the
application; backup restore is a distinct role from database access;
infrastructure as code with a review requirement; automated checks that storage
buckets are private, run as part of the deployment gate rather than as a manual
checklist item.

---

## Deliberately accepted risks

Stated plainly, because an honest threat model names what it is not solving:

- **A determined phishing attack against an individual user.** MFA and
  notifications reduce it; they do not eliminate it.
- **Extraction errors on poor-quality scans.** Mitigated by confidence scoring,
  by showing the evidence next to every finding, and by never asserting
  something the user cannot check for themselves.
- **A zero-day in a document parser.** Mitigated by isolation and resource
  limits rather than prevented.
- **Some trial and referral abuse.** Accepted, deliberately, rather than
  building surveillance infrastructure into a health-adjacent product.
- **Single-region deployment.** Documented to users rather than obscured;
  revisiting it is a business decision recorded in `docs/LIMITATIONS.md`.

---

## Review cadence

This model is reviewed when a new data category is introduced, a new provider is
added, a new jurisdiction is enabled, a new payment surface is added (native
in-app purchase in particular), or after any security incident. Penetration
testing before public launch is listed in `docs/LIMITATIONS.md` as
`SECURITY_REVIEW_REQUIRED` and has not been performed.
