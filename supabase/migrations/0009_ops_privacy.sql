-- 0009_ops_privacy.sql
-- Audit, security events, support access grants, privacy requests, jobs,
-- feature flags, referrals, corrections, support tickets.
--
-- audit_logs and security_events never contain document content. See
-- docs/SECURITY.md section 10.

create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete set null,
  actor_user_id  uuid references auth.users(id) on delete set null,
  actor_role     staff_role,
  action         text not null,
  resource_type  text,
  resource_id    uuid,
  outcome        text not null default 'SUCCESS',
  request_id     text,
  -- Hashed, never raw, and only kept for the abuse window.
  ip_hash        text,
  user_agent_hash text,
  -- Small, non-sensitive context only. Never a payload, never document text.
  context        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

comment on table public.audit_logs is
  'Who did what to which resource. Never what the resource contained.';

create index if not exists audit_logs_user_idx on public.audit_logs (user_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_resource_idx on public.audit_logs (resource_type, resource_id);

create table if not exists public.security_events (
  id          uuid primary key default gen_random_uuid(),
  event_type  security_event_type not null,
  user_id     uuid references auth.users(id) on delete set null,
  severity    text not null default 'WARN',
  request_id  text,
  ip_hash     text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists security_events_type_idx
  on public.security_events (event_type, created_at desc);

-- Support may read a user document ONLY under a live grant that the user
-- created. There is no ambient admin path. See docs/SECURITY.md section 3.
create table if not exists public.support_access_grants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  case_id      uuid references public.cases(id) on delete cascade,
  granted_to   uuid references auth.users(id) on delete set null,
  reason       text not null,
  granted_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  constraint support_access_grants_expiry_future check (expires_at > granted_at)
);

create index if not exists support_access_grants_live_idx
  on public.support_access_grants (granted_to, expires_at)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- privacy
-- ---------------------------------------------------------------------------

create table if not exists public.privacy_requests (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  request_type        privacy_request_type not null,
  status              privacy_request_status not null default 'RECEIVED',
  jurisdiction        text,
  verification_status text not null default 'PENDING',
  -- Statutory deadline is tracked, not remembered.
  due_date            timestamptz,
  notes               text,
  received_at         timestamptz not null default now(),
  completed_at        timestamptz
);

create index if not exists privacy_requests_open_idx
  on public.privacy_requests (status, due_date)
  where status not in ('COMPLETED', 'REJECTED', 'CANCELED');

create table if not exists public.export_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  privacy_request_id uuid references public.privacy_requests(id) on delete set null,
  status          job_status not null default 'QUEUED',
  idempotency_key text not null unique,
  storage_path    text,
  byte_size       bigint,
  -- Single use, short lived, and the download itself is audited.
  download_expires_at timestamptz,
  downloaded_at   timestamptz,
  error_class     text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create table if not exists public.deletion_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  privacy_request_id uuid references public.privacy_requests(id) on delete set null,
  status          job_status not null default 'QUEUED',
  idempotency_key text not null unique,
  scope           text not null default 'ACCOUNT',   -- ACCOUNT | CASE | DOCUMENT
  target_id       uuid,
  -- Cooling-off window. The user is told it exists and can cancel within it.
  execute_after   timestamptz not null,
  canceled_at     timestamptz,
  error_class     text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists deletion_jobs_due_idx
  on public.deletion_jobs (execute_after)
  where status = 'QUEUED' and canceled_at is null;

-- ---------------------------------------------------------------------------
-- generic queue and operational settings
-- ---------------------------------------------------------------------------

create table if not exists public.jobs (
  id              uuid primary key default gen_random_uuid(),
  job_type        text not null,
  user_id         uuid references auth.users(id) on delete cascade,
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status          job_status not null default 'QUEUED',
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  run_after       timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  error_class     text,
  created_at      timestamptz not null default now()
);

create index if not exists jobs_ready_idx
  on public.jobs (status, run_after) where status = 'QUEUED';

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  description text not null,
  -- Optional rollout scope, e.g. { "plans": ["plus","pro"] }
  scope       jsonb not null default '{}'::jsonb,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

create table if not exists public.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text not null,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- growth and support
-- ---------------------------------------------------------------------------

create table if not exists public.referrals (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  referrer_user_id  uuid not null references auth.users(id) on delete cascade,
  referred_user_id  uuid references auth.users(id) on delete set null,
  -- Reward only on qualified activation, never on signup. See threat model T7.
  qualified_at      timestamptz,
  reward_type       text,
  reward_issued_at  timestamptz,
  reward_reference  uuid,
  flagged_reason    text,
  created_at        timestamptz not null default now(),
  unique (referrer_user_id, referred_user_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_user_id);

create table if not exists public.corrections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete set null,
  content_page_id uuid references public.content_pages(id) on delete cascade,
  source_id       uuid references public.sources(id) on delete set null,
  analysis_id     uuid references public.analyses(id) on delete set null,
  category        text not null,     -- WRONG_INFO | OUTDATED_SOURCE | BAD_EXTRACTION | BAD_ANALYSIS
  detail          text not null,
  status          review_status not null default 'DRAFT',
  resolution      text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Category routes the ticket. BILLING never requires document access.
  category    text not null,   -- BILLING | PRODUCT | PRIVACY | SECURITY | OTHER
  subject     text not null,
  body        text not null,
  status      text not null default 'OPEN',
  priority    text not null default 'NORMAL',
  assigned_to uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz
);

drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();

create index if not exists support_tickets_user_idx
  on public.support_tickets (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- first-party product analytics
-- Event names only, opaque user reference, allowlisted properties.
-- Never document content. See docs/PRIVACY.md section 7.
-- ---------------------------------------------------------------------------

create table if not exists public.product_events (
  id           uuid primary key default gen_random_uuid(),
  user_ref     text,
  event_name   text not null,
  properties   jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now()
);

create index if not exists product_events_name_idx
  on public.product_events (event_name, occurred_at desc);
