-- Region-scoped commissioning visibility for operators issuing telemetry
-- enrollment credentials. This intentionally exposes safe token metadata only;
-- token hashes remain inaccessible to authenticated clients.

create or replace function public.get_telemetry_commissioning_queue(
  p_state text default 'all',
  p_limit integer default 200
)
returns table (
  token_id uuid,
  hardware_uid text,
  label text,
  token_status text,
  commissioning_state text,
  attention_reason text,
  created_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,
  expected_machine_id uuid,
  machine_name text,
  machine_serial text,
  machine_asset_tag text,
  machine_barcode text,
  device_id uuid,
  device_code text,
  device_status text,
  device_machine_id uuid,
  device_machine_link_status text,
  device_machine_link_method text,
  firmware_version text,
  last_seen_at timestamptz,
  last_transport text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_state text := lower(btrim(coalesce(p_state, 'all')));
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode='42501';
  end if;
  perform public.require_app_role(array['admin','operations']);

  if v_state not in ('all','waiting','enrolled','attention','history') then
    raise exception 'Commissioning state must be all, waiting, enrolled, attention, or history.' using errcode='22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Commissioning queue limit must be between 1 and 500.' using errcode='22023';
  end if;

  return query
  with scoped as (
    select
      t.id as token_id,
      t.expected_hardware_uid as hardware_uid,
      t.label,
      case
        when t.used_at is not null then 'used'
        when t.revoked_at is not null then 'revoked'
        when t.expires_at <= now() then 'expired'
        else 'active'
      end as token_status,
      t.created_at,
      t.expires_at,
      t.used_at,
      t.expected_machine_id,
      m.machine_name,
      m.serial_number as machine_serial,
      m.asset_tag as machine_asset_tag,
      m.machine_barcode,
      d.id as device_id,
      d.device_code,
      d.status as device_status,
      d.machine_id as device_machine_id,
      d.machine_link_status as device_machine_link_status,
      d.machine_link_method as device_machine_link_method,
      d.firmware_version,
      d.last_seen_at,
      d.last_transport,
      case
        when t.used_at is not null and (t.used_by_device_id is null or d.id is null) then 'attention'
        when t.used_at is not null and t.expected_machine_id is not null and d.machine_id is distinct from t.expected_machine_id then 'attention'
        when t.used_at is not null and d.last_seen_at is not null and d.last_seen_at >= now() - interval '30 minutes' then 'online'
        when t.used_at is not null then 'enrolled_offline'
        when t.revoked_at is not null then 'revoked'
        when t.expires_at <= now() then 'expired'
        else 'waiting'
      end as commissioning_state,
      case
        when t.used_at is not null and t.used_by_device_id is null then 'Token was marked used without a linked device.'
        when t.used_at is not null and d.id is null then 'The device linked to this used token no longer exists.'
        when t.used_at is not null and t.expected_machine_id is not null and d.machine_id is distinct from t.expected_machine_id then 'Enrolled device is not linked to the machine reserved by its token.'
        else null
      end as attention_reason
    from public.telemetry_enrollment_tokens t
    left join public.machines m
      on m.id = t.expected_machine_id
     and m.telemetry_region = v_region
    left join public.telemetry_devices d
      on d.id = t.used_by_device_id
     and d.telemetry_region = v_region
    where t.telemetry_region = v_region
  )
  select
    s.token_id,
    s.hardware_uid,
    s.label,
    s.token_status,
    s.commissioning_state,
    s.attention_reason,
    s.created_at,
    s.expires_at,
    s.used_at,
    s.expected_machine_id,
    s.machine_name,
    s.machine_serial,
    s.machine_asset_tag,
    s.machine_barcode,
    s.device_id,
    s.device_code,
    s.device_status,
    s.device_machine_id,
    s.device_machine_link_status,
    s.device_machine_link_method,
    s.firmware_version,
    s.last_seen_at,
    s.last_transport
  from scoped s
  where v_state = 'all'
     or (v_state = 'waiting' and s.commissioning_state = 'waiting')
     or (v_state = 'enrolled' and s.commissioning_state in ('online','enrolled_offline'))
     or (v_state = 'attention' and s.commissioning_state = 'attention')
     or (v_state = 'history' and s.commissioning_state in ('expired','revoked'))
  order by
    case s.commissioning_state
      when 'attention' then 0
      when 'waiting' then 1
      when 'enrolled_offline' then 2
      when 'online' then 3
      else 4
    end,
    s.created_at desc
  limit p_limit;
end;
$$;

revoke all on function public.get_telemetry_commissioning_queue(text,integer) from public, anon;
grant execute on function public.get_telemetry_commissioning_queue(text,integer) to authenticated;
