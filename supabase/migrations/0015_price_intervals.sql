-- ===========================================================================
-- 0015: billing interval on prices; annual prices; Essential repriced
--
-- The interval a customer is charged at is a property of the PRICE, not the
-- plan. "Plus" is one plan with four prices (USD/CAD x month/year), so plan
-- comparison, entitlements and the feature matrix never see the interval;
-- only checkout and display do. `plans.billing_interval` remains as the
-- legacy default and is no longer read when creating provider prices.
--
-- Essential moves from 9.99/12.99 to 14.99/19.99. This is done in place rather
-- than as a new plan version because, at the time of this migration, nothing
-- has been sold: no live subscription exists and no provider price has been
-- created for it. After launch a price change MUST be a new version (see
-- docs/BILLING.md section 1); this shortcut is only lawful while the
-- subscriptions table holds no live row, and the guard below enforces that.
--
-- The reasoning behind the numbers is in docs/PRICING.md.
-- ===========================================================================

-- Refuse to reprice in place while anyone holds a LIVE subscription. Terminal
-- rows (EXPIRED, REFUNDED, REVOKED) are history, not customers; a sandbox test
-- that was ended stays in the table and must not block this.
do $$
begin
  if exists (
    select 1 from public.subscriptions
    where status in ('CHECKOUT_PENDING','INCOMPLETE','TRIALING','ACTIVE',
                     'PAST_DUE','GRACE','PAUSED','CANCELED_PENDING_EXPIRY')
  ) then
    raise exception
      '0015: live subscriptions exist; Essential must be repriced as a new plan version, not in place (docs/BILLING.md section 1)';
  end if;
end
$$;

alter table public.plan_prices
  add column if not exists interval billing_interval not null default 'month';

comment on column public.plan_prices.interval is
  'The interval this price is charged at. The interval lives on the price, not the plan.';

-- One price per (plan, country, currency, interval). The old constraint keyed
-- on the first three only, which made an annual price impossible to store.
alter table public.plan_prices
  drop constraint if exists plan_prices_plan_id_country_currency_key;

alter table public.plan_prices
  add constraint plan_prices_plan_country_currency_interval_key
  unique (plan_id, country, currency, interval);

-- Prices. Explicit per country, currency and interval; no FX conversion and no
-- derived annual amount anywhere. Annual is roughly two months free; the exact
-- percentage is computed from these rows by annualSavingPercent(), never
-- hand-typed into copy.
insert into public.plan_prices (plan_id, currency, country, interval, amount_cents)
select p.id, v.currency, v.country::country_code, v.interval::billing_interval, v.amount_cents
from (values
  ('free',      'USD', 'US', 'month',     0),
  ('free',      'CAD', 'CA', 'month',     0),

  ('essential', 'USD', 'US', 'month',  1499),
  ('essential', 'USD', 'US', 'year',  14900),
  ('essential', 'CAD', 'CA', 'month',  1999),
  ('essential', 'CAD', 'CA', 'year',  19900),

  ('plus',      'USD', 'US', 'month',  1999),
  ('plus',      'USD', 'US', 'year',  19900),
  ('plus',      'CAD', 'CA', 'month',  2599),
  ('plus',      'CAD', 'CA', 'year',  25900),

  ('pro',       'USD', 'US', 'month',  2999),
  ('pro',       'USD', 'US', 'year',  29900),
  ('pro',       'CAD', 'CA', 'month',  3999),
  ('pro',       'CAD', 'CA', 'year',  39900)
) as v(slug, currency, country, interval, amount_cents)
join public.plans p on p.slug = v.slug and p.version = 1
on conflict (plan_id, country, currency, interval) do update set
  amount_cents = excluded.amount_cents,
  active = true;

-- A repriced row that already had a provider price would now advertise one
-- amount and charge another. Clear the id so checkout refuses (it fails closed
-- on a null provider_price_id) until the provider seed script creates a price
-- at the new amount. (0018 then clears every provider id anyway, because the
-- provider itself changes; this line keeps 0015 correct on its own.)
update public.plan_prices pp
set provider_price_id = null
from public.plans p
where pp.plan_id = p.id
  and p.slug = 'essential'
  and pp.interval = 'month';

-- Sanity: every paid plan has both intervals in both countries.
do $$
declare
  missing integer;
begin
  select count(*) into missing
  from public.plans p
  cross join (values ('US'::country_code, 'month'::billing_interval),
                     ('US'::country_code, 'year'::billing_interval),
                     ('CA'::country_code, 'month'::billing_interval),
                     ('CA'::country_code, 'year'::billing_interval)) as need(country, interval)
  left join public.plan_prices pp
    on pp.plan_id = p.id and pp.country = need.country and pp.interval = need.interval and pp.active
  where p.is_free = false and p.active and pp.id is null;

  if missing > 0 then
    raise exception '0015: % paid price row(s) missing after seed', missing;
  end if;
end
$$;
