create or replace function public.resolve_mapped_product_name(
  p_machine_id uuid,
  p_selection_code text
)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select p.product_name
  from public.machines m
  join public.machine_model_profiles mp
    on lower(btrim(mp.model_key)) = lower(btrim(coalesce(nullif(m.model, ''), nullif(m.machine_name, ''))))
  join public.machine_model_button_mappings mm
    on mm.profile_id = mp.id
   and lower(btrim(mm.selection_code)) = lower(btrim(p_selection_code))
  join public.products p on p.id = mm.product_id
  where m.id = p_machine_id
  limit 1;
$$;

revoke all on function public.resolve_mapped_product_name(uuid,text) from public, anon;
grant execute on function public.resolve_mapped_product_name(uuid,text) to authenticated, service_role;

create or replace function public.apply_mapped_product_name_to_telemetry_sale()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_product_name text;
begin
  if new.machine_id is null or btrim(coalesce(new.selection_code, '')) = '' then
    return new;
  end if;

  v_product_name := public.resolve_mapped_product_name(new.machine_id, new.selection_code);
  if v_product_name is not null then
    new.product_name := v_product_name;
  end if;
  return new;
end;
$$;

revoke all on function public.apply_mapped_product_name_to_telemetry_sale() from public, anon;
grant execute on function public.apply_mapped_product_name_to_telemetry_sale() to authenticated, service_role;

drop trigger if exists telemetry_daily_item_sales_apply_product_mapping on public.telemetry_daily_item_sales;
create trigger telemetry_daily_item_sales_apply_product_mapping
before insert or update of machine_id, selection_code on public.telemetry_daily_item_sales
for each row execute function public.apply_mapped_product_name_to_telemetry_sale();

create or replace function public.refresh_product_mapping_sales(p_profile_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := 0;
begin
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

revoke all on function public.refresh_product_mapping_sales(uuid) from public, anon;
grant execute on function public.refresh_product_mapping_sales(uuid) to authenticated, service_role;

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

  if p_model_key = '' then
    raise exception 'Machine model is required.';
  end if;
  if p_display_name = '' then
    p_display_name := p_model_key;
  end if;
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
    set model_key = p_model_key,
        display_name = p_display_name,
        button_count = p_button_count
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
    if v_selection_code = '' then
      raise exception 'Each mapped button requires a telemetry selection code.';
    end if;
    if v_product_id is null or not exists (select 1 from public.products where id = v_product_id) then
      raise exception 'Each mapped button requires a valid product.';
    end if;

    insert into public.machine_model_button_mappings (profile_id, button_number, selection_code, product_id)
    values (v_profile_id, v_button_number, v_selection_code, v_product_id);
    v_mapping_count := v_mapping_count + 1;
  end loop;

  v_refreshed_sales := public.refresh_product_mapping_sales(v_profile_id);

  return jsonb_build_object(
    'profile_id', v_profile_id,
    'model_key', p_model_key,
    'button_count', p_button_count,
    'mapping_count', v_mapping_count,
    'refreshed_sales_rows', v_refreshed_sales
  );
end;
$$;

revoke all on function public.save_machine_model_button_map(text,text,integer,jsonb) from public, anon;
grant execute on function public.save_machine_model_button_map(text,text,integer,jsonb) to authenticated, service_role;

create or replace function public.refresh_product_sales_after_product_rename()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if new.product_name is not distinct from old.product_name then
    return new;
  end if;

  for v_profile_id in
    select distinct profile_id
    from public.machine_model_button_mappings
    where product_id = new.id
  loop
    perform public.refresh_product_mapping_sales(v_profile_id);
  end loop;
  return new;
end;
$$;

revoke all on function public.refresh_product_sales_after_product_rename() from public, anon;
grant execute on function public.refresh_product_sales_after_product_rename() to authenticated, service_role;

drop trigger if exists products_refresh_mapped_sales_after_rename on public.products;
create trigger products_refresh_mapped_sales_after_rename
after update of product_name on public.products
for each row execute function public.refresh_product_sales_after_product_rename();