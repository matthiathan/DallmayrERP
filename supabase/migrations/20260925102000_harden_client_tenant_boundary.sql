-- Harden client tenancy so a client account never satisfies legacy internal-staff policies.
-- The UI still reads user_details.role = client_viewer, but database staff-role checks
-- deliberately resolve NULL for client accounts.

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.role
  from public.users u
  join public.user_details d on d.user_id = u.id
  where u.auth_user_id = (select auth.uid())
    and u.is_active = true
    and u.account_scope = 'dallmayr'
  limit 1;
$$;

-- Restrictive tenant policies narrow rows. These permissive policies provide the
-- minimum read grant a client needs for the machine dashboards while the existing
-- restrictive region/customer policies remain authoritative.
drop policy if exists client_customer_read on public.customers;
create policy client_customer_read on public.customers
  for select to authenticated
  using (public.is_client_app_user() and id = public.current_app_customer_id());

drop policy if exists client_customer_site_read on public.customer_sites;
create policy client_customer_site_read on public.customer_sites
  for select to authenticated
  using (public.is_client_app_user() and customer_id = public.current_app_customer_id());

drop policy if exists client_machine_read on public.machines;
create policy client_machine_read on public.machines
  for select to authenticated
  using (public.is_client_app_user() and public.telemetry_account_allows_machine(id));

drop policy if exists client_counter_state_read on public.telemetry_counter_state;
create policy client_counter_state_read on public.telemetry_counter_state
  for select to authenticated
  using (public.is_client_app_user() and public.telemetry_account_allows_device(device_id));

drop policy if exists client_daily_sales_read on public.telemetry_daily_item_sales;
create policy client_daily_sales_read on public.telemetry_daily_item_sales
  for select to authenticated
  using (public.is_client_app_user() and public.telemetry_account_allows_device(device_id));

-- Machine profile internals are Dallmayr implementation detail. The machine detail
-- page only needs the RPC call to remain structurally valid; clients receive no
-- decoder/profile catalogue, fingerprint or recommendation payload.
create or replace function public.get_telemetry_machine_identity(p_machine_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    perform public.assert_telemetry_region_selected();
    if not public.telemetry_region_allows_machine(p_machine_id) then
      raise exception 'Machine not found in your telemetry region.' using errcode='42501';
    end if;
  end if;

  v_result := public.get_telemetry_machine_identity_region_unscoped(p_machine_id);

  if coalesce(auth.jwt()->>'role','') <> 'service_role'
     and public.is_client_app_user() then
    return jsonb_build_object('effective_profile_key', null);
  end if;

  return v_result;
end;
$$;

revoke all on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated, service_role;
