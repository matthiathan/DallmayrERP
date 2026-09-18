-- Opening a telemetry enrollment window must not expire or cancel concurrent
-- enrollment work in another telemetry region.

create or replace function public.open_telemetry_enrollment_window(
  p_minutes integer default 10,
  p_max_devices integer default 1,
  p_label text default null::text,
  p_expected_hardware_uid text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_window public.telemetry_enrollment_windows%rowtype;
  v_expected_uid text := nullif(upper(trim(coalesce(p_expected_hardware_uid, ''))), '');
begin
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
  set status = 'expired',
      closed_at = coalesce(closed_at, now())
  where status = 'open'
    and telemetry_region = v_region
    and expires_at <= now();

  update public.telemetry_enrollment_windows
  set status = 'cancelled',
      closed_at = now()
  where status = 'open'
    and telemetry_region = v_region;

  insert into public.telemetry_enrollment_windows(
    label,
    status,
    expected_hardware_uid,
    max_claims,
    claimed_count,
    opened_by_auth_user_id,
    opened_at,
    expires_at,
    telemetry_region
  ) values (
    nullif(trim(coalesce(p_label, '')), ''),
    'open',
    v_expected_uid,
    p_max_devices,
    0,
    auth.uid(),
    now(),
    now() + make_interval(mins => p_minutes),
    v_region
  ) returning * into v_window;

  return jsonb_build_object(
    'active', true,
    'window_id', v_window.id,
    'status', v_window.status,
    'telemetry_region', v_region,
    'label', v_window.label,
    'expected_hardware_uid', v_window.expected_hardware_uid,
    'max_devices', v_window.max_claims,
    'claimed_devices', v_window.claimed_count,
    'opened_at', v_window.opened_at,
    'expires_at', v_window.expires_at
  );
end;
$$;

revoke all on function public.open_telemetry_enrollment_window(integer, integer, text, text) from public, anon;
grant execute on function public.open_telemetry_enrollment_window(integer, integer, text, text) to authenticated, service_role;

comment on function public.open_telemetry_enrollment_window(integer, integer, text, text) is
  'Opens an enrollment window in the selected telemetry region without modifying windows in other regions.';
