# PRIVACY

Wintora handles documents that reveal what care a person received, from whom,
when, and what it cost. That is among the most sensitive material a consumer
application can hold. The design rule is minimisation at every stage: collect
the least, process the least, retain the least, expose the least.

---

## 1. What is collected

| Category | Examples | Why |
| --- | --- | --- |
| Account | Email, password hash (held by Supabase Auth), display name | Authentication |
| Locale | Country (US or CA), state or province, timezone, language | Jurisdiction-correct guidance and quota windows |
| Case | Provider name, bill type, amounts, service and statement dates, case status | The core function of the product |
| Documents | Uploaded bills, EOBs, statements, correspondence | The core function of the product |
| Extraction | Line items, totals, dates, codes as printed on the document | Deterministic analysis |
| Billing | Razorpay customer, subscription, payment and invoice ids; card brand and last four; invoice metadata | Subscription management |
| Operational | Request logs with an opaque user reference, salted IP hash for the abuse window | Security and reliability |

**Not collected:** Social Security or Social Insurance numbers as a product
field, government ID documents, biometric data, precise location, contacts,
advertising identifiers, or cross-site behavioural profiles. If an SSN or SIN
appears inside an uploaded document, it is redacted before any AI call and
before any log write; it is never indexed or used as a lookup key.

Account creation asks for an email address and a password. Country is asked
because guidance is jurisdiction-specific. Nothing else is required to use the
free tier.

---

## 2. Lawful basis and roles

The service is provided to consumers directly. Wintora is the controller for
account and operational data, and processes case documents to deliver the
service the user has asked for.

**Billing data is different.** Payments are processed by **Razorpay Software
Private Limited** as payment gateway: the card details are collected in
Razorpay's own checkout iframe and Wintora never sees a card number. Wintora is
the seller and the controller of the subscription record; Razorpay is a
processor for the payment and an independent controller for the card data it
holds under its own terms. Wintora stores Razorpay references, the card brand
and last four digits, and invoice metadata. A customer exercising a privacy
right over card data held by Razorpay may need to exercise it with Razorpay;
the privacy notice must say so and link to theirs.

**The operator is established in India**, and customers are in the United States
and Canada. That is a cross-border transfer on every request, and it must be
disclosed rather than implied. It also means the operator, not only the
provider, is within scope of Indian law. `PRIVACY_REVIEW_REQUIRED`.

`PRIVACY_REVIEW_REQUIRED`, tracked in `docs/LIMITATIONS.md`:

- Whether HIPAA applies. Wintora is not a covered entity and is not acting as a
  business associate of a provider or plan; a consumer holding their own records
  and choosing to upload them is a different posture. That analysis needs
  counsel before any HIPAA-adjacent statement is published, and no HIPAA claim
  appears anywhere in the product until it is done.
- PIPEDA applicability and the provincial regimes, including Quebec Law 25
  requirements on transparency, automated decision-making disclosure and
  portability.
- US state privacy statutes, including CCPA/CPRA treatment of health-adjacent
  data and the several state laws that treat consumer health data as a special
  category.
- Data residency and cross-border transfer. Canadian users may reasonably
  expect Canadian storage. Today there is a single deployment region, and the
  service is operated from India, so health-adjacent data about US and Canadian
  consumers is accessed from a third country. That must be disclosed plainly in
  the privacy notice, and it needs review against PIPEDA, Quebec Law 25 and the
  US state consumer-health statutes before launch. It is the most significant
  open privacy question in the project.

---

## 3. Retention

Retention is governed by the retention system, **not** by billing. The two are
deliberately separate: a subscription lapsing does not delete anything, and a
document expiring does not affect a subscription.

Plan-based document retention (product policy placeholders, not legal
requirements, all configurable in `plan_features`):

| Plan | `RETENTION_DAYS` |
| --- | --- |
| Free | 30 |
| Essential | 90 |
| Plus | 180 |
| Pro | 365 |

Other retention:

| Data | Retained |
| --- | --- |
| Account and profile | Until deletion is requested |
| Case metadata | Until deletion, or 24 months after the case is closed |
| Extracted document text | Same window as the document it came from |
| Billing records | 7 years, for tax and accounting obligations |
| Audit logs | 24 months |
| Security events | 24 months |
| Request logs | 30 days |
| Salted IP hashes | 7 days |
| Deleted-account tombstone | Minimal record of the deletion itself |

### Retention on downgrade

Retention shrinking is never a surprise and never instant.

1. On downgrade, the new retention is computed but not applied immediately.
2. Documents that would fall outside the new window enter a **transition window**
   of 30 days.
3. The user is told exactly which documents are affected, and when.
4. They can download, export or delete them at any point.
5. Only after the transition window does the sweeper delete anything.

The corresponding UI copy states facts:

> Your plan now keeps documents for 90 days. Eleven documents in this case are
> older than that. You can download them until 4 November 2026, after which they
> will be removed. Your cases, findings and letters stay in your account.

Case records, findings and generated letters are text, are small, and are **not**
subject to plan-based document retention. Losing a plan does not erase a
person's record of what happened.

### The sweeper

A scheduled job selects documents where `retention_until < now()` and
`deleted_at is null`, then for each: deletes the object from storage, deletes
the extraction rows, nulls the storage path, sets `deleted_at`, and writes a
minimal audit entry recording that a document of a given type was removed under
a stated policy. The audit entry contains no document content.

Users see the retention window on every document and receive a notification 7
days before expiry.

---

## 4. User rights

Available to every user on every plan, including free, expired and canceled
accounts. `DATA_EXPORT` and `ACCOUNT_DELETION` are entitlements that no plan can
switch off, and `tests/entitlements.test.ts` asserts that for every lifecycle
state.

| Right | Route | Behaviour |
| --- | --- | --- |
| Access | `/settings/privacy` | Structured view of everything held |
| Export | `/api/privacy/export` | Asynchronous job producing a ZIP of JSON plus original documents |
| Correct | Case and profile editors | Direct editing, with an audit trail |
| Delete | `/api/privacy/delete` | Full account and content deletion |
| Restrict | `/settings/privacy` | Pause AI processing while keeping storage |
| Object | `/settings/privacy` | Opt out of optional processing |

Requests are recorded in `privacy_requests` with jurisdiction, verification
status and a statutory due date, so a legal deadline is tracked rather than
remembered.

### Export

Requires step-up authentication. The job produces a single archive containing
account and profile data, cases, documents with their originals, extractions,
analyses and findings with evidence, generated letters, reminders, deadlines,
billing history, and the audit log of the account itself. The download link is
single-use, expires in one hour, and the download is audited. Exports are never
emailed as attachments: the email says only that an export is ready in the
dashboard.

### Deletion

Requires step-up authentication and an explicit typed confirmation. A 7-day
cooling-off window allows cancellation, and the user is told the window exists.
After it elapses, the deletion job removes storage objects, then case and
document rows, then extractions, analyses, findings, letters, reminders,
entitlements and usage, then the profile, then the auth user.

What survives, and why, is stated up front rather than buried:

- Billing records required for tax and accounting, reduced to the minimum needed
  and disassociated from case content.
- Security events involving fraud or abuse.
- A tombstone recording that an account with a given internal id was deleted on
  a given date.
- Backup copies until the backup retention schedule expires them.

The Razorpay customer object is handled per the payment provider terms; the
subscription is cancelled as part of deletion so a deleted account cannot
continue to be billed.

---

## 5. AI and privacy

Default position: **customer documents are never used to train models.** Not by
Wintora, not by a provider. Provider contracts must include zero-retention or
short-retention terms for prompt data, and the provider abstraction records
which terms apply to the configured provider.

Before any content reaches a model:

1. **Classify.** Public reference material and user-private material take
   different paths.
2. **Redact.** Names, dates of birth, SSN/SIN, member and policy numbers,
   account numbers, addresses, phone numbers, email addresses and MRNs are
   replaced with stable placeholders (`[NAME_1]`, `[MEMBER_ID_1]`) so
   relationships survive but identity does not.
3. **Minimise.** Only the fields the specific task needs. A letter that requests
   an itemised statement does not need diagnosis codes, so they are not sent.
4. **Cap.** `AI_MAX_INPUT_CHARS` bounds any single call.

If redaction cannot confidently process a document, the AI step is skipped and
the deterministic path is used. Failing closed costs a nicer sentence; failing
open costs a person their privacy.

Users can disable optional AI processing entirely in `/settings/privacy` and
keep the deterministic analysis, which is the part that actually finds
discrepancies.

---

## 6. Communications

Email and push notifications contain the minimum. They say that something
happened, not what.

Correct:

> You have a new update in your Wintora case. Sign in to view it.

Never:

> Your appeal for the oncology claim from Mercy General was denied.

Push notifications are written to be safe on a lock screen. Subject lines never
name a provider, a condition, a procedure or an amount. Transactional billing
emails may name the plan and the amount, because that is commercial rather than
health information.

---

## 7. Analytics

Two separate environments, and they never mix.

**Marketing analytics**, on public pages only: a privacy-conscious, cookieless
analytics provider recording page, referrer and country. No cross-site tracking,
no advertising pixels, no third-party marketing tags. A consent banner appears
only where one is required, defaults to declining non-essential storage, and
makes declining exactly as easy as accepting.

**Product analytics**, inside the application: first-party events written to our
own Postgres. Events carry an opaque user reference and an event name, never
content.

Permitted event examples: `case_created`, `document_uploaded`,
`analysis_completed`, `finding_viewed`, `letter_generated`, `paywall_shown`,
`upgrade_completed`, `quota_exhausted`.

**Never sent to any analytics system:** document text, extracted values,
diagnoses, procedure codes, provider names, insurer names, bill amounts, member
numbers, or anything derived from a document. The event payload allowlist is
enforced in code, not by convention: an event with an unlisted property is
dropped and the drop is recorded.

There are no advertising or remarketing tags anywhere in the application, and
none on the pages that carry the free tools, because retargeting someone based
on a medical-bill tool visit is exactly the kind of inference this product
exists to avoid.

---

## 8. Health data is not a commodity

Stated plainly because it is the point:

- Health information is never sold, and never shared for anyone else advertising.
- No advertising targeting or lookalike modelling from case content.
- No model training on customer documents by default. Any future change would
  need a separately reviewed, explicit, revocable opt-in that is actually
  implemented rather than merely worded, and it would apply only prospectively.
- No data broker relationships.
- No sharing with employers, insurers, providers or collectors.
- Uploaded documents are stored in a private bucket and inspected by our own
  code. A PDF with a text layer is read in-process and identifiers are removed
  before the figures are laid out by the AI processor below. Photographs and
  scans are read by **Azure Document Intelligence** when that reader is
  configured, under Microsoft's data processing terms; when it is not, the
  photograph is stored and you enter the figures yourself. Whatever is read is
  shown to you as a draft to check, and nothing is analysed until you confirm it.
- The AI processor is **OpenRouter**, which brokers requests to upstream model
  providers. Because routing happens per request, the upstream provider is not
  fixed. Wintora sends every request with a routing constraint that permits only
  providers which do not collect or train on prompt data, and by default sends no
  raw text from your document to any model at all: the model receives a finding
  the deterministic engine produced, with identifiers already removed, and
  nothing else. If no qualifying provider is available the request fails and you
  see the original deterministic wording, which is always correct.
- Subprocessors are limited to what running the service requires (hosting,
  database, storage, payments, email, AI, OCR, malware scanning) and are listed
  publicly at `/privacy#subprocessors` with their purpose and region. Razorpay
  appears there as the payment processor, with the note that it is an
  independent controller of the card data it
  collects, not merely a processor acting on our instructions.

---

## 9. Trust centre

Public, in plain consumer language:

```
/security        implemented controls, in ordinary words
/privacy         the privacy notice
/data-retention  what is kept, for how long, and why
/sources         where the guidance comes from, and how it is verified
/methodology     how the analysis works and what it cannot do
/corrections     how to report an error, and what happens next
/accessibility   the accessibility commitment and known gaps
/status          operational status
/subprocessors   who else processes data, for what, and where
```

These pages describe what is actually implemented. They do not claim
certification, government approval or guaranteed compliance. See
`docs/LIMITATIONS.md` for the honest list of what has not yet been independently
reviewed.

---

## 10. Breach response

A documented incident process: detect, contain, assess, notify. Safe mode is the
containment lever. Notification timelines differ by jurisdiction and are
determined with counsel at the time, but the engineering commitment is that the
audit trail is good enough to establish what was accessed and by whom, which is
the part that has to be built in advance rather than improvised.
