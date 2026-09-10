-- 0003_catalog.sql
-- The plan catalog. Billing configuration is DATA, not code.
--
-- Prices, limits, currencies, intervals and availability all change here
-- without touching authorization logic. See docs/ENTITLEMENTS.md.

create table if not exists public.features (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,
  name          text not null,
  description   text not null,
  -- Shown verbatim on the pricing page and in the benefits panel, so a feature
  -- cannot be advertised in words that differ from what is enforced.
  benefit_text  text not null,
  type          feature_type not null,
  cost_level    cost_level not null default 'LOW',
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint features_key_format check (key ~ '^[A-Z][A-Z0-9_]*$')
);

comment on table public.features is
  'The single feature registry. src/config/features.ts seeds this and must match.';

drop trigger if exists features_set_updated_at on public.features;
create trigger features_set_updated_at
  before update on public.features
  for each row execute function public.set_updated_at();

create table if not exists public.plans (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null,
  version             integer not null default 1,
  display_name        text not null,
  description         text not null,
  tier                integer not null,            -- ordering for upgrade/downgrade comparison
  active              boolean not null default true,
  -- Which countries may purchase this plan. Empty means all supported.
  country_scope       country_code[] not null default array['US','CA']::country_code[],
  billing_interval    billing_interval not null default 'month',
  provider            billing_provider not null default 'stripe',
  provider_product_id text,
  is_free             boolean not null default false,
  -- Lifecycle: a price change creates a NEW version rather than mutating a row,
  -- which is what makes grandfathering possible. See docs/BILLING.md section 1.
  effective_from      timestamptz not null default now(),
  effective_until     timestamptz,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (slug, version)
);

comment on table public.plans is
  'Plan catalog. A price change creates a new version; existing subscribers keep their plan_id.';

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- At most one currently-sellable version per slug.
create unique index if not exists plans_one_active_version_per_slug
  on public.plans (slug)
  where active and effective_until is null;

-- Explicit per-currency prices. There is no FX conversion anywhere in the
-- product: USD and CAD are separate, deliberately chosen numbers.
create table if not exists public.plan_prices (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references public.plans(id) on delete cascade,
  currency          char(3) not null,
  country           country_code not null,
  amount_cents      integer not null check (amount_cents >= 0),
  provider_price_id text,
  tax_behavior      text not null default 'exclusive',
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (plan_id, country, currency)
);

comment on column public.plan_prices.amount_cents is
  'Integer minor units. No float ever touches money.';

drop trigger if exists plan_prices_set_updated_at on public.plan_prices;
create trigger plan_prices_set_updated_at
  before update on public.plan_prices
  for each row execute function public.set_updated_at();

create unique index if not exists plan_prices_provider_price_unique
  on public.plan_prices (provider_price_id)
  where provider_price_id is not null;

-- The plan matrix: which features a plan includes, and at what limit.
create table if not exists public.plan_features (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  feature_id  uuid not null references public.features(id) on delete cascade,
  enabled     boolean not null default true,
  -- NULL limit_value on a QUOTA/LIMIT feature means unlimited.
  limit_value integer,
  limit_unit  text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (plan_id, feature_id),
  constraint plan_features_limit_non_negative check (limit_value is null or limit_value >= 0)
);

comment on table public.plan_features is
  'Changing a number here changes enforcement. No deploy required.';

drop trigger if exists plan_features_set_updated_at on public.plan_features;
create trigger plan_features_set_updated_at
  before update on public.plan_features
  for each row execute function public.set_updated_at();

create index if not exists plan_features_plan_idx on public.plan_features (plan_id);
create index if not exists plan_features_feature_idx on public.plan_features (feature_id);
