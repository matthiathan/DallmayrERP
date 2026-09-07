drop policy if exists products_internal_read on public.products;
drop policy if exists products_internal_write on public.products;
create policy products_internal_access
  on public.products for all to authenticated
  using (public.current_app_role() is not null)
  with check (public.current_app_role() is not null);

drop policy if exists machine_model_profiles_internal_read on public.machine_model_profiles;
drop policy if exists machine_model_profiles_internal_write on public.machine_model_profiles;
create policy machine_model_profiles_internal_access
  on public.machine_model_profiles for all to authenticated
  using (public.current_app_role() is not null)
  with check (public.current_app_role() is not null);

drop policy if exists machine_model_button_mappings_internal_read on public.machine_model_button_mappings;
drop policy if exists machine_model_button_mappings_internal_write on public.machine_model_button_mappings;
create policy machine_model_button_mappings_internal_access
  on public.machine_model_button_mappings for all to authenticated
  using (public.current_app_role() is not null)
  with check (public.current_app_role() is not null);