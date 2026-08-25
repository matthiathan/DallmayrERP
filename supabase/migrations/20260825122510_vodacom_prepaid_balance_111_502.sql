alter table public.telemetry_prepaid_balance_state
  alter column ussd_code set default '*111*502#';

update public.telemetry_prepaid_balance_state
set ussd_code = '*111*502#',
    request_pending = true,
    requested_at = now(),
    updated_at = now()
where carrier = 'Vodacom South Africa'
  and ussd_code = '*135*500#';

create or replace function public.get_telemetry_prepaid_balances()
returns table (
  device_id uuid,
  device_code text,
  carrier text,
  ussd_code text,
  remaining_bytes bigint,
  balance_text text,
  query_status text,
  last_error text,
  checked_at timestamptz,
  received_at timestamptz,
  request_pending boolean,
  requested_at timestamptz,
  warning_threshold_bytes bigint,
  critical_threshold_bytes bigint,
  check_interval_minutes integer,
  stale_after_minutes integer,
  next_check_at timestamptz,
  is_stale boolean,
  alert_level text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view prepaid balances' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.device_code,
    coalesce(s.carrier, 'Vodacom South Africa'::text),
    coalesce(s.ussd_code, '*111*502#'::text),
    s.remaining_bytes,
    s.balance_text,
    coalesce(s.query_status, 'unknown'::text),
    s.last_error,
    s.checked_at,
    s.received_at,
    coalesce(s.request_pending, false),
    s.requested_at,
    coalesce(s.warning_threshold_bytes, 104857600::bigint),
    coalesce(s.critical_threshold_bytes, 26214400::bigint),
    coalesce(s.check_interval_minutes, 360),
    coalesce(s.stale_after_minutes, 720),
    case when s.checked_at is null then now()
      else s.checked_at + make_interval(mins => coalesce(s.check_interval_minutes, 360)) end,
    s.checked_at is null
      or s.checked_at + make_interval(mins => coalesce(s.stale_after_minutes, 720)) <= now(),
    case
      when s.checked_at is null then 'unknown'
      when s.checked_at + make_interval(mins => coalesce(s.stale_after_minutes, 720)) <= now() then 'stale'
      when s.query_status <> 'ok' then s.query_status
      when s.remaining_bytes = 0 then 'depleted'
      when s.remaining_bytes <= s.critical_threshold_bytes then 'critical'
      when s.remaining_bytes <= s.warning_threshold_bytes then 'low'
      else 'ok'
    end
  from public.telemetry_devices d
  left join public.telemetry_prepaid_balance_state s on s.device_id = d.id
  order by d.device_code;
end;
$$;

revoke all on function public.get_telemetry_prepaid_balances() from public, anon;
grant execute on function public.get_telemetry_prepaid_balances() to authenticated;
