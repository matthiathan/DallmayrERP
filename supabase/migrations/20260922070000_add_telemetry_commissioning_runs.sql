-- Durable field commissioning records. A run is bound to one telemetry device,
-- its current physical machine assignment and (normally) a Test Center session.
-- Counter baselines/finals and automated checks are captured server-side so an
-- audit record cannot be manufactured by supplying arbitrary evidence values.

create table if not exists public.telemetry_commissioning_runs (
  id uuid primary key default gen_random_uuid(),
  telemetry_region text not null,
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  machine_id uuid not null references public.machines(id) on delete restrict,
  test_session_id uuid references public.telemetry_test_sessions(id) on delete set null,
  status text not null default 'in_progress',
  expected_plan jsonb not null default '[]'::jsonb,
  start_snapshot jsonb not null default '{}'::jsonb,
  baseline_counter_snapshot jsonb not null default '[]'::jsonb,
  final_counter_snapshot jsonb,
  counter_delta_snapshot jsonb,
  automated_checks jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  operator_notes text,
  started_by_auth_user_id uuid,
  completed_by_auth_user_id uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telemetry_commissioning_runs_status_check
    check (status in ('in_progress','passed','failed','aborted')),
  constraint telemetry_commissioning_runs_expected_plan_array
    check (jsonb_typeof(expected_plan) = 'array'),
  constraint telemetry_commissioning_runs_completion_check
    check ((status = 'in_progress' and completed_at is null) or (status <> 'in_progress' and completed_at is not null))
);

create unique index if not exists telemetry_commissioning_runs_one_active_device_uidx
  on public.telemetry_commissioning_runs (device_id)
  where status = 'in_progress';

create index if not exists telemetry_commissioning_runs_region_started_idx
  on public.telemetry_commissioning_runs (telemetry_region, started_at desc);
create index if not exists telemetry_commissioning_runs_machine_started_idx
  on public.telemetry_commissioning_runs (machine_id, started_at desc);
create index if not exists telemetry_commissioning_runs_session_idx
  on public.telemetry_commissioning_runs (test_session_id)
  where test_session_id is not null;

drop trigger if exists telemetry_commissioning_runs_set_updated_at
  on public.telemetry_commissioning_runs;
create trigger telemetry_commissioning_runs_set_updated_at
before update on public.telemetry_commissioning_runs
for each row execute function public.set_updated_at();

alter table public.telemetry_commissioning_runs enable row level security;
revoke all on table public.telemetry_commissioning_runs from public, anon, authenticated;
grant select on table public.telemetry_commissioning_runs to authenticated;
grant select, insert, update, delete on table public.telemetry_commissioning_runs to service_role;

drop policy if exists telemetry_commissioning_runs_region_read
  on public.telemetry_commissioning_runs;
create policy telemetry_commissioning_runs_region_read
  on public.telemetry_commissioning_runs
  for select
  to authenticated
  using (
    public.is_active_app_user()
    and telemetry_region = public.current_telemetry_region()
  );

create or replace function public.start_telemetry_commissioning_run(
  p_device_id uuid,
  p_test_session_id uuid default null,
  p_expected_plan jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_device public.telemetry_devices%rowtype;
  v_session public.telemetry_test_sessions%rowtype;
  v_profile jsonb := '{}'::jsonb;
  v_plan jsonb := coalesce(p_expected_plan, jsonb_build_array(
    jsonb_build_object('label','Instant Porridge','expected_success_units',3,'kind','product'),
    jsonb_build_object('label','Caramel Cappuccino','expected_success_units',1,'kind','product'),
    jsonb_build_object('label','Known mapped product','expected_success_units',1,'kind','product'),
    jsonb_build_object('label','Failed, cancelled or free-vend scenario','expected_observation',true,'kind','scenario')
  ));
  v_baseline jsonb := '[]'::jsonb;
  v_start_snapshot jsonb := '{}'::jsonb;
  v_run_id uuid;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode='42501';
  end if;
  if jsonb_typeof(v_plan) <> 'array' then
    raise exception 'Expected commissioning plan must be a JSON array.' using errcode='22023';
  end if;
  if jsonb_array_length(v_plan) > 50 then
    raise exception 'Expected commissioning plan is too large.' using errcode='22023';
  end if;

  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
    and status = 'active'
    and telemetry_region = v_region
  for update;

  if not found then
    raise exception 'Active telemetry device not found in the selected telemetry region.' using errcode='22023';
  end if;
  if v_device.machine_id is null then
    raise exception 'Assign the telemetry device to a machine before commissioning.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.machines m
    where m.id = v_device.machine_id and m.telemetry_region = v_region
  ) then
    raise exception 'Linked machine is not available in the selected telemetry region.' using errcode='42501';
  end if;
  if exists (
    select 1 from public.telemetry_commissioning_runs r
    where r.device_id = v_device.id and r.status = 'in_progress'
  ) then
    raise exception 'This telemetry device already has an active commissioning run.' using errcode='23505';
  end if;

  if p_test_session_id is not null then
    select * into v_session
    from public.telemetry_test_sessions
    where id = p_test_session_id
      and device_id = v_device.id;
    if not found then
      raise exception 'Test Center session does not belong to the selected telemetry device.' using errcode='22023';
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'selection_code', c.selection_code,
    'counter_epoch', c.counter_epoch,
    'sold_total', c.sold_total,
    'failed_total', c.failed_total,
    'revenue_cents_total', c.revenue_cents_total,
    'updated_at', c.updated_at
  ) order by c.selection_code), '[]'::jsonb)
  into v_baseline
  from public.telemetry_counter_state c
  where c.device_id = v_device.id;

  v_profile := public.resolve_telemetry_device_profile(v_device.id);
  v_start_snapshot := jsonb_build_object(
    'captured_at', now(),
    'device_code', v_device.device_code,
    'machine_id', v_device.machine_id,
    'firmware_version', v_device.firmware_version,
    'last_seen_at', v_device.last_seen_at,
    'last_heartbeat_at', v_device.last_heartbeat_at,
    'last_transport', v_device.last_transport,
    'cellular_operator', v_device.cellular_operator,
    'cellular_csq', v_device.cellular_csq,
    'wifi_rssi', v_device.wifi_rssi,
    'reported_machine_interface', v_device.reported_machine_interface,
    'reported_machine_model', v_device.reported_machine_model,
    'reported_machine_profile_fingerprint', v_device.reported_machine_profile_fingerprint,
    'effective_profile_key', v_profile->>'effective_profile_key',
    'profile_resolution', v_profile->>'profile_resolution',
    'profile_confidence', v_profile->>'confidence',
    'applied_profile_key', nullif(v_device.applied_config->>'profile_id',''),
    'test_session_status', case when p_test_session_id is null then null else v_session.status end,
    'test_session_acknowledged_at', case when p_test_session_id is null then null else v_session.acknowledged_at end,
    'test_session_last_log_at', case when p_test_session_id is null then null else v_session.last_log_at end
  );

  insert into public.telemetry_commissioning_runs (
    telemetry_region, device_id, machine_id, test_session_id,
    expected_plan, start_snapshot, baseline_counter_snapshot,
    started_by_auth_user_id
  ) values (
    v_region, v_device.id, v_device.machine_id, p_test_session_id,
    v_plan, v_start_snapshot, v_baseline, auth.uid()
  ) returning id into v_run_id;

  return jsonb_build_object(
    'accepted', true,
    'run_id', v_run_id,
    'device_id', v_device.id,
    'device_code', v_device.device_code,
    'machine_id', v_device.machine_id,
    'test_session_id', p_test_session_id,
    'status', 'in_progress',
    'expected_plan', v_plan,
    'baseline_counter_snapshot', v_baseline,
    'start_snapshot', v_start_snapshot
  );
end;
$$;

revoke all on function public.start_telemetry_commissioning_run(uuid,uuid,jsonb) from public, anon;
grant execute on function public.start_telemetry_commissioning_run(uuid,uuid,jsonb) to authenticated;

create or replace function public.finalize_telemetry_commissioning_run(
  p_run_id uuid,
  p_result text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_run public.telemetry_commissioning_runs%rowtype;
  v_device public.telemetry_devices%rowtype;
  v_session public.telemetry_test_sessions%rowtype;
  v_profile jsonb := '{}'::jsonb;
  v_result text := lower(btrim(coalesce(p_result,'')));
  v_final jsonb := '[]'::jsonb;
  v_deltas jsonb := '[]'::jsonb;
  v_checks jsonb := '{}'::jsonb;
  v_summary jsonb := '{}'::jsonb;
  v_positive_delta boolean := false;
  v_epoch_change boolean := false;
  v_notes text := nullif(btrim(coalesce(p_notes,'')), '');
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode='42501';
  end if;
  if v_result not in ('passed','failed','aborted') then
    raise exception 'Commissioning result must be passed, failed or aborted.' using errcode='22023';
  end if;

  select * into v_run
  from public.telemetry_commissioning_runs
  where id = p_run_id
    and telemetry_region = v_region
  for update;

  if not found then
    raise exception 'Commissioning run not found in the selected telemetry region.' using errcode='22023';
  end if;
  if v_run.status <> 'in_progress' then
    raise exception 'Commissioning run is already complete.' using errcode='22023';
  end if;

  select * into v_device
  from public.telemetry_devices
  where id = v_run.device_id
    and telemetry_region = v_region;
  if not found then
    raise exception 'Commissioned telemetry device is no longer available in this region.' using errcode='22023';
  end if;

  if v_run.test_session_id is not null then
    select * into v_session
    from public.telemetry_test_sessions
    where id = v_run.test_session_id
      and device_id = v_run.device_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'selection_code', c.selection_code,
    'counter_epoch', c.counter_epoch,
    'sold_total', c.sold_total,
    'failed_total', c.failed_total,
    'revenue_cents_total', c.revenue_cents_total,
    'updated_at', c.updated_at
  ) order by c.selection_code), '[]'::jsonb)
  into v_final
  from public.telemetry_counter_state c
  where c.device_id = v_run.device_id;

  with baseline as (
    select * from jsonb_to_recordset(coalesce(v_run.baseline_counter_snapshot,'[]'::jsonb)) as x(
      selection_code text, counter_epoch text, sold_total bigint, failed_total bigint, revenue_cents_total bigint, updated_at timestamptz
    )
  ), current_state as (
    select c.selection_code, c.counter_epoch, c.sold_total, c.failed_total, c.revenue_cents_total, c.updated_at
    from public.telemetry_counter_state c
    where c.device_id = v_run.device_id
  ), joined as (
    select
      coalesce(c.selection_code,b.selection_code) selection_code,
      b.counter_epoch baseline_epoch,
      c.counter_epoch final_epoch,
      coalesce(b.sold_total,0) baseline_sold,
      coalesce(c.sold_total,0) final_sold,
      coalesce(b.failed_total,0) baseline_failed,
      coalesce(c.failed_total,0) final_failed,
      coalesce(b.revenue_cents_total,0) baseline_revenue,
      coalesce(c.revenue_cents_total,0) final_revenue,
      case
        when b.selection_code is null then false
        when c.selection_code is null then true
        else b.counter_epoch is distinct from c.counter_epoch
      end epoch_changed,
      case
        when c.selection_code is null then null
        when b.selection_code is null then c.sold_total
        when b.counter_epoch is distinct from c.counter_epoch then null
        else c.sold_total - b.sold_total
      end sold_delta,
      case
        when c.selection_code is null then null
        when b.selection_code is null then c.failed_total
        when b.counter_epoch is distinct from c.counter_epoch then null
        else c.failed_total - b.failed_total
      end failed_delta,
      case
        when c.selection_code is null then null
        when b.selection_code is null then c.revenue_cents_total
        when b.counter_epoch is distinct from c.counter_epoch then null
        else c.revenue_cents_total - b.revenue_cents_total
      end revenue_delta
    from baseline b
    full outer join current_state c on c.selection_code=b.selection_code
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'selection_code', selection_code,
      'baseline_epoch', baseline_epoch,
      'final_epoch', final_epoch,
      'baseline_sold', baseline_sold,
      'final_sold', final_sold,
      'sold_delta', sold_delta,
      'baseline_failed', baseline_failed,
      'final_failed', final_failed,
      'failed_delta', failed_delta,
      'baseline_revenue_cents', baseline_revenue,
      'final_revenue_cents', final_revenue,
      'revenue_delta_cents', revenue_delta,
      'epoch_changed', epoch_changed
    ) order by selection_code), '[]'::jsonb),
    coalesce(bool_or(coalesce(sold_delta,0) > 0), false),
    coalesce(bool_or(epoch_changed), false)
  into v_deltas, v_positive_delta, v_epoch_change
  from joined;

  v_profile := public.resolve_telemetry_device_profile(v_device.id);
  v_checks := jsonb_build_object(
    'captured_at', now(),
    'device_contact_during_run', coalesce(v_device.last_seen_at, v_device.last_heartbeat_at) >= v_run.started_at,
    'cellular_transport', v_device.last_transport = 'cellular',
    'machine_assignment_unchanged', v_device.machine_id = v_run.machine_id,
    'machine_interface_identified', nullif(btrim(coalesce(v_device.reported_machine_interface,'')), '') is not null,
    'decoder_profile_resolved', nullif(v_profile->>'effective_profile_key','') is not null,
    'decoder_profile_acknowledged', nullif(v_device.applied_config->>'profile_id','') is not distinct from nullif(v_profile->>'effective_profile_key',''),
    'test_session_linked', v_run.test_session_id is not null,
    'test_session_acknowledged', case when v_run.test_session_id is null then false else v_session.acknowledged_at is not null end,
    'test_logs_captured', case when v_run.test_session_id is null then false else v_session.last_log_at is not null and v_session.last_log_at >= v_run.started_at end,
    'counter_delta_observed', v_positive_delta,
    'counter_epoch_stable', not v_epoch_change
  );

  v_summary := jsonb_build_object(
    'automated_checks_passed', (
      select count(*) from jsonb_each(v_checks) e
      where jsonb_typeof(e.value)='boolean' and e.value='true'::jsonb
    ),
    'automated_checks_total', (
      select count(*) from jsonb_each(v_checks) e
      where jsonb_typeof(e.value)='boolean'
    ),
    'positive_counter_delta_observed', v_positive_delta,
    'counter_epoch_changed', v_epoch_change,
    'operator_result', v_result
  );

  update public.telemetry_commissioning_runs
  set status = v_result,
      final_counter_snapshot = v_final,
      counter_delta_snapshot = v_deltas,
      automated_checks = v_checks,
      result_summary = v_summary,
      operator_notes = v_notes,
      completed_by_auth_user_id = auth.uid(),
      completed_at = now(),
      updated_at = now()
  where id = v_run.id;

  return jsonb_build_object(
    'accepted', true,
    'run_id', v_run.id,
    'status', v_result,
    'automated_checks', v_checks,
    'result_summary', v_summary,
    'counter_delta_snapshot', v_deltas,
    'completed_at', now()
  );
end;
$$;

revoke all on function public.finalize_telemetry_commissioning_run(uuid,text,text) from public, anon;
grant execute on function public.finalize_telemetry_commissioning_run(uuid,text,text) to authenticated;
