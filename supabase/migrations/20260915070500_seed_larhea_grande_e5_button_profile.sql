-- Rhea documents the laRhea V+ grande E5 configuration with 12 direct selections.
-- Do not create raw MDB selection codes here: physical selection numbers and raw
-- telemetry codes remain separate and are learned/assigned in the Products workspace.

insert into public.machine_model_profiles (model_key, display_name, button_count)
select 'LARHEA GRANDE E5', 'LARHEA GRANDE E5', 12
where not exists (
  select 1
  from public.machine_model_profiles existing
  where lower(btrim(existing.model_key)) = lower('LARHEA GRANDE E5')
);
