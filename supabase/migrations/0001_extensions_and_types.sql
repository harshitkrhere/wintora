-- 0001_extensions_and_types.sql
-- Extensions, enum types and shared helper functions.
-- Forward-only. Safe to re-run.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- Enum types. Using real enums means an invalid state cannot be written at all,
-- rather than being caught (or not) by application code.
-- ---------------------------------------------------------------------------

do $$ begin
  create type country_code as enum ('US', 'CA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type billing_provider as enum ('stripe', 'apple', 'google');
exception when duplicate_object then null; end $$;

do $$ begin
  create type billing_interval as enum ('month', 'year');
exception when duplicate_object then null; end $$;

-- Mirrors src/domain/billing/states.ts. Both must change together.
do $$ begin
  create type subscription_status as enum (
    'FREE',
    'CHECKOUT_PENDING',
    'INCOMPLETE',
    'TRIALING',
    'ACTIVE',
    'PAST_DUE',
    'GRACE',
    'PAUSED',
    'CANCELED_PENDING_EXPIRY',
    'EXPIRED',
    'REFUNDED',
    'REVOKED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type feature_type as enum (
    'BOOLEAN', 'LIMIT', 'QUOTA', 'RETENTION', 'SUPPORT_LEVEL'
  );
exception when duplicate_object then null; end $$;

-- Drives model routing and margin protection. See docs/BILLING.md section 11.
do $$ begin
  create type cost_level as enum ('LOW', 'MEDIUM', 'HIGH');
exception when duplicate_object then null; end $$;

do $$ begin
  create type webhook_status as enum ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reservation_status as enum ('RESERVED', 'COMMITTED', 'ROLLED_BACK');
exception when duplicate_object then null; end $$;

do $$ begin
  create type entitlement_effect as enum ('NONE', 'REVOKE_IMMEDIATELY', 'REVOKE_AT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type staff_role as enum (
    'SUPPORT', 'BILLING_ADMIN', 'CONTENT_EDITOR',
    'PRIVACY_ADMIN', 'SECURITY_ADMIN', 'SUPER_ADMIN'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_status as enum (
    'OPEN', 'AWAITING_PROVIDER', 'AWAITING_INSURER', 'RESOLVED', 'CLOSED', 'ARCHIVED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type document_type as enum (
    'BILL', 'ITEMIZED_BILL', 'EOB', 'STATEMENT', 'DENIAL_LETTER',
    'CORRESPONDENCE', 'INSURANCE_CARD', 'RECEIPT', 'OTHER'
  );
exception when duplicate_object then null; end $$;

-- Fail-closed: a document is not extractable until it is CLEAN.
do $$ begin
  create type scan_status as enum ('PENDING', 'CLEAN', 'INFECTED', 'FAILED', 'SKIPPED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type processing_status as enum (
    'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type confidence_level as enum ('LOW', 'MEDIUM', 'HIGH');
exception when duplicate_object then null; end $$;

do $$ begin
  create type finding_severity as enum ('INFO', 'REVIEW', 'ATTENTION');
exception when duplicate_object then null; end $$;

do $$ begin
  create type generated_document_status as enum (
    'DRAFT', 'USER_REVIEWED', 'FINALIZED', 'ARCHIVED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_status as enum ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'STALE', 'RETIRED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type privacy_request_type as enum ('ACCESS', 'EXPORT', 'DELETE', 'CORRECT', 'RESTRICT', 'OBJECT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type privacy_request_status as enum (
    'RECEIVED', 'VERIFYING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_status as enum ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD');
exception when duplicate_object then null; end $$;

do $$ begin
  create type security_event_type as enum (
    'WEBHOOK_SIGNATURE_INVALID',
    'WEBHOOK_REPLAY_DETECTED',
    'CROSS_USER_ACCESS_ATTEMPT',
    'ILLEGAL_BILLING_TRANSITION',
    'QUOTA_BYPASS_ATTEMPT',
    'PROMPT_INJECTION_SUSPECTED',
    'UNAUTHORIZED_DOCUMENT_ACCESS',
    'AUTH_ANOMALY',
    'RATE_LIMIT_EXCEEDED',
    'BILLING_STATE_MISMATCH',
    'AI_OUTPUT_REJECTED'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Shared triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Maintains updated_at. Application code never sets this column.';
