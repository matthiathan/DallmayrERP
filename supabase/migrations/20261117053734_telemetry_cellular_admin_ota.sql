-- Administrator-confirmed machine assignment and signed OTA control plane.
-- Existing assignments/history are deliberately preserved.
alter table public.telemetry_devices add column if not exists suggested_machine_id uuid references public.machines(id) on delete set null;
create index if not exists telemetry_devices_suggested_machine_idx on public.telemetry_devices(suggested_machine_id) where suggested_machine_id is not null;

create or replace function public.guard_telemetry_machine_assignment()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    -- Enrollment may record an identity hint, never a final physical assignment.
    new.machine_id:=null; new.site_id:=null;
    new.machine_link_status:='unlinked'; new.machine_link_method:=null; new.machine_linked_at:=null;
    new.transport_preference:='cellular'; new.cellular_enabled:=true;
  elsif new.machine_id is distinct from old.machine_id then
    if not public.is_active_app_user() then raise exception 'Administrator confirmation is required.' using errcode='42501'; end if;
    perform public.require_app_role(array['admin']);
    if new.machine_id is not null and not exists(select 1 from public.machines m where m.id=new.machine_id and m.telemetry_region=new.telemetry_region) then
      raise exception 'Machine is outside the device region.' using errcode='42501';
    end if;
    new.machine_link_method:=case when new.machine_id is null then null else 'manual' end;
    new.suggested_machine_id:=null;
  end if;
  new.transport_preference:='cellular'; new.cellular_enabled:=true;
  return new;
end; $$;
revoke all on function public.guard_telemetry_machine_assignment() from public,anon,authenticated;
create trigger guard_telemetry_machine_assignment before insert or update of machine_id,transport_preference,cellular_enabled on public.telemetry_devices
for each row execute function public.guard_telemetry_machine_assignment();

-- Automatically link a telemetry device only from strong exact identity evidence.
-- Physical-machine linking is region-bound. Decoder profile selection remains a
-- separate evidence-scored concern so a model/fingerprint never reassigns an asset.

create or replace function public.reconcile_telemetry_machine_identity(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.telemetry_devices%rowtype;
  v_region text;
  v_serial text;
  v_asset text;
  v_serial_matches integer := 0;
  v_asset_matches integer := 0;
  v_serial_machine uuid;
  v_asset_machine uuid;
  v_target uuid;
  v_site uuid;
  v_method text;
  v_status text;
begin
  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'Telemetry device not found.' using errcode='22023';
  end if;

  v_region := v_device.telemetry_region;
  if v_region is null then
    raise exception 'Telemetry device region is not assigned.' using errcode='22023';
  end if;

  if v_device.machine_id is not null then
    if not exists (
      select 1 from public.machines m
      where m.id=v_device.machine_id and m.telemetry_region=v_region
    ) then
      raise exception 'Linked machine is outside the telemetry device region.' using errcode='42501';
    end if;
    update public.telemetry_devices
    set machine_link_status='linked', updated_at=now()
    where id=p_device_id;
    return jsonb_build_object(
      'status','linked','machine_id',v_device.machine_id,'reason','already_assigned','telemetry_region',v_region
    );
  end if;

  v_serial := lower(trim(coalesce(v_device.reported_machine_serial,'')));
  v_asset := lower(trim(coalesce(v_device.reported_machine_asset,'')));

  if v_serial <> '' then
    select count(*)::integer, min(m.id::text)::uuid
    into v_serial_matches, v_serial_machine
    from public.machines m
    where m.telemetry_region=v_region
      and nullif(trim(m.serial_number),'') is not null
      and lower(trim(m.serial_number))=v_serial;
  end if;

  if v_asset <> '' then
    select count(*)::integer, min(m.id::text)::uuid
    into v_asset_matches, v_asset_machine
    from public.machines m
    where m.telemetry_region=v_region
      and (
        (nullif(trim(m.asset_tag),'') is not null and lower(trim(m.asset_tag))=v_asset)
        or (nullif(trim(m.machine_barcode),'') is not null and lower(trim(m.machine_barcode))=v_asset)
      );
  end if;

  if v_asset_matches = 1 then
    if v_serial_matches > 0 and not exists (
      select 1 from public.machines m
      where m.id=v_asset_machine
        and m.telemetry_region=v_region
        and nullif(trim(m.serial_number),'') is not null
        and lower(trim(m.serial_number))=v_serial
    ) then
      v_status := 'ambiguous';
    else
      v_target := v_asset_machine;
      v_method := case
        when v_serial_matches > 0 then 'identity_auto_combined'
        else 'identity_auto_asset'
      end;
    end if;
  elsif v_asset_matches > 1 then
    v_status := 'ambiguous';
  elsif v_serial_matches = 1 then
    v_target := v_serial_machine;
    v_method := 'identity_auto_serial';
  elsif v_serial_matches > 1 then
    v_status := 'ambiguous';
  else
    v_status := case when v_serial='' and v_asset='' then 'unlinked' else 'no_match' end;
  end if;

  if v_target is not null then
    update public.telemetry_devices
    set suggested_machine_id=v_target, machine_link_status='unlinked', updated_at=now()
    where id=p_device_id and machine_id is null;
    return jsonb_build_object('status','unlinked','suggested_machine_id',v_target,
      'reason','administrator_confirmation_required','telemetry_region',v_region);
  end if;

  update public.telemetry_devices
  set suggested_machine_id=null, machine_link_status=v_status,
      machine_link_method=null,
      machine_linked_at=null,
      updated_at=now()
  where id=p_device_id and machine_id is null;

  return jsonb_build_object(
    'status',v_status,
    'serial_match_count',v_serial_matches,
    'asset_match_count',v_asset_matches,
    'telemetry_region',v_region
  );
end;
$$;

revoke execute on function public.reconcile_telemetry_machine_identity(uuid) from public,anon,authenticated;
grant execute on function public.reconcile_telemetry_machine_identity(uuid) to service_role;

-- Backward-compatible serial helper now uses the same region-safe reconciliation.
create or replace function public.try_auto_link_telemetry_device(p_device_id uuid, p_machine_serial text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(trim(coalesce(p_machine_serial,'')),'') is not null then
    update public.telemetry_devices
    set reported_machine_serial=left(trim(p_machine_serial),160), updated_at=now()
    where id=p_device_id;
    if not found then
      raise exception 'Telemetry device not found.' using errcode='22023';
    end if;
  end if;
  return public.reconcile_telemetry_machine_identity(p_device_id);
end;
$$;

revoke execute on function public.try_auto_link_telemetry_device(uuid,text) from public,anon,authenticated;
grant execute on function public.try_auto_link_telemetry_device(uuid,text) to service_role;

-- If a pre-paired machine has a known serial and the controller can report a
-- serial, require those two pieces of evidence to agree. MDB-only controllers
-- that cannot report a serial still use the explicit commissioning pre-pair.

create or replace function public.enroll_telemetry_device(
  p_token_hash text,
  p_hardware_uid text,
  p_machine_serial text,
  p_credential_hash text,
  p_firmware text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.telemetry_enrollment_tokens%rowtype;
  v_region text;
  v_hardware_uid text := upper(trim(coalesce(p_hardware_uid,'')));
  v_device_code text;
  v_device_id uuid;
  v_live_policy_id uuid;
  v_machine_id uuid;
  v_site_id uuid;
  v_serial text := lower(trim(coalesce(p_machine_serial,'')));
  v_expected_serial text;
  v_matches integer := 0;
  v_link_status text := 'unlinked';
  v_link_method text := null;
  v_expected_machine public.machines%rowtype;
begin
  if v_hardware_uid !~ '^[0-9A-F]{12}$' then
    raise exception 'Invalid ESP32 hardware UID' using errcode='22023';
  end if;
  if nullif(trim(coalesce(p_credential_hash,'')),'') is null then
    raise exception 'Credential hash is required' using errcode='22023';
  end if;

  select * into v_token
  from public.telemetry_enrollment_tokens
  where token_hash = lower(trim(coalesce(p_token_hash,'')))
  for update;

  if not found
     or v_token.used_at is not null
     or v_token.revoked_at is not null
     or v_token.expires_at <= now()
     or v_token.expected_hardware_uid is distinct from v_hardware_uid then
    raise exception 'Invalid, expired, already-used, or UID-mismatched enrollment token' using errcode='42501';
  end if;

  v_region := v_token.telemetry_region;

  if exists(select 1 from public.telemetry_devices where hardware_uid=v_hardware_uid) then
    raise exception 'This ESP32 is already enrolled; recommission it with a new token if credentials were erased' using errcode='23505';
  end if;

  v_device_code := 'DLM-ESP32-' || v_hardware_uid;

  -- Token pre-pairing is evidence only; administrator confirms in the portal.
  v_machine_id:=null; v_site_id:=null; v_link_status:='unlinked'; v_link_method:=null;
  select id into v_live_policy_id
  from public.telemetry_policies
  where policy_code='live'
  limit 1;

  insert into public.telemetry_devices(
    device_code,machine_id,site_id,status,credential_hash,firmware_version,
    telemetry_policy_id,transport_preference,wifi_enabled,cellular_enabled,
    hardware_uid,reported_machine_serial,machine_link_status,machine_link_method,
    machine_linked_at,telemetry_region
  ) values (
    v_device_code,v_machine_id,v_site_id,'active',p_credential_hash,nullif(p_firmware,''),
    v_live_policy_id,'cellular',true,true,v_hardware_uid,nullif(trim(p_machine_serial),''),
    v_link_status,v_link_method,case when v_link_status='linked' then now() else null end,v_region
  ) returning id into v_device_id;

  update public.telemetry_enrollment_tokens
  set used_at=now(),used_by_device_id=v_device_id
  where id=v_token.id;

  return jsonb_build_object(
    'accepted',true,
    'enrollment_method','one_time_token',
    'telemetry_region',v_region,
    'device_id',v_device_id,
    'device_code',v_device_code,
    'hardware_uid',v_hardware_uid,
    'machine_id',v_machine_id,
    'machine_link_status',v_link_status,
    'machine_link_method',v_link_method,
    'machine_match_count',v_matches,
    'telemetry_mode','live'
  );
end;
$$;

revoke all on function public.enroll_telemetry_device(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.enroll_telemetry_device(text,text,text,text,text) to service_role;

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
  -- Identity is only a suggestion; a new device remains unmapped.
  select id into v_live_policy_id from public.telemetry_policies where policy_code='live' limit 1;
  insert into public.telemetry_devices(device_code,machine_id,site_id,status,credential_hash,firmware_version,telemetry_policy_id,transport_preference,wifi_enabled,cellular_enabled,hardware_uid,reported_machine_serial,machine_link_status,machine_link_method,machine_linked_at,telemetry_region)
  values(v_device_code,v_machine_id,v_site_id,'active',p_credential_hash,nullif(p_firmware,''),v_live_policy_id,'cellular',true,true,v_hardware_uid,nullif(trim(p_machine_serial),''),v_link_status,case when v_link_status='linked' then 'serial_auto' else null end,case when v_link_status='linked' then now() else null end,v_region)
  returning id into v_device_id;
  insert into public.telemetry_enrollment_window_claims(window_id,device_id,hardware_uid) values(v_window.id,v_device_id,v_hardware_uid);
  update public.telemetry_enrollment_windows set claimed_count=claimed_count+1,status=case when claimed_count+1>=max_claims then 'exhausted' else status end,closed_at=case when claimed_count+1>=max_claims then now() else closed_at end where id=v_window.id;
  return jsonb_build_object('accepted',true,'enrollment_method','automatic_window','enrollment_window_id',v_window.id,'telemetry_region',v_region,'device_id',v_device_id,'device_code',v_device_code,'hardware_uid',v_hardware_uid,'machine_id',v_machine_id,'machine_link_status',v_link_status,'machine_match_count',v_matches,'telemetry_mode','live');
end; $$;

-- Bench provisioning: store only a hash. The one-time displayed private device
-- credential is written over USB before installation; no field window is needed.
create or replace function public.provision_telemetry_device(p_hardware_uid text,p_credential_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region text:=public.assert_telemetry_region_selected(); v_device public.telemetry_devices%rowtype; v_uid text:=upper(trim(p_hardware_uid));
begin
  perform public.require_app_role(array['admin']);
  if coalesce(v_uid,'') !~ '^[0-9A-F]{12}$' or coalesce(p_credential_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid hardware UID or credential hash.' using errcode='22023'; end if;
  insert into public.telemetry_devices(device_code,hardware_uid,credential_hash,telemetry_region,status,transport_preference,wifi_enabled,cellular_enabled)
  values('DLM-ESP32-'||v_uid,v_uid,p_credential_hash,v_region,'active','cellular',true,true) returning * into v_device;
  return jsonb_build_object('device_id',v_device.id,'device_code',v_device.device_code,'machine_id',null,'status','unmapped');
end; $$;
revoke all on function public.provision_telemetry_device(text,text) from public,anon;
grant execute on function public.provision_telemetry_device(text,text) to authenticated;

create table public.telemetry_firmware_releases (
  id uuid primary key default gen_random_uuid(),
  telemetry_region text not null,
  version text not null check(version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'),
  target text not null check(target='esp32s3-n16r8'),
  generation integer not null check(generation>0),
  image_size integer not null check(image_size between 1 and 6291456),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  signature text not null check(signature ~ '^[a-f0-9]{136,144}$' and length(signature)%2=0),
  storage_path text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  unique(telemetry_region,generation),
  check(storage_path=telemetry_region||'/'||sha256||'.bin')
);
create table public.telemetry_firmware_jobs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  release_id uuid not null references public.telemetry_firmware_releases(id),
  status text not null default 'pending' check(status in ('pending','installing','awaiting_health','healthy','failed','rejected','rolled_back','cancelled')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours',
  updated_at timestamptz not null default now(),
  detail text
);
create unique index telemetry_firmware_one_active_job on public.telemetry_firmware_jobs(device_id) where status in ('pending','installing','awaiting_health');
create index telemetry_firmware_jobs_release_idx on public.telemetry_firmware_jobs(release_id);
create table public.telemetry_firmware_state (
  device_id uuid primary key references public.telemetry_devices(id) on delete cascade,
  highwater integer not null default 0 check(highwater>=0),
  rollback_capable boolean not null default false,
  trust_ready boolean not null default false,
  running_version text,
  reported_at timestamptz not null default now()
);
alter table public.telemetry_firmware_releases enable row level security;
alter table public.telemetry_firmware_jobs enable row level security;
alter table public.telemetry_firmware_state enable row level security;
revoke all on public.telemetry_firmware_releases,public.telemetry_firmware_jobs,public.telemetry_firmware_state from public,anon,authenticated;
grant select on public.telemetry_firmware_releases,public.telemetry_firmware_jobs,public.telemetry_firmware_state to authenticated;
grant all on public.telemetry_firmware_releases,public.telemetry_firmware_jobs,public.telemetry_firmware_state to service_role;
create policy firmware_release_read on public.telemetry_firmware_releases for select to authenticated
using (public.is_active_app_user() and telemetry_region=public.assert_telemetry_region_selected());
create policy firmware_job_read on public.telemetry_firmware_jobs for select to authenticated
using (public.is_active_app_user() and public.telemetry_region_allows_device(device_id));
create policy firmware_state_read on public.telemetry_firmware_state for select to authenticated
using (public.is_active_app_user() and public.telemetry_region_allows_device(device_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('telemetry-firmware','telemetry-firmware',false,6291456,array['application/octet-stream']) on conflict(id) do nothing;
-- Images are immutable. No browser overwrite/delete policy is granted.
create policy telemetry_firmware_upload on storage.objects for insert to authenticated
with check(bucket_id='telemetry-firmware' and public.is_active_app_user() and public.current_app_role()='admin'
  and (storage.foldername(name))[1]=public.assert_telemetry_region_selected()
  and name ~ '^[a-zA-Z0-9_-]+/[a-f0-9]{64}\.bin$');

create or replace function public.register_telemetry_firmware_release(p_manifest jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region text:=public.assert_telemetry_region_selected(); v_id uuid; v_hash text:=p_manifest->>'sha256';
begin
  perform public.require_app_role(array['admin']);
  if not exists(select 1 from storage.objects where bucket_id='telemetry-firmware' and name=v_region||'/'||v_hash||'.bin') then
    raise exception 'Upload the immutable firmware image first.' using errcode='22023'; end if;
  insert into public.telemetry_firmware_releases(telemetry_region,version,target,generation,image_size,sha256,signature,storage_path,created_by)
  values(v_region,p_manifest->>'version',p_manifest->>'target',(p_manifest->>'generation')::integer,(p_manifest->>'size')::integer,
    v_hash,p_manifest->>'signature',v_region||'/'||v_hash||'.bin',auth.uid()) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.request_telemetry_firmware_update(p_device_id uuid,p_release_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region text:=public.assert_telemetry_region_selected(); v_id uuid; v_state public.telemetry_firmware_state%rowtype; v_release public.telemetry_firmware_releases%rowtype;
begin
  perform public.require_app_role(array['admin']);
  perform 1 from public.telemetry_devices where id=p_device_id and telemetry_region=v_region and status='active' for update;
  if not found then raise exception 'Active device not found in selected region.' using errcode='42501'; end if;
  select * into v_state from public.telemetry_firmware_state where device_id=p_device_id;
  if not found or not v_state.rollback_capable or not v_state.trust_ready or v_state.reported_at<now()-interval '5 minutes' then
    raise exception 'Device must recently confirm trusted OTA and bootloader rollback support.' using errcode='22023'; end if;
  select * into v_release from public.telemetry_firmware_releases where id=p_release_id and telemetry_region=v_region;
  if not found or v_release.generation<=v_state.highwater then raise exception 'Release must be in the selected region with a newer signed generation.' using errcode='22023'; end if;
  -- Expired pending work can be cancelled. Never silently replace an installation in progress.
  update public.telemetry_firmware_jobs set status='cancelled',detail='Expired before delivery.',updated_at=now()
  where device_id=p_device_id and status='pending' and expires_at<=now();
  insert into public.telemetry_firmware_jobs(device_id,release_id,requested_by) values(p_device_id,p_release_id,auth.uid()) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.record_telemetry_firmware_status(p_device_id uuid,p_report jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.telemetry_firmware_jobs%rowtype; v_release public.telemetry_firmware_releases%rowtype;
  v_status text:=p_report->>'status'; v_id uuid:=nullif(p_report->>'job_id','')::uuid; v_generation integer:=coalesce((p_report->>'generation')::integer,0);
begin
  if not exists(select 1 from public.telemetry_devices where id=p_device_id and status='active') then raise exception 'Unknown device.' using errcode='42501'; end if;
  insert into public.telemetry_firmware_state(device_id,highwater,rollback_capable,trust_ready,running_version)
  values(p_device_id,greatest(0,coalesce((p_report->>'highwater')::integer,0)),coalesce((p_report->>'rollback_capable')::boolean,false),coalesce((p_report->>'trust_ready')::boolean,false),left(p_report->>'running_version',160))
  on conflict(device_id) do update set highwater=greatest(telemetry_firmware_state.highwater,excluded.highwater),
    rollback_capable=excluded.rollback_capable,trust_ready=excluded.trust_ready,running_version=excluded.running_version,reported_at=now();
  if v_id is null then return jsonb_build_object('accepted',true); end if;
  select * into v_job from public.telemetry_firmware_jobs where id=v_id and device_id=p_device_id for update;
  if not found then raise exception 'Firmware request does not belong to this device.' using errcode='42501'; end if;
  select * into v_release from public.telemetry_firmware_releases where id=v_job.release_id;
  if v_generation<>v_release.generation then raise exception 'Firmware generation does not match request.' using errcode='22023'; end if;
  if v_status=v_job.status then return jsonb_build_object('accepted',true,'duplicate',true); end if;
  if not ((v_job.status='pending' and v_status in ('installing','failed','rejected'))
    or (v_job.status='installing' and v_status in ('awaiting_health','healthy','failed','rolled_back'))
    or (v_job.status='awaiting_health' and v_status in ('healthy','failed','rolled_back'))) then
    raise exception 'Invalid firmware request transition.' using errcode='22023'; end if;
  if v_status='healthy' and coalesce((p_report->>'highwater')::integer,0)<>v_generation then
    raise exception 'Trial image has not been confirmed.' using errcode='22023'; end if;
  update public.telemetry_firmware_jobs set status=v_status,detail=left(p_report->>'detail',500),updated_at=now() where id=v_id;
  return jsonb_build_object('accepted',true);
end; $$;
revoke all on function public.register_telemetry_firmware_release(jsonb),public.request_telemetry_firmware_update(uuid,uuid),public.record_telemetry_firmware_status(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.register_telemetry_firmware_release(jsonb),public.request_telemetry_firmware_update(uuid,uuid) to authenticated;
grant execute on function public.record_telemetry_firmware_status(uuid,jsonb) to service_role;

-- Align stored configuration and the UI with the enforced SIM-first contract.
update public.telemetry_devices set transport_preference='cellular',cellular_enabled=true;
update public.telemetry_policies set heartbeat_interval_minutes=1;
