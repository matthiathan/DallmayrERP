-- Seed verified physical selection counts without overwriting profiles that operators
-- have already configured in DallmayrERP. Raw MDB selection codes are intentionally
-- not pre-populated: an MDB code is not guaranteed to equal the physical button number.

insert into public.machine_model_profiles (model_key, display_name, button_count)
select seed.model_key, seed.display_name, seed.button_count
from (
  values
    ('SIELAFF BELLUNO', 'SIELAFF BELLUNO', 14),
    ('SIELAFF BELLUNO PRO', 'SIELAFF BELLUNO PRO', 14),
    ('RHEAVENDORS XS GRANDE E5 PRO', 'RHEAVENDORS XS GRANDE E5 PRO', 10),
    ('RHEAVENDORS XS GRANDE I6 INSTANT', 'RHEAVENDORS XS GRANDE I6 INSTANT', 10),
    ('RHEAVENDORS XX MICRO', 'RHEAVENDORS XX MICRO', 6)
) as seed(model_key, display_name, button_count)
where not exists (
  select 1
  from public.machine_model_profiles existing
  where lower(btrim(existing.model_key)) = lower(btrim(seed.model_key))
);
