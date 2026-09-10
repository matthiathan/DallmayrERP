create or replace function public.resolve_effective_telemetry_profile_key(
  p_device_id uuid,
  p_machine_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with chosen_device as (
    select d.*
    from public.telemetry_devices d
    where d.id = p_device_id
       or (p_device_id is null and p_machine_id is not null and d.machine_id = p_machine_id)
    order by (d.id = p_device_id) desc, (d.status = 'active') desc, d.updated_at desc
    limit 1
  ), chosen_machine as (
    select m.*
    from public.machines m
    where m.id = coalesce(p_machine_id, (select machine_id from chosen_device))
    limit 1
  )
  select coalesce(
    case
      when coalesce((select profile_assignment_method from chosen_device), 'automatic') = 'manual'
      then nullif(btrim((select profile_id from chosen_device)), '')
    end,
    nullif(btrim((select applied_config ->> 'profile_id' from chosen_device)), ''),
    (
      select mp.model_key
      from public.machine_model_profiles mp
      where regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(coalesce((select reported_machine_model from chosen_device), '')), '[^a-z0-9]+', '', 'g')
        and btrim(coalesce((select reported_machine_model from chosen_device), '')) <> ''
      limit 1
    ),
    (
      select mp.model_key
      from public.machine_model_profiles mp
      where regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(coalesce((select model from chosen_machine), (select machine_name from chosen_machine), '')), '[^a-z0-9]+', '', 'g')
        and btrim(coalesce((select model from chosen_machine), (select machine_name from chosen_machine), '')) <> ''
      limit 1
    )
  );
$$;

revoke all on function public.resolve_effective_telemetry_profile_key(uuid,uuid) from public, anon;
grant execute on function public.resolve_effective_telemetry_profile_key(uuid,uuid) to authenticated, service_role;

create or replace function public.resolve_mapped_product_name(
  p_machine_id uuid,
  p_device_id uuid,
  p_selection_code text
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.product_name
  from public.machine_model_profiles mp
  join public.machine_model_button_mappings mm
    on mm.profile_id = mp.id
   and lower(btrim(mm.selection_code)) = lower(btrim(p_selection_code))
  join public.products p on p.id = mm.product_id
  where lower(btrim(mp.model_key)) = lower(btrim(coalesce(
    public.resolve_effective_telemetry_profile_key(p_device_id, p_machine_id),
    ''
  )))
  limit 1;
$$;

revoke all on function public.resolve_mapped_product_name(uuid,uuid,text) from public, anon;
grant execute on function public.resolve_mapped_product_name(uuid,uuid,text) to authenticated, service_role;

create or replace function public.resolve_mapped_product_name(
  p_machine_id uuid,
  p_selection_code text
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.resolve_mapped_product_name(p_machine_id, null::uuid, p_selection_code);
$$;

revoke all on function public.resolve_mapped_product_name(uuid,text) from public, anon;
grant execute on function public.resolve_mapped_product_name(uuid,text) to authenticated, service_role;

create or replace function public.apply_mapped_product_name_to_telemetry_sale()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_name text;
begin
  if new.machine_id is null or btrim(coalesce(new.selection_code, '')) = '' then
    return new;
  end if;

  v_product_name := public.resolve_mapped_product_name(new.machine_id, new.device_id, new.selection_code);
  if v_product_name is not null then
    new.product_name := v_product_name;
  end if;
  return new;
end;
$$;

revoke all on function public.apply_mapped_product_name_to_telemetry_sale() from public, anon, authenticated;

drop trigger if exists telemetry_daily_item_sales_apply_product_mapping on public.telemetry_daily_item_sales;
create trigger telemetry_daily_item_sales_apply_product_mapping
before insert or update of machine_id, device_id, selection_code on public.telemetry_daily_item_sales
for each row execute function public.apply_mapped_product_name_to_telemetry_sale();

create or replace function private.refresh_product_mapping_sales(p_profile_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if not v_is_service_role and not public.is_active_app_user() then
    raise exception 'An active authenticated DallmayrERP user is required.' using errcode = '42501';
  end if;

  update public.telemetry_daily_item_sales s
  set product_name = p.product_name
  from public.machine_model_profiles mp,
       public.machine_model_button_mappings mm,
       public.products p
  where mp.id = p_profile_id
    and mm.profile_id = mp.id
    and p.id = mm.product_id
    and lower(btrim(coalesce(public.resolve_effective_telemetry_profile_key(s.device_id, s.machine_id), ''))) = lower(btrim(mp.model_key))
    and lower(btrim(s.selection_code)) = lower(btrim(mm.selection_code))
    and s.product_name is distinct from p.product_name;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.refresh_product_mapping_sales(uuid) from public, anon;
grant execute on function private.refresh_product_mapping_sales(uuid) to authenticated, service_role;
