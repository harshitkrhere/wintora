-- 0012_seed_catalog.sql
-- Seeds the feature registry, plan catalog, plan matrix, countries,
-- jurisdictions (all disabled pending review), letter templates and
-- operational settings.
--
-- This file must stay in step with src/config/features.ts and
-- src/config/plans.ts. tests/catalog-parity.test.ts asserts that it does.
--
-- Idempotent: every insert is an upsert on a natural key.

-- ===========================================================================
-- features
-- ===========================================================================

insert into public.features (key, name, description, benefit_text, type, cost_level, sort_order) values
  ('DOCUMENT_UPLOAD',            'Document upload',            'Upload bills, EOBs and correspondence to a case.',                    'Upload your bills and statements',                     'BOOLEAN', 'LOW',    10),
  ('BASIC_BILL_ANALYSIS',        'Bill analysis',              'Deterministic arithmetic and internal-consistency checks.',           'Check a bill for arithmetic and consistency problems',  'BOOLEAN', 'LOW',    20),
  ('ADVANCED_DOCUMENT_ANALYSIS', 'Advanced document analysis', 'Cross-document reconciliation and richer line-item comparison.',      'Advanced cross-document analysis',                     'BOOLEAN', 'HIGH',   30),
  ('EOB_COMPARISON',             'Bill vs EOB comparison',     'Compare a provider bill against an explanation of benefits.',        'Compare a bill against your EOB',                      'BOOLEAN', 'MEDIUM', 40),
  ('LETTER_GENERATION',          'Request letters',            'Generate administrative request drafts you review and send.',         'Prepare request letters to review and send yourself',   'BOOLEAN', 'LOW',    50),
  ('ADVANCED_LETTERS',           'Advanced letter drafts',     'Multi-part correspondence with evidence attachments.',                'Advanced correspondence drafts',                       'BOOLEAN', 'MEDIUM', 60),
  ('PREMIUM_TEMPLATES',          'Premium templates',          'The full reviewed template library.',                                 'The full template library',                            'BOOLEAN', 'LOW',    70),
  ('CASE_TRACKING',              'Case tracking',              'Organise a bill into a case with documents and status.',              'Keep each bill organised as a case',                   'BOOLEAN', 'LOW',    80),
  ('MULTIPLE_CASES',             'Multiple cases',             'Run more than one case at a time.',                                   'Work on several bills at once',                        'BOOLEAN', 'LOW',    90),
  ('CASE_TIMELINE',              'Case timeline',              'A dated record of what happened and when.',                           'A complete timeline of your case',                     'BOOLEAN', 'LOW',   100),
  ('REMINDERS',                  'Reminders',                  'Schedule follow-up reminders on a case.',                             'Follow-up reminders so nothing is missed',             'BOOLEAN', 'LOW',   110),
  ('DEADLINE_TRACKING',          'Deadline tracking',          'Track verified and user-entered dates, clearly distinguished.',       'Track your important dates',                           'BOOLEAN', 'LOW',   120),
  ('ADVANCED_EXPORT',            'Advanced export',            'Export a full case bundle as PDF or DOCX with attachments.',          'Export a complete case bundle',                        'BOOLEAN', 'MEDIUM',130),
  ('HOUSEHOLD_CASES',            'Household cases',            'Track cases for more than one person in the household.',              'Manage bills for your whole household',                'BOOLEAN', 'LOW',   140),
  ('EXTENDED_HISTORY',           'Extended history',           'Longer retention of case and analysis history.',                      'Keep your history for longer',                         'BOOLEAN', 'LOW',   150),
  ('PRIORITY_SUPPORT',           'Priority support',           'Support queue priority with a published response target.',            'Priority support with a published response target',    'SUPPORT_LEVEL', 'LOW', 160),
  ('DATA_EXPORT',                'Data export',                'Download everything held about you.',                                 'Download all your data at any time',                   'BOOLEAN', 'LOW',   170),
  ('ACCOUNT_DELETION',           'Account deletion',           'Delete your account and content.',                                    'Delete your account and content at any time',          'BOOLEAN', 'LOW',   180),
  ('MAX_ACTIVE_CASES',           'Active cases',               'How many cases may be open at once.',                                 'Active cases',                                         'LIMIT',   'LOW',   200),
  ('MONTHLY_DOCUMENTS',          'Documents per period',       'Document uploads per billing period.',                               'Document uploads per billing period',                  'QUOTA',   'MEDIUM',210),
  ('MONTHLY_ANALYSES',           'Analyses per period',        'Analysis runs per billing period.',                                  'Analyses per billing period',                          'QUOTA',   'HIGH',  220),
  ('MONTHLY_LETTERS',            'Letters per period',         'Letter drafts per billing period.',                                  'Letter drafts per billing period',                     'QUOTA',   'MEDIUM',230),
  ('MONTHLY_EXPORTS',            'Exports per period',         'Case exports per billing period.',                                   'Case exports per billing period',                      'QUOTA',   'LOW',   240),
  ('MAX_FILE_SIZE_MB',           'Maximum file size',          'Largest single upload, in megabytes.',                               'Maximum file size',                                    'LIMIT',   'LOW',   250),
  ('STORAGE_LIMIT_MB',           'Storage',                    'Total stored document size, in megabytes.',                          'Document storage',                                     'LIMIT',   'LOW',   260),
  ('RETENTION_DAYS',             'Document retention',         'How long uploaded documents are kept before automatic removal.',      'Document retention',                                   'RETENTION','LOW',  270),
  ('HOUSEHOLD_MEMBERS',          'Household members',          'How many people may be tracked on this account.',                     'People covered',                                       'LIMIT',   'LOW',   280)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  benefit_text = excluded.benefit_text,
  type = excluded.type,
  cost_level = excluded.cost_level,
  sort_order = excluded.sort_order,
  active = true;

-- ===========================================================================
-- plans
-- ===========================================================================

insert into public.plans (slug, version, display_name, description, tier, is_free, sort_order, provider_product_id) values
  ('free',      1, 'Free',      'Understand one bill, properly. Real analysis, one case, one letter.',                     0, true,  10, null),
  ('essential', 1, 'Essential', 'More room to work: more cases, more uploads, EOB comparison and reminders.',              1, false, 20, null),
  ('plus',      1, 'Plus',      'The full workflow: advanced analysis, deadline tracking, exports, longer history.',       2, false, 30, null),
  ('pro',       1, 'Pro',       'For households and high volume, with priority support.',                                  3, false, 40, null)
on conflict (slug, version) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  tier = excluded.tier,
  is_free = excluded.is_free,
  sort_order = excluded.sort_order,
  active = true;

-- Prices. Explicit per country and currency; no FX conversion anywhere.
-- provider_price_id is filled in from the Stripe dashboard before launch.
-- See docs/BILLING.md section 2.
insert into public.plan_prices (plan_id, currency, country, amount_cents)
select p.id, v.currency, v.country::country_code, v.amount_cents
from (values
  ('free',      'USD', 'US',     0),
  ('free',      'CAD', 'CA',     0),
  ('essential', 'USD', 'US',   999),
  ('essential', 'CAD', 'CA',  1299),
  ('plus',      'USD', 'US',  1999),
  ('plus',      'CAD', 'CA',  2599),
  ('pro',       'USD', 'US',  2999),
  ('pro',       'CAD', 'CA',  3999)
) as v(slug, currency, country, amount_cents)
join public.plans p on p.slug = v.slug and p.version = 1
on conflict (plan_id, country, currency) do update set
  amount_cents = excluded.amount_cents,
  active = true;

-- ===========================================================================
-- plan_features: the matrix
--
-- Changing a number here changes enforcement immediately. No deploy required.
-- ===========================================================================

insert into public.plan_features (plan_id, feature_id, enabled, limit_value, limit_unit, notes)
select p.id, f.id, v.enabled, v.limit_value, v.limit_unit, v.notes
from (values
  -- free
  ('free','DOCUMENT_UPLOAD',            true,  null, null, null),
  ('free','BASIC_BILL_ANALYSIS',        true,  null, null, 'Same deterministic engine as every paid tier.'),
  ('free','ADVANCED_DOCUMENT_ANALYSIS', false, null, null, null),
  ('free','EOB_COMPARISON',             true,  null, null, 'Basic comparison. Advanced cross-document analysis is a paid feature.'),
  ('free','LETTER_GENERATION',          true,  null, null, null),
  ('free','ADVANCED_LETTERS',           false, null, null, null),
  ('free','PREMIUM_TEMPLATES',          false, null, null, null),
  ('free','CASE_TRACKING',              true,  null, null, null),
  ('free','MULTIPLE_CASES',             false, null, null, null),
  ('free','CASE_TIMELINE',              true,  null, null, 'Basic timeline.'),
  ('free','REMINDERS',                  false, null, null, null),
  ('free','DEADLINE_TRACKING',          false, null, null, null),
  ('free','ADVANCED_EXPORT',            false, null, null, null),
  ('free','HOUSEHOLD_CASES',            false, null, null, null),
  ('free','EXTENDED_HISTORY',           false, null, null, null),
  ('free','PRIORITY_SUPPORT',           false, null, null, null),
  ('free','DATA_EXPORT',                true,  null, null, 'A user right. No plan may disable this.'),
  ('free','ACCOUNT_DELETION',           true,  null, null, 'A user right. No plan may disable this.'),
  ('free','MAX_ACTIVE_CASES',           true,     1, 'cases', null),
  ('free','MONTHLY_DOCUMENTS',          true,     3, 'documents', null),
  ('free','MONTHLY_ANALYSES',           true,     2, 'analyses', null),
  ('free','MONTHLY_LETTERS',            true,     1, 'letters', null),
  ('free','MONTHLY_EXPORTS',            true,     1, 'exports', null),
  ('free','MAX_FILE_SIZE_MB',           true,    10, 'MB', null),
  ('free','STORAGE_LIMIT_MB',           true,    50, 'MB', null),
  ('free','RETENTION_DAYS',             true,    30, 'days', null),
  ('free','HOUSEHOLD_MEMBERS',          true,     1, 'people', null),

  -- essential
  ('essential','DOCUMENT_UPLOAD',            true,  null, null, null),
  ('essential','BASIC_BILL_ANALYSIS',        true,  null, null, null),
  ('essential','ADVANCED_DOCUMENT_ANALYSIS', true,  null, null, null),
  ('essential','EOB_COMPARISON',             true,  null, null, null),
  ('essential','LETTER_GENERATION',          true,  null, null, null),
  ('essential','ADVANCED_LETTERS',           false, null, null, null),
  ('essential','PREMIUM_TEMPLATES',          true,  null, null, null),
  ('essential','CASE_TRACKING',              true,  null, null, null),
  ('essential','MULTIPLE_CASES',             true,  null, null, null),
  ('essential','CASE_TIMELINE',              true,  null, null, null),
  ('essential','REMINDERS',                  true,  null, null, null),
  ('essential','DEADLINE_TRACKING',          false, null, null, null),
  ('essential','ADVANCED_EXPORT',            false, null, null, null),
  ('essential','HOUSEHOLD_CASES',            false, null, null, null),
  ('essential','EXTENDED_HISTORY',           false, null, null, null),
  ('essential','PRIORITY_SUPPORT',           false, null, null, null),
  ('essential','DATA_EXPORT',                true,  null, null, null),
  ('essential','ACCOUNT_DELETION',           true,  null, null, null),
  ('essential','MAX_ACTIVE_CASES',           true,     5, 'cases', null),
  ('essential','MONTHLY_DOCUMENTS',          true,    25, 'documents', null),
  ('essential','MONTHLY_ANALYSES',           true,    15, 'analyses', null),
  ('essential','MONTHLY_LETTERS',            true,    10, 'letters', null),
  ('essential','MONTHLY_EXPORTS',            true,     5, 'exports', null),
  ('essential','MAX_FILE_SIZE_MB',           true,    20, 'MB', null),
  ('essential','STORAGE_LIMIT_MB',           true,   500, 'MB', null),
  ('essential','RETENTION_DAYS',             true,    90, 'days', null),
  ('essential','HOUSEHOLD_MEMBERS',          true,     1, 'people', null),

  -- plus
  ('plus','DOCUMENT_UPLOAD',            true,  null, null, null),
  ('plus','BASIC_BILL_ANALYSIS',        true,  null, null, null),
  ('plus','ADVANCED_DOCUMENT_ANALYSIS', true,  null, null, null),
  ('plus','EOB_COMPARISON',             true,  null, null, null),
  ('plus','LETTER_GENERATION',          true,  null, null, null),
  ('plus','ADVANCED_LETTERS',           true,  null, null, null),
  ('plus','PREMIUM_TEMPLATES',          true,  null, null, null),
  ('plus','CASE_TRACKING',              true,  null, null, null),
  ('plus','MULTIPLE_CASES',             true,  null, null, null),
  ('plus','CASE_TIMELINE',              true,  null, null, null),
  ('plus','REMINDERS',                  true,  null, null, null),
  ('plus','DEADLINE_TRACKING',          true,  null, null, null),
  ('plus','ADVANCED_EXPORT',            true,  null, null, null),
  ('plus','HOUSEHOLD_CASES',            false, null, null, null),
  ('plus','EXTENDED_HISTORY',           true,  null, null, null),
  ('plus','PRIORITY_SUPPORT',           false, null, null, null),
  ('plus','DATA_EXPORT',                true,  null, null, null),
  ('plus','ACCOUNT_DELETION',           true,  null, null, null),
  ('plus','MAX_ACTIVE_CASES',           true,    15, 'cases', null),
  ('plus','MONTHLY_DOCUMENTS',          true,   100, 'documents', null),
  ('plus','MONTHLY_ANALYSES',           true,    50, 'analyses', null),
  ('plus','MONTHLY_LETTERS',            true,    30, 'letters', null),
  ('plus','MONTHLY_EXPORTS',            true,    20, 'exports', null),
  ('plus','MAX_FILE_SIZE_MB',           true,    25, 'MB', null),
  ('plus','STORAGE_LIMIT_MB',           true,  2000, 'MB', null),
  ('plus','RETENTION_DAYS',             true,   180, 'days', null),
  ('plus','HOUSEHOLD_MEMBERS',          true,     1, 'people', null),

  -- pro
  ('pro','DOCUMENT_UPLOAD',            true,  null, null, null),
  ('pro','BASIC_BILL_ANALYSIS',        true,  null, null, null),
  ('pro','ADVANCED_DOCUMENT_ANALYSIS', true,  null, null, null),
  ('pro','EOB_COMPARISON',             true,  null, null, null),
  ('pro','LETTER_GENERATION',          true,  null, null, null),
  ('pro','ADVANCED_LETTERS',           true,  null, null, null),
  ('pro','PREMIUM_TEMPLATES',          true,  null, null, null),
  ('pro','CASE_TRACKING',              true,  null, null, null),
  ('pro','MULTIPLE_CASES',             true,  null, null, null),
  ('pro','CASE_TIMELINE',              true,  null, null, null),
  ('pro','REMINDERS',                  true,  null, null, null),
  ('pro','DEADLINE_TRACKING',          true,  null, null, null),
  ('pro','ADVANCED_EXPORT',            true,  null, null, null),
  ('pro','HOUSEHOLD_CASES',            true,  null, null, null),
  ('pro','EXTENDED_HISTORY',           true,  null, null, null),
  ('pro','PRIORITY_SUPPORT',           true,  null, null, 'Published response target. Requires a staffed queue before this is sold.'),
  ('pro','DATA_EXPORT',                true,  null, null, null),
  ('pro','ACCOUNT_DELETION',           true,  null, null, null),
  ('pro','MAX_ACTIVE_CASES',           true,    50, 'cases', null),
  ('pro','MONTHLY_DOCUMENTS',          true,   300, 'documents', null),
  ('pro','MONTHLY_ANALYSES',           true,   150, 'analyses', null),
  ('pro','MONTHLY_LETTERS',            true,    90, 'letters', null),
  ('pro','MONTHLY_EXPORTS',            true,    60, 'exports', null),
  ('pro','MAX_FILE_SIZE_MB',           true,    25, 'MB', null),
  ('pro','STORAGE_LIMIT_MB',           true,  5000, 'MB', null),
  ('pro','RETENTION_DAYS',             true,   365, 'days', null),
  ('pro','HOUSEHOLD_MEMBERS',          true,     6, 'people', null)
) as v(plan_slug, feature_key, enabled, limit_value, limit_unit, notes)
join public.plans p on p.slug = v.plan_slug and p.version = 1
join public.features f on f.key = v.feature_key
on conflict (plan_id, feature_id) do update set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value,
  limit_unit = excluded.limit_unit,
  notes = excluded.notes;

-- ===========================================================================
-- countries and jurisdictions
--
-- Every jurisdiction is seeded DISABLED. A state or province is opened only
-- after its content has been reviewed and sourced. See docs/SEO.md.
-- ===========================================================================

insert into public.countries (code, name) values
  ('US', 'United States'),
  ('CA', 'Canada')
on conflict (code) do nothing;

insert into public.jurisdictions (country, region_code, name, slug)
select v.country::country_code, v.region_code, v.name,
       lower(v.country) || '-' || lower(v.region_code)
from (values
  ('US','AL','Alabama'),('US','AK','Alaska'),('US','AZ','Arizona'),('US','AR','Arkansas'),
  ('US','CA','California'),('US','CO','Colorado'),('US','CT','Connecticut'),('US','DE','Delaware'),
  ('US','DC','District of Columbia'),('US','FL','Florida'),('US','GA','Georgia'),('US','HI','Hawaii'),
  ('US','ID','Idaho'),('US','IL','Illinois'),('US','IN','Indiana'),('US','IA','Iowa'),
  ('US','KS','Kansas'),('US','KY','Kentucky'),('US','LA','Louisiana'),('US','ME','Maine'),
  ('US','MD','Maryland'),('US','MA','Massachusetts'),('US','MI','Michigan'),('US','MN','Minnesota'),
  ('US','MS','Mississippi'),('US','MO','Missouri'),('US','MT','Montana'),('US','NE','Nebraska'),
  ('US','NV','Nevada'),('US','NH','New Hampshire'),('US','NJ','New Jersey'),('US','NM','New Mexico'),
  ('US','NY','New York'),('US','NC','North Carolina'),('US','ND','North Dakota'),('US','OH','Ohio'),
  ('US','OK','Oklahoma'),('US','OR','Oregon'),('US','PA','Pennsylvania'),('US','RI','Rhode Island'),
  ('US','SC','South Carolina'),('US','SD','South Dakota'),('US','TN','Tennessee'),('US','TX','Texas'),
  ('US','UT','Utah'),('US','VT','Vermont'),('US','VA','Virginia'),('US','WA','Washington'),
  ('US','WV','West Virginia'),('US','WI','Wisconsin'),('US','WY','Wyoming'),
  ('CA','AB','Alberta'),('CA','BC','British Columbia'),('CA','MB','Manitoba'),
  ('CA','NB','New Brunswick'),('CA','NL','Newfoundland and Labrador'),('CA','NS','Nova Scotia'),
  ('CA','NT','Northwest Territories'),('CA','NU','Nunavut'),('CA','ON','Ontario'),
  ('CA','PE','Prince Edward Island'),('CA','QC','Quebec'),('CA','SK','Saskatchewan'),
  ('CA','YT','Yukon')
) as v(country, region_code, name)
on conflict (country, region_code) do nothing;

-- ===========================================================================
-- letter templates
--
-- These are plain administrative correspondence. INSURANCE_APPEAL is seeded as
-- DRAFT because it is the one template that needs legal review before it is
-- offered to users. See docs/LIMITATIONS.md.
-- ===========================================================================

insert into public.templates (key, name, description, category, fields, body_template, is_premium, review_status, reviewed_by, reviewed_at) values
(
  'REQUEST_ITEMIZED_BILL',
  'Request an itemised statement',
  'Asks the billing office for a line-by-line statement of charges.',
  'REQUEST',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"user_address","label":"Your address","type":"textarea","required":false},
    {"key":"provider_name","label":"Provider or billing office","type":"text","required":true},
    {"key":"account_reference","label":"Account or statement number","type":"text","required":true},
    {"key":"service_date","label":"Date of service","type":"date","required":false},
    {"key":"statement_date","label":"Statement date","type":"date","required":false},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{provider_name}}\n\nRe: Request for an itemised statement\nAccount reference: {{account_reference}}\n\nTo whom it may concern,\n\nI am writing to request an itemised statement for the account referenced above{{#service_date}}, for services dated {{service_date}}{{/service_date}}.\n\nPlease include, for each charge: the date of service, a description of the service, the procedure or billing code, the quantity, and the amount charged.\n\nI am asking so that I can review the charges carefully before payment. Please send the statement to the contact details below.\n\n{{contact_details}}\n\nThank you for your help.\n\n{{user_name}}\n{{user_address}}',
  false, 'PUBLISHED', 'Editorial', now()
),
(
  'REQUEST_BILLING_CLARIFICATION',
  'Ask for clarification of specific charges',
  'Asks the billing office to explain or reconcile specific entries.',
  'REQUEST',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"provider_name","label":"Provider or billing office","type":"text","required":true},
    {"key":"account_reference","label":"Account or statement number","type":"text","required":true},
    {"key":"questions","label":"What you want explained","type":"list","required":true},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{provider_name}}\n\nRe: Questions about my statement\nAccount reference: {{account_reference}}\n\nTo whom it may concern,\n\nI have reviewed the statement for the account above and I would like to understand a few entries before I pay. My questions are:\n\n{{questions}}\n\nCould you please review these and let me know what you find? If a correction is needed, please send a revised statement.\n\nYou can reach me at:\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  false, 'PUBLISHED', 'Editorial', now()
),
(
  'REQUEST_PAYMENT_PLAN',
  'Request a payment plan',
  'Asks the billing office about instalment options.',
  'REQUEST',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"provider_name","label":"Provider or billing office","type":"text","required":true},
    {"key":"account_reference","label":"Account or statement number","type":"text","required":true},
    {"key":"balance","label":"Balance shown on the statement","type":"money","required":true},
    {"key":"proposed_monthly","label":"What you can pay each month","type":"money","required":false},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{provider_name}}\n\nRe: Request for a payment plan\nAccount reference: {{account_reference}}\n\nTo whom it may concern,\n\nI received a statement showing a balance of {{balance}}. I want to pay this, and I am asking whether a payment plan is available.\n\n{{#proposed_monthly}}I can currently manage {{proposed_monthly}} per month. {{/proposed_monthly}}If a different arrangement works better on your side, I am open to discussing it.\n\nPlease let me know what options are available and what you need from me. You can reach me at:\n\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  false, 'PUBLISHED', 'Editorial', now()
),
(
  'REQUEST_FINANCIAL_ASSISTANCE',
  'Request a financial assistance application',
  'Asks the provider for its financial assistance or charity care application.',
  'REQUEST',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"provider_name","label":"Provider or billing office","type":"text","required":true},
    {"key":"account_reference","label":"Account or statement number","type":"text","required":true},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{provider_name}}\n\nRe: Financial assistance application request\nAccount reference: {{account_reference}}\n\nTo whom it may concern,\n\nI am writing to ask for a copy of your financial assistance policy and the application form, along with a list of the documents you need from me.\n\nWhile my application is being considered, I would appreciate it if collection activity on this account could be held.\n\nYou can reach me at:\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  false, 'PUBLISHED', 'Editorial', now()
),
(
  'REQUEST_EOB_COPY',
  'Request a copy of an explanation of benefits',
  'Asks the insurer for the EOB for a specific claim.',
  'REQUEST',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"insurer_name","label":"Insurer","type":"text","required":true},
    {"key":"member_reference","label":"Member or policy reference","type":"text","required":true},
    {"key":"claim_reference","label":"Claim reference, if you have it","type":"text","required":false},
    {"key":"service_date","label":"Date of service","type":"date","required":false},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{insurer_name}}\n\nRe: Request for an explanation of benefits\nMember reference: {{member_reference}}\n\nTo whom it may concern,\n\nI am requesting a copy of the explanation of benefits{{#claim_reference}} for claim {{claim_reference}}{{/claim_reference}}{{#service_date}}, for services dated {{service_date}}{{/service_date}}.\n\nI would like to compare it against the statement I received from the provider.\n\nPlease send it to:\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  true, 'PUBLISHED', 'Editorial', now()
),
(
  'INSURANCE_APPEAL',
  'Internal appeal of a claim decision',
  'A structured internal appeal of a denied or partially paid claim.',
  'APPEAL',
  '[{"key":"user_name","label":"Your full name","type":"text","required":true},
    {"key":"insurer_name","label":"Insurer","type":"text","required":true},
    {"key":"member_reference","label":"Member or policy reference","type":"text","required":true},
    {"key":"claim_reference","label":"Claim reference","type":"text","required":true},
    {"key":"denial_date","label":"Date of the decision letter","type":"date","required":true},
    {"key":"denial_reason","label":"Reason given for the decision","type":"textarea","required":true},
    {"key":"grounds","label":"Why you think it should be reconsidered","type":"list","required":true},
    {"key":"enclosures","label":"What you are enclosing","type":"list","required":false},
    {"key":"contact_details","label":"How they should reach you","type":"textarea","required":true}]'::jsonb,
  E'{{today}}\n\n{{insurer_name}}\n\nRe: Internal appeal\nMember reference: {{member_reference}}\nClaim reference: {{claim_reference}}\n\nTo whom it may concern,\n\nI am appealing the decision dated {{denial_date}} on the claim referenced above. The reason given was:\n\n{{denial_reason}}\n\nI am asking you to reconsider for the following reasons:\n\n{{grounds}}\n\n{{#enclosures}}I have enclosed:\n{{enclosures}}\n\n{{/enclosures}}Please confirm receipt of this appeal and let me know the timeframe for a decision and what further information you need.\n\nYou can reach me at:\n{{contact_details}}\n\nThank you,\n\n{{user_name}}',
  true, 'DRAFT', null, null
)
on conflict (key) do nothing;

-- ===========================================================================
-- operational settings
-- ===========================================================================

insert into public.feature_flags (key, enabled, description) values
  ('safe_mode',            false, 'Global incident switch. Stops uploads, extraction, AI and letter generation. Keeps auth, billing, export and public pages working.'),
  ('ai_phrasing',          true,  'Allow the model to rephrase deterministic findings. Findings themselves are never model-authored.'),
  ('ocr_enabled',          false, 'Enable OCR extraction. Off until an OCR provider is configured.'),
  ('malware_scan_required', true, 'Refuse extraction until a document is scanned CLEAN. Fail closed.'),
  ('referrals_enabled',    false, 'Referral programme.'),
  ('trials_enabled',       false, 'Free trials. Off until trial terms are reviewed.')
on conflict (key) do nothing;

insert into public.system_settings (key, value, description) values
  ('grace_period_days',        '7'::jsonb,      'Days of premium access retained after a failed renewal.'),
  ('downgrade_effective_at',   '"period_end"'::jsonb, 'When a downgrade applies.'),
  ('retention_transition_days','30'::jsonb,     'Grace window before shortened retention deletes anything.'),
  ('deletion_cooling_off_days','7'::jsonb,      'Cancellable window before an account deletion executes.'),
  ('export_link_ttl_minutes',  '60'::jsonb,     'Lifetime of a single-use export download link.'),
  ('signed_url_ttl_seconds',   '300'::jsonb,    'Lifetime of a signed document URL.')
on conflict (key) do nothing;
