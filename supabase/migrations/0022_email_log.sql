-- 0022_email_log.sql
-- Every email the product sends, with what happened to it.
--
-- One row per message: who it went to (by account), what it said, which
-- provider carried it, the provider's message id, and a status that moves
-- forward as delivery events arrive. The idempotency key is the guard that
-- keeps a redelivered webhook or a re-run cron from sending twice.
--
-- The body is stored. That is safe because every message is, by design, a
-- fact about the account and a link: nothing from a case ever appears in
-- one (tests/email-messages.test.ts asserts it). Storing it means a failed
-- send can be retried as sent, and the customer can read exactly what they
-- were sent on /settings/privacy.
--
-- What is NOT tracked: opens and clicks. Those need a pixel and rewritten
-- links in every message, which is surveillance this product refuses.

create table if not exists public.email_log (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  kind                text not null,
  idempotency_key     text not null unique,
  subject             text not null,
  body                text not null,
  provider            text not null default 'none',
  provider_message_id text,
  status              text not null default 'QUEUED'
    check (status in ('QUEUED', 'SENT', 'DELIVERED', 'DELAYED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'SUPPRESSED', 'NO_ADDRESS')),
  error_class         text,
  attempts            integer not null default 0,
  -- [{ "type": "email.delivered", "at": "..." }], as the provider reported them.
  events              jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  last_event_at       timestamptz
);

comment on table public.email_log is
  'Every message the product sent to an account holder, and what became of it. Never case content.';

create index if not exists email_log_user_idx on public.email_log (user_id, created_at desc);
create index if not exists email_log_provider_msg_idx on public.email_log (provider_message_id)
  where provider_message_id is not null;
create index if not exists email_log_retry_idx on public.email_log (created_at)
  where status in ('QUEUED', 'FAILED');
create index if not exists email_log_suppress_idx on public.email_log (user_id, last_event_at desc)
  where status in ('BOUNCED', 'COMPLAINED');

-- READ_ONLY shape: the customer may read what was sent to them; only the
-- service role writes.
alter table public.email_log enable row level security;
alter table public.email_log force row level security;

drop policy if exists email_log_select_own on public.email_log;
create policy email_log_select_own on public.email_log
  for select using (user_id = (select auth.uid()));
