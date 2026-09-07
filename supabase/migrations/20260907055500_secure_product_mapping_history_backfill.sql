grant usage on schema private to service_role;

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
  if not v_is_service_role and (auth.uid() is null or public.current_app_role() is null) then
    raise exception 'A provisioned DallmayrERP user is required.' using errcode = '42501';
  end if;

  update public.telemetry_daily_item_sales s
  set product_name = p.product_name
  from public.machines m,
       public.machine_model_profiles mp,
       public.machine_model_button_mappings mm,
       public.products p
  where mp.id = p_profile_id
    and mm.profile_id = mp.id
    and p.id = mm.product_id
    and m.id = s.machine_id
    and lower(btrim(coalesce(nullif(m.model, ''), nullif(m.machine_name, '')))) = lower(btrim(mp.model_key))
    and lower(btrim(s.selection_code)) = lower(btrim(mm.selection_code))
    and s.product_name is distinct from p.product_name;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.refresh_product_mapping_sales(uuid) from public, anon;
grant execute on function private.refresh_product_mapping_sales(uuid) to authenticated, service_role;

create or replace function public.save_machine_model_button_map(
  p_model_key text,
  p_display_name text,
  p_button_count integer,
  p_mappings jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_item jsonb;
  v_button_number integer;
  v_selection_code text;
  v_product_id uuid;
  v_mapping_count integer := 0;
  v_refreshed_sales integer := 0;
begin
  if public.current_app_role() is null then
    raise exception 'A provisioned DallmayrERP user is required.' using errcode = '42501';
  end if;

  p_model_key := btrim(coalesce(p_model_key, ''));
  p_display_name := btrim(coalesce(p_display_name, ''));

  if p_model_key = '' then raise exception 'Machine model is required.'; end if;
  if p_display_name = '' then p_display_name := p_model_key; end if;
  if p_button_count is null or p_button_count < 1 or p_button_count > 100 then
    raise exception 'Button count must be between 1 and 100.';
  end if;
  if jsonb_typeof(coalesce(p_mappings, '[]'::jsonb)) <> 'array' then
    raise exception 'Mappings must be a JSON array.';
  end if;

  select id into v_profile_id
  from public.machine_model_profiles
  where lower(btrim(model_key)) = lower(p_model_key)
  limit 1;

  if v_profile_id is null then
    insert into public.machine_model_profiles (model_key, display_name, button_count)
    values (p_model_key, p_display_name, p_button_count)
    returning id into v_profile_id;
  else
    update public.machine_model_profiles
    set model_key = p_model_key, display_name = p_display_name, button_count = p_button_count
    where id = v_profile_id;
  end if;

  delete from public.machine_model_button_mappings where profile_id = v_profile_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_mappings, '[]'::jsonb))
  loop
    v_button_number := nullif(v_item ->> 'button_number', '')::integer;
    v_selection_code := btrim(coalesce(v_item ->> 'selection_code', ''));
    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;

    if v_button_number is null or v_button_number < 1 or v_button_number > p_button_count then
      raise exception 'Each mapped button must be between 1 and the configured button count.';
    end if;
    if v_selection_code = '' then raise exception 'Each mapped button requires a telemetry selection code.'; end if;
    if v_product_id is null or not exists (select 1 from public.products where id = v_product_id) then
      raise exception 'Each mapped button requires a valid product.';
    end if;

    insert into public.machine_model_button_mappings (profile_id, button_number, selection_code, product_id)
    values (v_profile_id, v_button_number, v_selection_code, v_product_id);
    v_mapping_count := v_mapping_count + 1;
  end loop;

  v_refreshed_sales := private.refresh_product_mapping_sales(v_profile_id);

  return jsonb_build_object(
    'profile_id', v_profile_id,
    'model_key', p_model_key,
    'button_count', p_button_count,
    'mapping_count', v_mapping_count,
    'refreshed_sales_rows', v_refreshed_sales
  );
end;
$$;

create or replace function public.refresh_product_sales_after_product_rename()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if new.product_name is not distinct from old.product_name then return new; end if;

  for v_profile_id in
    select distinct profile_id from public.machine_model_button_mappings where product_id = new.id
  loop
    perform private.refresh_product_mapping_sales(v_profile_id);
  end loop;
  return new;
end;
$$;

drop function if exists public.refresh_product_mapping_sales(uuid);