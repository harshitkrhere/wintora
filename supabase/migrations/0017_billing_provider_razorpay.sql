-- ===========================================================================
-- 0017: add 'razorpay' to billing_provider
--
-- Postgres cannot use a freshly added enum value inside the transaction that
-- added it, so this migration does one thing. 0018 switches the defaults and
-- clears the previous provider's identifiers.
--
-- The earlier values ('stripe', 'apple', 'google', 'paddle') stay: an enum
-- value cannot be dropped in place, no code path writes them, and the rows
-- that carry them (webhook_events from the Paddle period) are history worth
-- keeping.
-- ===========================================================================

alter type public.billing_provider add value if not exists 'razorpay';
