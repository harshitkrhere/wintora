-- 0008_knowledge.sql
-- Jurisdictions, authorities, sources, rules and public content.
--
-- Every published claim is scoped to a jurisdiction, cites a source, carries
-- effective dates and a verification date, and can be paused per jurisdiction
-- without shutting down the business. See docs/SEO.md and docs/AI_SAFETY.md.

create table if not exists public.countries (
  code       country_code primary key,
  name       text not null,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.jurisdictions (
  id                 uuid primary key default gen_random_uuid(),
  country            country_code not null references public.countries(code),
  region_code        text not null,           -- 'CA' state, 'ON' province
  name               text not null,
  slug               text not null unique,
  -- Three independent kill switches. A rule change can pause publishing for one
  -- province without stopping processing or the rest of the product.
  enabled            boolean not null default false,
  processing_enabled boolean not null default false,
  publishing_enabled boolean not null default false,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (country, region_code)
);

comment on column public.jurisdictions.enabled is
  'Defaults to false. A jurisdiction is opened only after content review.';

drop trigger if exists jurisdictions_set_updated_at on public.jurisdictions;
create trigger jurisdictions_set_updated_at
  before update on public.jurisdictions
  for each row execute function public.set_updated_at();

create table if not exists public.authorities (
  id              uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid references public.jurisdictions(id) on delete cascade,
  name            text not null,
  kind            text not null,          -- REGULATOR | OMBUDS | AGENCY | COURT
  website_url     text,
  -- Contact details are only ever shown when they came from an official source.
  contact_source_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists authorities_set_updated_at on public.authorities;
create trigger authorities_set_updated_at
  before update on public.authorities
  for each row execute function public.set_updated_at();

-- Source tiers, per docs/AI_SAFETY.md:
-- 1 federal, 2 state/provincial, 3 regulator, 4 court/tribunal,
-- 5 official insurer/provider, 6 recognised nonprofit, 7 reputable secondary.
create table if not exists public.sources (
  id              uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid references public.jurisdictions(id) on delete set null,
  tier            smallint not null check (tier between 1 and 7),
  title           text not null,
  publisher       text not null,
  url             text not null,
  published_at    date,
  accessed_at     timestamptz not null default now(),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (url)
);

drop trigger if exists sources_set_updated_at on public.sources;
create trigger sources_set_updated_at
  before update on public.sources
  for each row execute function public.set_updated_at();

-- Fetched snapshots. A changed content_hash marks dependent content STALE.
create table if not exists public.source_versions (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid not null references public.sources(id) on delete cascade,
  content_hash text not null,
  http_status  integer,
  fetched_at   timestamptz not null default now(),
  changed      boolean not null default false,
  excerpt      text,
  unique (source_id, content_hash)
);

create index if not exists source_versions_source_idx
  on public.source_versions (source_id, fetched_at desc);

create table if not exists public.rules (
  id              uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id) on delete cascade,
  topic           text not null,
  key             text not null,
  statement       text not null,
  source_id       uuid not null references public.sources(id),
  source_version_id uuid references public.source_versions(id),
  effective_from  date,
  effective_until date,
  review_status   review_status not null default 'DRAFT',
  reviewed_by     text,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (jurisdiction_id, key)
);

comment on table public.rules is
  'An administrative rule with provenance. Never a legal conclusion.';

drop trigger if exists rules_set_updated_at on public.rules;
create trigger rules_set_updated_at
  before update on public.rules
  for each row execute function public.set_updated_at();

create index if not exists rules_jurisdiction_topic_idx
  on public.rules (jurisdiction_id, topic);
create index if not exists rules_review_idx on public.rules (review_status);

-- ---------------------------------------------------------------------------
-- public content
-- ---------------------------------------------------------------------------

create table if not exists public.content_pages (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  topic             text not null,
  jurisdiction_id   uuid references public.jurisdictions(id) on delete set null,
  country           country_code,
  title             text not null,
  -- The one-sentence answer that appears above the fold and is what an answer
  -- engine is most likely to quote. See docs/SEO.md section 3.
  direct_answer     text not null,
  h1                text not null,
  meta_description  text not null,
  blocks            jsonb not null default '[]'::jsonb,
  faq               jsonb not null default '[]'::jsonb,
  source_ids        uuid[] not null default array[]::uuid[],
  related_slugs     text[] not null default array[]::text[],
  tool_key          text,
  review_status     review_status not null default 'DRAFT',
  author            text,
  editor            text,
  reviewed_at       timestamptz,
  last_verified_at  timestamptz,
  noindex           boolean not null default true,
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A page cannot be indexable unless it is published, verified and sourced.
  constraint content_pages_indexable_requires_review check (
    noindex = true
    or (review_status = 'PUBLISHED'
        and last_verified_at is not null
        and array_length(source_ids, 1) >= 1)
  )
);

comment on constraint content_pages_indexable_requires_review on public.content_pages is
  'Thin or unverified pages cannot become indexable. Enforced by the database.';

drop trigger if exists content_pages_set_updated_at on public.content_pages;
create trigger content_pages_set_updated_at
  before update on public.content_pages
  for each row execute function public.set_updated_at();

create index if not exists content_pages_topic_idx
  on public.content_pages (jurisdiction_id, topic);
create index if not exists content_pages_published_idx
  on public.content_pages (review_status, last_verified_at desc);

create table if not exists public.content_page_versions (
  id              uuid primary key default gen_random_uuid(),
  content_page_id uuid not null references public.content_pages(id) on delete cascade,
  version         integer not null,
  snapshot        jsonb not null,
  published_by    text,
  published_at    timestamptz not null default now(),
  unique (content_page_id, version)
);

comment on table public.content_page_versions is
  'Every publish is versioned so any page can be rolled back.';

-- Deferred foreign keys from 0007, now that sources and jurisdictions exist.
do $$ begin
  alter table public.finding_evidence
    add constraint finding_evidence_source_fk
    foreign key (source_id) references public.sources(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.finding_evidence
    add constraint finding_evidence_source_version_fk
    foreign key (source_version_id) references public.source_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.finding_evidence
    add constraint finding_evidence_jurisdiction_fk
    foreign key (jurisdiction_id) references public.jurisdictions(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.deadlines
    add constraint deadlines_source_fk
    foreign key (source_id) references public.sources(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.templates
    add constraint templates_jurisdiction_fk
    foreign key (jurisdiction_id) references public.jurisdictions(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.authorities
    add constraint authorities_contact_source_fk
    foreign key (contact_source_id) references public.sources(id) on delete set null;
exception when duplicate_object then null; end $$;
