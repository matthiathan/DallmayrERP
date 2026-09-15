-- Preserve cumulative counter snapshots as the production accounting source of
-- truth while recording independent MDB/DEX/machine evidence for audit and
-- reconciliation. Evidence never mutates telemetry_daily_item_sales directly.

create table if not exists public.telemetry_vend_evidence (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  machine_id uuid references public.machines(id) on delete set null,
  selection_code text not null check (char_length(selection_code) between 1 and 40),
  product_name text,
  profile_key text,
  correlation_key text not null check (char_length(correlation_key) between 1 and 120),
  source text not null check (source in ('mdb', 'dex', 'machine', 'counter')),
  evidence_type text not null check (evidence_type in (
    'vend_request', 'vend_approved', 'vend_denied', 'vend_success', 'vend_failure',
    'cash_sale', 'dex_sale_delta', 'machine_complete', 'counter_delta'
  )),
  outcome text not null check (outcome in ('pending', 'success', 'failure', 'audit')),
  confidence_score smallint not null check (confidence_score between 0 and 100),
  quantity bigint not null default 1 check (quantity > 0 and quantity <= 1000000),
  price_cents integer check (price_cents is null or price_cents >= 0),
  external_counter bigint check (external_counter is null or external_counter >= 0),
  boot_id text,
  device_sequence bigint check (device_sequence is null or device_sequence >= 0),
  occurred_at timestamptz not null default now(),
  raw_reference text,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique (device_id, source, correlation_key, evidence_type)
);

create index if not exists telemetry_vend_evidence_device_time_idx
  on public.telemetry_vend_evidence(device_id, occurred_at desc);
create index if not exists telemetry_vend_evidence_machine_time_idx
  on public.telemetry_vend_evidence(machine_id, occurred_at desc)
  where machine_id is not null;
create index if not exists telemetry_vend_evidence_selection_time_idx
  on public.telemetry_vend_evidence(device_id, selection_code, occurred_at desc);

alter table public.telemetry_vend_evidence enable row level security;

revoke all on table public.telemetry_vend_evidence from public, anon, authenticated;
grant select on table public.telemetry_vend_evidence to authenticated;
grant select, insert on table public.telemetry_vend_evidence to service_role;

drop policy if exists telemetry_vend_evidence_internal_read
  on public.telemetry_vend_evidence;
create policy telemetry_vend_evidence_internal_read
  on public.telemetry_vend_evidence
  for select
  to authenticated
  using (public.current_app_role() is not null);

create or replace function public.prevent_telemetry_vend_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
  raise exception 'Telemetry vend evidence is append-only.' using errcode = '55000';
end;
$function$;

drop trigger if exists telemetry_vend_evidence_append_only
  on public.telemetry_vend_evidence;
create trigger telemetry_vend_evidence_append_only
before update or delete on public.telemetry_vend_evidence
for each row execute function public.prevent_telemetry_vend_evidence_mutation();

revoke all on function public.prevent_telemetry_vend_evidence_mutation()
  from public, anon, authenticated, service_role;

-- Keep the established product-mapping API intact. Upgrade only its effective
-- profile helper so every existing caller now uses the same identity decision as
-- the machine dashboard and telemetry-config service introduced by PR #224.
create or replace function public.resolve_effective_telemetry_profile_key(
  p_device_id uuid,
  p_machine_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_device_id uuid := p_device_id;
  v_machine_id uuid := p_machine_id;
  v_resolution jsonb;
  v_profile_key text;
  v_machine_model text;
begin
  if v_device_id is null and v_machine_id is not null then
    select d.id
      into v_device_id
    from public.telemetry_devices d
    where d.machine_id = v_machine_id
    order by (d.status = 'active') desc, d.updated_at desc
    limit 1;
  end if;

  if v_device_id is not null then
    select d.machine_id
      into v_machine_id
    from public.telemetry_devices d
    where d.id = v_device_id;

    v_machine_id := coalesce(p_machine_id, v_machine_id);
    v_resolution := public.resolve_telemetry_device_profile(v_device_id);
    v_profile_key := nullif(btrim(v_resolution ->> 'effective_profile_key'), '');

    if v_profile_key is not null then
      return v_profile_key;
    end if;
  end if;

  -- With no usable device resolution, retain only the old exact database-model
  -- fallback. Do not perform a second fuzzy/partial scoring implementation here.
  if v_machine_id is null then
    return null;
  end if;

  select coalesce(nullif(m.model, ''), nullif(m.machine_name, ''))
    into v_machine_model
  from public.machines m
  where m.id = v_machine_id;

  if btrim(coalesce(v_machine_model, '')) = '' then
    return null;
  end if;

  select mp.model_key
    into v_profile_key
  from public.machine_model_profiles mp
  where public.normalize_telemetry_identity_token(mp.model_key)
        = public.normalize_telemetry_identity_token(v_machine_model)
  order by mp.updated_at desc
  limit 1;

  return v_profile_key;
end;
$function$;

-- CREATE OR REPLACE preserves the existing ACL of this established helper.

create or replace function public.record_telemetry_vend_evidence(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_device public.telemetry_devices%rowtype;
  v_source text := lower(btrim(coalesce(p_payload ->> 'source', '')));
  v_evidence_type text := lower(btrim(coalesce(
    p_payload ->> 'event',
    p_payload ->> 'evidence_type',
    ''
  )));
  v_selection text := left(btrim(coalesce(
    p_payload ->> 'selection',
    p_payload ->> 'selection_code',
    ''
  )), 40);
  v_boot_id text := left(btrim(coalesce(p_payload ->> 'boot_id', '')), 64);
  v_sequence bigint;
  v_correlation_key text;
  v_outcome text;
  v_default_confidence integer;
  v_requested_confidence integer;
  v_confidence integer;
  v_quantity bigint := 1;
  v_price_cents integer;
  v_external_counter bigint;
  v_occurred_at timestamptz := now();
  v_profile_key text;
  v_product_name text;
  v_evidence_id uuid;
  v_duplicate boolean := false;
begin
  select *
    into v_device
  from public.telemetry_devices
  where id = p_device_id;

  if not found then
    raise exception 'Telemetry device not found.' using errcode = '22023';
  end if;
  if v_device.status <> 'active' then
    raise exception 'Telemetry device is not active.' using errcode = '42501';
  end if;
  if lower(coalesce(p_payload ->> 'type', '')) <> 'vend_evidence' then
    raise exception 'Expected vend_evidence payload.' using errcode = '22023';
  end if;
  if v_selection = '' then
    raise exception 'Vend evidence requires a selection code.' using errcode = '22023';
  end if;

  if nullif(p_payload ->> 'sequence', '') is not null then
    begin
      v_sequence := (p_payload ->> 'sequence')::bigint;
    exception when others then
      raise exception 'Vend evidence sequence must be a non-negative integer.' using errcode = '22023';
    end;
    if v_sequence < 0 then
      raise exception 'Vend evidence sequence must be a non-negative integer.' using errcode = '22023';
    end if;
  end if;

  v_correlation_key := left(btrim(coalesce(
    nullif(p_payload ->> 'vend_key', ''),
    nullif(p_payload ->> 'event_id', ''),
    case
      when v_boot_id <> '' and v_sequence is not null
        then v_boot_id || ':' || v_sequence::text
      else null
    end,
    ''
  )), 120);

  if v_correlation_key = '' then
    raise exception 'Vend evidence requires vend_key, event_id, or boot_id + sequence.' using errcode = '22023';
  end if;

  if nullif(p_payload ->> 'quantity', '') is not null then
    begin
      v_quantity := (p_payload ->> 'quantity')::bigint;
    exception when others then
      raise exception 'Vend evidence quantity must be a positive integer.' using errcode = '22023';
    end;
  end if;
  if v_quantity <= 0 or v_quantity > 1000000 then
    raise exception 'Vend evidence quantity is out of range.' using errcode = '22023';
  end if;

  if nullif(p_payload ->> 'price_cents', '') is not null then
    begin
      v_price_cents := (p_payload ->> 'price_cents')::integer;
    exception when others then
      raise exception 'Vend evidence price_cents must be a non-negative integer.' using errcode = '22023';
    end;
    if v_price_cents < 0 then
      raise exception 'Vend evidence price_cents must be a non-negative integer.' using errcode = '22023';
    end if;
  end if;

  if nullif(p_payload ->> 'external_counter', '') is not null then
    begin
      v_external_counter := (p_payload ->> 'external_counter')::bigint;
    exception when others then
      raise exception 'Vend evidence external_counter must be non-negative.' using errcode = '22023';
    end;
    if v_external_counter < 0 then
      raise exception 'Vend evidence external_counter must be non-negative.' using errcode = '22023';
    end if;
  end if;

  if nullif(p_payload ->> 'occurred_at', '') is not null then
    begin
      v_occurred_at := (p_payload ->> 'occurred_at')::timestamptz;
    exception when others then
      raise exception 'Vend evidence occurred_at is invalid.' using errcode = '22023';
    end;
  end if;

  if v_source = 'mdb'
     and v_evidence_type in (
       'vend_request', 'vend_approved', 'vend_denied',
       'vend_success', 'vend_failure', 'cash_sale'
     ) then
    v_outcome := case
      when v_evidence_type in ('vend_success', 'cash_sale') then 'success'
      when v_evidence_type in ('vend_denied', 'vend_failure') then 'failure'
      else 'pending'
    end;
    v_default_confidence := case
      when v_evidence_type in ('vend_success', 'vend_failure', 'vend_denied') then 100
      when v_evidence_type = 'cash_sale' then 95
      when v_evidence_type = 'vend_approved' then 60
      else 30
    end;
  elsif v_source = 'dex' and v_evidence_type = 'dex_sale_delta' then
    v_outcome := 'audit';
    v_default_confidence := 80;
  elsif v_source = 'machine' and v_evidence_type = 'machine_complete' then
    v_outcome := 'success';
    v_default_confidence := 85;
  elsif v_source = 'counter' and v_evidence_type = 'counter_delta' then
    v_outcome := 'audit';
    v_default_confidence := 90;
  else
    raise exception 'Vend evidence source/event combination is not supported.' using errcode = '22023';
  end if;

  if nullif(p_payload ->> 'confidence_score', '') is not null then
    begin
      v_requested_confidence := (p_payload ->> 'confidence_score')::integer;
    exception when others then
      raise exception 'Vend evidence confidence_score must be between 0 and 100.' using errcode = '22023';
    end;
    if v_requested_confidence < 0 or v_requested_confidence > 100 then
      raise exception 'Vend evidence confidence_score must be between 0 and 100.' using errcode = '22023';
    end if;
  end if;

  -- A device may lower its confidence but can never raise it above the server's
  -- source/event cap.
  v_confidence := least(
    v_default_confidence,
    coalesce(v_requested_confidence, v_default_confidence)
  );

  v_profile_key := public.resolve_effective_telemetry_profile_key(
    p_device_id,
    v_device.machine_id
  );
  v_product_name := public.resolve_mapped_product_name(
    v_device.machine_id,
    p_device_id,
    v_selection
  );

  insert into public.telemetry_vend_evidence (
    device_id,
    machine_id,
    selection_code,
    product_name,
    profile_key,
    correlation_key,
    source,
    evidence_type,
    outcome,
    confidence_score,
    quantity,
    price_cents,
    external_counter,
    boot_id,
    device_sequence,
    occurred_at,
    raw_reference,
    metadata
  ) values (
    v_device.id,
    v_device.machine_id,
    v_selection,
    v_product_name,
    v_profile_key,
    v_correlation_key,
    v_source,
    v_evidence_type,
    v_outcome,
    v_confidence,
    v_quantity,
    v_price_cents,
    v_external_counter,
    nullif(v_boot_id, ''),
    v_sequence,
    v_occurred_at,
    left(coalesce(p_payload ->> 'raw', p_payload ->> 'raw_reference', ''), 500),
    coalesce(p_payload -> 'metadata', '{}'::jsonb)
      || jsonb_build_object(
        'firmware', nullif(p_payload ->> 'firmware', ''),
        'transport', nullif(p_payload ->> 'transport', '')
      )
  )
  on conflict (device_id, source, correlation_key, evidence_type) do nothing
  returning id into v_evidence_id;

  if v_evidence_id is null then
    v_duplicate := true;
    select e.id
      into v_evidence_id
    from public.telemetry_vend_evidence e
    where e.device_id = v_device.id
      and e.source = v_source
      and e.correlation_key = v_correlation_key
      and e.evidence_type = v_evidence_type;
  end if;

  update public.telemetry_devices
  set last_seen_at = now(),
      last_upload_at = now(),
      firmware_version = coalesce(nullif(p_payload ->> 'firmware', ''), firmware_version),
      updated_at = now()
  where id = v_device.id;

  return jsonb_build_object(
    'accepted', true,
    'vend_evidence', true,
    'duplicate', v_duplicate,
    'evidence_id', v_evidence_id,
    'selection_code', v_selection,
    'product_name', v_product_name,
    'profile_key', v_profile_key,
    'source', v_source,
    'evidence_type', v_evidence_type,
    'outcome', v_outcome,
    'confidence_score', v_confidence,
    'accounting_source', 'counter_snapshot'
  );
end;
$function$;

revoke all on function public.record_telemetry_vend_evidence(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_telemetry_vend_evidence(uuid, jsonb)
  to service_role;

-- V4 adds vend evidence while preserving Learn Mode and the proven V3 core.
create or replace function public.ingest_telemetry_payload_v4(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if lower(coalesce(p_payload ->> 'type', '')) = 'vend_evidence' then
    return public.record_telemetry_vend_evidence(p_device_id, p_payload);
  end if;

  if lower(coalesce(p_payload ->> 'type', '')) = 'selection_observation' then
    return public.ingest_telemetry_selection_observation_v1(p_device_id, p_payload);
  end if;

  return public.ingest_telemetry_payload_v3_core(p_device_id, p_payload);
end;
$function$;

revoke all on function public.ingest_telemetry_payload_v4(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload_v4(uuid, jsonb)
  to service_role;

-- Keep the deployed Edge Function and existing firmware on the stable V3 name.
create or replace function public.ingest_telemetry_payload_v3(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.ingest_telemetry_payload_v4(p_device_id, p_payload);
$function$;

revoke all on function public.ingest_telemetry_payload_v3(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload_v3(uuid, jsonb)
  to service_role;

create or replace function public.get_telemetry_vend_reconciliation(
  p_days integer default 7,
  p_device_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 7), 90));
  v_from date := (now() at time zone 'Africa/Johannesburg')::date
    - (greatest(1, least(coalesce(p_days, 7), 90)) - 1);
  v_result jsonb;
begin
  if auth.uid() is not null and public.current_app_role() is null then
    raise exception 'A provisioned DallmayrERP user is required.' using errcode = '42501';
  end if;

  -- Collapse multiple MDB completion signals that share a correlation key into
  -- one physical transaction before daily aggregation. DEX remains a separate
  -- audit total and is compared with, never added to, counter-accounted sales.
  with evidence_transactions as (
    select
      (e.occurred_at at time zone 'Africa/Johannesburg')::date as sales_date,
      e.device_id,
      max(e.machine_id::text)::uuid as machine_id,
      e.selection_code,
      e.correlation_key,
      max(e.product_name) filter (where e.product_name is not null) as product_name,
      max(e.quantity) filter (
        where e.source = 'mdb'
          and e.outcome = 'success'
          and e.evidence_type in ('vend_success', 'cash_sale')
      )::bigint as mdb_success_units,
      max(e.quantity) filter (
        where e.source = 'mdb'
          and e.outcome = 'failure'
          and e.evidence_type in ('vend_denied', 'vend_failure')
      )::bigint as mdb_failure_units,
      max(e.quantity) filter (
        where e.source = 'dex'
          and e.evidence_type = 'dex_sale_delta'
      )::bigint as dex_units,
      max(e.quantity) filter (
        where e.source = 'machine'
          and e.evidence_type = 'machine_complete'
      )::bigint as machine_success_units,
      max(e.confidence_score)::integer as highest_confidence
    from public.telemetry_vend_evidence e
    where (e.occurred_at at time zone 'Africa/Johannesburg')::date >= v_from
      and (p_device_id is null or e.device_id = p_device_id)
    group by
      (e.occurred_at at time zone 'Africa/Johannesburg')::date,
      e.device_id,
      e.selection_code,
      e.correlation_key
  ),
  evidence as (
    select
      et.sales_date,
      et.device_id,
      max(et.machine_id::text)::uuid as machine_id,
      et.selection_code,
      max(et.product_name) filter (where et.product_name is not null) as product_name,
      coalesce(sum(et.mdb_success_units), 0)::bigint as mdb_success_units,
      coalesce(sum(et.mdb_failure_units), 0)::bigint as mdb_failure_units,
      coalesce(sum(et.dex_units), 0)::bigint as dex_units,
      coalesce(sum(et.machine_success_units), 0)::bigint as machine_success_units,
      coalesce(max(et.highest_confidence), 0)::integer as highest_confidence
    from evidence_transactions et
    group by et.sales_date, et.device_id, et.selection_code
  ),
  counters as (
    select
      s.sales_date,
      s.device_id,
      max(s.machine_id::text)::uuid as machine_id,
      s.selection_code,
      max(s.product_name) filter (where s.product_name is not null) as product_name,
      sum(s.units_sold)::bigint as counter_units,
      sum(s.failed_vends)::bigint as counter_failed_units
    from public.telemetry_daily_item_sales s
    where s.sales_date >= v_from
      and (p_device_id is null or s.device_id = p_device_id)
    group by s.sales_date, s.device_id, s.selection_code
  ),
  joined as (
    select
      coalesce(c.sales_date, e.sales_date) as sales_date,
      coalesce(c.device_id, e.device_id) as device_id,
      coalesce(c.machine_id, e.machine_id) as machine_id,
      coalesce(c.selection_code, e.selection_code) as selection_code,
      coalesce(c.product_name, e.product_name) as product_name,
      coalesce(c.counter_units, 0)::bigint as counter_units,
      coalesce(c.counter_failed_units, 0)::bigint as counter_failed_units,
      coalesce(e.mdb_success_units, 0)::bigint as mdb_success_units,
      coalesce(e.mdb_failure_units, 0)::bigint as mdb_failure_units,
      coalesce(e.dex_units, 0)::bigint as dex_units,
      coalesce(e.machine_success_units, 0)::bigint as machine_success_units,
      coalesce(e.highest_confidence, 0)::integer as highest_confidence
    from counters c
    full outer join evidence e
      on e.sales_date = c.sales_date
     and e.device_id = c.device_id
     and e.selection_code = c.selection_code
  ),
  classified as (
    select
      j.*,
      case
        when j.mdb_success_units > 0 and j.mdb_failure_units > 0 then 'evidence_conflict'
        when j.counter_units > 0 and j.mdb_success_units = j.counter_units then 'matched_mdb_counter'
        when j.counter_units > 0 and j.dex_units = j.counter_units then 'matched_dex_counter'
        when j.mdb_success_units > j.counter_units then 'mdb_evidence_ahead'
        when j.dex_units > j.counter_units then 'dex_evidence_ahead'
        when j.counter_units > greatest(
          j.mdb_success_units,
          j.dex_units,
          j.machine_success_units
        ) and greatest(
          j.mdb_success_units,
          j.dex_units,
          j.machine_success_units
        ) > 0 then 'counter_ahead'
        when j.counter_units > 0
          and greatest(j.mdb_success_units, j.dex_units, j.machine_success_units) = 0
          then 'counter_only'
        when j.counter_units = 0
          and greatest(j.mdb_success_units, j.dex_units, j.machine_success_units) > 0
          then 'evidence_only'
        else 'no_confirmed_sale'
      end as reconciliation_status
    from joined j
  )
  select jsonb_build_object(
    'date_from', v_from,
    'date_to', (now() at time zone 'Africa/Johannesburg')::date,
    'days', v_days,
    'device_id', p_device_id,
    'summary', jsonb_build_object(
      'rows', count(*),
      'counter_units', coalesce(sum(counter_units), 0),
      'mdb_success_units', coalesce(sum(mdb_success_units), 0),
      'dex_units', coalesce(sum(dex_units), 0),
      'matched_rows', count(*) filter (
        where reconciliation_status in ('matched_mdb_counter', 'matched_dex_counter')
      ),
      'attention_rows', count(*) filter (
        where reconciliation_status in (
          'evidence_conflict',
          'mdb_evidence_ahead',
          'dex_evidence_ahead',
          'counter_ahead',
          'evidence_only'
        )
      )
    ),
    'rows', coalesce(
      jsonb_agg(to_jsonb(classified) order by sales_date desc, device_id, selection_code),
      '[]'::jsonb
    )
  )
  into v_result
  from classified;

  return v_result;
end;
$function$;

revoke all on function public.get_telemetry_vend_reconciliation(integer, uuid)
  from public, anon;
grant execute on function public.get_telemetry_vend_reconciliation(integer, uuid)
  to authenticated, service_role;
