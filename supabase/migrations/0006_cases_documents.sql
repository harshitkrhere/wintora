-- 0006_cases_documents.sql
-- Cases, documents and extractions.
--
-- documents holds METADATA ONLY. File bytes live in a private storage bucket
-- keyed {user_id}/{case_id}/{document_id}. See docs/DATABASE.md section 8.

create table if not exists public.cases (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  provider_name  text,
  bill_type      text,
  amount_cents   bigint,
  currency       char(3),
  country        country_code not null default 'US',
  region_code    text,
  status         case_status not null default 'OPEN',
  service_date   date,
  statement_date date,
  due_date       date,
  account_reference text,
  notes          text,
  archived_at    timestamptz,
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

comment on table public.cases is
  'A case is never deleted because a plan changed. See docs/BILLING.md section 4.';

drop trigger if exists cases_set_updated_at on public.cases;
create trigger cases_set_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

create index if not exists cases_user_status_idx
  on public.cases (user_id, status, created_at desc);
-- MAX_ACTIVE_CASES counts exactly this set.
create index if not exists cases_active_idx
  on public.cases (user_id)
  where deleted_at is null and archived_at is null
    and status not in ('CLOSED', 'ARCHIVED', 'RESOLVED');

-- Household support (Pro). The case is still owned by one account; this records
-- which household member it concerns.
create table if not exists public.case_members (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  member_label text not null,
  relationship text,
  created_at   timestamptz not null default now(),
  unique (case_id, member_label)
);

create index if not exists case_members_user_idx on public.case_members (user_id);

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  case_id           uuid references public.cases(id) on delete cascade,
  storage_path      text,
  original_filename text,
  mime_type         text not null,
  byte_size         bigint not null check (byte_size > 0),
  sha256            text not null,
  document_type     document_type not null default 'OTHER',
  page_count        integer,
  -- Fail closed: extraction refuses to run unless scan_status = 'CLEAN'.
  scan_status       scan_status not null default 'PENDING',
  scan_detail       text,
  extraction_status processing_status not null default 'PENDING',
  -- Set from the plan RETENTION_DAYS at upload; recomputed with a transition
  -- window on downgrade. See docs/PRIVACY.md section 3.
  retention_until   timestamptz,
  retention_notice_sent_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

comment on table public.documents is
  'Metadata only. No file bytes, no extracted clinical text.';

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

create index if not exists documents_user_case_idx on public.documents (user_id, case_id);
create index if not exists documents_retention_idx
  on public.documents (retention_until)
  where deleted_at is null and retention_until is not null;
create index if not exists documents_sha_idx on public.documents (user_id, sha256);

create table if not exists public.document_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  version      integer not null,
  storage_path text,
  sha256       text not null,
  byte_size    bigint not null,
  created_at   timestamptz not null default now(),
  unique (document_id, version)
);

-- Structured extraction output. Line items and totals as PRINTED on the
-- document. Access is audited; retention follows the parent document.
create table if not exists public.document_extractions (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid not null references public.documents(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  engine            text not null,
  engine_version    text not null,
  -- { lineItems: [...], subtotalCents, totalCents, dates, accountRef, ... }
  payload           jsonb not null,
  -- Per-field extraction confidence, drives finding confidence downstream.
  field_confidence  jsonb not null default '{}'::jsonb,
  overall_confidence confidence_level not null default 'MEDIUM',
  created_at        timestamptz not null default now(),
  unique (document_id, engine_version)
);

create index if not exists document_extractions_doc_idx
  on public.document_extractions (document_id);
create index if not exists document_extractions_user_idx
  on public.document_extractions (user_id);
