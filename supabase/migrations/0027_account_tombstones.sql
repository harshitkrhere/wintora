-- 0027_account_tombstones.sql
-- What survives an account deletion, and nothing else.
--
-- Deleting the auth user cascades through every table that references it,
-- which is the point: cases, documents, checks, letters, reminders, the
-- email log, the audit trail of the account, all go. Two things must
-- outlive that, and docs/PRIVACY.md section 4 says so up front:
--
--   * a record that an account with a given internal id was deleted on a
--     given date, so a later question ("did you delete my account?") has an
--     answer;
--   * the billing records tax and accounting law require, reduced to the
--     minimum (amounts, currency, dates, provider references) and held apart
--     from anything about a bill or a diagnosis.
--
-- No foreign key to auth.users: the row exists precisely because the user
-- does not. No email address, no name, no case content. Service role only.

create table if not exists public.account_tombstones (
  user_id              uuid primary key,
  requested_at         timestamptz,
  deleted_at           timestamptz not null default now(),
  provider             text,
  provider_customer_id text,
  -- One object per invoice: provider_invoice_id, number, amounts in cents,
  -- currency, status, period and dates. Nothing else.
  billing              jsonb not null default '[]'::jsonb
);

comment on table public.account_tombstones is
  'Deleted accounts: the fact of the deletion and the minimum billing record. No content, no address.';

alter table public.account_tombstones enable row level security;
alter table public.account_tombstones force row level security;
-- No policies: only the service role reads or writes this table.
