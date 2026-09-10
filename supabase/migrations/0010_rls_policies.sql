-- 0010_rls_policies.sql
-- Row Level Security for every table.
--
-- Three shapes:
--   A. OWNED       user reads and writes their own rows
--   B. READ_ONLY   user reads their own rows; only service_role writes
--   C. CATALOG     any visitor reads published configuration/content
--   D. INTERNAL    RLS enabled with NO policies, so only service_role can touch it
--
-- Notes that matter:
--   * `force row level security` subjects the table owner to policies too.
--   * `(select auth.uid())` is used rather than a bare auth.uid() so the planner
--     treats it as a stable initplan instead of re-evaluating per row.
--   * Child tables verify ownership through the parent as well as via their own
--     user_id column, so a forged parent id cannot attach a row to another user.
--
-- See docs/DATABASE.md section 7 and docs/SECURITY.md section 2.

-- ===========================================================================
-- A. OWNED
-- ===========================================================================

-- profiles -------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Insert is handled by the on_auth_user_created trigger (security definer).
-- Delete goes through the deletion job, never directly.

-- cases ----------------------------------------------------------------------
alter table public.cases enable row level security;
alter table public.cases force row level security;

drop policy if exists cases_select_own on public.cases;
create policy cases_select_own on public.cases
  for select using (user_id = (select auth.uid()));

drop policy if exists cases_insert_own on public.cases;
create policy cases_insert_own on public.cases
  for insert with check (user_id = (select auth.uid()));

drop policy if exists cases_update_own on public.cases;
create policy cases_update_own on public.cases
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists cases_delete_own on public.cases;
create policy cases_delete_own on public.cases
  for delete using (user_id = (select auth.uid()));

-- case_members ---------------------------------------------------------------
alter table public.case_members enable row level security;
alter table public.case_members force row level security;

drop policy if exists case_members_select_own on public.case_members;
create policy case_members_select_own on public.case_members
  for select using (user_id = (select auth.uid()));

drop policy if exists case_members_insert_own on public.case_members;
create policy case_members_insert_own on public.case_members
  for insert with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.cases c
                where c.id = case_id and c.user_id = (select auth.uid()))
  );

drop policy if exists case_members_update_own on public.case_members;
create policy case_members_update_own on public.case_members
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists case_members_delete_own on public.case_members;
create policy case_members_delete_own on public.case_members
  for delete using (user_id = (select auth.uid()));

-- documents ------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.documents force row level security;

drop policy if exists documents_select_own on public.documents;
create policy documents_select_own on public.documents
  for select using (user_id = (select auth.uid()) and deleted_at is null);

drop policy if exists documents_insert_own on public.documents;
create policy documents_insert_own on public.documents
  for insert with check (
    user_id = (select auth.uid())
    and (case_id is null or exists (
      select 1 from public.cases c
      where c.id = case_id and c.user_id = (select auth.uid())
    ))
  );

drop policy if exists documents_update_own on public.documents;
create policy documents_update_own on public.documents
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists documents_delete_own on public.documents;
create policy documents_delete_own on public.documents
  for delete using (user_id = (select auth.uid()));

-- document_versions ----------------------------------------------------------
alter table public.document_versions enable row level security;
alter table public.document_versions force row level security;

drop policy if exists document_versions_select_own on public.document_versions;
create policy document_versions_select_own on public.document_versions
  for select using (user_id = (select auth.uid()));

drop policy if exists document_versions_insert_own on public.document_versions;
create policy document_versions_insert_own on public.document_versions
  for insert with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.documents d
                where d.id = document_id and d.user_id = (select auth.uid()))
  );

-- document_extractions -------------------------------------------------------
alter table public.document_extractions enable row level security;
alter table public.document_extractions force row level security;

drop policy if exists document_extractions_select_own on public.document_extractions;
create policy document_extractions_select_own on public.document_extractions
  for select using (user_id = (select auth.uid()));

-- Written by the extraction worker via service_role only.

-- analyses -------------------------------------------------------------------
alter table public.analyses enable row level security;
alter table public.analyses force row level security;

drop policy if exists analyses_select_own on public.analyses;
create policy analyses_select_own on public.analyses
  for select using (user_id = (select auth.uid()));

drop policy if exists analyses_insert_own on public.analyses;
create policy analyses_insert_own on public.analyses
  for insert with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.cases c
                where c.id = case_id and c.user_id = (select auth.uid()))
  );

-- analysis_findings ----------------------------------------------------------
alter table public.analysis_findings enable row level security;
alter table public.analysis_findings force row level security;

drop policy if exists analysis_findings_select_own on public.analysis_findings;
create policy analysis_findings_select_own on public.analysis_findings
  for select using (user_id = (select auth.uid()));

-- Findings are written by the rule engine via service_role. A user cannot
-- create, edit or delete a finding, which keeps the evidence trail honest.

-- finding_evidence -----------------------------------------------------------
alter table public.finding_evidence enable row level security;
alter table public.finding_evidence force row level security;

drop policy if exists finding_evidence_select_own on public.finding_evidence;
create policy finding_evidence_select_own on public.finding_evidence
  for select using (user_id = (select auth.uid()));

-- generated_documents --------------------------------------------------------
alter table public.generated_documents enable row level security;
alter table public.generated_documents force row level security;

drop policy if exists generated_documents_select_own on public.generated_documents;
create policy generated_documents_select_own on public.generated_documents
  for select using (user_id = (select auth.uid()) and deleted_at is null);

drop policy if exists generated_documents_insert_own on public.generated_documents;
create policy generated_documents_insert_own on public.generated_documents
  for insert with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.cases c
                where c.id = case_id and c.user_id = (select auth.uid()))
  );

drop policy if exists generated_documents_update_own on public.generated_documents;
create policy generated_documents_update_own on public.generated_documents
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists generated_documents_delete_own on public.generated_documents;
create policy generated_documents_delete_own on public.generated_documents
  for delete using (user_id = (select auth.uid()));

-- case_events ----------------------------------------------------------------
alter table public.case_events enable row level security;
alter table public.case_events force row level security;

drop policy if exists case_events_select_own on public.case_events;
create policy case_events_select_own on public.case_events
  for select using (user_id = (select auth.uid()));

drop policy if exists case_events_insert_own on public.case_events;
create policy case_events_insert_own on public.case_events
  for insert with check (
    user_id = (select auth.uid())
    and origin = 'USER'
    and exists (select 1 from public.cases c
                where c.id = case_id and c.user_id = (select auth.uid()))
  );

-- A user may add their own timeline entries but cannot forge a SYSTEM event.

-- reminders ------------------------------------------------------------------
alter table public.reminders enable row level security;
alter table public.reminders force row level security;

drop policy if exists reminders_select_own on public.reminders;
create policy reminders_select_own on public.reminders
  for select using (user_id = (select auth.uid()));

drop policy if exists reminders_insert_own on public.reminders;
create policy reminders_insert_own on public.reminders
  for insert with check (user_id = (select auth.uid()));

drop policy if exists reminders_update_own on public.reminders;
create policy reminders_update_own on public.reminders
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists reminders_delete_own on public.reminders;
create policy reminders_delete_own on public.reminders
  for delete using (user_id = (select auth.uid()));

-- deadlines ------------------------------------------------------------------
alter table public.deadlines enable row level security;
alter table public.deadlines force row level security;

drop policy if exists deadlines_select_own on public.deadlines;
create policy deadlines_select_own on public.deadlines
  for select using (user_id = (select auth.uid()));

drop policy if exists deadlines_insert_own on public.deadlines;
create policy deadlines_insert_own on public.deadlines
  for insert with check (
    user_id = (select auth.uid())
    -- A user may record their own deadline, never mark one verified.
    and is_verified = false
    and user_entered = true
    and exists (select 1 from public.cases c
                where c.id = case_id and c.user_id = (select auth.uid()))
  );

drop policy if exists deadlines_update_own on public.deadlines;
create policy deadlines_update_own on public.deadlines
  for update using (user_id = (select auth.uid()) and user_entered = true)
  with check (user_id = (select auth.uid()) and is_verified = false);

drop policy if exists deadlines_delete_own on public.deadlines;
create policy deadlines_delete_own on public.deadlines
  for delete using (user_id = (select auth.uid()) and user_entered = true);

-- support_access_grants ------------------------------------------------------
alter table public.support_access_grants enable row level security;
alter table public.support_access_grants force row level security;

drop policy if exists support_access_grants_select_own on public.support_access_grants;
create policy support_access_grants_select_own on public.support_access_grants
  for select using (user_id = (select auth.uid()));

drop policy if exists support_access_grants_insert_own on public.support_access_grants;
create policy support_access_grants_insert_own on public.support_access_grants
  for insert with check (user_id = (select auth.uid()));

drop policy if exists support_access_grants_revoke_own on public.support_access_grants;
create policy support_access_grants_revoke_own on public.support_access_grants
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- privacy_requests -----------------------------------------------------------
alter table public.privacy_requests enable row level security;
alter table public.privacy_requests force row level security;

drop policy if exists privacy_requests_select_own on public.privacy_requests;
create policy privacy_requests_select_own on public.privacy_requests
  for select using (user_id = (select auth.uid()));

drop policy if exists privacy_requests_insert_own on public.privacy_requests;
create policy privacy_requests_insert_own on public.privacy_requests
  for insert with check (user_id = (select auth.uid()));

-- support_tickets ------------------------------------------------------------
alter table public.support_tickets enable row level security;
alter table public.support_tickets force row level security;

drop policy if exists support_tickets_select_own on public.support_tickets;
create policy support_tickets_select_own on public.support_tickets
  for select using (user_id = (select auth.uid()));

drop policy if exists support_tickets_insert_own on public.support_tickets;
create policy support_tickets_insert_own on public.support_tickets
  for insert with check (user_id = (select auth.uid()));

-- corrections ----------------------------------------------------------------
alter table public.corrections enable row level security;
alter table public.corrections force row level security;

drop policy if exists corrections_insert_any on public.corrections;
create policy corrections_insert_any on public.corrections
  for insert with check (user_id is null or user_id = (select auth.uid()));

drop policy if exists corrections_select_own on public.corrections;
create policy corrections_select_own on public.corrections
  for select using (user_id = (select auth.uid()));

-- referrals ------------------------------------------------------------------
alter table public.referrals enable row level security;
alter table public.referrals force row level security;

drop policy if exists referrals_select_own on public.referrals;
create policy referrals_select_own on public.referrals
  for select using (referrer_user_id = (select auth.uid()));

-- Qualification and reward issuance are service_role only, so a user cannot
-- mark their own referral qualified.

-- ===========================================================================
-- B. READ_ONLY  (user reads own rows, only service_role writes)
-- ===========================================================================

alter table public.billing_customers enable row level security;
alter table public.billing_customers force row level security;
drop policy if exists billing_customers_select_own on public.billing_customers;
create policy billing_customers_select_own on public.billing_customers
  for select using (user_id = (select auth.uid()));

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select using (user_id = (select auth.uid()));

alter table public.subscription_items enable row level security;
alter table public.subscription_items force row level security;
drop policy if exists subscription_items_select_own on public.subscription_items;
create policy subscription_items_select_own on public.subscription_items
  for select using (exists (
    select 1 from public.subscriptions s
    where s.id = subscription_id and s.user_id = (select auth.uid())
  ));

alter table public.billing_periods enable row level security;
alter table public.billing_periods force row level security;
drop policy if exists billing_periods_select_own on public.billing_periods;
create policy billing_periods_select_own on public.billing_periods
  for select using (user_id = (select auth.uid()));

alter table public.invoices enable row level security;
alter table public.invoices force row level security;
drop policy if exists invoices_select_own on public.invoices;
create policy invoices_select_own on public.invoices
  for select using (user_id = (select auth.uid()));

alter table public.payments enable row level security;
alter table public.payments force row level security;
drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
  for select using (user_id = (select auth.uid()));

alter table public.refunds enable row level security;
alter table public.refunds force row level security;
drop policy if exists refunds_select_own on public.refunds;
create policy refunds_select_own on public.refunds
  for select using (user_id = (select auth.uid()));

alter table public.user_entitlements enable row level security;
alter table public.user_entitlements force row level security;
drop policy if exists user_entitlements_select_own on public.user_entitlements;
create policy user_entitlements_select_own on public.user_entitlements
  for select using (user_id = (select auth.uid()));

-- A user may read their entitlements. Only the recompute path writes them, so
-- a client cannot grant itself a feature even with a valid session.

alter table public.entitlement_versions enable row level security;
alter table public.entitlement_versions force row level security;
drop policy if exists entitlement_versions_select_own on public.entitlement_versions;
create policy entitlement_versions_select_own on public.entitlement_versions
  for select using (user_id = (select auth.uid()));

alter table public.usage_counters enable row level security;
alter table public.usage_counters force row level security;
drop policy if exists usage_counters_select_own on public.usage_counters;
create policy usage_counters_select_own on public.usage_counters
  for select using (user_id = (select auth.uid()));

alter table public.usage_reservations enable row level security;
alter table public.usage_reservations force row level security;
drop policy if exists usage_reservations_select_own on public.usage_reservations;
create policy usage_reservations_select_own on public.usage_reservations
  for select using (user_id = (select auth.uid()));

alter table public.export_jobs enable row level security;
alter table public.export_jobs force row level security;
drop policy if exists export_jobs_select_own on public.export_jobs;
create policy export_jobs_select_own on public.export_jobs
  for select using (user_id = (select auth.uid()));

alter table public.deletion_jobs enable row level security;
alter table public.deletion_jobs force row level security;
drop policy if exists deletion_jobs_select_own on public.deletion_jobs;
create policy deletion_jobs_select_own on public.deletion_jobs
  for select using (user_id = (select auth.uid()));

-- ===========================================================================
-- C. CATALOG  (public read of published configuration and content)
-- ===========================================================================

alter table public.features enable row level security;
alter table public.features force row level security;
drop policy if exists features_read_all on public.features;
create policy features_read_all on public.features
  for select using (active = true);

alter table public.plans enable row level security;
alter table public.plans force row level security;
drop policy if exists plans_read_all on public.plans;
create policy plans_read_all on public.plans
  for select using (active = true);

alter table public.plan_prices enable row level security;
alter table public.plan_prices force row level security;
drop policy if exists plan_prices_read_all on public.plan_prices;
create policy plan_prices_read_all on public.plan_prices
  for select using (active = true);

alter table public.plan_features enable row level security;
alter table public.plan_features force row level security;
drop policy if exists plan_features_read_all on public.plan_features;
create policy plan_features_read_all on public.plan_features
  for select using (true);

-- The pricing page reads exactly these four tables, which is why an advertised
-- feature cannot drift from what the backend enforces.

alter table public.countries enable row level security;
alter table public.countries force row level security;
drop policy if exists countries_read_all on public.countries;
create policy countries_read_all on public.countries
  for select using (enabled = true);

alter table public.jurisdictions enable row level security;
alter table public.jurisdictions force row level security;
drop policy if exists jurisdictions_read_enabled on public.jurisdictions;
create policy jurisdictions_read_enabled on public.jurisdictions
  for select using (enabled = true);

alter table public.authorities enable row level security;
alter table public.authorities force row level security;
drop policy if exists authorities_read_all on public.authorities;
create policy authorities_read_all on public.authorities
  for select using (true);

alter table public.sources enable row level security;
alter table public.sources force row level security;
drop policy if exists sources_read_active on public.sources;
create policy sources_read_active on public.sources
  for select using (active = true);

alter table public.source_versions enable row level security;
alter table public.source_versions force row level security;
drop policy if exists source_versions_read_all on public.source_versions;
create policy source_versions_read_all on public.source_versions
  for select using (true);

alter table public.rules enable row level security;
alter table public.rules force row level security;
drop policy if exists rules_read_published on public.rules;
create policy rules_read_published on public.rules
  for select using (review_status = 'PUBLISHED');

-- STALE and DRAFT rules are unreadable, so an outdated claim stops being served
-- the moment its source changes.

alter table public.content_pages enable row level security;
alter table public.content_pages force row level security;
drop policy if exists content_pages_read_published on public.content_pages;
create policy content_pages_read_published on public.content_pages
  for select using (review_status = 'PUBLISHED');

alter table public.templates enable row level security;
alter table public.templates force row level security;
drop policy if exists templates_read_published on public.templates;
create policy templates_read_published on public.templates
  for select using (review_status = 'PUBLISHED');

-- ===========================================================================
-- D. INTERNAL  (RLS on, no policies: service_role only)
-- ===========================================================================
-- Enabling RLS without any policy is a complete deny for every role except
-- service_role. That is the intended configuration for all of these.

alter table public.user_roles enable row level security;
alter table public.user_roles force row level security;

alter table public.webhook_events enable row level security;
alter table public.webhook_events force row level security;

alter table public.billing_reconciliations enable row level security;
alter table public.billing_reconciliations force row level security;

alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

alter table public.security_events enable row level security;
alter table public.security_events force row level security;

alter table public.jobs enable row level security;
alter table public.jobs force row level security;

alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;

alter table public.system_settings enable row level security;
alter table public.system_settings force row level security;

alter table public.content_page_versions enable row level security;
alter table public.content_page_versions force row level security;

alter table public.product_events enable row level security;
alter table public.product_events force row level security;

-- ===========================================================================
-- Storage: private document bucket
-- ===========================================================================
-- Object keys are {user_id}/{case_id}/{document_id}.{ext}, so scoping the policy
-- to the first path segment gives the same isolation as RLS on a table.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-documents',
  'user-documents',
  false,
  26214400,  -- 25 MB hard ceiling; plan limits are enforced above this
  array['application/pdf','image/png','image/jpeg','image/heic','image/tiff']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists user_documents_read_own on storage.objects;
create policy user_documents_read_own on storage.objects
  for select using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists user_documents_insert_own on storage.objects;
create policy user_documents_insert_own on storage.objects
  for insert with check (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists user_documents_update_own on storage.objects;
create policy user_documents_update_own on storage.objects
  for update using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists user_documents_delete_own on storage.objects;
create policy user_documents_delete_own on storage.objects
  for delete using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
