-- ===========================================================================
-- 0016: seed profiles.country from the sign-up form
--
-- The sign-up route passes the chosen country in auth metadata
-- (`raw_user_meta_data.country`), and the profile trigger ignored it, so every
-- profile was 'US'. Checkout resolves the price from profiles.country, which
-- meant a Canadian who was shown CA$25.99 would have been charged 19.99 USD.
-- See docs/CHECKOUT_AUDIT.md, "Every Canadian customer is charged in USD".
--
-- Only the two supported values are accepted; anything else falls back to the
-- column default. Metadata is customer-supplied and is treated as such.
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country country_code := 'US';
  v_raw text := new.raw_user_meta_data ->> 'country';
begin
  if v_raw in ('US', 'CA') then
    v_country := v_raw::country_code;
  end if;

  insert into public.profiles (id, country)
  values (new.id, v_country)
  on conflict (id) do nothing;

  insert into public.entitlement_versions (user_id, version)
  values (new.id, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Repair profiles created before this migration whose sign-up metadata
-- recorded a country the profile never received. Only rows still at the
-- default are touched, so a country a customer has since changed is kept.
update public.profiles p
set country = (u.raw_user_meta_data ->> 'country')::country_code
from auth.users u
where u.id = p.id
  and p.country = 'US'
  and (u.raw_user_meta_data ->> 'country') = 'CA';
