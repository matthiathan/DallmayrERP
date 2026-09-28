-- Harden physical field acceptance so a passed record proves the controlled vend plan
-- and session-local reporting / cellular usage deltas. No firmware or hardware changes.

alter table public.telemetry_test_sessions
  add column if not exists acceptance_baseline jsonb;

create or replace function public.start_telemetry_test_session(
  p_device_id uuid,
  p_duration_minutes integer default 30,
  p_raw_mdb boolean default true,
  p_raw_dex boolean default true,
  p_http_trace boolean default true
)
returns public.telemetry_test_sessions
language plpgsql
set search_path = public
as $function$
declare
  v_session public.telemetry_test_sessions;
  v_duration integer;
  v_requested_expiry timestamptz;
  v_daily_units bigint := 0;
  v_monthly_units bigint := 0;
  v_cellular_bytes bigint := 0;
begin
  if not public.is_active_app_user() then
    raise exception 'Authenticated DallmayrERP access is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.telemetry_devices
    where id = p_device_id and status = 'active'
  ) then
    raise exception 'Unknown or inactive telemetry device.' using errcode = '22023';
  end if;

  v_duration := greatest(5, least(coalesce(p_duration_minutes, 30), 60));

  update public.telemetry_test_sessions
  set status = 'expired',
      ended_at = coalesce(ended_at, now()),
      updated_at = now()
  where device_id = p_device_id
    and status = 'active'
    and expires_at <= now();

  select * into v_session
  from public.telemetry_test_sessions
  where device_id = p_device_id
    and status = 'active'
    and expires_at > now()
  order by started_at desc
  limit 1
  for update;

  if v_session.id is not null then
    v_requested_expiry := least(
      v_session.started_at + interval '60 minutes',
      greatest(v_session.expires_at, now() + make_interval(mins => v_duration))
    );

    update public.telemetry_test_sessions
    set raw_mdb = coalesce(p_raw_mdb, raw_mdb),
        raw_dex = coalesce(p_raw_dex, raw_dex),
        http_trace = coalesce(p_http_trace, http_trace),
        expires_at = v_requested_expiry,
        updated_at = now()
    where id = v_session.id
    returning * into v_session;

    return v_session;
  end if;

  select coalesce(sum(greatest(coalesce(s.units_sold, 0), 0)), 0)
    into v_daily_units
  from public.telemetry_daily_item_sales s
  where s.device_id = p_device_id;

  select coalesce(sum(greatest(coalesce(s.units_sold, 0), 0)), 0)
    into v_monthly_units
  from public.telemetry_daily_item_sales s
  where s.device_id = p_device_id
    and s.sales_date >= date_trunc('month', current_date)::date;

  select coalesce(sum(
      greatest(coalesce(u.application_tx_bytes_total, 0), 0)
      + greatest(coalesce(u.application_rx_bytes_total, 0), 0)
      + greatest(coalesce(u.modem_tx_bytes_total, 0), 0)
      + greatest(coalesce(u.modem_rx_bytes_total, 0), 0)
    ), 0)
    into v_cellular_bytes
  from public.telemetry_data_usage_state u
  where u.device_id = p_device_id
    and lower(coalesce(u.transport, '')) = 'cellular';

  insert into public.telemetry_test_sessions (
    device_id, requested_by, status, log_level,
    raw_mdb, raw_dex, modem_at, http_trace,
    cup_counters, machine_identity, expires_at, acceptance_baseline
  )
  values (
    p_device_id, (select auth.uid()), 'active', 'detailed',
    coalesce(p_raw_mdb, true), coalesce(p_raw_dex, true), false,
    coalesce(p_http_trace, true), true, true,
    now() + make_interval(mins => v_duration),
    jsonb_build_object(
      'captured_at', now(),
      'daily_units_total', v_daily_units,
      'monthly_units_total', v_monthly_units,
      'cellular_bytes_total', v_cellular_bytes
    )
  )
  returning * into v_session;

  return v_session;
end;
$function$;

create or replace function public.prepare_telemetry_field_acceptance_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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
  v_porridge_units bigint := 0;
  v_caramel_units bigint := 0;
  v_other_mapped_units bigint := 0;
  v_terminal_scenario_count bigint := 0;
  v_distinct_vend_count bigint := 0;
  v_accounted_success_units bigint := 0;
  v_daily_units_now bigint := 0;
  v_monthly_units_now bigint := 0;
  v_cellular_bytes_now bigint := 0;
  v_daily_delta_units bigint := 0;
  v_monthly_delta_units bigint := 0;
  v_cellular_bytes_delta bigint := 0;
  v_controlled_plan_reconciled boolean := false;
  v_reporting_reconciled boolean := false;
  v_data_usage_evidence boolean := false;
  v_machine_linked boolean := false;
  v_configuration_applied boolean := false;
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
  if v_session.acceptance_baseline is null then
    raise exception 'This Test Center session predates controlled acceptance baselines. Start a new session before field acceptance.' using errcode = '22023';
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
  if v_window_end < v_session.started_at then v_window_end := v_session.started_at; end if;

  select count(*), max(l.received_at),
    count(*) filter (where l.message ~* '(selection|selected|button[[:space:]]*(press|code)|product[[:space:]]*(selected|selection)|choice)'),
    count(*) filter (where l.message ~* '(vend.*(success|complete|completed|accepted|free|failed|cancel)|(success|free|failed|cancel).*vend|vend[_ -]?result|vend outcome)'),
    count(*) filter (where l.message ~* '(cup[[:space:]]*counter|counter.*(increment|delta|count)|cups?[[:space:]]*[+=:])')
  into v_log_count, v_latest_log_at, v_selection_log_count, v_vend_log_count, v_counter_log_count
  from public.telemetry_debug_logs l
  where l.session_id = v_session.id and l.device_id = v_device.id;

  select count(*),
    coalesce(sum(greatest(coalesce(v.quantity, 0), 0)), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'correlation_key', v.correlation_key, 'selection_code', v.selection_code,
      'product_name', v.product_name, 'source', v.source, 'evidence_type', v.evidence_type,
      'outcome', v.outcome, 'confidence_score', v.confidence_score, 'quantity', v.quantity,
      'price_cents', v.price_cents, 'occurred_at', v.occurred_at, 'received_at', v.received_at
    ) order by coalesce(v.occurred_at, v.received_at), v.id), '[]'::jsonb)
  into v_vend_evidence_count, v_vend_units, v_vend_evidence
  from public.telemetry_vend_evidence v
  where v.device_id = v_device.id
    and (v.machine_id is null or v_device.machine_id is null or v.machine_id = v_device.machine_id)
    and coalesce(v.occurred_at, v.received_at) >= v_session.started_at
    and coalesce(v.occurred_at, v.received_at) <= v_window_end + interval '5 minutes';

  with correlated as (
    select
      coalesce(nullif(v.correlation_key, ''), v.id::text) correlation_key,
      max(nullif(btrim(v.product_name), '')) product_name,
      max(greatest(coalesce(v.quantity, 0), 0)) quantity,
      bool_or(lower(coalesce(v.outcome, '')) ~ '(success|complete|completed|accepted|free)') successful,
      bool_or(lower(coalesce(v.outcome, '')) ~ '(free|fail|failed|cancel|cancelled)') negative_or_free_scenario
    from public.telemetry_vend_evidence v
    where v.device_id = v_device.id
      and (v.machine_id is null or v_device.machine_id is null or v.machine_id = v_device.machine_id)
      and coalesce(v.occurred_at, v.received_at) >= v_session.started_at
      and coalesce(v.occurred_at, v.received_at) <= v_window_end + interval '5 minutes'
    group by coalesce(nullif(v.correlation_key, ''), v.id::text)
  )
  select
    count(*),
    coalesce(sum(quantity) filter (where successful), 0),
    coalesce(sum(quantity) filter (where successful and lower(product_name) = 'instant porridge'), 0),
    coalesce(sum(quantity) filter (where successful and lower(product_name) = 'caramel cappuccino'), 0),
    coalesce(sum(quantity) filter (where successful and product_name is not null and lower(product_name) not in ('instant porridge', 'caramel cappuccino')), 0),
    count(*) filter (where negative_or_free_scenario)
  into v_distinct_vend_count, v_accounted_success_units, v_porridge_units, v_caramel_units, v_other_mapped_units, v_terminal_scenario_count
  from correlated;

  v_controlled_plan_reconciled :=
    v_distinct_vend_count >= 6
    and v_porridge_units >= 3
    and v_caramel_units >= 1
    and v_other_mapped_units >= 1
    and v_terminal_scenario_count >= 1;

  select count(*),
    coalesce(sum(greatest(coalesce(s.units_sold, 0), 0)), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'sales_date', s.sales_date, 'selection_code', s.selection_code, 'sku', s.sku,
      'product_name', s.product_name, 'units_sold', s.units_sold, 'failed_vends', s.failed_vends,
      'revenue_cents', s.revenue_cents, 'first_received_at', s.first_received_at,
      'last_received_at', s.last_received_at
    ) order by s.last_received_at, s.selection_code), '[]'::jsonb)
  into v_counter_row_count, v_counter_units, v_counter_evidence
  from public.telemetry_daily_item_sales s
  where s.device_id = v_device.id
    and (s.machine_id is null or v_device.machine_id is null or s.machine_id = v_device.machine_id)
    and s.last_received_at >= v_session.started_at
    and s.first_received_at <= v_window_end + interval '5 minutes';

  select coalesce(sum(greatest(coalesce(s.units_sold, 0), 0)), 0)
  into v_daily_units_now
  from public.telemetry_daily_item_sales s
  where s.device_id = v_device.id;

  select coalesce(sum(greatest(coalesce(s.units_sold, 0), 0)), 0)
  into v_monthly_units_now
  from public.telemetry_daily_item_sales s
  where s.device_id = v_device.id
    and s.sales_date >= date_trunc('month', v_session.started_at)::date;

  select coalesce(sum(
      greatest(coalesce(u.application_tx_bytes_total, 0), 0)
      + greatest(coalesce(u.application_rx_bytes_total, 0), 0)
      + greatest(coalesce(u.modem_tx_bytes_total, 0), 0)
      + greatest(coalesce(u.modem_rx_bytes_total, 0), 0)
    ), 0)
  into v_cellular_bytes_now
  from public.telemetry_data_usage_state u
  where u.device_id = v_device.id and lower(coalesce(u.transport, '')) = 'cellular';

  v_daily_delta_units := greatest(v_daily_units_now - coalesce((v_session.acceptance_baseline ->> 'daily_units_total')::bigint, 0), 0);
  v_monthly_delta_units := greatest(v_monthly_units_now - coalesce((v_session.acceptance_baseline ->> 'monthly_units_total')::bigint, 0), 0);
  v_cellular_bytes_delta := greatest(v_cellular_bytes_now - coalesce((v_session.acceptance_baseline ->> 'cellular_bytes_total')::bigint, 0), 0);

  v_reporting_reconciled := v_accounted_success_units > 0
    and v_daily_delta_units = v_accounted_success_units
    and v_monthly_delta_units = v_accounted_success_units;
  v_data_usage_evidence := coalesce(v_device.last_transport, '') = 'cellular' and v_cellular_bytes_delta > 0;
  v_machine_linked := v_device.machine_id is not null and coalesce(v_device.machine_link_status, '') = 'linked';
  v_configuration_applied := v_device.applied_config is not null and v_device.last_config_ack_at is not null;

  v_checks := jsonb_build_object(
    'device_contact', coalesce(v_session.last_device_contact_at, v_device.last_heartbeat_at, v_device.last_seen_at) >= v_session.started_at,
    'cellular_transport', coalesce(v_device.last_transport, '') = 'cellular',
    'test_session_acknowledged', v_session.acknowledged_at is not null,
    'logs_streaming', v_log_count > 0,
    'machine_linked', v_machine_linked,
    'machine_interface_identified', nullif(btrim(coalesce(v_device.reported_machine_interface, '')), '') is not null,
    'decoder_profile_applied', nullif(btrim(coalesce(v_device.applied_config ->> 'profile_id', v_device.profile_id, '')), '') is not null,
    'configuration_applied', v_configuration_applied,
    'product_selection_evidence', v_selection_log_count > 0 or v_vend_evidence_count > 0,
    'vend_evidence', v_vend_log_count > 0 or v_vend_evidence_count > 0,
    'cup_counter_evidence', v_counter_log_count > 0 or v_counter_row_count > 0,
    'controlled_plan_reconciled', v_controlled_plan_reconciled,
    'reporting_reconciled', v_reporting_reconciled,
    'data_usage_evidence', v_data_usage_evidence
  );

  v_pass_ready :=
    coalesce((v_checks ->> 'device_contact')::boolean, false)
    and coalesce((v_checks ->> 'cellular_transport')::boolean, false)
    and coalesce((v_checks ->> 'test_session_acknowledged')::boolean, false)
    and coalesce((v_checks ->> 'logs_streaming')::boolean, false)
    and coalesce((v_checks ->> 'machine_linked')::boolean, false)
    and coalesce((v_checks ->> 'machine_interface_identified')::boolean, false)
    and coalesce((v_checks ->> 'decoder_profile_applied')::boolean, false)
    and coalesce((v_checks ->> 'configuration_applied')::boolean, false)
    and coalesce((v_checks ->> 'product_selection_evidence')::boolean, false)
    and coalesce((v_checks ->> 'vend_evidence')::boolean, false)
    and coalesce((v_checks ->> 'cup_counter_evidence')::boolean, false)
    and coalesce((v_checks ->> 'controlled_plan_reconciled')::boolean, false)
    and coalesce((v_checks ->> 'reporting_reconciled')::boolean, false)
    and coalesce((v_checks ->> 'data_usage_evidence')::boolean, false);

  if new.outcome = 'passed' and not v_pass_ready then
    raise exception 'Field acceptance cannot be marked passed until the controlled plan and all authoritative evidence checks are satisfied.' using errcode = '22023';
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
    'controlled_plan_reconciliation', jsonb_build_object(
      'distinct_vends', v_distinct_vend_count,
      'successful_or_free_units', v_accounted_success_units,
      'instant_porridge_units', v_porridge_units,
      'caramel_cappuccino_units', v_caramel_units,
      'other_mapped_units', v_other_mapped_units,
      'negative_or_free_scenario', v_terminal_scenario_count,
      'reconciled', v_controlled_plan_reconciled
    ),
    'reporting_reconciliation', jsonb_build_object(
      'baseline_daily_units', coalesce((v_session.acceptance_baseline ->> 'daily_units_total')::bigint, 0),
      'current_daily_units', v_daily_units_now,
      'daily_delta_units', v_daily_delta_units,
      'baseline_monthly_units', coalesce((v_session.acceptance_baseline ->> 'monthly_units_total')::bigint, 0),
      'current_monthly_units', v_monthly_units_now,
      'monthly_delta_units', v_monthly_delta_units,
      'live_success_units', v_accounted_success_units,
      'reconciled', v_reporting_reconciled
    ),
    'data_usage_evidence', jsonb_build_object(
      'baseline_cellular_bytes', coalesce((v_session.acceptance_baseline ->> 'cellular_bytes_total')::bigint, 0),
      'current_cellular_bytes', v_cellular_bytes_now,
      'cellular_bytes_delta', v_cellular_bytes_delta,
      'last_transport', v_device.last_transport,
      'reconciled', v_data_usage_evidence
    ),
    'device', jsonb_build_object(
      'device_id', v_device.id, 'device_code', v_device.device_code, 'machine_id', v_device.machine_id,
      'machine_link_status', v_device.machine_link_status, 'firmware_version', v_device.firmware_version,
      'last_seen_at', v_device.last_seen_at, 'last_heartbeat_at', v_device.last_heartbeat_at,
      'last_transport', v_device.last_transport, 'transport_preference', v_device.transport_preference,
      'reported_machine_interface', v_device.reported_machine_interface, 'reported_machine_model', v_device.reported_machine_model,
      'reported_machine_profile_fingerprint', v_device.reported_machine_profile_fingerprint,
      'profile_id', v_device.profile_id, 'applied_profile_id', v_device.applied_config ->> 'profile_id',
      'applied_config', v_device.applied_config, 'last_config_ack_at', v_device.last_config_ack_at,
      'mdb_master_polarity', v_device.mdb_master_polarity, 'mdb_slave_polarity', v_device.mdb_slave_polarity,
      'mdb_pin_swap', v_device.mdb_pin_swap
    ),
    'session', jsonb_build_object(
      'id', v_session.id, 'status', v_session.status, 'started_at', v_session.started_at,
      'ended_at', v_session.ended_at, 'expires_at', v_session.expires_at,
      'acknowledged_at', v_session.acknowledged_at, 'last_device_contact_at', v_session.last_device_contact_at,
      'last_log_at', v_session.last_log_at, 'evidence_window_end', v_window_end,
      'acceptance_baseline', v_session.acceptance_baseline, 'log_count', v_log_count,
      'latest_log_at', v_latest_log_at, 'selection_log_count', v_selection_log_count,
      'vend_log_count', v_vend_log_count, 'counter_log_count', v_counter_log_count
    ),
    'vend_evidence', jsonb_build_object('row_count', v_vend_evidence_count, 'units', v_vend_units, 'rows', v_vend_evidence),
    'cup_counter_evidence', jsonb_build_object('row_count', v_counter_row_count, 'units', v_counter_units, 'rows', v_counter_evidence)
  );

  return new;
end;
$function$;

revoke all on function public.prepare_telemetry_field_acceptance_record() from public, anon, authenticated;
