alter table public.telemetry_devices
  add column if not exists last_transport_at timestamptz;

comment on column public.telemetry_devices.last_transport_at is
  'Database receipt time of the most recent accepted upload that declared its actual transport.';

update public.telemetry_devices
set last_transport_at = coalesce(last_upload_at, last_seen_at, updated_at)
where last_transport is not null and last_transport_at is null;

create or replace function public.get_telemetry_transport_usage(p_days integer default 30)
returns table (
  device_id uuid,
  transport text,
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
  current_application_tx_bytes_total bigint,
  current_application_rx_bytes_total bigint,
  current_application_bytes_total bigint,
  current_modem_tx_bytes_total bigint,
  current_modem_rx_bytes_total bigint,
  current_modem_bytes_total bigint,
  current_counter_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view telemetry transport usage' using errcode = '42501';
  end if;

  return query
  with usage as (
    select u.*
    from public.telemetry_data_usage_daily u
    where u.usage_date >= (now() at time zone 'Africa/Johannesburg')::date
      - greatest(1, least(coalesce(p_days, 30), 366)) + 1
      and u.transport in ('wifi', 'cellular')
  ), totals as (
    select
      u.device_id,
      u.transport,
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
    group by u.device_id, u.transport
  ), combined as (
    select
      coalesce(t.device_id, s.device_id) as device_id,
      coalesce(t.transport, s.transport) as transport,
      t.request_count,
      t.request_bytes,
      t.response_bytes,
      t.device_application_tx_bytes,
      t.device_application_rx_bytes,
      t.device_application_sample_count,
      t.modem_tx_bytes,
      t.modem_rx_bytes,
      t.modem_sample_count,
      t.days_observed,
      t.last_reported_at,
      s.application_tx_bytes_total as current_application_tx_bytes_total,
      s.application_rx_bytes_total as current_application_rx_bytes_total,
      s.modem_tx_bytes_total as current_modem_tx_bytes_total,
      s.modem_rx_bytes_total as current_modem_rx_bytes_total,
      s.updated_at as current_counter_updated_at
    from totals t
    full join public.telemetry_data_usage_state s
      on s.device_id = t.device_id and s.transport = t.transport
    where coalesce(t.transport, s.transport) in ('wifi', 'cellular')
  )
  select
    c.device_id,
    c.transport,
    coalesce(c.request_count, 0)::bigint,
    coalesce(c.request_bytes, 0)::bigint,
    coalesce(c.response_bytes, 0)::bigint,
    (coalesce(c.request_bytes, 0) + coalesce(c.response_bytes, 0))::bigint,
    coalesce(c.device_application_tx_bytes, 0)::bigint,
    coalesce(c.device_application_rx_bytes, 0)::bigint,
    (coalesce(c.device_application_tx_bytes, 0) + coalesce(c.device_application_rx_bytes, 0))::bigint,
    coalesce(c.device_application_sample_count, 0)::bigint,
    coalesce(c.modem_tx_bytes, 0)::bigint,
    coalesce(c.modem_rx_bytes, 0)::bigint,
    (coalesce(c.modem_tx_bytes, 0) + coalesce(c.modem_rx_bytes, 0))::bigint,
    coalesce(c.modem_sample_count, 0)::bigint,
    coalesce(c.days_observed, 0)::bigint,
    c.last_reported_at,
    c.current_application_tx_bytes_total,
    c.current_application_rx_bytes_total,
    case
      when c.current_application_tx_bytes_total is null and c.current_application_rx_bytes_total is null then null
      else coalesce(c.current_application_tx_bytes_total, 0) + coalesce(c.current_application_rx_bytes_total, 0)
    end::bigint,
    c.current_modem_tx_bytes_total,
    c.current_modem_rx_bytes_total,
    case
      when c.current_modem_tx_bytes_total is null and c.current_modem_rx_bytes_total is null then null
      else coalesce(c.current_modem_tx_bytes_total, 0) + coalesce(c.current_modem_rx_bytes_total, 0)
    end::bigint,
    c.current_counter_updated_at
  from combined c;
end;
$$;

revoke all on function public.get_telemetry_transport_usage(integer) from public, anon;
grant execute on function public.get_telemetry_transport_usage(integer) to authenticated;
