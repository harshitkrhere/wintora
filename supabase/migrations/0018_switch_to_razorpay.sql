-- ===========================================================================
-- 0018: Razorpay becomes the payment provider
--
-- Razorpay is a gateway, not a Merchant of Record. The operator is the legal
-- seller; see docs/BILLING.md. This migration:
--
--   1. makes 'razorpay' the default provider on every billing table, so a row
--      written without an explicit provider is attributed correctly;
--   2. marks the catalog rows as Razorpay's;
--   3. CLEARS every provider price and product id. They were Paddle's, and a
--      Paddle price id means nothing to Razorpay. resolvePriceId() fails
--      closed on a null id, so checkout refuses until `npm run razorpay:seed`
--      creates the Razorpay plans and writes their ids back.
--
-- Guarded: it refuses to run if any live subscription exists, because those
-- would be Paddle subscriptions that cannot be moved to Razorpay by SQL.
-- ===========================================================================

do $$
begin
  if exists (
    select 1 from public.subscriptions
    where status in ('CHECKOUT_PENDING','INCOMPLETE','TRIALING','ACTIVE',
                     'PAST_DUE','GRACE','PAUSED','CANCELED_PENDING_EXPIRY')
  ) then
    raise exception
      '0018: live subscriptions exist on the previous provider; they must be migrated or ended before switching (docs/BILLING.md)';
  end if;
end
$$;

alter table public.plans             alter column provider set default 'razorpay';
alter table public.billing_customers alter column provider set default 'razorpay';
alter table public.subscriptions     alter column provider set default 'razorpay';
alter table public.invoices          alter column provider set default 'razorpay';
alter table public.payments          alter column provider set default 'razorpay';
alter table public.refunds           alter column provider set default 'razorpay';

update public.plans
set provider = 'razorpay',
    provider_product_id = null;

-- Paddle's price ids are meaningless to Razorpay. Null, so checkout fails
-- closed until the Razorpay plans exist.
update public.plan_prices
set provider_price_id = null
where provider_price_id is not null;

comment on column public.plan_prices.provider_price_id is
  'The Razorpay plan id (plan_...) this price is sold under. Written by scripts/seed-razorpay.mjs. Null means not yet sellable.';

-- Customer mappings from the previous provider cannot be reused.
delete from public.billing_customers where provider <> 'razorpay';
