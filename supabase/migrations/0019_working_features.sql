-- 0019_working_features.sql
-- The "working" features: letters with evidence, case exports, deadlines that
-- can be marked done, and the rest of the reviewed template library.
--
-- Nothing here changes what a plan includes. The plan matrix in 0012 already
-- entitles these features; this migration gives them somewhere to live.

-- ---------------------------------------------------------------------------
-- letters: evidence attached to a draft (ADVANCED_LETTERS)
--
-- [{ "kind": "document", "id": "<uuid>", "label": "statement.pdf" },
--  { "kind": "finding",  "id": "<uuid>", "label": "Line items do not add up" }]
--
-- Labels are copied at attach time so the letter still reads correctly after
-- the document has been removed by retention. Ids are kept for traceability.
-- ---------------------------------------------------------------------------

alter table public.generated_documents
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.generated_documents.attachments is
  'Evidence listed in the letter: case documents and findings, by id and label.';

-- ---------------------------------------------------------------------------
-- deadlines: a date can be marked done. Nothing is ever auto-completed.
-- ---------------------------------------------------------------------------

alter table public.deadlines
  add column if not exists completed_at timestamptz;

-- ---------------------------------------------------------------------------
-- case_exports (ADVANCED_EXPORT)
--
-- A bundle is built server-side, written to the private bucket under
-- {user_id}/exports/{export_id}.zip and handed to the customer as a signed
-- URL that expires. The row records what was produced; the sweep removes the
-- object once the link has expired, so an export never outlives its link.
-- ---------------------------------------------------------------------------

create table if not exists public.case_exports (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  case_id            uuid not null references public.cases(id) on delete cascade,
  format             text not null check (format in ('pdf', 'docx')),
  includes_documents boolean not null default false,
  storage_path       text,
  byte_size          bigint,
  file_count         integer not null default 0,
  -- Files that were left out, by label, so the customer is told rather than
  -- left to notice.
  omitted            jsonb not null default '[]'::jsonb,
  expires_at         timestamptz not null,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now()
);

comment on table public.case_exports is
  'Case bundles. Short-lived: the object is removed once the download link expires.';

create index if not exists case_exports_case_idx
  on public.case_exports (case_id, created_at desc);
create index if not exists case_exports_expiry_idx
  on public.case_exports (expires_at)
  where deleted_at is null;

-- READ_ONLY shape: the customer may list their own exports; only the service
-- role writes, because a row is only ever created alongside a stored object.
alter table public.case_exports enable row level security;
alter table public.case_exports force row level security;

drop policy if exists case_exports_select_own on public.case_exports;
create policy case_exports_select_own on public.case_exports
  for select using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- the rest of the template library (PREMIUM_TEMPLATES)
--
-- Plain administrative correspondence, in the same register as the four free
-- templates: a request, a question, a confirmation. None asserts a legal
-- position, quotes a statute or threatens anything. INSURANCE_APPEAL stays
-- DRAFT (see docs/LIMITATIONS.md); nothing here changes that.
-- ---------------------------------------------------------------------------

insert into public.templates (key, name, description, category, fields, body_template, is_premium, review_status, reviewed_by, reviewed_at) values
(
  'REQUEST_CORRECTED_STATEMENT',
  'Ask for a corrected statement',
  'Lists the entries that do not agree and asks for a corrected statement.',
  'REQUEST',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"provider_name","label":"Provider or billing office","type":"text","required":true},
    {"key":"account_reference","label":"Account or statement number","type":"text","required":true},
    {"key":"statement_date","label":"Statement date","type":"date","required":false},
    {"key":"discrepancies","label":"What does not agree","type":"list","required":true,"help":"One entry per difference, with the figures as printed."},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{provider_name}}\n\nRe: Request for a corrected statement\nAccount reference: {{account_reference}}\n\nTo whom it may concern,\n\nI have gone through the statement for the account above{{#statement_date}}, dated {{statement_date}},{{/statement_date}} and some of the entries do not agree with each other or with the documents I hold. Specifically:\n\n{{discrepancies}}\n\nCould you please review these entries and, where a correction is needed, send me a corrected statement? If you find that the statement is right as printed, I would appreciate a short explanation of how the figures were reached, so that I can pay the correct amount with confidence.\n\nYou can reach me at:\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  true, 'PUBLISHED', 'Editorial', now()
),
(
  'REQUEST_ACCOUNT_HOLD',
  'Ask for the account to be held while a question is resolved',
  'Asks the billing office not to move the account forward while an open question is answered.',
  'REQUEST',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"provider_name","label":"Provider or billing office","type":"text","required":true},
    {"key":"account_reference","label":"Account or statement number","type":"text","required":true},
    {"key":"open_question","label":"What is still being resolved","type":"textarea","required":true,"help":"For example: a corrected statement you requested on a given date, or a claim your insurer is still processing."},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{provider_name}}\n\nRe: Request to hold the account\nAccount reference: {{account_reference}}\n\nTo whom it may concern,\n\nThere is an open question on the account referenced above, and I am asking that the account be held while it is resolved:\n\n{{open_question}}\n\nI want to pay what is owed once the figures are confirmed. In the meantime, could you please confirm in writing that the account will not be sent for further collection activity while this is being looked into, and let me know if there is anything you need from me to move it along?\n\nYou can reach me at:\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  true, 'PUBLISHED', 'Editorial', now()
),
(
  'REQUEST_CLAIM_STATUS',
  'Ask your insurer for the status of a claim',
  'Asks the insurer where a claim stands and what, if anything, is still needed.',
  'REQUEST',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"insurer_name","label":"Insurer","type":"text","required":true},
    {"key":"member_reference","label":"Member or policy reference","type":"text","required":true},
    {"key":"claim_reference","label":"Claim reference, if you have it","type":"text","required":false},
    {"key":"provider_name","label":"Provider who gave the care","type":"text","required":true},
    {"key":"service_date","label":"Date of service","type":"date","required":false},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{insurer_name}}\n\nRe: Status of a claim\nMember reference: {{member_reference}}{{#claim_reference}}\nClaim reference: {{claim_reference}}{{/claim_reference}}\n\nTo whom it may concern,\n\nI am writing to ask where things stand with a claim from {{provider_name}}{{#service_date}} for services dated {{service_date}}{{/service_date}}. I have received a statement from the provider and would like to understand what has been processed on your side before I pay it.\n\nCould you please let me know:\n\n1. Whether the claim has been received, and on what date.\n2. Whether it has been processed, and if so, what was allowed, what the plan paid and what is recorded as my responsibility.\n3. Whether anything further is needed from me or from the provider.\n\nIf an explanation of benefits has been issued for this claim, I would appreciate a copy.\n\nYou can reach me at:\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  true, 'PUBLISHED', 'Editorial', now()
),
(
  'REQUEST_SUBMIT_TO_INSURER',
  'Ask the provider to submit the claim to your insurer',
  'Asks the billing office to bill your insurance, or to bill it again, before billing you.',
  'REQUEST',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"provider_name","label":"Provider or billing office","type":"text","required":true},
    {"key":"account_reference","label":"Account or statement number","type":"text","required":true},
    {"key":"insurer_name","label":"Insurer","type":"text","required":true},
    {"key":"member_reference","label":"Member or policy reference","type":"text","required":true},
    {"key":"service_date","label":"Date of service","type":"date","required":false},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{provider_name}}\n\nRe: Request to submit a claim to my insurer\nAccount reference: {{account_reference}}\n\nTo whom it may concern,\n\nThe statement for the account above{{#service_date}}, for services dated {{service_date}},{{/service_date}} does not appear to reflect a claim to my insurer. My coverage details are:\n\nInsurer: {{insurer_name}}\nMember reference: {{member_reference}}\n\nCould you please submit the claim to my insurer, or if it has already been submitted, let me know the date and the claim reference so I can follow it up with them? Once the claim has been processed, please send me a revised statement showing what the plan paid and what remains.\n\nYou can reach me at:\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  true, 'PUBLISHED', 'Editorial', now()
),
(
  'CONFIRM_CONVERSATION',
  'Confirm a phone conversation in writing',
  'Puts what was agreed on a call into a letter, so both sides have the same record.',
  'CONFIRMATION',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"recipient_name","label":"Who you are writing to","type":"text","required":true},
    {"key":"account_reference","label":"Account, claim or reference number","type":"text","required":true},
    {"key":"conversation_date","label":"Date of the call","type":"date","required":true},
    {"key":"spoke_with","label":"Who you spoke with, if you have a name","type":"text","required":false},
    {"key":"agreed","label":"What was agreed","type":"list","required":true,"help":"One point per line, in your own words."},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{recipient_name}}\n\nRe: Confirming our conversation of {{conversation_date}}\nReference: {{account_reference}}\n\nTo whom it may concern,\n\nThank you for your time on {{conversation_date}}{{#spoke_with}}, when I spoke with {{spoke_with}}{{/spoke_with}}. I am writing to confirm my understanding of what was agreed, so that we both have the same record:\n\n{{agreed}}\n\nIf any of this differs from your notes, please let me know in writing so it can be put right now rather than later.\n\nYou can reach me at:\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  true, 'PUBLISHED', 'Editorial', now()
),
(
  'FOLLOW_UP_PREVIOUS_LETTER',
  'Follow up on a letter that has not been answered',
  'A short, polite second letter that refers back to the first.',
  'FOLLOW_UP',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"recipient_name","label":"Who you are writing to","type":"text","required":true},
    {"key":"account_reference","label":"Account, claim or reference number","type":"text","required":true},
    {"key":"previous_letter_date","label":"Date of your earlier letter","type":"date","required":true},
    {"key":"previous_subject","label":"What that letter asked for","type":"text","required":true},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{recipient_name}}\n\nRe: Follow-up to my letter of {{previous_letter_date}}\nReference: {{account_reference}}\n\nTo whom it may concern,\n\nOn {{previous_letter_date}} I wrote to you about the reference above, asking for {{previous_subject}}. I have not yet had a reply, so I am writing again in case the first letter did not reach the right person.\n\nI have enclosed a copy of the earlier letter. Could you please let me know when I can expect a response, and whether anything further is needed from me?\n\nYou can reach me at:\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  true, 'PUBLISHED', 'Editorial', now()
),
(
  'REQUEST_PAYMENT_RECORD',
  'Ask for a record of payments on the account',
  'Asks the billing office for a list of every payment and adjustment applied to the account.',
  'REQUEST',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"provider_name","label":"Provider or billing office","type":"text","required":true},
    {"key":"account_reference","label":"Account or statement number","type":"text","required":true},
    {"key":"from_date","label":"From date, if you want a particular period","type":"date","required":false},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{provider_name}}\n\nRe: Request for a payment history\nAccount reference: {{account_reference}}\n\nTo whom it may concern,\n\nCould you please send me a record of every payment, insurance payment, adjustment and credit applied to the account above{{#from_date}} since {{from_date}}{{/from_date}}, with the date and amount of each, and the balance after each entry?\n\nI am asking so that I can reconcile my own records against yours before making a further payment.\n\nPlease send it to:\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  true, 'PUBLISHED', 'Editorial', now()
)
on conflict (key) do nothing;
