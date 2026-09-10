# ARCHITECTURE

Wintora is a consumer software utility that helps people in the United States and
Canada understand, organize and act on healthcare bills and related
administrative paperwork.

It is **not** a law firm, medical provider, insurer, debt collector, government
agency, credit-repair business, or autonomous negotiation agent. It prepares
**drafts the user reviews and sends themselves**. See `docs/AI_SAFETY.md` and the
disclaimer system in `src/config/disclaimers.ts`.

---

## 1. Layering

Business logic never lives in UI components. Every layer below depends only on
layers beneath it.

```
+----------------------------------------------------------+
| Presentation      src/app/**, src/components/**           |  React server/client components
+----------------------------------------------------------+
| Application       src/app/api/**, server actions          |  request parsing, auth, orchestration
+----------------------------------------------------------+
| Authorization     src/domain/entitlements/**              |  checkEntitlement(), feature gates
| Billing           src/domain/billing/**                   |  subscription state machine
| Usage             src/domain/usage/**                     |  quota windows, atomic metering
+----------------------------------------------------------+
| Domain            src/domain/{analysis,letters,cases,     |  pure, deterministic, provider-free
|                   retention,redaction}                    |
+----------------------------------------------------------+
| Infrastructure    src/lib/{supabase,payments,ai,http}     |  adapters to external systems
+----------------------------------------------------------+
| Data              supabase/migrations/**                  |  Postgres + Row Level Security
+----------------------------------------------------------+
```

**Ports and adapters.** `src/domain/**` is pure TypeScript with no imports from
`src/lib/**` and no network access. Persistence is expressed as narrow port
interfaces (`EntitlementStore`, `UsageStore`, `BillingStore`). Production wires
Supabase adapters; tests wire in-memory fakes. This is what makes the
entitlement and metering matrices testable without a live database, and the
purity rule is enforced by `scripts/verify-sql-invariants.mjs`.

---

## 2. System architecture

```mermaid
flowchart TB
  subgraph Public["Public / organic surface"]
    SEO["Static and ISR content pages"]
    TOOL["Anonymous free tools (no account required)"]
  end

  subgraph App["Next.js application"]
    RSC["React Server Components"]
    API["Route handlers /api/**"]
    GATE["Feature gate + checkEntitlement()"]
  end

  subgraph Data["Supabase"]
    PG[("Postgres, RLS on every user table")]
    STORE[("Private object storage, signed URLs only")]
    AUTH["Supabase Auth"]
  end

  subgraph Jobs["Background workers"]
    OCRQ["OCR / extraction"]
    AIQ["AI summarization"]
    RET["Retention sweeper"]
    REC["Billing reconciliation"]
    SRC["Source freshness checks"]
  end

  subgraph Ext["External providers"]
      PAY["Paddle (Merchant of Record)"]
    AIP["AI provider (abstracted)"]
    MAIL["Transactional email"]
  end

  SEO --> TOOL --> RSC
  RSC --> API --> GATE
  GATE --> PG
  API --> STORE
  API --> AUTH
  API --> Jobs
  Jobs --> PG
  Jobs --> STORE
  AIQ --> AIP
  PAY -- "signed webhooks" --> API
  API -- "Checkout / Portal sessions" --> PAY
  Jobs --> MAIL
```

---

## 3. Data flow: a document from upload to finding

```mermaid
sequenceDiagram
  participant U as User (browser)
  participant A as API route
  participant E as Entitlement engine
  participant M as Usage meter
  participant S as Private storage
  participant W as Worker
  participant D as Postgres

  U->>A: POST /api/documents (file)
  A->>E: checkEntitlement(user, DOCUMENT_UPLOAD)
  E->>D: read entitlements + usage window
  E-->>A: allowed / denied + remaining
  A->>M: reserve(MONTHLY_DOCUMENTS, idempotencyKey)
  A->>A: MIME sniff, size cap, malware scan
  A->>S: put object (private bucket, per-user prefix)
  A->>D: insert documents row (metadata only)
  A->>W: enqueue extraction job
  W->>S: signed read
  W->>W: extract text, then structured line items
  W->>W: deterministic rule engine (arithmetic, duplicates, EOB delta)
  W->>W: optional AI summarization only, on redacted input
  W->>D: insert analyses + analysis_findings with evidence and confidence
  W->>M: commit or rollback reservation
  U->>A: GET /api/cases/:id
  A-->>U: findings with evidence and next administrative steps
```

The rule engine is deterministic and runs first. The AI layer may only *phrase*
what the rules already found: it can never introduce a finding. See
`docs/AI_SAFETY.md`, section "Output contract".

---

## 4. Billing flow

```mermaid
flowchart LR
  U["User picks a plan"] --> CO["POST /api/billing/checkout"]
  CO --> SC["Paddle transaction, price id resolved from plans table"]
  SC --> PAY["Paddle collects payment as seller of record"]
  PAY --> WH["Paddle webhook POST /api/webhooks/paddle"]
  WH --> V{"Signature valid?"}
  V -- no --> R400["400, nothing written"]
  V -- yes --> IDEM{"event_id already processed?"}
  IDEM -- yes --> ACK["200, no state change"]
  IDEM -- no --> SUB["Update subscriptions row via state machine"]
  SUB --> ENT["Recompute user_entitlements, bump entitlement version"]
  ENT --> UI["UI refetches, features unlock"]
  PAY -.-> SUCCESS["/billing/success page"]
  SUCCESS -.-> UI
```

The dotted path is important: reaching `/billing/success` **never** grants
access. Entitlements change only on a signature-verified webhook or on
reconciliation against the provider API.

---

## 5. Entitlement flow

```mermaid
flowchart TB
  P["plans"] --> PF["plan_features (enabled, limit_value, limit_unit)"]
  F["features (key, type)"] --> PF
  S["subscriptions (status, current_period_*)"] --> C["computeEntitlements()"]
  PF --> C
  POL["policy.ts: grace, downgrade timing, refunds"] --> C
  C --> UE["user_entitlements (enabled, limit_value, period, version)"]
  UE --> CK["checkEntitlement(userId, feature, resource, action)"]
  UC["usage_counters"] --> CK
  CK --> DEC{"allowed?"}
  DEC -- yes --> RUN["execute operation"]
  DEC -- no --> REASON["PLAN_REQUIRED | LIMIT_REACHED | JURISDICTION_UNAVAILABLE | ..."]
```

`computeEntitlements()` is a **pure function**: given a subscription snapshot, a
plan-feature matrix and policy, it returns the entitlement set. It is therefore
directly unit-testable across the full plan and lifecycle matrix
(`tests/entitlements.test.ts`).

---

## 6. Subscription state machine

See `docs/BILLING.md` section 3 for the full transition table and
`src/domain/billing/states.ts` for the executable definition.

```mermaid
stateDiagram-v2
  [*] --> FREE
  FREE --> CHECKOUT_PENDING: user starts checkout
  CHECKOUT_PENDING --> INCOMPLETE: payment requires action
  CHECKOUT_PENDING --> ACTIVE: payment succeeded
  INCOMPLETE --> ACTIVE: authentication completed
  INCOMPLETE --> EXPIRED: abandoned
  ACTIVE --> TRIALING: trial granted
  TRIALING --> ACTIVE: trial converted
  TRIALING --> EXPIRED: trial ended unpaid
  ACTIVE --> PAST_DUE: renewal payment failed
  PAST_DUE --> GRACE: dunning window opens
  GRACE --> ACTIVE: payment recovered
  GRACE --> EXPIRED: grace elapsed
  ACTIVE --> PAUSED: user pauses
  PAUSED --> ACTIVE: user resumes
  ACTIVE --> CANCELED_PENDING_EXPIRY: cancel at period end
  CANCELED_PENDING_EXPIRY --> ACTIVE: reactivated before period end
  CANCELED_PENDING_EXPIRY --> EXPIRED: period ended
  ACTIVE --> REFUNDED: refund issued
  REFUNDED --> FREE: entitlements recomputed
  EXPIRED --> FREE: entitlements recomputed
  ACTIVE --> REVOKED: abuse or chargeback
  REVOKED --> FREE
```

---

## 7. AI pipeline

```mermaid
flowchart LR
  DOC["Uploaded document"] --> CLASS["Classify: PUBLIC vs PRIVATE_SENSITIVE"]
  CLASS --> RED["Redaction: names, DOB, SSN/SIN, member IDs, addresses, account numbers"]
  RED --> MIN["Field minimisation, only fields the task needs"]
  MIN --> RULES["Deterministic rule engine"]
  RULES --> FIND["Findings with evidence"]
  FIND --> LLM["LLM: phrasing and summarisation only"]
  LLM --> VAL["Output validator: schema + banned-claim check"]
  VAL -- fails --> FALLBACK["Deterministic template text"]
  VAL -- passes --> OUT["User-facing explanation"]
```

Uploaded document text is **untrusted data**, never instructions. See
`docs/THREAT_MODEL.md`, section "Prompt injection".

---

## 8. Security boundary

```mermaid
flowchart TB
  subgraph Untrusted
    BR["Browser / mobile client"]
    DOCS["Uploaded PDFs and images"]
    WEBHOOKS["Inbound webhook requests"]
  end
  subgraph Trusted["Server trust boundary"]
    RH["Route handlers"]
    DOMAIN["Domain + entitlement engine"]
    SR["service_role Supabase client"]
  end
  subgraph DataZ["Data zone"]
    PG[("Postgres + RLS")]
    OBJ[("Private buckets")]
  end

  BR -->|"session cookie, anon key"| RH
  DOCS -->|"treated as hostile text"| RH
  WEBHOOKS -->|"HMAC signature required"| RH
  RH --> DOMAIN --> SR --> PG
  SR --> OBJ
  BR -.->|"BLOCKED: anon key cannot bypass RLS"| PG
  BR -.->|"BLOCKED: no public object URLs"| OBJ
```

The anon key is safe in the browser only because RLS is enabled on every
user-scoped table. The `service_role` key is server-only and bypasses RLS; it is
never referenced from any client component. `npm run verify:secrets` enforces
this as a CI gate.

---

## 9. SEO architecture

Public content is generated from structured records (`content_pages`,
`jurisdictions`, `sources`), not from string substitution of a state name into a
template. Each published page carries a jurisdiction, its sources, and a
`last_verified_at` date. Private surfaces are `noindex`. See `docs/SEO.md`.

---

## 10. Technology choices and why

| Concern | Choice | Reason |
| --- | --- | --- |
| Framework | Next.js App Router + TypeScript strict | Server-first rendering for SEO pages; server components keep authorization off the client. |
| Database | Supabase Postgres | The data is deeply relational (user, subscription, plan, feature, entitlement, usage, case, document, finding, source). Quota consumption and billing state need real transactions. |
| Authorization | Application checks **plus** Row Level Security | Two independent layers. A bug in a route handler still cannot read another user's rows. |
| Storage | Supabase private buckets, short-lived signed URLs | No public object URLs for health-adjacent documents. |
| Payments | Paddle, behind a `PaymentProvider` port | Merchant of Record: legal seller, remits sales tax/VAT/GST, accepts individual sellers. Chosen because Stripe is invite-only in India and the operator is not a registered company. The port keeps the choice reversible. |
| AI | Provider abstraction (`src/lib/ai`) | Cost-level routing (basic vs advanced model) protects plan margin; the provider is swappable. |
| Jobs | Queue with idempotency keys | OCR, AI, retention and reconciliation must all be retry-safe. |

---

## 11. Repository map

```
docs/                architecture, billing, entitlements, security, privacy, AI safety, SEO, threat model
supabase/migrations/ ordered SQL: schema, functions, RLS policies, catalog seed
supabase/tests/      RLS isolation tests (require a live Postgres)
src/config/          feature registry, plan catalog, policy constants, disclaimers
src/domain/          pure business logic, no I/O
src/lib/             adapters: supabase, payments (Paddle), ai, http, logging, rate limiting
src/app/             routes: public content, tools, dashboard, billing, API handlers
tests/               vitest suites: entitlements, metering, state machine, webhooks, analysis, redaction, retention
scripts/             CI gates: SQL invariants, secret-leak scan
```

---

## 12. What this architecture deliberately does not do

- It does not send anything on the user's behalf. No email, no fax, no filing,
  no phone call, no payment to a provider.
- It does not decide legal or medical questions.
- It does not treat frontend state as an authorization input.
- It does not delete user data because a subscription lapsed.
- It does not train models on customer documents.
