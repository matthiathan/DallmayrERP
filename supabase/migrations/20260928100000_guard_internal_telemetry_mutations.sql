-- Keep existing telemetry mutation behavior intact behind private implementations,
-- while enforcing the client-viewer read-only boundary at the public RPC layer.

-- Move existing SECURITY DEFINER implementations out of the exposed public API schema.
alter function public.delete_telemetry_device(uuid, text) set schema private;
alter function private.delete_telemetry_device(uuid, text) rename to delete_telemetry_device_internal_v1;
revoke execute on function private.delete_telemetry_device_internal_v1(uuid, text) from public, anon, authenticated;
grant execute on function private.delete_telemetry_device_internal_v1(uuid, text) to service_role;

alter function public.save_telemetry_device_configuration(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) set schema private;
alter function private.save_telemetry_device_configuration(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) rename to save_telemetry_device_configuration_internal_v1;
revoke execute on function private.save_telemetry_device_configuration_internal_v1(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function private.save_telemetry_device_configuration_internal_v1(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) to service_role;

alter function public.set_telemetry_device_profile(uuid, text, text) set schema private;
alter function private.set_telemetry_device_profile(uuid, text, text) rename to set_telemetry_device_profile_internal_v1;
revoke execute on function private.set_telemetry_device_profile_internal_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function private.set_telemetry_device_profile_internal_v1(uuid, text, text) to service_role;

alter function public.assign_learned_selection_mapping(text, integer, text, uuid) set schema private;
alter function private.assign_learned_selection_mapping(text, integer, text, uuid) rename to assign_learned_selection_mapping_internal_v1;
revoke execute on function private.assign_learned_selection_mapping_internal_v1(text, integer, text, uuid) from public, anon, authenticated;
grant execute on function private.assign_learned_selection_mapping_internal_v1(text, integer, text, uuid) to service_role;

alter function public.copy_machine_model_profile_mappings(text, text) set schema private;
alter function private.copy_machine_model_profile_mappings(text, text) rename to copy_machine_model_profile_mappings_internal_v1;
revoke execute on function private.copy_machine_model_profile_mappings_internal_v1(text, text) from public, anon, authenticated;
grant execute on function private.copy_machine_model_profile_mappings_internal_v1(text, text) to service_role;

create or replace function public.delete_telemetry_device(
  p_device_id uuid,
  p_device_code text
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if not public.is_active_app_user() or not public.is_dallmayr_app_user() then
      raise exception 'An active internal Dallmayr account is required.' using errcode = '42501';
    end if;
  end if;
  return private.delete_telemetry_device_internal_v1(p_device_id, p_device_code);
end;
$function$;
revoke execute on function public.delete_telemetry_device(uuid, text) from public, anon;
grant execute on function public.delete_telemetry_device(uuid, text) to authenticated, service_role;

create or replace function public.save_telemetry_device_configuration(
  p_device_id uuid,
  p_device_code text,
  p_machine_id uuid default null,
  p_status text default 'active',
  p_mode text default 'live',
  p_transport_preference text default 'auto',
  p_wifi_enabled boolean default true,
  p_cellular_enabled boolean default true,
  p_mdb_master_polarity text default 'auto',
  p_mdb_slave_polarity text default 'auto',
  p_mdb_pin_swap boolean default false,
  p_location_enabled boolean default true,
  p_location_override text default null,
  p_location_interval_minutes integer default 15,
  p_location_min_move_m integer default 50,
  p_warning_megabytes integer default 100,
  p_critical_megabytes integer default 25,
  p_balance_check_interval_minutes integer default 360,
  p_balance_stale_after_minutes integer default 720
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if not public.is_active_app_user() or not public.is_dallmayr_app_user() then
      raise exception 'An active internal Dallmayr account is required.' using errcode = '42501';
    end if;
  end if;
  return private.save_telemetry_device_configuration_internal_v1(
    p_device_id,
    p_device_code,
    p_machine_id,
    p_status,
    p_mode,
    p_transport_preference,
    p_wifi_enabled,
    p_cellular_enabled,
    p_mdb_master_polarity,
    p_mdb_slave_polarity,
    p_mdb_pin_swap,
    p_location_enabled,
    p_location_override,
    p_location_interval_minutes,
    p_location_min_move_m,
    p_warning_megabytes,
    p_critical_megabytes,
    p_balance_check_interval_minutes,
    p_balance_stale_after_minutes
  );
end;
$function$;
revoke execute on function public.save_telemetry_device_configuration(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.save_telemetry_device_configuration(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) to authenticated, service_role;

create or replace function public.set_telemetry_device_profile(
  p_device_id uuid,
  p_profile_key text default null,
  p_assignment_method text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if not public.is_active_app_user() or not public.is_dallmayr_app_user() then
      raise exception 'An active internal Dallmayr account is required.' using errcode = '42501';
    end if;
  end if;
  return private.set_telemetry_device_profile_internal_v1(p_device_id, p_profile_key, p_assignment_method);
end;
$function$;
revoke execute on function public.set_telemetry_device_profile(uuid, text, text) from public, anon;
grant execute on function public.set_telemetry_device_profile(uuid, text, text) to authenticated, service_role;

create or replace function public.assign_learned_selection_mapping(
  p_model_key text,
  p_slot_number integer,
  p_selection_code text,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if not public.is_active_app_user() or not public.is_dallmayr_app_user() then
      raise exception 'An active internal Dallmayr account is required.' using errcode = '42501';
    end if;
  end if;
  return private.assign_learned_selection_mapping_internal_v1(p_model_key, p_slot_number, p_selection_code, p_product_id);
end;
$function$;
revoke execute on function public.assign_learned_selection_mapping(text, integer, text, uuid) from public, anon;
grant execute on function public.assign_learned_selection_mapping(text, integer, text, uuid) to authenticated, service_role;

create or replace function public.copy_machine_model_profile_mappings(
  p_source_model_key text,
  p_target_model_key text
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if not public.is_active_app_user() or not public.is_dallmayr_app_user() then
      raise exception 'An active internal Dallmayr account is required.' using errcode = '42501';
    end if;
  end if;
  return private.copy_machine_model_profile_mappings_internal_v1(p_source_model_key, p_target_model_key);
end;
$function$;
revoke execute on function public.copy_machine_model_profile_mappings(text, text) from public, anon;
grant execute on function public.copy_machine_model_profile_mappings(text, text) to authenticated, service_role;
