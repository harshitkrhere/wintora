-- 0005_entitlements_usage.sql
-- Entitlements (what the user may do) and usage (how much they have consumed).
--
-- user_entitlements is a MATERIALISED CACHE of computeEntitlements(). It can be
-- dropped and rebuilt at any time. Nothing writes to it except the recompute
-- path. See docs/ENTITLEMENTS.md.

create table if not exists public.entitlement_versions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  version    integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.entitlement_versions is
  'Monotonic per-user counter. Clients refetch when they see a higher version.';

create table if not exists public.user_entitlements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  feature_id     uuid not null references public.features(id) on delete cascade,
  feature_key    text not null,
  source_plan_id uuid references public.plans(id),
  enabled        boolean not null default false,
  limit_value    integer,
  limit_unit     text,
  period_start   timestamptz,
  period_end     timestamptz,
  effective_at   timestamptz not null default now(),
  expires_at     timestamptz,
  version        integer not null default 0,
  updated_at     timestamptz not null default now(),
  unique (user_id, feature_id)
);

comment on table public.user_entitlements is
  'Derived from subscription + plan_features + policy. Never edited directly.';

create index if not exists user_entitlements_user_idx
  on public.user_entitlements (user_id, feature_key);
create index if not exists user_entitlements_version_idx
  on public.user_entitlements (user_id, version);

-- ---------------------------------------------------------------------------
-- usage
-- ---------------------------------------------------------------------------

create table if not exists public.usage_counters (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  feature_key  text not null,
  period_start timestamptz not null,
  period_end   timestamptz not null,
  used         integer not null default 0 check (used >= 0),
  -- Snapshot of the limit in force for this window. Kept alongside the counter
  -- so a mid-period plan change cannot retroactively push a user over a limit
  -- they were legitimately under at the time.
  limit_value  integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, feature_key, period_start),
  constraint usage_counters_period_ordered check (period_end > period_start)
);

drop trigger if exists usage_counters_set_updated_at on public.usage_counters;
create trigger usage_counters_set_updated_at
  before update on public.usage_counters
  for each row execute function public.set_updated_at();

create index if not exists usage_counters_lookup_idx
  on public.usage_counters (user_id, feature_key, period_start desc);

-- Reserve, then commit or roll back. The unique idempotency_key is what makes a
-- browser retry free rather than double-charged.
create table if not exists public.usage_reservations (
  id              uuid primary key default gen_random_uuid(),
  counter_id      uuid not null references public.usage_counters(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  feature_key     text not null,
  amount          integer not null check (amount > 0),
  idempotency_key text not null unique,
  status          reservation_status not null default 'RESERVED',
  -- Cached result so a replayed idempotency key returns the original answer
  -- without touching the counter again.
  result_remaining integer,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz
);

comment on table public.usage_reservations is
  'One row per metered operation attempt. Retries reuse the row, never the quota.';

create index if not exists usage_reservations_counter_idx
  on public.usage_reservations (counter_id, status);
create index if not exists usage_reservations_user_idx
  on public.usage_reservations (user_id, created_at desc);

-- Now that entitlement_versions exists, wire the new-user trigger from 0002.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
