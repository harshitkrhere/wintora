-- rls_isolation.sql
-- Adversarial Row Level Security matrix.
--
-- This is the one thing an in-memory fake cannot prove: that the DATABASE, not
-- just the application, refuses to let one user reach another user's rows.
--
-- Runs under either tool, with no psql meta-commands:
--
--   supabase db query --linked --file supabase/tests/rls_isolation.sql
--   psql "$SUPABASE_DB_URL" -f supabase/tests/rls_isolation.sql
--
-- Everything happens inside a transaction that is rolled back, so it leaves no
-- trace. Every assertion is recorded rather than raising immediately, so one
-- run reports every failure instead of stopping at the first. If any assertion
-- fails, the final block raises with the full list, which produces a non-zero
-- exit and makes this usable as a deployment gate.

begin;

create temporary table _t (k text primary key, v uuid) on commit drop;
create temporary table _results (label text not null, passed boolean not null) on commit drop;

-- The assertions run while impersonating `authenticated`, which has no rights
-- on these scratch tables. Granting them here keeps the harness working without
-- weakening anything: both tables are temporary and vanish with the transaction.
grant select on _t to authenticated;
grant select, insert on _results to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
                     true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.check(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  insert into _results (label, passed) values (p_label, coalesce(p_condition, false));
end $$;

create or replace function pg_temp.key(p_key text) returns uuid
language sql stable as $$ select v from _t where k = p_key $$;

-- ---------------------------------------------------------------------------
-- Fixtures: two users, each with a case, a document and a letter
-- ---------------------------------------------------------------------------

do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_case_a uuid;
  v_case_b uuid;
  v_doc_a uuid;
  v_doc_b uuid;
  v_letter_b uuid;
  v_plan uuid;
begin
  insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, aud, role)
  values
    (v_a, '00000000-0000-0000-0000-000000000000', 'rls-a@example.test', '', now(),
     '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
    (v_b, '00000000-0000-0000-0000-000000000000', 'rls-b@example.test', '', now(),
     '{}'::jsonb, '{}'::jsonb, now(), now(), 'authenticated', 'authenticated');

  select id into v_plan from public.plans where slug = 'free' and version = 1;

  insert into public.cases (user_id, title) values (v_a, 'A case') returning id into v_case_a;
  insert into public.cases (user_id, title) values (v_b, 'B case') returning id into v_case_b;

  insert into public.documents (user_id, case_id, mime_type, byte_size, sha256, storage_path)
  values (v_a, v_case_a, 'application/pdf', 1024, repeat('a', 64), v_a || '/' || v_case_a || '/a.pdf')
  returning id into v_doc_a;

  insert into public.documents (user_id, case_id, mime_type, byte_size, sha256, storage_path)
  values (v_b, v_case_b, 'application/pdf', 1024, repeat('b', 64), v_b || '/' || v_case_b || '/b.pdf')
  returning id into v_doc_b;

  insert into public.generated_documents (user_id, case_id, template_key, title, content)
  values (v_b, v_case_b, 'REQUEST_ITEMIZED_BILL', 'B letter', 'private text')
  returning id into v_letter_b;

  insert into public.subscriptions (user_id, plan_id, status, country, currency)
  values (v_b, v_plan, 'ACTIVE', 'US', 'USD');

  insert into public.invoices (user_id, provider_invoice_id, amount_due_cents, currency, status)
  values (v_b, 'in_test_b', 1999, 'USD', 'paid');

  insert into public.usage_counters (user_id, feature_key, period_start, period_end, used, limit_value)
  values (v_b, 'MONTHLY_ANALYSES', now() - interval '1 day', now() + interval '29 days', 3, 50);

  insert into _t values
    ('a', v_a), ('b', v_b),
    ('case_a', v_case_a), ('case_b', v_case_b),
    ('doc_a', v_doc_a), ('doc_b', v_doc_b),
    ('letter_b', v_letter_b);
end $$;

-- ---------------------------------------------------------------------------
-- SELECT isolation
-- ---------------------------------------------------------------------------

do $$
declare v_n integer;
begin
  perform pg_temp.become(pg_temp.key('a'));

  select count(*) into v_n from public.cases where id = pg_temp.key('case_b');
  perform pg_temp.check(v_n = 0, 'A cannot select B case');

  select count(*) into v_n from public.documents where id = pg_temp.key('doc_b');
  perform pg_temp.check(v_n = 0, 'A cannot select B document');

  select count(*) into v_n from public.generated_documents where id = pg_temp.key('letter_b');
  perform pg_temp.check(v_n = 0, 'A cannot select B generated letter');

  select count(*) into v_n from public.invoices where user_id = pg_temp.key('b');
  perform pg_temp.check(v_n = 0, 'A cannot select B invoices');

  select count(*) into v_n from public.subscriptions where user_id = pg_temp.key('b');
  perform pg_temp.check(v_n = 0, 'A cannot select B subscription');

  select count(*) into v_n from public.usage_counters where user_id = pg_temp.key('b');
  perform pg_temp.check(v_n = 0, 'A cannot select B usage counters');

  select count(*) into v_n from public.user_entitlements where user_id = pg_temp.key('b');
  perform pg_temp.check(v_n = 0, 'A cannot select B entitlements');

  select count(*) into v_n from public.profiles where id = pg_temp.key('b');
  perform pg_temp.check(v_n = 0, 'A cannot select B profile');

  -- And A can still see their own.
  select count(*) into v_n from public.cases where id = pg_temp.key('case_a');
  perform pg_temp.check(v_n = 1, 'A can select own case');

  select count(*) into v_n from public.documents where id = pg_temp.key('doc_a');
  perform pg_temp.check(v_n = 1, 'A can select own document');

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- UPDATE and DELETE isolation
-- ---------------------------------------------------------------------------

do $$
declare v_n integer;
begin
  perform pg_temp.become(pg_temp.key('a'));

  update public.cases set title = 'hijacked' where id = pg_temp.key('case_b');
  get diagnostics v_n = row_count;
  perform pg_temp.check(v_n = 0, 'A cannot update B case');

  update public.documents set document_type = 'OTHER' where id = pg_temp.key('doc_b');
  get diagnostics v_n = row_count;
  perform pg_temp.check(v_n = 0, 'A cannot update B document');

  delete from public.cases where id = pg_temp.key('case_b');
  get diagnostics v_n = row_count;
  perform pg_temp.check(v_n = 0, 'A cannot delete B case');

  delete from public.documents where id = pg_temp.key('doc_b');
  get diagnostics v_n = row_count;
  perform pg_temp.check(v_n = 0, 'A cannot delete B document');

  delete from public.generated_documents where id = pg_temp.key('letter_b');
  get diagnostics v_n = row_count;
  perform pg_temp.check(v_n = 0, 'A cannot delete B letter');

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Forged parent id: A tries to attach a child row to B case
-- ---------------------------------------------------------------------------

do $$
declare v_failed boolean;
begin
  perform pg_temp.become(pg_temp.key('a'));

  v_failed := false;
  begin
    insert into public.documents (user_id, case_id, mime_type, byte_size, sha256)
    values (pg_temp.key('a'), pg_temp.key('case_b'), 'application/pdf', 10, repeat('c', 64));
  exception when others then v_failed := true;
  end;
  perform pg_temp.check(v_failed, 'A cannot attach a document to B case');

  v_failed := false;
  begin
    insert into public.generated_documents (user_id, case_id, template_key, title, content)
    values (pg_temp.key('a'), pg_temp.key('case_b'), 'REQUEST_ITEMIZED_BILL', 'x', 'x');
  exception when others then v_failed := true;
  end;
  perform pg_temp.check(v_failed, 'A cannot attach a letter to B case');

  v_failed := false;
  begin
    insert into public.analyses (user_id, case_id, analysis_type, engine_version)
    values (pg_temp.key('a'), pg_temp.key('case_b'), 'BILL_CONSISTENCY', '1.0.0');
  exception when others then v_failed := true;
  end;
  perform pg_temp.check(v_failed, 'A cannot attach an analysis to B case');

  -- Claiming another user_id outright.
  v_failed := false;
  begin
    insert into public.cases (user_id, title) values (pg_temp.key('b'), 'impersonated');
  exception when others then v_failed := true;
  end;
  perform pg_temp.check(v_failed, 'A cannot insert a case owned by B');

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Privilege escalation
-- ---------------------------------------------------------------------------

do $$
declare
  v_failed boolean;
  v_n integer;
begin
  perform pg_temp.become(pg_temp.key('a'));

  v_failed := false;
  begin
    insert into public.user_roles (user_id, role, reason)
    values (pg_temp.key('a'), 'SUPER_ADMIN', 'escalation attempt');
  exception when others then v_failed := true;
  end;
  perform pg_temp.check(v_failed, 'A cannot grant themselves a staff role');

  v_failed := false;
  begin
    insert into public.user_entitlements (user_id, feature_id, feature_key, enabled, limit_value)
    select pg_temp.key('a'), f.id, f.key, true, 9999
      from public.features f where f.key = 'MONTHLY_ANALYSES';
  exception when others then v_failed := true;
  end;
  perform pg_temp.check(v_failed, 'A cannot write their own entitlements');

  v_failed := false;
  begin
    insert into public.usage_counters (user_id, feature_key, period_start, period_end, used, limit_value)
    values (pg_temp.key('a'), 'MONTHLY_ANALYSES', now(), now() + interval '30 days', 0, 9999);
  exception when others then v_failed := true;
  end;
  perform pg_temp.check(v_failed, 'A cannot write their own usage counters');

  v_failed := false;
  begin
    insert into public.subscriptions (user_id, plan_id, status, country, currency)
    select pg_temp.key('a'), id, 'ACTIVE', 'US', 'USD'
      from public.plans where slug = 'pro' and version = 1;
  exception when others then v_failed := true;
  end;
  perform pg_temp.check(v_failed, 'A cannot fabricate a paid subscription');

  -- A verified deadline renders as authoritative, so a user must not create one.
  v_failed := false;
  begin
    insert into public.deadlines (user_id, case_id, label, due_date, is_verified, user_entered)
    values (pg_temp.key('a'), pg_temp.key('case_a'), 'fake statutory deadline',
            current_date + 30, true, false);
  exception when others then v_failed := true;
  end;
  perform pg_temp.check(v_failed, 'A cannot mark a deadline verified');

  v_failed := false;
  begin
    insert into public.case_events (case_id, user_id, event_type, title, origin)
    values (pg_temp.key('case_a'), pg_temp.key('a'), 'ANALYSIS_COMPLETED', 'forged', 'SYSTEM');
  exception when others then v_failed := true;
  end;
  perform pg_temp.check(v_failed, 'A cannot forge a SYSTEM timeline event');

  -- A user must not be able to author a finding about their own case.
  v_failed := false;
  begin
    insert into public.analysis_findings (analysis_id, user_id, code, title, explanation)
    values (gen_random_uuid(), pg_temp.key('a'), 'FAKE', 'forged', 'forged');
  exception when others then v_failed := true;
  end;
  perform pg_temp.check(v_failed, 'A cannot author a finding');

  -- Internal tables are entirely invisible.
  select count(*) into v_n from public.webhook_events;
  perform pg_temp.check(v_n = 0, 'webhook_events invisible to authenticated');

  select count(*) into v_n from public.security_events;
  perform pg_temp.check(v_n = 0, 'security_events invisible to authenticated');

  select count(*) into v_n from public.audit_logs;
  perform pg_temp.check(v_n = 0, 'audit_logs invisible to authenticated');

  select count(*) into v_n from public.user_roles;
  perform pg_temp.check(v_n = 0, 'user_roles invisible to authenticated');

  select count(*) into v_n from public.billing_reconciliations;
  perform pg_temp.check(v_n = 0, 'billing_reconciliations invisible to authenticated');

  select count(*) into v_n from public.product_events;
  perform pg_temp.check(v_n = 0, 'product_events invisible to authenticated');

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Catalog readability: the pricing page depends on it
-- ---------------------------------------------------------------------------

do $$
declare v_n integer;
begin
  perform pg_temp.become(pg_temp.key('a'));

  select count(*) into v_n from public.plans where active;
  perform pg_temp.check(v_n >= 4, 'plans readable by authenticated');

  select count(*) into v_n from public.plan_features;
  perform pg_temp.check(v_n > 0, 'plan_features readable by authenticated');

  select count(*) into v_n from public.features where active;
  perform pg_temp.check(v_n >= 20, 'features readable by authenticated');

  -- Unreviewed content must never be served.
  select count(*) into v_n from public.content_pages where review_status <> 'PUBLISHED';
  perform pg_temp.check(v_n = 0, 'unpublished content invisible');

  select count(*) into v_n from public.templates where review_status <> 'PUBLISHED';
  perform pg_temp.check(v_n = 0, 'unreviewed templates invisible');

  select count(*) into v_n from public.jurisdictions where not enabled;
  perform pg_temp.check(v_n = 0, 'disabled jurisdictions invisible');

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Function EXECUTE grants
--
-- RLS protects tables. It does NOT protect SECURITY DEFINER functions, which
-- Supabase exposes over PostgREST at /rest/v1/rpc/<name> and grants to
-- `authenticated` by default. That gap was a live quota bypass until 0013:
-- consume_usage takes p_limit from the caller, so a signed-in user could grant
-- themselves any allowance they liked.
--
-- These assertions check the grants directly, because no amount of TypeScript
-- testing can see them.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_callable boolean;
begin
  for r in
    select unnest(array[
      'consume_usage(uuid, text, integer, text, timestamp with time zone, timestamp with time zone, integer)',
      'commit_usage(uuid)',
      'rollback_usage(uuid)',
      'bump_entitlement_version(uuid)',
      'count_active_cases(uuid)',
      'handle_new_user()',
      'has_role(staff_role)'
    ]) as sig
  loop
    v_callable := has_function_privilege('authenticated', 'public.' || r.sig, 'EXECUTE');
    perform pg_temp.check(not v_callable, 'authenticated cannot execute ' || split_part(r.sig, '(', 1));

    v_callable := has_function_privilege('anon', 'public.' || r.sig, 'EXECUTE');
    perform pg_temp.check(not v_callable, 'anon cannot execute ' || split_part(r.sig, '(', 1));
  end loop;

  -- The server still must be able to call them, or metering stops working.
  perform pg_temp.check(
    has_function_privilege('service_role', 'public.consume_usage(uuid, text, integer, text, timestamp with time zone, timestamp with time zone, integer)', 'EXECUTE'),
    'service_role can execute consume_usage');
  perform pg_temp.check(
    has_function_privilege('service_role', 'public.rollback_usage(uuid)', 'EXECUTE'),
    'service_role can execute rollback_usage');
  perform pg_temp.check(
    has_function_privilege('service_role', 'public.count_active_cases(uuid)', 'EXECUTE'),
    'service_role can execute count_active_cases');
end $$;

-- Every SECURITY DEFINER function in `public` must pin its search_path, and
-- none may be callable by anon or authenticated. This catches a function added
-- by a future migration that forgets both.
do $$
declare
  v_unpinned text;
  v_exposed text;
begin
  select coalesce(string_agg(p.proname, ', '), '')
    into v_unpinned
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and (p.proconfig is null or not exists (
       select 1 from unnest(p.proconfig) c where c like 'search\_path=%'
     ));
  perform pg_temp.check(v_unpinned = '',
    'every SECURITY DEFINER function pins search_path (offenders: ' || v_unpinned || ')');

  select coalesce(string_agg(p.proname, ', '), '')
    into v_exposed
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  perform pg_temp.check(v_exposed = '',
    'no SECURITY DEFINER function is client-callable (offenders: ' || v_exposed || ')');
end $$;

-- ---------------------------------------------------------------------------
-- Report, then fail loudly if anything did not hold
-- ---------------------------------------------------------------------------

select
  count(*) filter (where passed)       as passed,
  count(*) filter (where not passed)   as failed,
  coalesce(string_agg(label, '; ') filter (where not passed), 'none') as failures
from _results;

do $$
declare
  v_failed integer;
  v_labels text;
begin
  select count(*), coalesce(string_agg(label, '; '), '')
    into v_failed, v_labels
    from _results where not passed;

  if v_failed > 0 then
    raise exception 'RLS ISOLATION FAILED (% assertion(s)): %', v_failed, v_labels;
  end if;

  raise notice 'RLS isolation matrix passed: % assertions', (select count(*) from _results);
end $$;

rollback;
