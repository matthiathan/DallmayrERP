create or replace function public.get_machine_model_button_map(p_model_key text)
returns table (
  profile_id uuid,
  model_key text,
  display_name text,
  button_count integer,
  button_number integer,
  selection_code text,
  product_id uuid,
  product_name text,
  product_active boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    mp.id,
    mp.model_key,
    mp.display_name,
    mp.button_count,
    mm.button_number,
    mm.selection_code,
    p.id,
    p.product_name,
    p.is_active
  from public.machine_model_profiles mp
  left join public.machine_model_button_mappings mm on mm.profile_id = mp.id
  left join public.products p on p.id = mm.product_id
  where lower(btrim(mp.model_key)) = lower(btrim(p_model_key))
  order by mm.button_number nulls last;
$$;

revoke all on function public.get_machine_model_button_map(text) from public, anon;
grant execute on function public.get_machine_model_button_map(text) to authenticated, service_role;

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

  return jsonb_build_object(
    'profile_id', v_profile_id,
    'model_key', p_model_key,
    'button_count', p_button_count,
    'mapping_count', v_mapping_count
  );
end;
$$;

revoke all on function public.save_machine_model_button_map(text,text,integer,jsonb) from public, anon;
grant execute on function public.save_machine_model_button_map(text,text,integer,jsonb) to authenticated, service_role;