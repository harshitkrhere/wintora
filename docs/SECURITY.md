# SECURITY

Working assumptions, applied everywhere:

- Every input is malicious until validated.
- Every browser is untrusted.
- Every uploaded document is hostile.
- Every webhook can be spoofed or replayed.
- Every frontend entitlement claim can be forged.
- Every account will attempt privilege escalation.

---

## 1. Authentication

Supabase Auth with three routes in: Google OAuth, email plus password, and a
magic link. Sessions are httpOnly, `Secure`, `SameSite=Lax` cookies handled by
`@supabase/ssr`; no access token is written to `localStorage`.

Google OAuth is started server-side (`/api/auth/oauth`) rather than in the
browser, because `next` has to pass through `safeRedirect` before it is embedded
in the callback URL. A client-built OAuth URL is an open redirect: the value
survives the whole round trip and returns as a redirect target. The request asks
for `scope=email` only and forces `prompt=select_account`, so a shared browser
does not silently reuse someone else's Google session.

- Password minimum 12 characters, enforced in `src/lib/auth/password.ts`.
  Composition rules are deliberately absent: they mostly produce `Password1!`.
  **Breached-password rejection is a Supabase Auth project setting, not
  implemented here**, and enabling it is listed in `docs/LIMITATIONS.md`.
- TOTP MFA available to all users and **required** for every staff role.
- Step-up re-authentication (a fresh login within the last 10 minutes) is
  required for: data export, account deletion, changing email, changing
  password, granting support access, and viewing a signed document URL after a
  long idle period.
- Rate limiting on login, signup, password reset and magic link, keyed by IP and
  by account, with exponential backoff. Failures are counted in
  `security_events`, and a burst across many accounts from one source is treated
  as credential stuffing.
- Login responses are constant-shaped: an unknown email and a wrong password
  produce the same message and comparable timing, so the endpoint is not an
  account-existence oracle.

---

## 2. Authorization: two independent layers

**Layer 1, application.** Every route handler establishes the authenticated user
from the session, then calls `checkEntitlement()` with the feature *and the
resource*. Entitlement and ownership are separate questions and both are asked.

**Layer 2, database.** RLS policies on every user-scoped table restrict rows to
`user_id = (select auth.uid())`. Child tables verify ownership through their
parent. If layer 1 has a bug, layer 2 still returns zero rows.

The `service_role` key bypasses RLS. It is used only in server-side code paths
that have already performed an explicit ownership check, and it never appears in
a client bundle. `scripts/verify-no-secret-leaks.mjs` fails the build if
`SUPABASE_SERVICE_ROLE_KEY`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` or
`OPENROUTER_API_KEY` appears in any file containing `"use client"`, in anything
under `src/components/`, or behind a `NEXT_PUBLIC_` name. It also scans for the
literal shapes of live credentials, so a key pasted into a file by accident fails
the build rather than reaching a commit.

---

## 3. Staff roles

Roles are separated so that billing work never requires access to health-adjacent
documents.

| Role | Can | Cannot |
| --- | --- | --- |
| `SUPPORT` | See ticket metadata, plan, subscription status, usage counters | Read documents, extractions, findings, or letter contents |
| `BILLING_ADMIN` | Invoices, refunds, subscription state, reconciliation | Read any case content |
| `CONTENT_EDITOR` | Draft, review and publish content pages and sources | See any user data at all |
| `PRIVACY_ADMIN` | Process privacy requests, run exports and deletions | Browse documents outside a specific request |
| `SECURITY_ADMIN` | Read `security_events` and `audit_logs`, manage flags | Read document contents |
| `SUPER_ADMIN` | Manage roles | Silently read documents; document access always requires a grant |

Document access by staff requires a `support_access_grants` row: the **user**
grants it, it names a specific case, it carries a stated reason, it expires
(default 24 hours), and every read against it is written to `audit_logs`. There
is no ambient admin path to a user document. Any attempt to read one without a
live grant is a `security_events` row.

---

## 4. Input validation

Every route handler parses its input with a zod schema before anything else.
Unvalidated request data never reaches the domain layer. Responses are also
schema-shaped, so an internal field cannot leak by accident.

- Path and query parameters are validated as UUIDs where they are ids.
- Numeric input is range-checked; money is parsed to integer minor units.
- Free-text fields have length caps and are stored as text, never interpolated
  into SQL.
- All database access is through parameterised queries or PostgREST filters. No
  string-concatenated SQL exists in the codebase.
- Any outbound fetch (source verification, provider webhooks) validates the URL
  against an allowlist of schemes and hosts and refuses private, link-local,
  loopback and metadata addresses, which blocks SSRF including via redirects and
  DNS rebinding. Redirects are followed manually with the same check at each
  hop.

---

## 5. File upload

The upload path, in order:

1. Entitlement check (`DOCUMENT_UPLOAD`) and quota reservation
   (`MONTHLY_DOCUMENTS`, `STORAGE_LIMIT_MB`, `MAX_FILE_SIZE_MB`).
2. Size cap enforced by the plan and by the platform.
3. Content-type sniffing from the actual bytes, not the client-supplied
   `Content-Type` or the file extension. Allowlist only: PDF, PNG, JPEG, HEIC,
   TIFF.
4. PDF structure checks: reject encrypted PDFs the parser cannot handle, reject
   embedded JavaScript, reject launch and embedded-file actions.
5. Malware scan. Until a scanner is configured, `MALWARE_SCAN_PROVIDER=none`
   holds the document in `scan_status = 'PENDING'` and refuses extraction. This
   is a deliberate fail-closed default and is listed in `docs/LIMITATIONS.md`.
6. SHA-256 hash computed and stored.
7. Object written to the private bucket under `{user_id}/{case_id}/{doc_id}`.
8. Metadata row inserted. Extraction is enqueued, never run inline.

Files are never served from an origin that can execute them, never returned with
a user-controlled content type, and always delivered with
`Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

---

## 6. Webhook security

Covered in detail in `docs/BILLING.md`, section 5. The security-relevant
properties:

- Raw body signature verification before any parsing. Paddle signs
  `<timestamp>:<raw body>` with HMAC-SHA256 and sends it as `Paddle-Signature`;
  `verifyPaddleSignature` recomputes it and compares in constant time.
- Constant-time signature comparison, and a timestamp tolerance that rejects
  old signatures. The tolerance is 300 seconds rather than Paddle's own 5-second
  SDK default: five seconds drops legitimate events on a slow network hop, and a
  dropped billing event means a paying customer does not receive what they
  bought. The **real** replay defence is the next item, which makes a replay a
  no-op however old it is.
- Idempotency on `(provider, event_id)` with a unique constraint, so redelivery
  cannot double-apply.
- `payload_hash` stored so a modified body reusing a known event id is
  detectable.
- Ordering enforced by `provider_object_updated_at`, so a late event cannot roll
  a subscription backwards.
- Invalid signatures return 400, write a `security_events` row, and change no
  state.
- The webhook route is excluded from any body-parsing middleware and runs on the
  Node runtime.

---

## 7. Transport and browser hardening

Built in `src/lib/http/csp.ts`, applied by `src/middleware.ts`, and pinned by
`tests/csp.test.ts`.

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self';
  script-src 'self' 'nonce-<per-request>' https://cdn.paddle.com;
  style-src 'self' 'unsafe-inline' https://*.paddle.com;
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self' https://*.supabase.co https://*.paddle.com;
  frame-src https://*.paddle.com;
  frame-ancestors 'none'; base-uri 'self'; form-action 'self';
  object-src 'none'; worker-src 'self' blob:; upgrade-insecure-requests
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self)
Cross-Origin-Opener-Policy: same-origin
X-Frame-Options: DENY
```

**Scripts** carry a per-request nonce and no `'unsafe-inline'`. The nonce is set
on the *request* headers as well as the response, which is how Next.js learns to
stamp it onto the inline scripts carrying the RSC streaming payload. Without
that the page renders and never hydrates.

**Styles allow `'unsafe-inline'`, and carry no nonce.** Two honest points about
this:

- The nonce is *absent by necessity*, not by oversight. Per the CSP spec,
  `'unsafe-inline'` is **ignored** whenever a nonce or hash is present in the
  same directive. Listing both silently blocks every inline style.
- It is a real weakening. React emits an inline style for every `style={{...}}`
  prop and Paddle.js injects its own for the checkout overlay, so the practical
  choice was inline styles or no working checkout. Inline CSS cannot execute
  code, and `img-src` is restricted to `'self' data: blob:`, which closes the
  usual CSS-based exfiltration routes. The stricter fix is to remove every
  inline style prop in favour of classes; that is recorded in
  `docs/LIMITATIONS.md` rather than pretended away.

**`'unsafe-eval'` is added in development only**, because Next.js evaluates
strings for hot module replacement. `tests/csp.test.ts` asserts it is absent
from a production policy.

CSRF: state-changing routes are POST/PATCH/DELETE only, require a JSON content
type, verify the `Origin` header against `NEXT_PUBLIC_APP_URL`, and rely on
`SameSite=Lax` session cookies. Implemented in `src/lib/http/origin.ts` and
tested in `tests/origin.test.ts`.

In **development only**, loopback and private-LAN origins are also accepted,
because browsing `localhost` while `NEXT_PUBLIC_APP_URL` points at a tunnel is a
normal setup and strict equality rejects every POST with a bare 403. Production
has no such allowance, and a test asserts it.

Redirect targets (`?next=`) are attacker-controllable and pass through
`safeRedirect` in every consumer: the page, the API route and the OAuth
callback. Same-site absolute paths only, with protocol-relative, backslash,
control-character and scheme-smuggling variants all refused.

XSS: React escapes by default. `dangerouslySetInnerHTML` appears nowhere in the
codebase, and `verify-sql-invariants.mjs` fails the build if it is introduced.
Generated letter previews render as plain text nodes, never as HTML.

---

## 8. Rate limiting and abuse

Limits are applied per account, per IP and per route class, with the tighter of
the two winning:

| Class | Limit |
| --- | --- |
| Auth (login, signup, reset) | 10 per 15 min per IP, 5 per account |
| Upload | Plan quota, plus 20 per hour |
| Analysis | Plan quota, plus 10 per hour |
| Letter generation | Plan quota, plus 15 per hour |
| Export | Plan quota, plus 3 per hour |
| Anonymous public tool | 20 per hour per IP |
| Referral redemption | 5 per day per account |

IPs are stored only as a salted hash with a rotating salt, and only for the
abuse window. The product does not build long-lived device fingerprints for
users of a health-adjacent service.

Referral abuse controls: self-referral detection on account, payment fingerprint
and email normalisation; reward only on qualified activation rather than signup;
per-account reward caps; manual review above a threshold. Rewards are product
credit, not cash.

---

## 9. Secrets

- No secret is ever committed. `.env.example` carries names and comments only.
- Production secrets live in the platform secret store, injected at runtime.
- Rotation runbook for each secret is in `docs/DEPLOYMENT.md`.
- Secrets never appear in logs, error messages, URLs, or analytics.
- The redacting logger scrubs anything matching known secret shapes before
  writing, as a second line of defence rather than a first.

---

## 10. Logging and observability

Logged for every request: request id, opaque user reference (a per-environment
HMAC of the user id, not the id itself), route, method, status, latency, error
class, entitlement decision reason.

**Never logged:** document contents, extracted text, diagnoses, provider names
attached to an identifiable user, insurance member numbers, dates of birth,
SSN/SIN, card data, authentication secrets, full request or response bodies for
any route that touches a document.

`src/lib/logging.ts` runs every log record through the same redactor used for AI
inputs, and `tests/redaction.test.ts` asserts that representative sensitive
payloads survive neither the AI path nor the logging path.

Monitored signals: authentication anomalies, failed-payment spikes, webhook
failure rate, authorization-denial rate, document-access anomalies, mass export
attempts, unusual analysis volume, unexpected admin activity, and the
`BILLING_STATE_MISMATCH` counter.

---

## 11. Error handling

Users see a generic message and a request id:

> Something went wrong. Please try again. If it keeps happening, quote reference
> `req_8f2a...` when you contact support.

Stack traces, database errors, provider errors and internal identifiers stay in
server logs. `src/lib/errors.ts` defines typed application errors with a public
message and a private detail; the public message is the only thing serialised to
a client.

---

## 12. Safe mode

`SAFE_MODE=true`, or the `safe_mode` row in `feature_flags`, immediately:

- stops new document uploads
- stops OCR, extraction and AI processing
- stops letter generation
- keeps authentication, account management, billing and data export working
- keeps public informational pages serving
- displays a plain status banner

Per-jurisdiction switches (`jurisdictions.enabled`, `processing_enabled`,
`publishing_enabled`) allow one state or province to be paused (for example after
a rule change invalidates published guidance) without stopping the business.

---

## 13. Backups and recovery

Automated daily encrypted Postgres backups with point-in-time recovery, and
versioned object storage. Backup encryption keys are separate from application
keys, and backup restore access is a distinct role from production database
access. Restores are rehearsed quarterly against a scratch project; an untested
backup is not a backup. Retention deletions propagate to backups on the backup
retention schedule, which is documented to users in the privacy notice rather
than glossed over.

---

## 14. Deployment gate

`npm run gate` must pass before a production deploy. It fails on:

- TypeScript errors
- any test failure
- a `create table` without RLS or an explicit exemption annotation
- a plan-string comparison outside the entitlement layer
- `dangerouslySetInnerHTML` anywhere
- a server secret referenced from client code
- a `NEXT_PUBLIC_` variable holding a secret-shaped name

`.github/workflows/ci.yml` runs the same command, so the gate cannot be skipped
locally.

---

## 15. Independent review still required

This document describes controls that are implemented in this repository. It is
not an assertion of certification or of regulatory compliance. Penetration
testing, a HIPAA/PHIPA applicability assessment, and a security review of the
production configuration are listed in `docs/LIMITATIONS.md` as
`SECURITY_REVIEW_REQUIRED`. See `docs/LIMITATIONS.md` for what is deliberately
not claimed.
