create table if not exists public.telemetry_selection_observations (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  machine_id uuid references public.machines(id) on delete set null,
  interface text not null default 'mdb' check (interface in ('mdb', 'dex')),
  selection_code text,
  item_number integer check (item_number between 0 and 65534),
  price_minor bigint check (price_minor is null or price_minor >= 0),
  currency text not null default 'ZAR',
  result text not null check (result in ('observed', 'requested', 'approved', 'denied', 'success', 'failure')),
  source text not null,
  confirmation text,
  confidence text not null check (confidence in ('observed', 'probable', 'confirmed', 'failed')),
  event_id text not null,
  boot_id text,
  device_sequence bigint,
  observed_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint telemetry_selection_observations_device_event_key unique (device_id, event_id),
  constraint telemetry_selection_observations_has_selection check (selection_code is not null or item_number is not null)
);

create index if not exists telemetry_selection_observations_device_observed_idx
  on public.telemetry_selection_observations (device_id, observed_at desc);
create index if not exists telemetry_selection_observations_machine_observed_idx
  on public.telemetry_selection_observations (machine_id, observed_at desc)
  where machine_id is not null;
create index if not exists telemetry_selection_observations_code_observed_idx
  on public.telemetry_selection_observations (selection_code, observed_at desc)
  where selection_code is not null;

alter table public.telemetry_selection_observations enable row level security;

drop policy if exists telemetry_selection_observations_authenticated_read on public.telemetry_selection_observations;
create policy telemetry_selection_observations_authenticated_read
  on public.telemetry_selection_observations
  for select
  to authenticated
  using (public.is_active_app_user());

revoke all on public.telemetry_selection_observations from anon;
revoke insert, update, delete on public.telemetry_selection_observations from authenticated;
grant select on public.telemetry_selection_observations to authenticated;

grant usage, select on sequence public.telemetry_selection_observations_id_seq to service_role;

create or replace function public.ingest_telemetry_selection_observation_v1(
  p_device_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_device public.telemetry_devices%rowtype;
  v_interface text := lower(left(trim(coalesce(p_payload ->> 'interface', 'mdb')), 16));
  v_result text := lower(left(trim(coalesce(p_payload ->> 'result', 'observed')), 16));
  v_source text := lower(left(trim(coalesce(p_payload ->> 'source', 'mdb')), 40));
  v_confirmation text := nullif(left(trim(coalesce(p_payload ->> 'confirmation', '')), 80), '');
  v_confidence text := lower(left(trim(coalesce(p_payload ->> 'confidence', 'observed')), 16));
  v_event_id text := left(trim(coalesce(p_payload ->> 'event_id', '')), 120);
  v_selection text := nullif(left(trim(coalesce(p_payload ->> 'selection_code', '')), 80), '');
  v_item integer := case when nullif(p_payload ->> 'item_number', '') is null then null else (p_payload ->> 'item_number')::integer end;
  v_price bigint := case when nullif(p_payload ->> 'price_minor', '') is null then null else (p_payload ->> 'price_minor')::bigint end;
  v_currency text := upper(left(trim(coalesce(p_payload ->> 'currency', 'ZAR')), 8));
  v_boot_id text := nullif(left(trim(coalesce(p_payload ->> 'boot_id', '')), 64), '');
  v_sequence bigint := case when nullif(p_payload ->> 'sequence', '') is null then null else (p_payload ->> 'sequence')::bigint end;
  v_observed_at timestamptz := coalesce(nullif(p_payload ->> 'observed_at', '')::timestamptz, now());
  v_inserted_id bigint;
begin
  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'Telemetry device not found' using errcode = '22023';
  end if;
  if v_device.status <> 'active' then
    raise exception 'Telemetry device is not active' using errcode = '42501';
  end if;
  if lower(coalesce(p_payload ->> 'type', '')) <> 'selection_observation' then
    raise exception 'selection_observation payload required' using errcode = '22023';
  end if;
  if v_event_id = '' then
    raise exception 'event_id is required' using errcode = '22023';
  end if;
  if v_interface not in ('mdb', 'dex') then
    raise exception 'Unsupported selection observation interface' using errcode = '22023';
  end if;
  if v_result not in ('observed', 'requested', 'approved', 'denied', 'success', 'failure') then
    raise exception 'Unsupported selection observation result' using errcode = '22023';
  end if;
  if v_confidence not in ('observed', 'probable', 'confirmed', 'failed') then
    raise exception 'Unsupported selection observation confidence' using errcode = '22023';
  end if;
  if v_item = 65535 then v_item := null; end if;
  if v_item is not null and (v_item < 0 or v_item > 65534) then
    raise exception 'MDB item number is out of range' using errcode = '22023';
  end if;
  if v_price is not null and v_price < 0 then
    raise exception 'Selection price cannot be negative' using errcode = '22023';
  end if;
  if v_selection is null and v_interface = 'mdb' and v_item is not null then
    v_selection := 'MDB-' || v_item::text;
  end if;
  if v_selection is null and v_item is null then
    raise exception 'A selection_code or defined item_number is required' using errcode = '22023';
  end if;

  insert into public.telemetry_selection_observations (
    device_id, machine_id, interface, selection_code, item_number, price_minor,
    currency, result, source, confirmation, confidence, event_id, boot_id,
    device_sequence, observed_at, metadata
  ) values (
    v_device.id, v_device.machine_id, v_interface, v_selection, v_item, v_price,
    v_currency, v_result, v_source, v_confirmation, v_confidence, v_event_id,
    v_boot_id, v_sequence, v_observed_at,
    jsonb_strip_nulls(jsonb_build_object(
      'firmware', nullif(p_payload ->> 'firmware', ''),
      'reader_index', p_payload -> 'reader_index',
      'reason', nullif(p_payload ->> 'reason', ''),
      'passive_only', true
    ))
  )
  on conflict (device_id, event_id) do nothing
  returning id into v_inserted_id;

  update public.telemetry_devices
  set last_seen_at = now(),
      last_upload_at = now(),
      updated_at = now()
  where id = v_device.id;

  return jsonb_build_object(
    'accepted', true,
    'selection_observation', true,
    'duplicate', v_inserted_id is null,
    'observation_id', v_inserted_id,
    'selection_code', v_selection,
    'item_number', v_item,
    'result', v_result
  );
end;
$function$;

revoke all on function public.ingest_telemetry_selection_observation_v1(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_selection_observation_v1(uuid, jsonb) to service_role;

create or replace function public.get_recent_telemetry_selection_observations(
  p_limit integer default 50,
  p_device_id uuid default null,
  p_machine_id uuid default null
) returns table (
  id bigint,
  event_id text,
  device_id uuid,
  device_code text,
  machine_id uuid,
  machine_name text,
  machine_model text,
  interface text,
  selection_code text,
  item_number integer,
  price_minor bigint,
  currency text,
  result text,
  source text,
  confirmation text,
  confidence text,
  observed_at timestamptz,
  received_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.is_active_app_user() then
    raise exception 'An active authenticated DallmayrERP user is required.' using errcode = '42501';
  end if;

  return query
  select
    o.id, o.event_id, o.device_id, d.device_code, o.machine_id,
    m.machine_name, m.model, o.interface, o.selection_code, o.item_number,
    o.price_minor, o.currency, o.result, o.source, o.confirmation,
    o.confidence, o.observed_at, o.received_at
  from public.telemetry_selection_observations o
  join public.telemetry_devices d on d.id = o.device_id
  left join public.machines m on m.id = o.machine_id
  where (p_device_id is null or o.device_id = p_device_id)
    and (p_machine_id is null or o.machine_id = p_machine_id)
  order by o.observed_at desc, o.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$function$;

revoke all on function public.get_recent_telemetry_selection_observations(integer, uuid, uuid) from public, anon;
grant execute on function public.get_recent_telemetry_selection_observations(integer, uuid, uuid) to authenticated, service_role;
