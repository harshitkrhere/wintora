-- 0025_product_events.sql
-- The funnel, counted from our own tables.
--
-- Five events, each written by the server at the moment it happens:
--   anon_check_completed     the free checker answered, no account
--   signup_completed         an account was created
--   first_document_uploaded  the account's first accepted upload
--   first_letter_sent        the account's first letter marked sent
--   free_limit_hit           the free plan's case or letter limit refused something
--
-- What is NOT here: IP addresses, page views, anything a third party sees.
-- anon_hash is a keyed one-way hash of the network address that already
-- bounds the free checker, so repeat visits can be distinguished from
-- distinct ones without keeping the address. user_id is the only link to a
-- person, and it goes when the account does.

-- 0009 created a placeholder of the same name (event_name, properties,
-- user_ref) that nothing ever wrote to. It is empty and is replaced, not
-- altered, so the shape here is the whole definition.
drop view if exists public.funnel_summary;
drop table if exists public.product_events;

create table public.product_events (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  user_id    uuid references auth.users(id) on delete cascade,
  anon_hash  text,
  case_id    uuid references public.cases(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.product_events is
  'Funnel events, written by the server. No addresses, no payloads, no third party.';

create index if not exists product_events_kind_idx on public.product_events (kind, created_at);

-- INTERNAL shape: RLS on, no policies, so only the service role can touch it.
alter table public.product_events enable row level security;
alter table public.product_events force row level security;

-- Counts per kind per week. The view runs with the caller's rights and is
-- readable by the service role only; a public-schema view would otherwise be
-- readable through the API by anyone holding the anon key.
create or replace view public.funnel_summary
with (security_invoker = true) as
select
  kind,
  date_trunc('week', created_at)::date as week_starting,
  count(*)::integer as events,
  count(distinct coalesce(user_id::text, anon_hash))::integer as distinct_people
from public.product_events
group by kind, date_trunc('week', created_at)
order by week_starting desc, kind;

revoke all on public.funnel_summary from anon, authenticated;
