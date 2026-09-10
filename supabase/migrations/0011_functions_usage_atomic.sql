-- 0011_functions_usage_atomic.sql
-- Atomic usage metering and entitlement versioning.
--
-- The row lock in consume_usage() is what makes concurrent requests safe: ten
-- simultaneous analyses against a limit of two grant exactly two, not ten.
-- The unique idempotency key is what makes a browser retry free rather than
-- double-charged. See docs/ENTITLEMENTS.md section 5.

-- ---------------------------------------------------------------------------
-- consume_usage
--
-- Returns one row:
--   status         'ALLOWED' | 'LIMIT_REACHED' | 'REPLAYED'
--   remaining      remaining balance after this call (null = unlimited)
--   used           counter value after this call
--   limit_value    limit in force for this window
--   reservation_id the reservation, when one was created or replayed
-- ---------------------------------------------------------------------------

create or replace function public.consume_usage(
  p_user_id          uuid,
  p_feature_key      text,
  p_amount           integer,
  p_idempotency_key  text,
  p_period_start     timestamptz,
  p_period_end       timestamptz,
  p_limit            integer
)
returns table (
  status         text,
  remaining      integer,
  used           integer,
  limit_value    integer,
  reservation_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counter    public.usage_counters%rowtype;
  v_existing   public.usage_reservations%rowtype;
  v_new_used   integer;
  v_reservation uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'consume_usage: amount must be positive, got %', p_amount
      using errcode = '22023';
  end if;

  if p_period_end <= p_period_start then
    raise exception 'consume_usage: period_end must be after period_start'
      using errcode = '22023';
  end if;

  -- 1. Idempotency. A retry returns the original answer and consumes nothing.
  select * into v_existing
  from public.usage_reservations
  where idempotency_key = p_idempotency_key;

  if found then
    select * into v_counter
    from public.usage_counters
    where id = v_existing.counter_id;

    return query
    select 'REPLAYED'::text,
           v_existing.result_remaining,
           coalesce(v_counter.used, 0),
           v_counter.limit_value,
           v_existing.id;
    return;
  end if;

  -- 2. Ensure the counter row exists for this window, then lock it. The insert
  --    is racy by nature, so the on-conflict plus the subsequent locked select
  --    is what serialises concurrent callers.
  insert into public.usage_counters (user_id, feature_key, period_start, period_end, used, limit_value)
  values (p_user_id, p_feature_key, p_period_start, p_period_end, 0, p_limit)
  on conflict (user_id, feature_key, period_start) do nothing;

  select * into v_counter
  from public.usage_counters
  where user_id = p_user_id
    and feature_key = p_feature_key
    and period_start = p_period_start
  for update;

  if not found then
    raise exception 'consume_usage: counter row missing after upsert'
      using errcode = 'P0002';
  end if;

  -- 3. A limit already recorded for this window wins over the caller-supplied
  --    one, so a mid-period plan change cannot retroactively shrink an
  --    allowance a user was legitimately under. A larger new limit is adopted
  --    (upgrades take effect immediately).
  if p_limit is not null and (v_counter.limit_value is null or p_limit > v_counter.limit_value) then
    update public.usage_counters
      set limit_value = p_limit
      where id = v_counter.id;
    v_counter.limit_value := p_limit;
  end if;

  -- 4. Enforce. NULL limit means unlimited.
  v_new_used := v_counter.used + p_amount;

  if v_counter.limit_value is not null and v_new_used > v_counter.limit_value then
    return query
    select 'LIMIT_REACHED'::text,
           greatest(v_counter.limit_value - v_counter.used, 0),
           v_counter.used,
           v_counter.limit_value,
           null::uuid;
    return;
  end if;

  -- 5. Reserve.
  update public.usage_counters
    set used = v_new_used
    where id = v_counter.id;

  insert into public.usage_reservations
    (counter_id, user_id, feature_key, amount, idempotency_key, status, result_remaining)
  values
    (v_counter.id, p_user_id, p_feature_key, p_amount, p_idempotency_key, 'RESERVED',
     case when v_counter.limit_value is null then null
          else v_counter.limit_value - v_new_used end)
  returning id into v_reservation;

  return query
  select 'ALLOWED'::text,
         case when v_counter.limit_value is null then null
              else v_counter.limit_value - v_new_used end,
         v_new_used,
         v_counter.limit_value,
         v_reservation;
end;
$$;

comment on function public.consume_usage is
  'Reserve quota atomically. SELECT ... FOR UPDATE serialises concurrent callers; '
  'the unique idempotency key makes retries free.';

-- ---------------------------------------------------------------------------
-- commit_usage: the operation completed. Usage stands.
-- ---------------------------------------------------------------------------

create or replace function public.commit_usage(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.usage_reservations
    set status = 'COMMITTED', settled_at = now()
    where id = p_reservation_id and status = 'RESERVED';

  get diagnostics v_updated = row_count;
  -- Idempotent: committing an already-committed reservation is a no-op success.
  return v_updated > 0
      or exists (select 1 from public.usage_reservations
                 where id = p_reservation_id and status = 'COMMITTED');
end;
$$;

-- ---------------------------------------------------------------------------
-- rollback_usage: the operation failed for a reason that is not the customer's
-- fault. Return the credit. Idempotent, and never drives a counter negative.
-- ---------------------------------------------------------------------------

create or replace function public.rollback_usage(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.usage_reservations%rowtype;
begin
  select * into v_res
  from public.usage_reservations
  where id = p_reservation_id
  for update;

  if not found then
    return false;
  end if;

  if v_res.status <> 'RESERVED' then
    -- Already settled. Do not double-refund.
    return v_res.status = 'ROLLED_BACK';
  end if;

  update public.usage_counters
    set used = greatest(used - v_res.amount, 0)
    where id = v_res.counter_id;

  update public.usage_reservations
    set status = 'ROLLED_BACK', settled_at = now()
    where id = p_reservation_id;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- bump_entitlement_version: monotonic per-user counter driving client cache
-- invalidation. See docs/ENTITLEMENTS.md section 7.
-- ---------------------------------------------------------------------------

create or replace function public.bump_entitlement_version(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer;
begin
  insert into public.entitlement_versions (user_id, version, updated_at)
  values (p_user_id, 1, now())
  on conflict (user_id) do update
    set version = public.entitlement_versions.version + 1,
        updated_at = now()
  returning version into v_version;

  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- count_active_cases: the single definition of "active case", used by the
-- MAX_ACTIVE_CASES limit check so the UI and the enforcement cannot disagree.
-- ---------------------------------------------------------------------------

create or replace function public.count_active_cases(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.cases
  where user_id = p_user_id
    and deleted_at is null
    and archived_at is null
    and status not in ('CLOSED', 'ARCHIVED', 'RESOLVED');
$$;

-- ---------------------------------------------------------------------------
-- Grants. These functions run as security definer and are the only supported
-- way to mutate usage, so anon must not reach them.
-- ---------------------------------------------------------------------------

revoke all on function public.consume_usage(uuid, text, integer, text, timestamptz, timestamptz, integer) from public, anon;
revoke all on function public.commit_usage(uuid) from public, anon;
revoke all on function public.rollback_usage(uuid) from public, anon;
revoke all on function public.bump_entitlement_version(uuid) from public, anon;

grant execute on function public.consume_usage(uuid, text, integer, text, timestamptz, timestamptz, integer) to service_role;
grant execute on function public.commit_usage(uuid) to service_role;
grant execute on function public.rollback_usage(uuid) to service_role;
grant execute on function public.bump_entitlement_version(uuid) to service_role;
grant execute on function public.count_active_cases(uuid) to service_role, authenticated;
