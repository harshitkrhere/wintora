-- 0024_country_other.sql
-- Someone outside the United States and Canada can say so.
--
-- The sign-up form offered exactly two countries, so anyone elsewhere had to
-- pick one that was untrue, and their profile and cases were stamped with
-- it. 'OTHER' records the truth. Billing maps it to the US price list (USD)
-- at the price boundary; nothing else in the product keys on it.
--
-- Only the enum value is added here. Postgres forbids using a new enum value
-- in the transaction that adds it, so no row is written with it in this file.

alter type country_code add value if not exists 'OTHER';
