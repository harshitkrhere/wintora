-- 0020_letter_sent.sql
-- A letter can record that the customer sent it, and how.
--
-- Wintora never sends anything. This is the customer's own note that they
-- did: by which route, on which day, and to whom. It closes the loop on the
-- letter page ("what do I do after downloading it?") and gives the follow-up
-- reminder a date to count from.

alter table public.generated_documents
  add column if not exists sent_at  timestamptz,
  add column if not exists sent_via text
    check (sent_via is null or sent_via in ('email', 'post', 'portal', 'fax', 'other')),
  add column if not exists sent_to  text;

comment on column public.generated_documents.sent_at is
  'When the CUSTOMER says they sent it. Never set by the product.';
