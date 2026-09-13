-- 0023_email_log_html.sql
-- The HTML rendering of each message, alongside its text, so a retry sends
-- exactly what the first attempt would have.

alter table public.email_log
  add column if not exists html text;
