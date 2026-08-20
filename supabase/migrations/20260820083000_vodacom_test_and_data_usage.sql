create table if not exists public.telemetry_data_usage_state (
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  transport text not null default 'unknown',
  counter_epoch text,
  application_tx_bytes_total bigint,
  application_rx_bytes_total bigint,
  modem_tx_bytes_total bigint,
  modem_rx_bytes_total bigint,
  updated_at timestamptz not null default now(),
  primary key (device_id, transport),
  constraint telemetry_usage_state_transport_check check (transport in ('wifi','cellular','unknown')),
  constraint telemetry_usage_state_app_tx_nonnegative check (application_tx_bytes_total is null or application_tx_bytes_total >= 0),
  constraint telemetry_usage_state_app_rx_nonnegative check (application_rx_bytes_total is null or application_rx_bytes_total >= 0),
  constraint telemetry_usage_state_tx_nonnegative check (modem_tx_bytes_total is null or modem_tx_bytes_total >= 0),
  constraint telemetry_usage_state_rx_nonnegative check (modem_rx_bytes_total is null or modem_rx_bytes_total >= 0)
);

create table if not exists public.telemetry_data_usage_daily (
  usage_date date not null,
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  transport text not null default 'unknown',
  request_count bigint not null default 0,
  request_bytes bigint not null default 0,
  response_bytes bigint not null default 0,
  device_application_tx_bytes bigint not null default 0,
  device_application_rx_bytes bigint not null default 0,
  device_application_sample_count bigint not null default 0,
  modem_tx_bytes bigint not null default 0,
  modem_rx_bytes bigint not null default 0,
  modem_sample_count bigint not null default 0,
  last_reported_at timestamptz not null default now(),
  primary key (usage_date, device_id, transport),
  constraint telemetry_usage_transport_check check (transport in ('wifi','cellular','unknown')),
  constraint telemetry_usage_daily_nonnegative check (
    request_count >= 0 and request_bytes >= 0 and response_bytes >= 0
    and device_application_tx_bytes >= 0 and device_application_rx_bytes >= 0 and device_application_sample_count >= 0
    and modem_tx_bytes >= 0 and modem_rx_bytes >= 0 and modem_sample_count >= 0
  )
);

create index if not exists telemetry_data_usage_daily_device_date_idx
  on public.telemetry_data_usage_daily (device_id, usage_date desc);

alter table public.telemetry_data_usage_state enable row level security;
alter table public.telemetry_data_usage_daily enable row level security;
revoke all on table public.telemetry_data_usage_state from public, anon, authenticated;
revoke all on table public.telemetry_data_usage_daily from public, anon, authenticated;
grant select, insert, update, delete on table public.telemetry_data_usage_state to service_role;
grant select, insert, update, delete on table public.telemetry_data_usage_daily to service_role;

create or replace function public.record_telemetry_data_usage(
  p_device_id uuid,
  p_transport text,
  p_request_bytes bigint,
  p_response_bytes bigint,
  p_counter_epoch text,
  p_application_tx_bytes_total bigint,
  p_application_rx_bytes_total bigint,
  p_modem_tx_bytes_total bigint,
  p_modem_rx_bytes_total bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transport text := lower(trim(coalesce(p_transport, 'unknown')));
  v_usage_date date := (now() at time zone 'Africa/Johannesburg')::date;
  v_previous public.telemetry_data_usage_state%rowtype;
  v_previous_exists boolean := false;
  v_counter_epoch text := nullif(trim(coalesce(p_counter_epoch, '')), '');
  v_application_tx_total bigint := p_application_tx_bytes_total;
  v_application_rx_total bigint := p_application_rx_bytes_total;
  v_tx_total bigint := p_modem_tx_bytes_total;
  v_rx_total bigint := p_modem_rx_bytes_total;
  v_application_tx_delta bigint := 0;
  v_application_rx_delta bigint := 0;
  v_tx_delta bigint := 0;
  v_rx_delta bigint := 0;
  v_has_application_sample boolean := false;
  v_has_modem_sample boolean := false;
  v_result jsonb;
begin
  if v_transport not in ('wifi','cellular') then v_transport := 'unknown'; end if;
  if v_application_tx_total is not null and v_application_tx_total < 0 then v_application_tx_total := null; end if;
  if v_application_rx_total is not null and v_application_rx_total < 0 then v_application_rx_total := null; end if;
  if v_tx_total is not null and v_tx_total < 0 then v_tx_total := null; end if;
  if v_rx_total is not null and v_rx_total < 0 then v_rx_total := null; end if;
  v_has_application_sample := v_application_tx_total is not null or v_application_rx_total is not null;
  v_has_modem_sample := v_tx_total is not null or v_rx_total is not null;

  if v_has_application_sample or v_has_modem_sample then
    select * into v_previous
    from public.telemetry_data_usage_state
    where device_id = p_device_id and transport = v_transport
    for update;
    v_previous_exists := found;

    if v_previous_exists and v_previous.counter_epoch is not distinct from v_counter_epoch then
      if v_application_tx_total is not null and v_previous.application_tx_bytes_total is not null and v_application_tx_total >= v_previous.application_tx_bytes_total then
        v_application_tx_delta := v_application_tx_total - v_previous.application_tx_bytes_total;
      end if;
      if v_application_rx_total is not null and v_previous.application_rx_bytes_total is not null and v_application_rx_total >= v_previous.application_rx_bytes_total then
        v_application_rx_delta := v_application_rx_total - v_previous.application_rx_bytes_total;
      end if;
      if v_tx_total is not null and v_previous.modem_tx_bytes_total is not null and v_tx_total >= v_previous.modem_tx_bytes_total then
        v_tx_delta := v_tx_total - v_previous.modem_tx_bytes_total;
      end if;
      if v_rx_total is not null and v_previous.modem_rx_bytes_total is not null and v_rx_total >= v_previous.modem_rx_bytes_total then
        v_rx_delta := v_rx_total - v_previous.modem_rx_bytes_total;
      end if;
    end if;

    insert into public.telemetry_data_usage_state (
      device_id, transport, counter_epoch, application_tx_bytes_total, application_rx_bytes_total,
      modem_tx_bytes_total, modem_rx_bytes_total, updated_at
    ) values (
      p_device_id, v_transport, v_counter_epoch, v_application_tx_total, v_application_rx_total,
      v_tx_total, v_rx_total, now()
    )
    on conflict (device_id, transport) do update set
      counter_epoch = excluded.counter_epoch,
      application_tx_bytes_total = coalesce(excluded.application_tx_bytes_total, public.telemetry_data_usage_state.application_tx_bytes_total),
      application_rx_bytes_total = coalesce(excluded.application_rx_bytes_total, public.telemetry_data_usage_state.application_rx_bytes_total),
      modem_tx_bytes_total = coalesce(excluded.modem_tx_bytes_total, public.telemetry_data_usage_state.modem_tx_bytes_total),
      modem_rx_bytes_total = coalesce(excluded.modem_rx_bytes_total, public.telemetry_data_usage_state.modem_rx_bytes_total),
      updated_at = now();
  end if;

  insert into public.telemetry_data_usage_daily (
    usage_date, device_id, transport, request_count, request_bytes, response_bytes,
    device_application_tx_bytes, device_application_rx_bytes, device_application_sample_count,
    modem_tx_bytes, modem_rx_bytes, modem_sample_count, last_reported_at
  ) values (
    v_usage_date, p_device_id, v_transport, 1,
    greatest(coalesce(p_request_bytes, 0), 0), greatest(coalesce(p_response_bytes, 0), 0),
    v_application_tx_delta, v_application_rx_delta, case when v_has_application_sample then 1 else 0 end,
    v_tx_delta, v_rx_delta, case when v_has_modem_sample then 1 else 0 end, now()
  )
  on conflict (usage_date, device_id, transport) do update set
    request_count = public.telemetry_data_usage_daily.request_count + 1,
    request_bytes = public.telemetry_data_usage_daily.request_bytes + excluded.request_bytes,
    response_bytes = public.telemetry_data_usage_daily.response_bytes + excluded.response_bytes,
    device_application_tx_bytes = public.telemetry_data_usage_daily.device_application_tx_bytes + excluded.device_application_tx_bytes,
    device_application_rx_bytes = public.telemetry_data_usage_daily.device_application_rx_bytes + excluded.device_application_rx_bytes,
    device_application_sample_count = public.telemetry_data_usage_daily.device_application_sample_count + excluded.device_application_sample_count,
    modem_tx_bytes = public.telemetry_data_usage_daily.modem_tx_bytes + excluded.modem_tx_bytes,
    modem_rx_bytes = public.telemetry_data_usage_daily.modem_rx_bytes + excluded.modem_rx_bytes,
    modem_sample_count = public.telemetry_data_usage_daily.modem_sample_count + excluded.modem_sample_count,
    last_reported_at = now();

  select jsonb_build_object(
    'recorded', true,
    'usage_date', usage_date,
    'transport', transport,
    'request_count_today', request_count,
    'application_bytes_today', request_bytes + response_bytes,
    'device_application_bytes_today', device_application_tx_bytes + device_application_rx_bytes,
    'device_application_measured', device_application_sample_count > 0,
    'modem_bytes_today', modem_tx_bytes + modem_rx_bytes,
    'modem_measured', modem_sample_count > 0
  ) into v_result
  from public.telemetry_data_usage_daily
  where usage_date = v_usage_date and device_id = p_device_id and transport = v_transport;

  return v_result;
end;
$$;

revoke all on function public.record_telemetry_data_usage(uuid,text,bigint,bigint,text,bigint,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.record_telemetry_data_usage(uuid,text,bigint,bigint,text,bigint,bigint,bigint,bigint) to service_role;

create or replace function public.get_telemetry_data_usage(p_days integer default 30)
returns table (
  device_id uuid,
  request_count bigint,
  request_bytes bigint,
  response_bytes bigint,
  application_bytes bigint,
  device_application_tx_bytes bigint,
  device_application_rx_bytes bigint,
  device_application_bytes bigint,
  device_application_sample_count bigint,
  modem_tx_bytes bigint,
  modem_rx_bytes bigint,
  measured_modem_bytes bigint,
  modem_sample_count bigint,
  days_observed bigint,
  last_reported_at timestamptz,
  projected_monthly_application_bytes numeric,
  projected_monthly_device_application_bytes numeric,
  projected_monthly_modem_bytes numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view telemetry data usage' using errcode = '42501';
  end if;

  return query
  with usage as (
    select u.*
    from public.telemetry_data_usage_daily u
    where u.usage_date >= (now() at time zone 'Africa/Johannesburg')::date - greatest(1, least(coalesce(p_days, 30), 366)) + 1
  ), totals as (
    select
      u.device_id,
      sum(u.request_count)::bigint as request_count,
      sum(u.request_bytes)::bigint as request_bytes,
      sum(u.response_bytes)::bigint as response_bytes,
      sum(u.device_application_tx_bytes)::bigint as device_application_tx_bytes,
      sum(u.device_application_rx_bytes)::bigint as device_application_rx_bytes,
      sum(u.device_application_sample_count)::bigint as device_application_sample_count,
      sum(u.modem_tx_bytes)::bigint as modem_tx_bytes,
      sum(u.modem_rx_bytes)::bigint as modem_rx_bytes,
      sum(u.modem_sample_count)::bigint as modem_sample_count,
      count(distinct u.usage_date)::bigint as days_observed,
      max(u.last_reported_at) as last_reported_at
    from usage u
    group by u.device_id
  )
  select
    t.device_id,
    t.request_count,
    t.request_bytes,
    t.response_bytes,
    (t.request_bytes + t.response_bytes)::bigint as application_bytes,
    t.device_application_tx_bytes,
    t.device_application_rx_bytes,
    (t.device_application_tx_bytes + t.device_application_rx_bytes)::bigint as device_application_bytes,
    t.device_application_sample_count,
    t.modem_tx_bytes,
    t.modem_rx_bytes,
    (t.modem_tx_bytes + t.modem_rx_bytes)::bigint as measured_modem_bytes,
    t.modem_sample_count,
    t.days_observed,
    t.last_reported_at,
    round(((t.request_bytes + t.response_bytes)::numeric / greatest(t.days_observed, 1)) * 30) as projected_monthly_application_bytes,
    case when t.device_application_sample_count > 0
      then round(((t.device_application_tx_bytes + t.device_application_rx_bytes)::numeric / greatest(t.days_observed, 1)) * 30)
      else null
    end as projected_monthly_device_application_bytes,
    case when t.modem_sample_count > 0
      then round(((t.modem_tx_bytes + t.modem_rx_bytes)::numeric / greatest(t.days_observed, 1)) * 30)
      else null
    end as projected_monthly_modem_bytes
  from totals t;
end;
$$;

revoke all on function public.get_telemetry_data_usage(integer) from public, anon;
grant execute on function public.get_telemetry_data_usage(integer) to authenticated;

-- Some deployed projects already have the richer v3 ingestion function. Add a
-- compatibility wrapper only when it is absent so repository migrations and a
-- fresh environment can still accept counter_snapshot and diagnostic payloads.
do $outer$
begin
  if to_regprocedure('public.ingest_telemetry_payload_v3(uuid,jsonb)') is null then
    execute $function$
      create function public.ingest_telemetry_payload_v3(p_device_id uuid, p_payload jsonb)
      returns jsonb
      language plpgsql
      security definer
      set search_path = public, pg_temp
      as $body$
      begin
        return public.ingest_telemetry_payload(p_device_id, p_payload);
      end;
      $body$
    $function$;
  end if;
end;
$outer$;

revoke all on function public.ingest_telemetry_payload_v3(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload_v3(uuid,jsonb) to service_role;
