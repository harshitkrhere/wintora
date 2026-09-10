# ENTITLEMENTS

There is exactly one way to ask whether a user may do something:

```ts
const decision = await checkEntitlement(deps, {
  userId,
  feature: 'EOB_COMPARISON',
  resource: { type: 'case', id: caseId },
  action: 'execute',
});
```

It returns:

```ts
{
  allowed: boolean;
  feature: FeatureKey;
  reason: EntitlementReason;   // ALLOWED | PLAN_REQUIRED | LIMIT_REACHED | ...
  plan: PlanSlug;
  remaining: number | null;    // null when the feature is not metered
  limit: number | null;
  resetAt: string | null;      // ISO, aligned to the billing period
  expiresAt: string | null;    // when the current entitlement lapses
  version: number;             // entitlement version, for cache invalidation
  message: string;             // plain, non-manipulative user-facing sentence
}
```

There is no `if (user.plan === 'pro')` anywhere in the codebase.
`scripts/verify-sql-invariants.mjs` fails the build if that pattern reappears
outside `src/config/` and `src/domain/entitlements/`.

---

## 1. The chain

```
Payment provider (billing authority)
  -> subscriptions.status + period       (what the customer is paying for)
  -> plans + plan_features               (what that plan includes)
  -> policy.ts                           (grace, downgrade timing, refunds)
  -> computeEntitlements()               (pure function)
  -> user_entitlements                   (materialised, versioned)
  -> checkEntitlement()                  (+ live usage_counters)
  -> authorization decision
```

`computeEntitlements()` takes a snapshot and returns an entitlement set. It
performs no I/O, so the whole plan and lifecycle matrix is unit-testable.

`user_entitlements` is a **materialised cache** of that function, not an
independent source of truth. It can be dropped and recomputed at any time by
`recomputeEntitlements(userId)`. Nothing writes to it except the recompute path.

---

## 2. Feature registry

`src/config/features.ts` is the single registry. Every feature has a key, a
type, a human name, a customer-facing benefit sentence, and a cost level. The
pricing page, the comparison table, the paywalls, the benefits panel and the
backend authorization all read from it, so a feature advertised on the pricing
page cannot fail to exist in the backend.

### Feature types

| Type | Meaning | Example |
| --- | --- | --- |
| `BOOLEAN` | On or off for the plan | `EOB_COMPARISON` |
| `LIMIT` | A ceiling on concurrent state | `MAX_ACTIVE_CASES` |
| `QUOTA` | A per-billing-period allowance that resets | `MONTHLY_ANALYSES` |
| `RETENTION` | A duration in days | `RETENTION_DAYS` |
| `SUPPORT_LEVEL` | An ordinal service tier | `PRIORITY_SUPPORT` |

### Boolean features

```
DOCUMENT_UPLOAD          BASIC_BILL_ANALYSIS      ADVANCED_DOCUMENT_ANALYSIS
EOB_COMPARISON           LETTER_GENERATION        ADVANCED_LETTERS
PREMIUM_TEMPLATES        CASE_TRACKING            MULTIPLE_CASES
CASE_TIMELINE            REMINDERS                DEADLINE_TRACKING
ADVANCED_EXPORT          HOUSEHOLD_CASES          EXTENDED_HISTORY
PRIORITY_SUPPORT         DATA_EXPORT              ACCOUNT_DELETION
```

`DATA_EXPORT` and `ACCOUNT_DELETION` are enabled on **every** plan including
free, and including expired accounts. Data portability and deletion are user
rights, not paid features, and the entitlement engine is not permitted to gate
them. `tests/entitlements.test.ts` asserts this for every lifecycle state.

### Limits and quotas

```
MAX_ACTIVE_CASES      MONTHLY_DOCUMENTS     MONTHLY_ANALYSES
MONTHLY_LETTERS       MONTHLY_EXPORTS       MAX_FILE_SIZE_MB
STORAGE_LIMIT_MB      RETENTION_DAYS        HOUSEHOLD_MEMBERS
```

---

## 3. Plan matrix

Seeded from `src/config/plans.ts` into `plan_features`. Every number here is
configuration, changeable by an administrator without a code change or a
deploy.

| Feature | Free | Essential | Plus | Pro |
| --- | --- | --- | --- | --- |
| `DOCUMENT_UPLOAD` | yes | yes | yes | yes |
| `BASIC_BILL_ANALYSIS` | yes | yes | yes | yes |
| `ADVANCED_DOCUMENT_ANALYSIS` | no | yes | yes | yes |
| `EOB_COMPARISON` | basic only | yes | yes | yes |
| `LETTER_GENERATION` | yes | yes | yes | yes |
| `ADVANCED_LETTERS` | no | no | yes | yes |
| `PREMIUM_TEMPLATES` | no | yes | yes | yes |
| `CASE_TRACKING` | yes | yes | yes | yes |
| `CASE_TIMELINE` | basic | yes | yes | yes |
| `REMINDERS` | no | yes | yes | yes |
| `DEADLINE_TRACKING` | no | no | yes | yes |
| `ADVANCED_EXPORT` | no | no | yes | yes |
| `HOUSEHOLD_CASES` | no | no | no | yes |
| `EXTENDED_HISTORY` | no | no | yes | yes |
| `PRIORITY_SUPPORT` | no | no | no | yes |
| `DATA_EXPORT` | yes | yes | yes | yes |
| `ACCOUNT_DELETION` | yes | yes | yes | yes |
| `MAX_ACTIVE_CASES` | 1 | 5 | 15 | 50 |
| `MONTHLY_DOCUMENTS` | 3 | 25 | 100 | 300 |
| `MONTHLY_ANALYSES` | 2 | 15 | 50 | 150 |
| `MONTHLY_LETTERS` | 1 | 10 | 30 | 90 |
| `MONTHLY_EXPORTS` | 1 | 5 | 20 | 60 |
| `MAX_FILE_SIZE_MB` | 10 | 20 | 25 | 25 |
| `STORAGE_LIMIT_MB` | 50 | 500 | 2000 | 5000 |
| `RETENTION_DAYS` | 30 | 90 | 180 | 365 |
| `HOUSEHOLD_MEMBERS` | 1 | 1 | 1 | 6 |

The free tier is deliberately useful. It runs the same deterministic analysis
engine as every paid tier. Free users are never given deliberately degraded or
misleading results to manufacture an upgrade; what they get less of is
**volume and workflow**, not **truth**.

---

## 4. Entitlement reasons

`checkEntitlement()` never returns a bare `false`. The reason drives what the UI
shows, and each maps to a specific feature-gate state.

| Reason | Gate state | Meaning |
| --- | --- | --- |
| `ALLOWED` | `AVAILABLE` | Proceed. |
| `PLAN_REQUIRED` | `PLAN_REQUIRED` | Feature exists but is not in this plan. |
| `LIMIT_REACHED` | `LIMIT_REACHED` | Quota or concurrent limit exhausted for this period. |
| `SUBSCRIPTION_INACTIVE` | `PLAN_REQUIRED` | Premium feature, subscription expired or paused. |
| `JURISDICTION_UNAVAILABLE` | `JURISDICTION_UNAVAILABLE` | Feature not enabled for this state or province. |
| `FEATURE_DISABLED` | `TEMPORARILY_UNAVAILABLE` | Feature flag off, or global safe mode. |
| `REQUIRES_VERIFICATION` | `REQUIRES_VERIFICATION` | Step-up authentication needed (exports, deletion). |
| `NOT_OWNER` | denied | The resource belongs to another user. Also a security event. |
| `RESOURCE_INVALID` | denied | Resource missing or in the wrong state. |

`NOT_OWNER` is never surfaced as "this belongs to someone else". The user sees a
generic not-found, and the attempt is recorded in `security_events`.

---

## 5. Usage metering

Quota features are metered in a **reserve, then commit or roll back** cycle so a
failed operation does not burn a credit and a retry does not burn two.

```
BEGIN
  SELECT ... FOR UPDATE on the usage_counters row for (user, feature, period)
  IF an idempotency_key row already exists -> return the original result, consume nothing
  IF used + amount > limit                 -> ROLLBACK, return LIMIT_REACHED
  INSERT usage_reservations (idempotency_key UNIQUE)
  UPDATE usage_counters SET used = used + amount
COMMIT
-- operation runs --
commit(reservationId)     -- normal completion, usage stands
rollback(reservationId)   -- operation failed, usage returned
```

Implemented as the Postgres function `consume_usage()` in
`supabase/migrations/0011_functions_usage_atomic.sql`, wrapped by
`src/domain/usage/meter.ts`. The row lock is what makes concurrent requests
safe: ten simultaneous analyses against a limit of two grant exactly two.
`tests/usage-metering.test.ts` asserts this, along with idempotent retries and
rollback on failure.

### Rollback policy

| Failure | Usage |
| --- | --- |
| Infrastructure failure (OCR down, AI timeout, storage error) | Rolled back. Not the customer's fault. |
| Invalid input rejected before processing | Rolled back. |
| Operation completed but the user disliked the result | Retained. The work was done. |
| Client disconnect after processing started | Retained; the result is saved to the case. |

### Quota windows

Quota periods are aligned to the **billing period**, not the calendar month. A
subscription running the 14th to the 14th resets on the 14th. Free users have no
provider billing period, so they get a rolling 30-day window anchored to account
creation.
`src/domain/usage/period.ts` computes the window and is tested against month-end
edge cases (31 January to 28 February), leap days, and DST boundaries; all
arithmetic is in UTC.

On upgrade mid-period the allowance grows immediately and consumption already
recorded is preserved. On downgrade at period end the new, smaller allowance
applies from the next window. A user is never retroactively pushed over a limit
for usage they legitimately had at the time.

---

## 6. Never trust the frontend

The client may cache the entitlement snapshot for up to 60 seconds to render
gates without a round trip. That cache is **display only**.

Every privileged operation re-checks server-side, inside the same transaction
that consumes the quota. The following are all expected and all denied by the
backend, and each has a test in `tests/frontend-tamper.test.ts`:

- editing `localStorage` to claim a plan
- forging a cookie or a client-side plan name
- calling a premium API route directly with no UI involvement
- calling a premium route with a valid session but an expired subscription
- replaying a `/billing/success` URL
- unhiding a disabled button in devtools
- racing concurrent requests to slip past a quota
- passing another user's resource id to an endpoint the caller is entitled to

The last case is the important one: entitlement and ownership are separate
checks. Being on Pro entitles you to run an analysis; it does not entitle you to
run one on someone else's case. `checkEntitlement()` takes a `resource` and
verifies ownership, and RLS independently blocks the read even if that check
were skipped.

---

## 7. Versioning and cache invalidation

Every entitlement write bumps `user_entitlements.version` for that user. The
version is returned by `checkEntitlement()` and included in the client snapshot.
When the client sees a higher version it refetches. Stale clients cannot use an
old snapshot to authorize anything, because authorization happens on the server
regardless.

Webhook handlers apply entitlement changes idempotently. A duplicate delivery
does not double-bump the version or double-grant an allowance.

---

## 8. Customer fairness

Security and fairness are both requirements. The engine must not grant more than
was paid for, and it must not take away less than was paid for.

Deliberate fairness rules:

- Paid entitlements persist through UI bugs and delayed webhooks, because the
  server reads the database, not the client.
- A duplicate or out-of-order webhook cannot shorten a period.
- A downgrade never revokes early.
- A payment failure never revokes before the grace window elapses.
- A refund follows the recorded policy, not an implicit default.
- Expiry revokes premium features only; login, account management, free
  features, export, deletion and billing history all continue to work.
- Data is never deleted because a plan changed. Retention and billing are
  separate systems.

---

## 9. What the customer sees

`/settings/subscription` renders directly from the registry and live counters:

```
Plus                                          Active

Your benefits
  Advanced bill analysis
  EOB comparison
  Deadline tracking
  Advanced exports
  15 active cases
  50 analyses per billing period
  30 letters per billing period
  180-day document retention

Remaining this period
  Analyses   42 of 50 remaining
  Letters    22 of 30 remaining
  Cases      11 of 15 available
  Resets     1 October 2026
```

No ambiguity about what was bought, what is left, or when it resets. Paywalls
state what the user has, what they are missing, what the upgrade gives, the
price, the billing frequency and the cancellation terms. There are no fake
countdowns, no invented savings, no manufactured urgency.
