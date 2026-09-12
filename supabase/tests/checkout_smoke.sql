-- Did a real checkout actually grant what it should?
--
--   supabase db query --linked --file supabase/tests/checkout_smoke.sql
--
-- Run after completing a sandbox purchase. Read the rows top to bottom: the
-- first step reporting a problem is where the chain broke.
--
-- Deliberately ONE statement. `supabase db query` returns only the final result
-- set in a multi-statement file, which silently hides every earlier section and
-- makes an empty table look identical to a table that was never queried.

with
webhooks as (
  select event_type, status, count(*) as n, max(received_at) as latest
  from public.webhook_events
  group by event_type, status
),
subs as (
  select s.status, p.slug as plan, s.currency, s.amount_cents,
         s.current_period_end, s.updated_at
  from public.subscriptions s
  left join public.plans p on p.id = s.plan_id
),
ents as (
  select e.user_id, count(*) filter (where e.enabled) as enabled_features,
         max(e.version) as version, max(e.updated_at) as updated_at
  from public.user_entitlements e
  group by e.user_id
)

-- 1. Webhook deliveries. PROCESSED is a handled event; IGNORED is an event we
--    deliberately do not act on, which is healthy. FAILED means it arrived and
--    the handler threw, and is the one to worry about.
select 1 as step, 'webhook' as item,
       event_type || ' -> ' || status as detail,
       n::text as count, latest::text as at
from webhooks

union all
-- 2. Razorpay customer linked to the account, written before payment.
select 2, 'customer',
       provider || ' ' || provider_customer_id, '1', created_at::text
from public.billing_customers

union all
-- 3. The row that grants access. Must reach ACTIVE or TRIALING.
select 3, 'subscription',
       status || ' ' || coalesce(plan, '?') || ' ' ||
       coalesce(currency, '') || ' ' || coalesce(amount_cents::text, ''),
       coalesce(current_period_end::text, 'no period'), updated_at::text
from subs

union all
-- 4. Entitlements, recomputed from the subscription. A paid account has many
--    enabled features; a free one has few. Zero rows means recompute never ran.
select 4, 'entitlements',
       'user ' || left(user_id::text, 8) || ' v' || version,
       enabled_features::text, updated_at::text
from ents

union all
-- 5. A single verdict line, so the answer is readable without interpreting the
--    rows above.
select 5, 'VERDICT',
  case
    when not exists (select 1 from public.webhook_events)
      then 'No webhook has ever arrived. Check the Razorpay webhook URL and secret.'
    when exists (select 1 from public.webhook_events where status = 'FAILED')
      then 'A webhook arrived and the handler FAILED. See error_class in webhook_events.'
    when not exists (select 1 from subs)
      then 'Webhooks arrive but no subscription row exists. Either payment is not complete, or no subscription.* event was handled.'
    when exists (select 1 from subs where status in ('ACTIVE','TRIALING'))
      then 'Chain complete: subscription is live and entitlements should be granted.'
    else 'Subscription row exists but is not ACTIVE or TRIALING.'
  end,
  '', ''

order by 1, 2, 3;
