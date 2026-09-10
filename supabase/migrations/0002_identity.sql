-- 0002_identity.sql
-- Profiles and staff roles.
--
-- Deliberately minimal. A profile holds what is needed to serve
-- jurisdiction-correct guidance and nothing clinical. See docs/PRIVACY.md.

create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text,
  country             country_code not null default 'US',
  region_code         text,                       -- 'CA' (California), 'ON' (Ontario)
  locale              text not null default 'en-US',
  timezone            text not null default 'UTC',
  onboarding_complete boolean not null default false,
  -- User-controlled privacy switches. Honoured by the AI pipeline.
  ai_processing_enabled boolean not null default true,
  marketing_email_opt_in boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint profiles_region_matches_country check (
    region_code is null
    or (country = 'US' and region_code ~ '^[A-Z]{2}$')
    or (country = 'CA' and region_code ~ '^[A-Z]{2}$')
  )
);

comment on table public.profiles is
  'One row per auth user. Contains no clinical or diagnostic information.';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Staff roles live in their own table so that a compromised profile write
-- cannot grant a role. Nothing user-facing may write here; service_role only.
create table if not exists public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        staff_role not null,
  granted_by  uuid references auth.users(id),
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,
  reason      text not null,
  unique (user_id, role)
);

comment on table public.user_roles is
  'Staff role assignments. service_role writes only. See docs/SECURITY.md section 3.';

create index if not exists user_roles_user_idx on public.user_roles (user_id);

-- Helper used by RLS policies on staff-readable tables.
create or replace function public.has_role(p_role staff_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role = p_role
      and (ur.expires_at is null or ur.expires_at > now())
  );
$$;

-- Create the profile row when an auth user appears, so no code path can end up
-- with a session that has no profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  insert into public.entitlement_versions (user_id, version)
  values (new.id, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- The trigger itself is created in 0005 once entitlement_versions exists.
