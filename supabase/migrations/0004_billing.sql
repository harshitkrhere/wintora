-- 0004_billing.sql
-- Subscriptions, invoices, payments, refunds, webhook idempotency,
-- reconciliation. See docs/BILLING.md.
--
-- No card number, CVC or PAN is ever stored here. Only Stripe references and
-- the safe metadata Stripe itself returns.

create table if not exists public.billing_customers (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  provider             billing_provider not null default 'stripe',
  provider_customer_id text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (provider, provider_customer_id),
  unique (user_id, provider)
);

drop trigger if exists billing_customers_set_updated_at on public.billing_customers;
create trigger billing_customers_set_updated_at
  before update on public.billing_customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------

create table if not exists public.subscriptions (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  provider                   billing_provider not null default 'stripe',
  provider_customer_id       text,
  provider_subscription_id   text,
  plan_id                    uuid not null references public.plans(id),
  status                     subscription_status not null default 'FREE',
  country                    country_code not null default 'US',
  currency                   char(3) not null default 'USD',
  billing_interval           billing_interval not null default 'month',
  amount_cents               integer not null default 0,
  provider_price_id          text,
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  cancel_at_period_end       boolean not null default false,
  canceled_at                timestamptz,
  trial_start                timestamptz,
  trial_end                  timestamptz,
  grace_period_end           timestamptz,
  pause_start                timestamptz,
  pause_end                  timestamptz,
  -- A downgrade is recorded here and applied at the effective time, so paid
  -- access is never revoked early. See docs/BILLING.md section 4.
  pending_plan_id            uuid references public.plans(id),
  pending_plan_effective_at  timestamptz,
  -- Guards against out-of-order webhook delivery rolling state backwards.
  provider_object_updated_at timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint subscriptions_period_ordered check (
    current_period_start is null
    or current_period_end is null
    or current_period_end > current_period_start
  )
);

comment on table public.subscriptions is
  'The commercial agreement and its lifecycle state. NOT the entitlement set.';

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create unique index if not exists subscriptions_provider_sub_unique
  on public.subscriptions (provider_subscription_id)
  where provider_subscription_id is not null;

-- At most one live subscription per user. Terminal states are excluded so
-- history is preserved.
create unique index if not exists subscriptions_one_live_per_user
  on public.subscriptions (user_id)
  where status in (
    'CHECKOUT_PENDING','INCOMPLETE','TRIALING','ACTIVE',
    'PAST_DUE','GRACE','PAUSED','CANCELED_PENDING_EXPIRY'
  );

create index if not exists subscriptions_user_idx on public.subscriptions (user_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);
create index if not exists subscriptions_period_end_idx on public.subscriptions (current_period_end);

create table if not exists public.subscription_items (
  id                    uuid primary key default gen_random_uuid(),
  subscription_id       uuid not null references public.subscriptions(id) on delete cascade,
  provider_item_id      text,
  provider_price_id     text,
  quantity              integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists subscription_items_set_updated_at on public.subscription_items;
create trigger subscription_items_set_updated_at
  before update on public.subscription_items
  for each row execute function public.set_updated_at();

-- Materialised billing periods. Quota windows anchor to these rows, so history
-- survives a period rolling over.
create table if not exists public.billing_periods (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  plan_id         uuid references public.plans(id),
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (user_id, period_start),
  constraint billing_periods_ordered check (period_end > period_start)
);

create index if not exists billing_periods_user_idx
  on public.billing_periods (user_id, period_start desc);

-- ---------------------------------------------------------------------------
-- invoices, payments, refunds
-- ---------------------------------------------------------------------------

create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  subscription_id     uuid references public.subscriptions(id) on delete set null,
  provider            billing_provider not null default 'stripe',
  provider_invoice_id text not null,
  number              text,
  amount_due_cents    integer not null default 0,
  amount_paid_cents   integer not null default 0,
  tax_cents           integer not null default 0,
  currency            char(3) not null,
  status              text not null,
  hosted_invoice_url  text,
  invoice_pdf_url     text,
  period_start        timestamptz,
  period_end          timestamptz,
  issued_at           timestamptz,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider, provider_invoice_id)
);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create index if not exists invoices_user_idx on public.invoices (user_id, created_at desc);

create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  invoice_id            uuid references public.invoices(id) on delete set null,
  provider              billing_provider not null default 'stripe',
  provider_payment_id   text not null,
  amount_cents          integer not null,
  currency              char(3) not null,
  status                text not null,
  failure_code          text,
  -- Safe display metadata only, exactly as returned by the provider.
  card_brand            text,
  card_last4            char(4),
  card_exp_month        smallint,
  card_exp_year         smallint,
  processed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (provider, provider_payment_id),
  constraint payments_no_pan check (card_last4 is null or card_last4 ~ '^[0-9]{4}$')
);

comment on table public.payments is
  'Never stores a card number, CVC or full PAN. Brand and last four only.';

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

create table if not exists public.refunds (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  payment_id          uuid references public.payments(id) on delete set null,
  provider            billing_provider not null default 'stripe',
  provider_refund_id  text not null,
  provider_reference  text,
  amount_cents        integer not null,
  currency            char(3) not null,
  reason              text,
  is_full_refund      boolean not null default false,
  -- Explicit policy, never an implicit default. See docs/BILLING.md section 7.
  entitlement_effect  entitlement_effect not null default 'NONE',
  revoke_at           timestamptz,
  decided_by          uuid references auth.users(id),
  processed_at        timestamptz,
  created_at          timestamptz not null default now(),
  unique (provider, provider_refund_id)
);

create index if not exists refunds_user_idx on public.refunds (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- webhook idempotency
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_events (
  id                  uuid primary key default gen_random_uuid(),
  provider            billing_provider not null,
  event_id            text not null,
  event_type          text not null,
  status              webhook_status not null default 'RECEIVED',
  attempt_count       integer not null default 0,
  -- SHA-256 of the raw body. Makes a modified replay of a known id detectable.
  payload_hash        text not null,
  provider_created_at timestamptz,
  received_at         timestamptz not null default now(),
  processed_at        timestamptz,
  error_class         text,
  unique (provider, event_id)
);

comment on table public.webhook_events is
  'The unique (provider, event_id) constraint IS the idempotency mechanism. '
  'Payload bodies are deliberately not stored.';

create index if not exists webhook_events_status_idx
  on public.webhook_events (status, received_at desc);

create table if not exists public.billing_reconciliations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  subscription_id  uuid references public.subscriptions(id) on delete set null,
  mismatch_type    text not null,
  provider_state   jsonb not null,
  internal_state   jsonb not null,
  resolved         boolean not null default false,
  resolved_by      uuid references auth.users(id),
  resolution_notes text,
  detected_at      timestamptz not null default now(),
  resolved_at      timestamptz
);

comment on table public.billing_reconciliations is
  'A mismatch is recorded and alerted, never silently resolved by guessing.';

create index if not exists billing_reconciliations_open_idx
  on public.billing_reconciliations (detected_at desc) where not resolved;
