# Wintora

A consumer software utility that helps people in the United States and Canada
understand, organise and act on healthcare bills and related administrative
paperwork.

It is **not** a law firm, medical provider, insurer, debt collector, government
agency, credit-repair business, or autonomous negotiation agent. It prepares
drafts that the user reviews and sends themselves.

---

## Quick start

```bash
npm install
cp .env.example .env.local
npm run gate     # typecheck, invariants, secret scan, 299 tests
npm run dev
```

The gate passes on a clean checkout with no external services configured,
because the domain layer has no dependency on them. Follow `docs/DEPLOYMENT.md`
to wire up Supabase and Razorpay.

---

## The three ideas the codebase is built on

**1. The model never decides what is true.** Every finding comes from a
deterministic rule engine over the figures on a document. A language model may
only rephrase a finding that already exists, given that finding and its
evidence, with no tools and no network. That is what makes text inside an
uploaded document harmless: an injected instruction has nothing to actuate.

**2. Billing, entitlement, usage and data ownership are four separate things.**
The payment provider decides whether money moved. The database decides what the
user may do.
Usage counters decide how much is left. `user_id` decides who owns a record.
Collapsing any two of these is where subscription products go wrong: a lapsed
plan should cost you features, not your case history.

**3. Authorization is asked exactly one way.** `checkEntitlement()` takes a
user, a feature and a resource, and returns a decision with a reason, a
remaining balance and a reset date. There is no `user.plan === 'pro'` anywhere
else, and the build fails if one appears.

---

## Documentation

| Document | What it covers |
| --- | --- |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Layering, diagrams, technology choices |
| [DATABASE](docs/DATABASE.md) | Schema, RLS, atomic usage functions, indexes |
| [BILLING](docs/BILLING.md) | Plan catalog, state machine, webhooks, refunds, reconciliation |
| [PRICING](docs/PRICING.md) | Tier structure, price reasoning, retention mechanics, which persuasion is used and which is refused |
| [ENTITLEMENTS](docs/ENTITLEMENTS.md) | Feature registry, plan matrix, metering, fairness rules |
| [SECURITY](docs/SECURITY.md) | Auth, authorization, uploads, headers, logging, safe mode |
| [PRIVACY](docs/PRIVACY.md) | Collection, retention, user rights, AI privacy, analytics |
| [AI_SAFETY](docs/AI_SAFETY.md) | Output contract, hallucination control, injection, language |
| [SEO](docs/SEO.md) | Growth loop, page template, content operations, indexing |
| [THREAT_MODEL](docs/THREAT_MODEL.md) | Assets, thirteen threat classes, accepted risks |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | Setup order, secrets, cron, gate, incident response |
| [LIMITATIONS](docs/LIMITATIONS.md) | **What is not built, and what needs review** |

Read `docs/LIMITATIONS.md` before assuming anything is production-ready. It is
the honest register: what works, what fails closed, and what needs a lawyer, a
privacy officer or a penetration test rather than more code.

---

## Layout

```
docs/                 architecture and policy documents
supabase/migrations/  ordered SQL: schema, RLS, functions, catalog seed
supabase/tests/       adversarial RLS isolation matrix (needs a live database)
src/config/           feature registry, plan catalog, policy, disclaimers
src/domain/           pure business logic, no I/O, no provider SDKs
src/lib/              adapters: supabase, payments (Razorpay), ai, http, logging
src/app/              routes: public content, tools, API handlers, settings
tests/                299 tests across 11 suites
scripts/              CI gates: structural invariants, secret-leak scan
```

`src/domain/**` imports nothing from `src/lib/**`. Persistence is expressed as
narrow ports; production wires Supabase adapters and tests wire in-memory fakes.
That is what makes the entitlement and metering matrices testable without a
database, and the build fails if the boundary is crossed.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Test suite |
| `npm run typecheck` | TypeScript, strict |
| `npm run verify:sql` | RLS coverage, domain purity, no plan-string authorization |
| `npm run verify:secrets` | No server secret reachable from client code |
| `npm run gate` | All of the above. Required before deploying |

---

## Product principles

These are enforced in code and in tests, not just written down.

- The free tier runs the **same analysis engine** as every paid tier. What a
  free user gets less of is volume and workflow, never truth.
- **Nothing is deleted because a plan changed.** A downgrade blocks creating new
  things; it never removes existing ones.
- **Data export and account deletion work on every plan**, including free,
  expired and cancelled accounts. They are rights, and the entitlement engine is
  not permitted to gate them.
- **A failed payment does not revoke access.** There is a grace period, and the
  user is told the amount, the date and exactly what happens if it is not
  resolved.
- **Reaching the payment success page grants nothing.** Access changes only on a
  signature-verified webhook.
- **No manufactured urgency, invented savings, or fake scarcity.** An arithmetic
  difference is a question worth asking, not evidence that anyone did anything
  wrong.
- **Nothing is sent on a user's behalf.** No email, fax, filing, call or
  payment. Letters are drafts the user reviews and sends.
- **Customer documents are never used to train models.**

---

## Licence

Not yet determined.
