-- Enrollment carries a region so new hardware cannot silently enter another fleet.

create or replace function public.create_telemetry_enrollment_token(p_hardware_uid text,p_token_hash text,p_minutes integer default 10,p_label text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_region text:=public.assert_telemetry_region_selected();
  v_hardware_uid text:=upper(trim(coalesce(p_hardware_uid,'')));
  v_token_hash text:=lower(trim(coalesce(p_token_hash,'')));
  v_token public.telemetry_enrollment_tokens%rowtype;
begin
  if v_hardware_uid !~ '^[0-9A-F]{12}$' then raise exception 'Hardware UID must contain exactly 12 hexadecimal characters' using errcode='22023'; end if;
  if v_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Enrollment token hash must be a SHA-256 hexadecimal digest' using errcode='22023'; end if;
  if p_minutes is null or p_minutes<1 or p_minutes>60 then raise exception 'Enrollment token duration must be between 1 and 60 minutes' using errcode='22023'; end if;
  if exists(select 1 from public.telemetry_devices where hardware_uid=v_hardware_uid) then raise exception 'This ESP32 hardware UID is already enrolled' using errcode='23505'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_hardware_uid,0));
  update public.telemetry_enrollment_tokens set revoked_at=now() where expected_hardware_uid=v_hardware_uid and used_at is null and revoked_at is null;
  insert into public.telemetry_enrollment_tokens(token_hash,label,expected_hardware_uid,expires_at,created_by_auth_user_id,telemetry_region)
  values(v_token_hash,nullif(trim(coalesce(p_label,'')),''),v_hardware_uid,now()+make_interval(mins=>p_minutes),auth.uid(),v_region)
  returning * into v_token;
  return jsonb_build_object('token_id',v_token.id,'hardware_uid',v_token.expected_hardware_uid,'telemetry_region',v_region,'expires_at',v_token.expires_at,'seconds_remaining',greatest(floor(extract(epoch from(v_token.expires_at-now())))::integer,0));
end; $$;

create or replace function public.get_telemetry_enrollment_token_status(p_token_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_region text:=public.assert_telemetry_region_selected();
  v_token public.telemetry_enrollment_tokens%rowtype;
  v_status text;
begin
  select * into v_token from public.telemetry_enrollment_tokens where id=p_token_id and telemetry_region=v_region;
  if not found then return jsonb_build_object('status','missing','token_id',p_token_id); end if;
  v_status:=case when v_token.used_at is not null then 'used' when v_token.revoked_at is not null then 'revoked' when v_token.expires_at<=now() then 'expired' else 'active' end;
  return jsonb_build_object('status',v_status,'token_id',v_token.id,'hardware_uid',v_token.expected_hardware_uid,'telemetry_region',v_region,'device_id',v_token.used_by_device_id,'expires_at',v_token.expires_at,'seconds_remaining',case when v_status='active' then greatest(floor(extract(epoch from(v_token.expires_at-now())))::integer,0) else 0 end);
end; $$;

create or replace function public.revoke_telemetry_enrollment_token(p_token_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_region text:=public.assert_telemetry_region_selected();
  v_token public.telemetry_enrollment_tokens%rowtype;
begin
  update public.telemetry_enrollment_tokens set revoked_at=coalesce(revoked_at,now())
  where id=p_token_id and telemetry_region=v_region and used_at is null returning * into v_token;
  return jsonb_build_object('revoked',found,'token_id',p_token_id,'hardware_uid',v_token.expected_hardware_uid,'telemetry_region',v_region);
end; $$;

create or replace function public.open_telemetry_enrollment_window(p_minutes integer default 10,p_max_devices integer default 1,p_label text default null,p_expected_hardware_uid text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_region text:=public.assert_telemetry_region_selected();
  v_window public.telemetry_enrollment_windows%rowtype;
  v_expected_uid text:=nullif(upper(trim(coalesce(p_expected_hardware_uid,''))),'');
begin
  if p_minutes is null or p_minutes<1 or p_minutes>60 then raise exception 'Enrollment window duration must be between 1 and 60 minutes' using errcode='22023'; end if;
  if p_max_devices is null or p_max_devices<1 or p_max_devices>100 then raise exception 'Enrollment window device count must be between 1 and 100' using errcode='22023'; end if;
  if v_expected_uid is not null and v_expected_uid !~ '^[0-9A-F]{12}$' then raise exception 'Expected hardware UID must contain exactly 12 hexadecimal characters' using errcode='22023'; end if;
  if v_expected_uid is not null and p_max_devices<>1 then raise exception 'A hardware-locked window can enroll exactly one device' using errcode='22023'; end if;
  update public.telemetry_enrollment_windows set status='expired',closed_at=coalesce(closed_at,now()) where status='open' and expires_at<=now();
  -- Zero-touch firmware does not send a region hint. Keep at most one open global window to avoid ambiguity.
  update public.telemetry_enrollment_windows set status='cancelled',closed_at=now() where status='open';
  insert into public.telemetry_enrollment_windows(label,status,expected_hardware_uid,max_claims,claimed_count,opened_by_auth_user_id,opened_at,expires_at,telemetry_region)
  values(nullif(trim(coalesce(p_label,'')),''),'open',v_expected_uid,p_max_devices,0,auth.uid(),now(),now()+make_interval(mins=>p_minutes),v_region)
  returning * into v_window;
  return jsonb_build_object('active',true,'window_id',v_window.id,'status',v_window.status,'telemetry_region',v_region,'label',v_window.label,'expected_hardware_uid',v_window.expected_hardware_uid,'max_devices',v_window.max_claims,'claimed_devices',v_window.claimed_count,'opened_at',v_window.opened_at,'expires_at',v_window.expires_at);
end; $$;

create or replace function public.close_telemetry_enrollment_window()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_region text:=public.assert_telemetry_region_selected();
  v_window_id uuid;
begin
  update public.telemetry_enrollment_windows set status=case when expires_at<=now() then 'expired' else 'cancelled' end,closed_at=coalesce(closed_at,now())
  where status='open' and telemetry_region=v_region returning id into v_window_id;
  return jsonb_build_object('active',false,'closed',v_window_id is not null,'window_id',v_window_id,'telemetry_region',v_region);
end; $$;

create or replace function public.get_telemetry_enrollment_window_status()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_region text:=public.assert_telemetry_region_selected();
  v_window public.telemetry_enrollment_windows%rowtype;
  v_effective_status text;
  v_active boolean;
begin
  select * into v_window from public.telemetry_enrollment_windows where telemetry_region=v_region order by created_at desc limit 1;
  if not found then return jsonb_build_object('active',false,'status','none','telemetry_region',v_region); end if;
  v_active:=v_window.status='open' and v_window.expires_at>now() and v_window.claimed_count<v_window.max_claims;
  v_effective_status:=case when v_window.status='open' and v_window.expires_at<=now() then 'expired' else v_window.status end;
  return jsonb_build_object('active',v_active,'window_id',v_window.id,'status',v_effective_status,'telemetry_region',v_region,'label',v_window.label,'expected_hardware_uid',v_window.expected_hardware_uid,'max_devices',v_window.max_claims,'claimed_devices',v_window.claimed_count,'opened_at',v_window.opened_at,'expires_at',v_window.expires_at,'seconds_remaining',case when v_active then greatest(floor(extract(epoch from(v_window.expires_at-now())))::integer,0) else 0 end);
end; $$;

create or replace function public.enroll_telemetry_device(p_token_hash text,p_hardware_uid text,p_machine_serial text,p_credential_hash text,p_firmware text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_token public.telemetry_enrollment_tokens%rowtype;
  v_region text;
  v_hardware_uid text:=upper(trim(coalesce(p_hardware_uid,'')));
  v_device_code text; v_device_id uuid; v_live_policy_id uuid; v_machine_id uuid; v_site_id uuid;
  v_serial text:=lower(trim(coalesce(p_machine_serial,''))); v_matches integer:=0; v_link_status text:='unlinked';
begin
  if v_hardware_uid !~ '^[0-9A-F]{12}$' then raise exception 'Invalid ESP32 hardware UID' using errcode='22023'; end if;
  if nullif(trim(coalesce(p_credential_hash,'')),'') is null then raise exception 'Credential hash is required' using errcode='22023'; end if;
  select * into v_token from public.telemetry_enrollment_tokens where token_hash=lower(trim(coalesce(p_token_hash,''))) for update;
  if not found or v_token.used_at is not null or v_token.revoked_at is not null or v_token.expires_at<=now() or v_token.expected_hardware_uid is distinct from v_hardware_uid then
    raise exception 'Invalid, expired, already-used, or UID-mismatched enrollment token' using errcode='42501';
  end if;
  v_region:=v_token.telemetry_region;
  if exists(select 1 from public.telemetry_devices where hardware_uid=v_hardware_uid) then raise exception 'This ESP32 is already enrolled; recommission it with a new token if credentials were erased' using errcode='23505'; end if;
  v_device_code:='DLM-ESP32-'||v_hardware_uid;
  if v_serial<>'' then
    select count(*)::integer into v_matches from public.machines where telemetry_region=v_region and nullif(trim(serial_number),'') is not null and lower(trim(serial_number))=v_serial;
    if v_matches=1 then select id,site_id into v_machine_id,v_site_id from public.machines where telemetry_region=v_region and nullif(trim(serial_number),'') is not null and lower(trim(serial_number))=v_serial limit 1; v_link_status:='linked';
    elsif v_matches=0 then v_link_status:='no_match'; else v_link_status:='ambiguous'; end if;
  end if;
  select id into v_live_policy_id from public.telemetry_policies where policy_code='live' limit 1;
  insert into public.telemetry_devices(device_code,machine_id,site_id,status,credential_hash,firmware_version,telemetry_policy_id,transport_preference,wifi_enabled,cellular_enabled,hardware_uid,reported_machine_serial,machine_link_status,machine_link_method,machine_linked_at,telemetry_region)
  values(v_device_code,v_machine_id,v_site_id,'active',p_credential_hash,nullif(p_firmware,''),v_live_policy_id,'auto',true,true,v_hardware_uid,nullif(trim(p_machine_serial),''),v_link_status,case when v_link_status='linked' then 'serial_auto' else null end,case when v_link_status='linked' then now() else null end,v_region)
  returning id into v_device_id;
  update public.telemetry_enrollment_tokens set used_at=now(),used_by_device_id=v_device_id where id=v_token.id;
  return jsonb_build_object('accepted',true,'enrollment_method','one_time_token','telemetry_region',v_region,'device_id',v_device_id,'device_code',v_device_code,'hardware_uid',v_hardware_uid,'machine_id',v_machine_id,'machine_link_status',v_link_status,'machine_match_count',v_matches,'telemetry_mode','live');
end; $$;

create or replace function public.enroll_telemetry_device_zero_touch(p_hardware_uid text,p_machine_serial text,p_credential_hash text,p_firmware text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_window public.telemetry_enrollment_windows%rowtype;
  v_region text;
  v_hardware_uid text:=upper(trim(coalesce(p_hardware_uid,'')));
  v_device_code text; v_device_id uuid; v_live_policy_id uuid; v_machine_id uuid; v_site_id uuid;
  v_serial text:=lower(trim(coalesce(p_machine_serial,''))); v_matches integer:=0; v_link_status text:='unlinked';
begin
  if v_hardware_uid !~ '^[0-9A-F]{12}$' then raise exception 'Invalid ESP32 hardware UID' using errcode='22023'; end if;
  if nullif(trim(coalesce(p_credential_hash,'')),'') is null then raise exception 'Credential hash is required' using errcode='22023'; end if;
  update public.telemetry_enrollment_windows set status='expired',closed_at=coalesce(closed_at,now()) where status='open' and expires_at<=now();
  select * into v_window from public.telemetry_enrollment_windows
  where status='open' and expires_at>now() and claimed_count<max_claims and (expected_hardware_uid is null or expected_hardware_uid=v_hardware_uid)
  order by opened_at desc limit 1 for update skip locked;
  if not found then raise exception 'No active enrollment window is available for this device' using errcode='42501'; end if;
  v_region:=v_window.telemetry_region;
  if exists(select 1 from public.telemetry_devices where hardware_uid=v_hardware_uid) then raise exception 'This ESP32 is already enrolled; an Administrator must recommission it if credentials were erased' using errcode='23505'; end if;
  v_device_code:='DLM-ESP32-'||v_hardware_uid;
  if v_serial<>'' then
    select count(*)::integer into v_matches from public.machines where telemetry_region=v_region and nullif(trim(serial_number),'') is not null and lower(trim(serial_number))=v_serial;
    if v_matches=1 then select id,site_id into v_machine_id,v_site_id from public.machines where telemetry_region=v_region and nullif(trim(serial_number),'') is not null and lower(trim(serial_number))=v_serial limit 1; v_link_status:='linked';
    elsif v_matches=0 then v_link_status:='no_match'; else v_link_status:='ambiguous'; end if;
  end if;
  select id into v_live_policy_id from public.telemetry_policies where policy_code='live' limit 1;
  insert into public.telemetry_devices(device_code,machine_id,site_id,status,credential_hash,firmware_version,telemetry_policy_id,transport_preference,wifi_enabled,cellular_enabled,hardware_uid,reported_machine_serial,machine_link_status,machine_link_method,machine_linked_at,telemetry_region)
  values(v_device_code,v_machine_id,v_site_id,'active',p_credential_hash,nullif(p_firmware,''),v_live_policy_id,'auto',true,true,v_hardware_uid,nullif(trim(p_machine_serial),''),v_link_status,case when v_link_status='linked' then 'serial_auto' else null end,case when v_link_status='linked' then now() else null end,v_region)
  returning id into v_device_id;
  insert into public.telemetry_enrollment_window_claims(window_id,device_id,hardware_uid) values(v_window.id,v_device_id,v_hardware_uid);
  update public.telemetry_enrollment_windows set claimed_count=claimed_count+1,status=case when claimed_count+1>=max_claims then 'exhausted' else status end,closed_at=case when claimed_count+1>=max_claims then now() else closed_at end where id=v_window.id;
  return jsonb_build_object('accepted',true,'enrollment_method','automatic_window','enrollment_window_id',v_window.id,'telemetry_region',v_region,'device_id',v_device_id,'device_code',v_device_code,'hardware_uid',v_hardware_uid,'machine_id',v_machine_id,'machine_link_status',v_link_status,'machine_match_count',v_matches,'telemetry_mode','live');
end; $$;
