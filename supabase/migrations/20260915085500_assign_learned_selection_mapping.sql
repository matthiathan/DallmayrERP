create or replace function public.assign_learned_selection_mapping(
  p_model_key text,
  p_slot_number integer,
  p_selection_code text,
  p_product_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_profile public.machine_model_profiles%rowtype;
  v_model_key text := trim(coalesce(p_model_key, ''));
  v_selection text := trim(coalesce(p_selection_code, ''));
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.is_active_app_user() then
    raise exception 'An active authenticated DallmayrERP user is required.' using errcode = '42501';
  end if;
  if v_model_key = '' then raise exception 'Machine model is required' using errcode = '22023'; end if;
  if p_slot_number < 1 or p_slot_number > 100 then raise exception 'Selection slot must be between 1 and 100' using errcode = '22023'; end if;
  if v_selection = '' then raise exception 'Selection code is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.products where id = p_product_id and is_active) then
    raise exception 'An active product is required' using errcode = '22023';
  end if;

  select * into v_profile
  from public.machine_model_profiles
  where lower(trim(model_key)) = lower(v_model_key)
  for update;

  if not found then
    insert into public.machine_model_profiles (model_key, display_name, button_count)
    values (v_model_key, v_model_key, p_slot_number)
    returning * into v_profile;
  elsif v_profile.button_count < p_slot_number then
    update public.machine_model_profiles
    set button_count = p_slot_number,
        updated_at = now()
    where id = v_profile.id
    returning * into v_profile;
  end if;

  if exists (
    select 1 from public.machine_model_button_mappings
    where profile_id = v_profile.id
      and lower(trim(selection_code)) = lower(v_selection)
      and button_number <> p_slot_number
  ) then
    raise exception 'Selection code is already assigned to another slot in this machine profile' using errcode = '22023';
  end if;

  insert into public.machine_model_button_mappings (profile_id, button_number, selection_code, product_id)
  values (v_profile.id, p_slot_number, v_selection, p_product_id)
  on conflict (profile_id, button_number)
  do update set selection_code = excluded.selection_code,
                product_id = excluded.product_id,
                updated_at = now();

  perform private.refresh_product_mapping_sales(v_profile.model_key, null);

  return jsonb_build_object(
    'accepted', true,
    'model_key', v_profile.model_key,
    'slot_number', p_slot_number,
    'selection_code', v_selection,
    'product_id', p_product_id
  );
end;
$function$;

revoke all on function public.assign_learned_selection_mapping(text, integer, text, uuid) from public, anon;
grant execute on function public.assign_learned_selection_mapping(text, integer, text, uuid) to authenticated, service_role;
