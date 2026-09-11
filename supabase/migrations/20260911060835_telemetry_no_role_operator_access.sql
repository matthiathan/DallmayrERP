create or replace function public.open_telemetry_enrollment_window(
  p_minutes integer default 10,
  p_max_devices integer default 1,
  p_label text default null,
  p_expected_hardware_uid text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window public.telemetry_enrollment_windows%rowtype;
  v_expected_uid text := nullif(upper(trim(coalesce(p_expected_hardware_uid, ''))), '');
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then
    raise exception 'Enrollment window duration must be between 1 and 60 minutes' using errcode = '22023';
  end if;
  if p_max_devices is null or p_max_devices < 1 or p_max_devices > 100 then
    raise exception 'Enrollment window device count must be between 1 and 100' using errcode = '22023';
  end if;
  if v_expected_uid is not null and v_expected_uid !~ '^[0-9A-F]{12}$' then
    raise exception 'Expected hardware UID must contain exactly 12 hexadecimal characters' using errcode = '22023';
  end if;
  if v_expected_uid is not null and p_max_devices <> 1 then
    raise exception 'A hardware-locked window can enroll exactly one device' using errcode = '22023';
  end if;

  update public.telemetry_enrollment_windows
  set status = 'expired', closed_at = coalesce(closed_at, now())
  where status = 'open' and expires_at <= now();
  update public.telemetry_enrollment_windows
  set status = 'cancelled', closed_at = now()
  where status = 'open';

  insert into public.telemetry_enrollment_windows (
    label, status, expected_hardware_uid, max_claims, claimed_count,
    opened_by_auth_user_id, opened_at, expires_at
  ) values (
    nullif(trim(coalesce(p_label, '')), ''), 'open', v_expected_uid,
    p_max_devices, 0, auth.uid(), now(), now() + make_interval(mins => p_minutes)
  ) returning * into v_window;

  return jsonb_build_object(
    'active', true, 'window_id', v_window.id, 'status', v_window.status,
    'label', v_window.label, 'expected_hardware_uid', v_window.expected_hardware_uid,
    'max_devices', v_window.max_claims, 'claimed_devices', v_window.claimed_count,
    'opened_at', v_window.opened_at, 'expires_at', v_window.expires_at
  );
end;
$$;

create or replace function public.close_telemetry_enrollment_window()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_window_id uuid;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  update public.telemetry_enrollment_windows
  set status = case when expires_at <= now() then 'expired' else 'cancelled' end,
      closed_at = coalesce(closed_at, now())
  where status = 'open'
  returning id into v_window_id;
  return jsonb_build_object('active', false, 'closed', v_window_id is not null, 'window_id', v_window_id);
end;
$$;

create or replace function public.get_telemetry_enrollment_window_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_window public.telemetry_enrollment_windows%rowtype;
  v_effective_status text;
  v_active boolean;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  select * into v_window from public.telemetry_enrollment_windows order by created_at desc limit 1;
  if not found then return jsonb_build_object('active', false, 'status', 'none'); end if;
  v_active := v_window.status = 'open' and v_window.expires_at > now() and v_window.claimed_count < v_window.max_claims;
  v_effective_status := case when v_window.status = 'open' and v_window.expires_at <= now() then 'expired' else v_window.status end;
  return jsonb_build_object(
    'active', v_active, 'window_id', v_window.id, 'status', v_effective_status,
    'label', v_window.label, 'expected_hardware_uid', v_window.expected_hardware_uid,
    'max_devices', v_window.max_claims, 'claimed_devices', v_window.claimed_count,
    'opened_at', v_window.opened_at, 'expires_at', v_window.expires_at,
    'seconds_remaining', case when v_active then greatest(floor(extract(epoch from (v_window.expires_at - now())))::integer, 0) else 0 end
  );
end;
$$;

create or replace function public.create_telemetry_enrollment_token(
  p_hardware_uid text,
  p_token_hash text,
  p_minutes integer default 10,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hardware_uid text := upper(trim(coalesce(p_hardware_uid, '')));
  v_token_hash text := lower(trim(coalesce(p_token_hash, '')));
  v_token public.telemetry_enrollment_tokens%rowtype;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  if v_hardware_uid !~ '^[0-9A-F]{12}$' then raise exception 'Hardware UID must contain exactly 12 hexadecimal characters' using errcode = '22023'; end if;
  if v_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Enrollment token hash must be a SHA-256 hexadecimal digest' using errcode = '22023'; end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then raise exception 'Enrollment token duration must be between 1 and 60 minutes' using errcode = '22023'; end if;
  if exists (select 1 from public.telemetry_devices where hardware_uid = v_hardware_uid) then
    raise exception 'This ESP32 hardware UID is already enrolled' using errcode = '23505';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_hardware_uid, 0));
  update public.telemetry_enrollment_windows
  set status = case when expires_at <= now() then 'expired' else 'cancelled' end,
      closed_at = coalesce(closed_at, now())
  where status = 'open';
  update public.telemetry_enrollment_tokens
  set revoked_at = now()
  where expected_hardware_uid = v_hardware_uid and used_at is null and revoked_at is null;
  insert into public.telemetry_enrollment_tokens (
    token_hash, label, expected_hardware_uid, expires_at, created_by_auth_user_id
  ) values (
    v_token_hash, nullif(trim(coalesce(p_label, '')), ''), v_hardware_uid,
    now() + make_interval(mins => p_minutes), auth.uid()
  ) returning * into v_token;
  return jsonb_build_object(
    'token_id', v_token.id, 'hardware_uid', v_token.expected_hardware_uid,
    'expires_at', v_token.expires_at,
    'seconds_remaining', greatest(floor(extract(epoch from (v_token.expires_at - now())))::integer, 0)
  );
end;
$$;

create or replace function public.get_telemetry_enrollment_token_status(p_token_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.telemetry_enrollment_tokens%rowtype;
  v_status text;
begin
  if not public.is_active_app_user() then raise exception 'An active DallmayrERP account is required.' using errcode = '42501'; end if;
  select * into v_token from public.telemetry_enrollment_tokens where id = p_token_id;
  if not found then return jsonb_build_object('status', 'missing', 'token_id', p_token_id); end if;
  v_status := case when v_token.used_at is not null then 'used' when v_token.revoked_at is not null then 'revoked' when v_token.expires_at <= now() then 'expired' else 'active' end;
  return jsonb_build_object(
    'status', v_status, 'token_id', v_token.id, 'hardware_uid', v_token.expected_hardware_uid,
    'device_id', v_token.used_by_device_id, 'expires_at', v_token.expires_at,
    'seconds_remaining', case when v_status = 'active' then greatest(floor(extract(epoch from (v_token.expires_at - now())))::integer, 0) else 0 end
  );
end;
$$;

create or replace function public.revoke_telemetry_enrollment_token(p_token_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_token public.telemetry_enrollment_tokens%rowtype;
begin
  if not public.is_active_app_user() then raise exception 'An active DallmayrERP account is required.' using errcode = '42501'; end if;
  update public.telemetry_enrollment_tokens
  set revoked_at = coalesce(revoked_at, now())
  where id = p_token_id and used_at is null
  returning * into v_token;
  return jsonb_build_object('revoked', found, 'token_id', p_token_id, 'hardware_uid', v_token.expected_hardware_uid);
end;
$$;

create or replace function public.request_telemetry_prepaid_balance(p_device_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_device_id uuid;
begin
  if not public.is_active_app_user() then raise exception 'An active DallmayrERP account is required.' using errcode = '42501'; end if;
  select id into v_device_id from public.telemetry_devices where device_code = trim(p_device_code) and status = 'active';
  if not found then raise exception 'Active telemetry device not found' using errcode = '22023'; end if;
  insert into public.telemetry_prepaid_balance_state (device_id, request_pending, requested_at, updated_at)
  values (v_device_id, true, now(), now())
  on conflict (device_id) do update set request_pending = true, requested_at = now(), updated_at = now();
  return jsonb_build_object('accepted', true, 'device_id', v_device_id, 'request_pending', true);
end;
$$;

create or replace function public.delete_telemetry_device(p_device_id uuid, p_device_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.telemetry_devices%rowtype;
  v_sales_rows bigint := 0;
begin
  if not public.is_active_app_user() then raise exception 'An active DallmayrERP account is required.' using errcode = '42501'; end if;
  select * into v_device from public.telemetry_devices where id = p_device_id for update;
  if not found then raise exception 'Telemetry device not found' using errcode = 'P0002'; end if;
  if trim(coalesce(p_device_code, '')) <> v_device.device_code then raise exception 'Enter the exact device ID to confirm deletion' using errcode = '22023'; end if;
  select count(*) into v_sales_rows from public.telemetry_daily_item_sales where device_id = v_device.id;
  delete from public.telemetry_daily_item_sales where device_id = v_device.id;
  delete from public.telemetry_devices where id = v_device.id;
  return jsonb_build_object('deleted', true, 'device_id', v_device.id, 'device_code', v_device.device_code, 'sales_rows_deleted', v_sales_rows);
end;
$$;

create or replace function public.set_telemetry_device_profile(p_device_id uuid, p_profile_key text default null, p_assignment_method text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_key text := nullif(btrim(coalesce(p_profile_key, '')), '');
  v_method text := lower(btrim(coalesce(p_assignment_method, 'manual')));
  v_device public.telemetry_devices%rowtype;
begin
  if not public.is_active_app_user() then raise exception 'An active DallmayrERP account is required.' using errcode = '42501'; end if;
  if v_method not in ('automatic','manual') then raise exception 'Profile assignment method must be automatic or manual.' using errcode = '22023'; end if;
  select * into v_device from public.telemetry_devices where id = p_device_id for update;
  if not found then raise exception 'Telemetry device not found.' using errcode = '22023'; end if;
  if v_method = 'manual' then
    if v_profile_key is null then raise exception 'A decoder profile is required for manual assignment.' using errcode = '22023'; end if;
    select mp.model_key into v_profile_key from public.machine_model_profiles mp where lower(btrim(mp.model_key)) = lower(v_profile_key) limit 1;
    if v_profile_key is null then raise exception 'Decoder profile not found.' using errcode = '22023'; end if;
  else
    v_profile_key := null;
  end if;
  update public.telemetry_devices set profile_id = v_profile_key, profile_assignment_method = v_method, profile_updated_at = now(), updated_at = now() where id = p_device_id;
  return jsonb_build_object('accepted', true, 'device_id', p_device_id, 'profile_id', v_profile_key, 'profile_assignment_method', v_method, 'updated_at', now());
end;
$$;

create or replace function public.set_telemetry_alarm_workflow(p_fault_id uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_action text := lower(trim(coalesce(p_action, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_row public.telemetry_alarm_workflow%rowtype;
begin
  if v_actor is null or not public.is_active_app_user() then raise exception 'An active DallmayrERP account is required.' using errcode = '42501'; end if;
  if p_fault_id is null or not exists (select 1 from public.telemetry_fault_events where id = p_fault_id) then raise exception 'Alarm was not found.' using errcode = '22023'; end if;
  if v_action not in ('acknowledge','unacknowledge','take','release','resolve','reopen') then raise exception 'Unsupported alarm workflow action.' using errcode = '22023'; end if;
  if v_action = 'resolve' and (v_note is null or length(v_note) < 3) then raise exception 'A resolution note of at least 3 characters is required.' using errcode = '22023'; end if;
  if v_note is not null and length(v_note) > 1000 then raise exception 'Alarm workflow note is too long.' using errcode = '22023'; end if;
  insert into public.telemetry_alarm_workflow(fault_id) values (p_fault_id) on conflict (fault_id) do nothing;
  if v_action = 'acknowledge' then
    update public.telemetry_alarm_workflow set workflow_status = case when workflow_status = 'resolved' then 'resolved' else 'acknowledged' end, acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, v_actor), updated_at = now() where fault_id = p_fault_id;
  elsif v_action = 'unacknowledge' then
    update public.telemetry_alarm_workflow set workflow_status = case when workflow_status = 'resolved' then 'resolved' else 'open' end, acknowledged_at = null, acknowledged_by = null, updated_at = now() where fault_id = p_fault_id;
  elsif v_action = 'take' then
    update public.telemetry_alarm_workflow set workflow_status = case when workflow_status = 'resolved' then 'resolved' else 'acknowledged' end, acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, v_actor), assigned_to = v_actor, updated_at = now() where fault_id = p_fault_id;
  elsif v_action = 'release' then
    update public.telemetry_alarm_workflow set assigned_to = null, updated_at = now() where fault_id = p_fault_id;
  elsif v_action = 'resolve' then
    update public.telemetry_alarm_workflow set workflow_status = 'resolved', acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, v_actor), assigned_to = coalesce(assigned_to, v_actor), resolved_at = now(), resolved_by = v_actor, resolution_note = v_note, updated_at = now() where fault_id = p_fault_id;
  elsif v_action = 'reopen' then
    update public.telemetry_alarm_workflow set workflow_status = 'open', acknowledged_at = null, acknowledged_by = null, resolved_at = null, resolved_by = null, resolution_note = null, updated_at = now() where fault_id = p_fault_id;
  end if;
  insert into public.telemetry_alarm_workflow_history(fault_id, action, actor_id, note) values (p_fault_id, v_action, v_actor, v_note);
  select * into v_row from public.telemetry_alarm_workflow where fault_id = p_fault_id;
  return jsonb_build_object('fault_id', v_row.fault_id, 'workflow_status', v_row.workflow_status, 'acknowledged_at', v_row.acknowledged_at, 'acknowledged_by', v_row.acknowledged_by, 'assigned_to', v_row.assigned_to, 'resolved_at', v_row.resolved_at, 'resolved_by', v_row.resolved_by, 'resolution_note', v_row.resolution_note, 'updated_at', v_row.updated_at);
end;
$$;

revoke all on function public.open_telemetry_enrollment_window(integer,integer,text,text) from public, anon;
revoke all on function public.close_telemetry_enrollment_window() from public, anon;
revoke all on function public.get_telemetry_enrollment_window_status() from public, anon;
revoke all on function public.create_telemetry_enrollment_token(text,text,integer,text) from public, anon;
revoke all on function public.get_telemetry_enrollment_token_status(uuid) from public, anon;
revoke all on function public.revoke_telemetry_enrollment_token(uuid) from public, anon;
revoke all on function public.request_telemetry_prepaid_balance(text) from public, anon;
revoke all on function public.delete_telemetry_device(uuid,text) from public, anon;
revoke all on function public.set_telemetry_device_profile(uuid,text,text) from public, anon;
revoke all on function public.set_telemetry_alarm_workflow(uuid,text,text) from public, anon;
grant execute on function public.open_telemetry_enrollment_window(integer,integer,text,text) to authenticated;
grant execute on function public.close_telemetry_enrollment_window() to authenticated;
grant execute on function public.get_telemetry_enrollment_window_status() to authenticated;
grant execute on function public.create_telemetry_enrollment_token(text,text,integer,text) to authenticated;
grant execute on function public.get_telemetry_enrollment_token_status(uuid) to authenticated;
grant execute on function public.revoke_telemetry_enrollment_token(uuid) to authenticated;
grant execute on function public.request_telemetry_prepaid_balance(text) to authenticated;
grant execute on function public.delete_telemetry_device(uuid,text) to authenticated;
grant execute on function public.set_telemetry_device_profile(uuid,text,text) to authenticated;
grant execute on function public.set_telemetry_alarm_workflow(uuid,text,text) to authenticated;
