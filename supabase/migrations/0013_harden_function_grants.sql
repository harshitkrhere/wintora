-- 0013_harden_function_grants.sql
--
-- SECURITY FIX. Found by `supabase db advisors --type security` against the
-- live project, and confirmed exploitable.
--
-- 0011 revoked EXECUTE on the usage functions from `public` and `anon`, but NOT
-- from `authenticated`. Supabase grants EXECUTE on public-schema functions to
-- `authenticated` by default and exposes them over PostgREST, so every
-- signed-in user could call them directly at /rest/v1/rpc/<name>.
--
-- The consequence was a complete quota bypass, which is exactly what
-- docs/THREAT_MODEL.md T6 claims is prevented:
--
--   * consume_usage takes p_limit from the CALLER, and the function adopts a
--     larger limit than the one recorded. A signed-in free user could post
--     p_limit = 999999 and grant themselves effectively unlimited analyses.
--   * rollback_usage would let a user refund their own committed usage,
--     resetting their counter at will.
--   * bump_entitlement_version let a user churn their own entitlement version.
--
-- The application only ever calls these through the service_role client, so
-- revoking from anon and authenticated changes no legitimate behaviour.
--
-- The TypeScript tests could not have caught this: they exercise the meter
-- logic, not the Postgres grants. supabase/tests/rls_isolation.sql now asserts
-- the grants directly so it cannot regress silently.

-- ---------------------------------------------------------------------------
-- 1. Usage and entitlement functions: service_role only
-- ---------------------------------------------------------------------------

revoke all on function public.consume_usage(uuid, text, integer, text, timestamptz, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.commit_usage(uuid) from public, anon, authenticated;
revoke all on function public.rollback_usage(uuid) from public, anon, authenticated;
revoke all on function public.bump_entitlement_version(uuid) from public, anon, authenticated;

grant execute on function public.consume_usage(uuid, text, integer, text, timestamptz, timestamptz, integer)
  to service_role;
grant execute on function public.commit_usage(uuid) to service_role;
grant execute on function public.rollback_usage(uuid) to service_role;
grant execute on function public.bump_entitlement_version(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. count_active_cases
--
-- It is SECURITY DEFINER and takes a user id, so an authenticated caller could
-- pass someone else's id and learn how many open cases they have. Small, but it
-- is still one user reading a fact about another. Every call site uses the
-- service_role client, so nothing legitimate needs the grant.
-- ---------------------------------------------------------------------------

revoke all on function public.count_active_cases(uuid) from public, anon, authenticated;
grant execute on function public.count_active_cases(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Internal helpers that were never meant to be reachable over the API
--
-- handle_new_user is a trigger function; triggers do not run through an EXECUTE
-- grant, so revoking costs nothing. has_role is a policy helper that no policy
-- currently references; if one later does, grant EXECUTE to authenticated in
-- that migration, since a policy is evaluated as the calling role.
-- ---------------------------------------------------------------------------

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.has_role(staff_role) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Pin the trigger function search_path
--
-- A mutable search_path on a function lets a caller who can create objects
-- shadow an unqualified name. set_updated_at is SECURITY INVOKER and only
-- touches NEW, so the risk is low, but there is no reason to leave it open.
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Drop the unused citext extension
--
-- Declared in 0001 and never used by any column. An extension in the public
-- schema is flagged because its objects share a namespace with application
-- objects. Removing it is better than relocating something nothing needs.
-- ---------------------------------------------------------------------------

drop extension if exists citext;

-- ---------------------------------------------------------------------------
-- 6. Default privileges for functions added later
--
-- Without this, the next SECURITY DEFINER function added to `public` inherits
-- the same default EXECUTE grant and reopens the hole. This makes the safe
-- default the automatic one, rather than something a future migration has to
-- remember.
-- ---------------------------------------------------------------------------

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;
