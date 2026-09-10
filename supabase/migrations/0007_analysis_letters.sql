-- 0007_analysis_letters.sql
-- Analyses, findings with evidence, letter templates and generated drafts,
-- case timeline, reminders and deadlines.
--
-- Findings come from the deterministic rule engine. is_ai_generated is false
-- for every finding; the AI layer may only phrase an existing finding.
-- See docs/AI_SAFETY.md.

create table if not exists public.analyses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  case_id        uuid not null references public.cases(id) on delete cascade,
  document_id    uuid references public.documents(id) on delete set null,
  compare_document_id uuid references public.documents(id) on delete set null,
  analysis_type  text not null,          -- BILL_CONSISTENCY | BILL_VS_EOB | ...
  engine_version text not null,
  status         processing_status not null default 'PENDING',
  cost_level     cost_level not null default 'LOW',
  model_used     text,
  -- Links the run to the quota reservation so a failure can roll it back.
  reservation_id uuid references public.usage_reservations(id) on delete set null,
  error_class    text,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists analyses_case_idx on public.analyses (case_id, created_at desc);
create index if not exists analyses_user_idx on public.analyses (user_id, created_at desc);
create index if not exists analyses_pending_idx
  on public.analyses (created_at) where status = 'PENDING';

create table if not exists public.analysis_findings (
  id                 uuid primary key default gen_random_uuid(),
  analysis_id        uuid not null references public.analyses(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  code               text not null,          -- e.g. SUBTOTAL_MISMATCH
  severity           finding_severity not null default 'REVIEW',
  title              text not null,
  explanation        text not null,
  recommended_action text,
  confidence         confidence_level not null default 'MEDIUM',
  -- Always false. The rule engine produces findings; the model only rephrases.
  is_ai_generated    boolean not null default false,
  ai_phrasing_used   boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint findings_never_ai_authored check (is_ai_generated = false)
);

comment on constraint findings_never_ai_authored on public.analysis_findings is
  'Structural guarantee: a model can never author a finding. See docs/AI_SAFETY.md.';

create index if not exists analysis_findings_analysis_idx
  on public.analysis_findings (analysis_id, severity);

-- Traceability. Every claim carries the numbers it was derived from.
create table if not exists public.finding_evidence (
  id            uuid primary key default gen_random_uuid(),
  finding_id    uuid not null references public.analysis_findings(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  document_id   uuid references public.documents(id) on delete set null,
  page_number   integer,
  field_path    text,
  -- The actual values compared, so the UI can show its work.
  observed      jsonb not null default '{}'::jsonb,
  expected      jsonb,
  source_id     uuid,                       -- FK added in 0008 once sources exists
  source_version_id uuid,
  jurisdiction_id   uuid,
  created_at    timestamptz not null default now()
);

create index if not exists finding_evidence_finding_idx
  on public.finding_evidence (finding_id);

-- ---------------------------------------------------------------------------
-- letter templates and generated drafts
-- ---------------------------------------------------------------------------

create table if not exists public.templates (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,
  name            text not null,
  description     text not null,
  category        text not null,
  -- Typed field definitions. The renderer assembles from verified fields; the
  -- model may improve wording but cannot introduce a factual claim.
  fields          jsonb not null default '[]'::jsonb,
  body_template   text not null,
  country_scope   country_code[] not null default array['US','CA']::country_code[],
  jurisdiction_id uuid,
  is_premium      boolean not null default false,
  review_status   review_status not null default 'DRAFT',
  reviewed_by     text,
  reviewed_at     timestamptz,
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists templates_set_updated_at on public.templates;
create trigger templates_set_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();

create table if not exists public.generated_documents (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  case_id           uuid not null references public.cases(id) on delete cascade,
  template_id       uuid references public.templates(id) on delete set null,
  template_key      text not null,
  title             text not null,
  -- Rendered plain text. Never rendered as HTML anywhere in the product.
  content           text not null,
  field_values      jsonb not null default '{}'::jsonb,
  status            generated_document_status not null default 'DRAFT',
  -- The product never sends anything. The user reviews, confirms and sends.
  user_confirmed_at timestamptz,
  user_confirmed_accuracy boolean not null default false,
  exported_formats  text[] not null default array[]::text[],
  ai_phrasing_used  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint generated_documents_confirm_requires_review check (
    user_confirmed_at is null or user_confirmed_accuracy = true
  )
);

comment on table public.generated_documents is
  'Drafts only. Wintora never transmits these. The user reviews and sends.';

drop trigger if exists generated_documents_set_updated_at on public.generated_documents;
create trigger generated_documents_set_updated_at
  before update on public.generated_documents
  for each row execute function public.set_updated_at();

create index if not exists generated_documents_case_idx
  on public.generated_documents (case_id, created_at desc);

-- ---------------------------------------------------------------------------
-- timeline, reminders, deadlines
-- ---------------------------------------------------------------------------

create table if not exists public.case_events (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  event_type   text not null,
  title        text not null,
  detail       text,
  -- SYSTEM events are things the product observed. USER events are what the
  -- person told us happened. Nothing else is ever placed on the timeline.
  origin       text not null default 'SYSTEM' check (origin in ('SYSTEM', 'USER')),
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists case_events_case_idx
  on public.case_events (case_id, occurred_at desc);

create table if not exists public.reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  case_id      uuid references public.cases(id) on delete cascade,
  title        text not null,
  detail       text,
  remind_at    timestamptz not null,
  completed_at timestamptz,
  notified_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists reminders_set_updated_at on public.reminders;
create trigger reminders_set_updated_at
  before update on public.reminders
  for each row execute function public.set_updated_at();

create index if not exists reminders_due_idx
  on public.reminders (remind_at) where completed_at is null;

create table if not exists public.deadlines (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  case_id       uuid not null references public.cases(id) on delete cascade,
  label         text not null,
  due_date      date not null,
  -- A deadline is presented as authoritative ONLY when is_verified is true AND
  -- a source is cited. Everything else is shown as the user's own note.
  is_verified   boolean not null default false,
  user_entered  boolean not null default true,
  source_id     uuid,
  jurisdiction_id uuid,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint deadlines_verified_requires_source check (
    is_verified = false or source_id is not null
  )
);

comment on constraint deadlines_verified_requires_source on public.deadlines is
  'The database refuses to store a verified deadline with no cited source.';

drop trigger if exists deadlines_set_updated_at on public.deadlines;
create trigger deadlines_set_updated_at
  before update on public.deadlines
  for each row execute function public.set_updated_at();

create index if not exists deadlines_case_idx on public.deadlines (case_id, due_date);
