-- Durable commissioning evidence for Remote Test Center field acceptance.
-- Operators submit only the session, outcome and notes. A private BEFORE INSERT
-- trigger resolves the selected region and freezes all authoritative telemetry
-- evidence so the browser cannot manufacture an acceptance snapshot.

create table if not exists public.telemetry_field_acceptance_records (
  id uuid primary key default gen_random_uuid(),
  telemetry_region text not null,
  test_session_id uuid not null,
  device_id uuid not null,
  machine_id uuid,
  outcome text not null check (outcome in ('passed', 'failed')),
  operator_notes text,
  expected_plan jsonb not null,
  evidence_snapshot jsonb not null,
  recorded_by_auth_user_id uuid not null,
  recorded_at timestamptz not null default now(),
  constraint telemetry_field_acceptance_records_session_uidx unique (test_session_id)
);

create index if not exists telemetry_field_acceptance_records_region_recorded_idx
  on public.telemetry_field_acceptance_records (telemetry_region, recorded_at desc);

create index if not exists telemetry_field_acceptance_records_device_recorded_idx
  on public.telemetry_field_acceptance_records (device_id, recorded_at desc);

alter table public.telemetry_field_acceptance_records enable row level security;

revoke all on public.telemetry_field_acceptance_records from anon, authenticated;
grant select on public.telemetry_field_acceptance_records to authenticated;
grant insert (test_session_id, outcome, operator_notes)
  on public.telemetry_field_acceptance_records to authenticated;
grant select on public.telemetry_field_acceptance_records to service_role;

drop policy if exists telemetry_field_acceptance_records_region_read
  on public.telemetry_field_acceptance_records;
create policy telemetry_field_acceptance_records_region_read
  on public.telemetry_field_acceptance_records
  for select
  to authenticated
  using (
    public.is_active_app_user()
    and telemetry_region = public.current_telemetry_region()
  );

drop policy if exists telemetry_field_acceptance_records_region_insert
  on public.telemetry_field_acceptance_records;
create policy telemetry_field_acceptance_records_region_insert
  on public.telemetry_field_acceptance_records
  for insert
  to authenticated
  with check (
    public.is_active_app_user()
    and telemetry_region = public.current_telemetry_region()
    and recorded_by_auth_user_id = auth.uid()
  );

create or replace function public.prepare_telemetry_field_acceptance_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_auth_user_id uuid := auth.uid();
  v_session public.telemetry_test_sessions%rowtype;
  v_device public.telemetry_devices%rowtype;
  v_window_end timestamptz;
  v_log_count bigint := 0;
  v_latest_log_at timestamptz;
  v_selection_log_count bigint := 0;
  v_vend_log_count bigint := 0;
  v_counter_log_count bigint := 0;
  v_vend_evidence_count bigint := 0;
  v_counter_row_count bigint := 0;
  v_vend_units bigint := 0;
  v_counter_units bigint := 0;
  v_vend_evidence jsonb := '[]'::jsonb;
  v_counter_evidence jsonb := '[]'::jsonb;
  v_checks jsonb;
  v_pass_ready boolean := false;
begin
  if v_auth_user_id is null or not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;

  perform public.require_app_role(array['admin', 'operations', 'technician', 'road_technician']);

  new.outcome := lower(btrim(coalesce(new.outcome, '')));
  if new.outcome not in ('passed', 'failed') then
    raise exception 'Acceptance outcome must be passed or failed.' using errcode = '22023';
  end if;

  new.operator_notes := nullif(btrim(coalesce(new.operator_notes, '')), '');

  select s.* into v_session
  from public.telemetry_test_sessions s
  join public.telemetry_devices d on d.id = s.device_id
  where s.id = new.test_session_id
    and d.telemetry_region = v_region
  limit 1;

  if not found then
    raise exception 'Test Center session was not found in the selected telemetry region.' using errcode = '22023';
  end if;

  if v_session.status = 'active' then
    raise exception 'Stop the Test Center session before recording field acceptance.' using errcode = '22023';
  end if;

  select d.* into v_device
  from public.telemetry_devices d
  where d.id = v_session.device_id
    and d.telemetry_region = v_region
  limit 1;

  if not found then
    raise exception 'Telemetry device was not found in the selected telemetry region.' using errcode = '22023';
  end if;

  v_window_end := coalesce(v_session.ended_at, least(v_session.expires_at, now()), now());
  if v_window_end < v_session.started_at then
    v_window_end := v_session.started_at;
  end if;

  select
    count(*),
    max(l.received_at),
    count(*) filter (where l.message ~* '(selection|selected|button[[:space:]]*(press|code)|product[[:space:]]*(selected|selection)|choice)'),
    count(*) filter (where l.message ~* '(vend.*(success|complete|completed|accepted|free|failed|cancel)|(success|free|failed|cancel).*vend|vend[_ -]?result|vend outcome)'),
    count(*) filter (where l.message ~* '(cup[[:space:]]*counter|counter.*(increment|delta|count)|cups?[[:space:]]*[+=:])')
  into v_log_count, v_latest_log_at, v_selection_log_count, v_vend_log_count, v_counter_log_count
  from public.telemetry_debug_logs l
  where l.session_id = v_session.id
    and l.device_id = v_device.id;

  select
    count(*),
    coalesce(sum(greatest(coalesce(v.quantity, 0), 0)), 0),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'selection_code', v.selection_code,
        'product_name', v.product_name,
        'source', v.source,
        'evidence_type', v.evidence_type,
        'outcome', v.outcome,
        'confidence_score', v.confidence_score,
        'quantity', v.quantity,
        'price_cents', v.price_cents,
        'occurred_at', v.occurred_at,
        'received_at', v.received_at
      ) order by coalesce(v.occurred_at, v.received_at), v.id
    ), '[]'::jsonb)
  into v_vend_evidence_count, v_vend_units, v_vend_evidence
  from public.telemetry_vend_evidence v
  where v.device_id = v_device.id
    and (v.machine_id is null or v_device.machine_id is null or v.machine_id = v_device.machine_id)
    and coalesce(v.occurred_at, v.received_at) >= v_session.started_at
    and coalesce(v.occurred_at, v.received_at) <= v_window_end + interval '5 minutes';

  select
    count(*),
    coalesce(sum(greatest(coalesce(s.units_sold, 0), 0)), 0),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'sales_date', s.sales_date,
        'selection_code', s.selection_code,
        'sku', s.sku,
        'product_name', s.product_name,
        'units_sold', s.units_sold,
        'failed_vends', s.failed_vends,
        'revenue_cents', s.revenue_cents,
        'first_received_at', s.first_received_at,
        'last_received_at', s.last_received_at
      ) order by s.last_received_at, s.selection_code
    ), '[]'::jsonb)
  into v_counter_row_count, v_counter_units, v_counter_evidence
  from public.telemetry_daily_item_sales s
  where s.device_id = v_device.id
    and (s.machine_id is null or v_device.machine_id is null or s.machine_id = v_device.machine_id)
    and s.last_received_at >= v_session.started_at
    and s.first_received_at <= v_window_end + interval '5 minutes';

  v_checks := jsonb_build_object(
    'device_contact', coalesce(v_session.last_device_contact_at, v_device.last_heartbeat_at, v_device.last_seen_at) >= v_session.started_at,
    'cellular_transport', coalesce(v_device.last_transport, '') = 'cellular',
    'test_session_acknowledged', v_session.acknowledged_at is not null,
    'logs_streaming', v_log_count > 0,
    'machine_interface_identified', nullif(btrim(coalesce(v_device.reported_machine_interface, '')), '') is not null,
    'decoder_profile_applied', nullif(btrim(coalesce(v_device.applied_config ->> 'profile_id', v_device.profile_id, '')), '') is not null,
    'product_selection_evidence', v_selection_log_count > 0 or v_vend_evidence_count > 0,
    'vend_evidence', v_vend_log_count > 0 or v_vend_evidence_count > 0,
    'cup_counter_evidence', v_counter_log_count > 0 or v_counter_row_count > 0
  );

  v_pass_ready :=
    coalesce((v_checks ->> 'device_contact')::boolean, false)
    and coalesce((v_checks ->> 'cellular_transport')::boolean, false)
    and coalesce((v_checks ->> 'test_session_acknowledged')::boolean, false)
    and coalesce((v_checks ->> 'logs_streaming')::boolean, false)
    and coalesce((v_checks ->> 'machine_interface_identified')::boolean, false)
    and coalesce((v_checks ->> 'decoder_profile_applied')::boolean, false)
    and coalesce((v_checks ->> 'product_selection_evidence')::boolean, false)
    and coalesce((v_checks ->> 'vend_evidence')::boolean, false)
    and coalesce((v_checks ->> 'cup_counter_evidence')::boolean, false);

  if new.outcome = 'passed' and not v_pass_ready then
    raise exception 'Field acceptance cannot be marked passed until all authoritative evidence checks are satisfied.' using errcode = '22023';
  end if;

  new.telemetry_region := v_region;
  new.device_id := v_device.id;
  new.machine_id := v_device.machine_id;
  new.recorded_by_auth_user_id := v_auth_user_id;
  new.recorded_at := now();
  new.expected_plan := jsonb_build_object(
    'name', 'Controlled vend acceptance',
    'steps', jsonb_build_array(
      jsonb_build_object('label', 'Instant Porridge', 'quantity', 3, 'expected', 'successful or free vend counter increment'),
      jsonb_build_object('label', 'Caramel Cappuccino', 'quantity', 1, 'expected', 'successful or free vend counter increment'),
      jsonb_build_object('label', 'Known mapped product', 'quantity', 1, 'expected', 'mapped selection and counter increment'),
      jsonb_build_object('label', 'Free, failed or cancelled scenario', 'quantity', 1, 'expected', 'outcome captured without corrupting successful cup totals')
    )
  );
  new.evidence_snapshot := jsonb_build_object(
    'captured_at', now(),
    'pass_ready', v_pass_ready,
    'checks', v_checks,
    'device', jsonb_build_object(
      'device_id', v_device.id,
      'device_code', v_device.device_code,
      'machine_id', v_device.machine_id,
      'firmware_version', v_device.firmware_version,
      'last_seen_at', v_device.last_seen_at,
      'last_heartbeat_at', v_device.last_heartbeat_at,
      'last_transport', v_device.last_transport,
      'transport_preference', v_device.transport_preference,
      'reported_machine_interface', v_device.reported_machine_interface,
      'reported_machine_model', v_device.reported_machine_model,
      'reported_machine_profile_fingerprint', v_device.reported_machine_profile_fingerprint,
      'profile_id', v_device.profile_id,
      'applied_profile_id', v_device.applied_config ->> 'profile_id',
      'applied_config', v_device.applied_config,
      'mdb_master_polarity', v_device.mdb_master_polarity,
      'mdb_slave_polarity', v_device.mdb_slave_polarity,
      'mdb_pin_swap', v_device.mdb_pin_swap
    ),
    'session', jsonb_build_object(
      'id', v_session.id,
      'status', v_session.status,
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'expires_at', v_session.expires_at,
      'acknowledged_at', v_session.acknowledged_at,
      'last_device_contact_at', v_session.last_device_contact_at,
      'last_log_at', v_session.last_log_at,
      'evidence_window_end', v_window_end,
      'log_count', v_log_count,
      'latest_log_at', v_latest_log_at,
      'selection_log_count', v_selection_log_count,
      'vend_log_count', v_vend_log_count,
      'counter_log_count', v_counter_log_count
    ),
    'vend_evidence', jsonb_build_object(
      'row_count', v_vend_evidence_count,
      'units', v_vend_units,
      'rows', v_vend_evidence
    ),
    'cup_counter_evidence', jsonb_build_object(
      'row_count', v_counter_row_count,
      'units', v_counter_units,
      'rows', v_counter_evidence
    )
  );

  return new;
end;
$$;

revoke all on function public.prepare_telemetry_field_acceptance_record() from public, anon, authenticated;

drop trigger if exists telemetry_field_acceptance_records_prepare
  on public.telemetry_field_acceptance_records;
create trigger telemetry_field_acceptance_records_prepare
before insert on public.telemetry_field_acceptance_records
for each row execute function public.prepare_telemetry_field_acceptance_record();

create or replace function public.finalize_telemetry_field_acceptance(
  p_session_id uuid,
  p_outcome text,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_record public.telemetry_field_acceptance_records%rowtype;
begin
  insert into public.telemetry_field_acceptance_records (
    test_session_id,
    outcome,
    operator_notes
  ) values (
    p_session_id,
    p_outcome,
    p_notes
  )
  returning * into v_record;

  return to_jsonb(v_record);
end;
$$;

revoke all on function public.finalize_telemetry_field_acceptance(uuid, text, text) from public, anon;
grant execute on function public.finalize_telemetry_field_acceptance(uuid, text, text) to authenticated;

comment on table public.telemetry_field_acceptance_records is
  'Immutable operator commissioning decisions with server-derived Test Center, device, vend and cup-counter evidence snapshots.';
