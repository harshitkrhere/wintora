-- 0021_deadline_notice.sql
-- A date the customer entered is emailed the day before, once.

alter table public.deadlines
  add column if not exists notified_at timestamptz;

create index if not exists deadlines_due_notice_idx
  on public.deadlines (due_date)
  where completed_at is null and notified_at is null;
