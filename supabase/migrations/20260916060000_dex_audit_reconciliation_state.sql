-- Persist DEX/UCS cumulative audit baselines independently from production sales
-- accounting. Counter snapshots remain the accounting source of truth; this state
-- only turns cumulative DEX audit movement into secondary reconciliation evidence.

create table if not exists public.telemetry_dex_audit_state (
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  selection_code text not null check (char_length(selection_code) between 1 and 40),
  counter_generation bigint not null default 0 check (counter_generation >= 0),
  sold_total bigint not null default 0 check (sold_total >= 0),
  revenue_cents_total bigint not null default 0 check (revenue_cents_total >= 0),
  product_name text,
  configured_price_cents integer check (configured_price_cents is null or configured_price_cents >= 0),
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (device_id, selection_code)
);

create index if not exists telemetry_dex_audit_state_device_idx
  on public.telemetry_dex_audit_state(device_id, last_observed_at desc);

alter table public.telemetry_dex_audit_state enable row level security;

revoke all on public.telemetry_dex_audit_state from public, anon;
grant select on public.telemetry_dex_audit_state to authenticated;
grant select, insert, update, delete on public.telemetry_dex_audit_state to service_role;

drop policy if exists telemetry_dex_audit_state_internal_read
  on public.telemetry_dex_audit_state;
create policy telemetry_dex_audit_state_internal_read
  on public.telemetry_dex_audit_state
  for select
  to authenticated
  using (public.current_app_role() in ('admin', 'executive'));

create or replace function public.ingest_telemetry_dex_audit_snapshot_v1(
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
  v_items jsonb := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_item jsonb;
  v_state public.telemetry_dex_audit_state%rowtype;
  v_selection text;
  v_product text;
  v_price integer;
  v_sold bigint;
  v_revenue bigint;
  v_delta bigint;
  v_revenue_delta bigint;
  v_remaining bigint;
  v_chunk bigint;
  v_chunk_index integer;
  v_generation bigint;
  v_vend_key text;
  v_processed integer := 0;
  v_baselined integer := 0;
  v_unchanged integer := 0;
  v_changed integer := 0;
  v_reset integer := 0;
  v_evidence_units bigint := 0;
  v_evidence_rows integer := 0;
  v_observed_at timestamptz := now();
begin
  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'Telemetry device not found.' using errcode = '22023';
  end if;
  if v_device.status <> 'active' then
    raise exception 'Telemetry device is not active.' using errcode = '42501';
  end if;
  if lower(coalesce(p_payload ->> 'type', '')) <> 'dex_audit_snapshot' then
    raise exception 'DEX audit payload type is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'items must be a JSON array.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 64 then
    raise exception 'A maximum of 64 DEX audit items is allowed per batch.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    v_processed := v_processed + 1;
    v_selection := left(btrim(coalesce(v_item ->> 'selection', v_item ->> 'selection_code', '')), 40);
    if v_selection = '' then
      raise exception 'Each DEX audit item requires a selection code.' using errcode = '22023';
    end if;

    begin
      v_sold := coalesce(nullif(v_item ->> 'sold_total', '')::bigint, 0);
      v_revenue := coalesce(nullif(v_item ->> 'revenue_cents_total', '')::bigint, 0);
      v_price := nullif(v_item ->> 'configured_price_cents', '')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'DEX audit counters must be valid integers.' using errcode = '22023';
    end;

    if v_sold < 0 or v_revenue < 0 or coalesce(v_price, 0) < 0 then
      raise exception 'DEX audit counters cannot be negative.' using errcode = '22023';
    end if;

    v_product := nullif(left(btrim(coalesce(v_item ->> 'product', v_item ->> 'product_name', '')), 160), '');

    select * into v_state
    from public.telemetry_dex_audit_state s
    where s.device_id = p_device_id
      and lower(btrim(s.selection_code)) = lower(btrim(v_selection))
    for update;

    if not found then
      insert into public.telemetry_dex_audit_state (
        device_id, selection_code, counter_generation, sold_total,
        revenue_cents_total, product_name, configured_price_cents,
        last_observed_at, created_at, updated_at
      ) values (
        p_device_id, v_selection, 0, v_sold,
        v_revenue, v_product, v_price,
        v_observed_at, now(), now()
      );
      v_baselined := v_baselined + 1;
      continue;
    end if;

    v_generation := v_state.counter_generation;

    if v_sold < v_state.sold_total then
      v_generation := v_generation + 1;
      update public.telemetry_dex_audit_state
      set counter_generation = v_generation,
          sold_total = v_sold,
          revenue_cents_total = v_revenue,
          product_name = coalesce(v_product, product_name),
          configured_price_cents = coalesce(v_price, configured_price_cents),
          last_observed_at = v_observed_at,
          updated_at = now()
      where device_id = p_device_id
        and selection_code = v_state.selection_code;

      insert into public.telemetry_diagnostics (
        device_id, machine_id, diagnostic_type, source, detail, metadata
      ) values (
        p_device_id,
        v_device.machine_id,
        'dex_counter_reset',
        'dex',
        'A DEX cumulative product counter decreased. The new value was accepted as a fresh audit baseline without creating sale evidence.',
        jsonb_build_object(
          'selection', v_selection,
          'previous_sold_total', v_state.sold_total,
          'new_sold_total', v_sold,
          'counter_generation', v_generation
        )
      );

      v_reset := v_reset + 1;
      continue;
    end if;

    v_delta := v_sold - v_state.sold_total;
    v_revenue_delta := case
      when v_revenue >= v_state.revenue_cents_total
        then v_revenue - v_state.revenue_cents_total
      else 0
    end;

    if v_delta = 0 then
      update public.telemetry_dex_audit_state
      set revenue_cents_total = v_revenue,
          product_name = coalesce(v_product, product_name),
          configured_price_cents = coalesce(v_price, configured_price_cents),
          last_observed_at = v_observed_at,
          updated_at = now()
      where device_id = p_device_id
        and selection_code = v_state.selection_code;
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    -- The vend-evidence ledger caps one evidence row at 100,000 units. Split an
    -- unusually large offline/audit delta into deterministic chunks while keeping
    -- the whole state transition atomic and idempotent.
    v_remaining := v_delta;
    v_chunk_index := 0;
    while v_remaining > 0 loop
      v_chunk := least(v_remaining, 100000::bigint);
      v_vend_key := 'dex:' || md5(lower(btrim(v_selection)))
        || ':g' || v_generation::text
        || ':to' || v_sold::text
        || ':c' || v_chunk_index::text;

      perform public.record_telemetry_vend_evidence(
        p_device_id,
        jsonb_build_object(
          'type', 'vend_evidence',
          'source', 'dex',
          'event', 'dex_sale_delta',
          'selection_code', v_selection,
          'vend_key', v_vend_key,
          'quantity', v_chunk,
          'price_cents', v_price,
          'confidence_score', 80,
          'raw_reference', 'DEX/UCS cumulative product audit delta',
          'metadata', jsonb_build_object(
            'counter_generation', v_generation,
            'previous_sold_total', v_state.sold_total,
            'new_sold_total', v_sold,
            'delta_units', v_delta,
            'delta_revenue_cents', v_revenue_delta,
            'chunk_index', v_chunk_index,
            'product_name', v_product,
            'accounting_source', 'counter_snapshot'
          )
        )
      );

      v_evidence_rows := v_evidence_rows + 1;
      v_evidence_units := v_evidence_units + v_chunk;
      v_remaining := v_remaining - v_chunk;
      v_chunk_index := v_chunk_index + 1;
    end loop;

    update public.telemetry_dex_audit_state
    set sold_total = v_sold,
        revenue_cents_total = v_revenue,
        product_name = coalesce(v_product, product_name),
        configured_price_cents = coalesce(v_price, configured_price_cents),
        last_observed_at = v_observed_at,
        updated_at = now()
    where device_id = p_device_id
      and selection_code = v_state.selection_code;

    v_changed := v_changed + 1;
  end loop;

  update public.telemetry_devices
  set last_seen_at = now(),
      last_upload_at = now(),
      updated_at = now()
  where id = p_device_id;

  return jsonb_build_object(
    'accepted', true,
    'dex_audit_snapshot', true,
    'processed_items', v_processed,
    'baselined_items', v_baselined,
    'unchanged_items', v_unchanged,
    'changed_items', v_changed,
    'reset_items', v_reset,
    'evidence_rows', v_evidence_rows,
    'evidence_units', v_evidence_units,
    'accounting_source', 'counter_snapshot'
  );
end;
$function$;

revoke all on function public.ingest_telemetry_dex_audit_snapshot_v1(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_telemetry_dex_audit_snapshot_v1(uuid, jsonb)
  to service_role;

-- Add DEX audit snapshots without changing the stable Edge Function RPC name.
create or replace function public.ingest_telemetry_payload_v5(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if lower(coalesce(p_payload ->> 'type', '')) = 'dex_audit_snapshot' then
    return public.ingest_telemetry_dex_audit_snapshot_v1(p_device_id, p_payload);
  end if;

  return public.ingest_telemetry_payload_v4(p_device_id, p_payload);
end;
$function$;

revoke all on function public.ingest_telemetry_payload_v5(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload_v5(uuid, jsonb)
  to service_role;

create or replace function public.ingest_telemetry_payload_v3(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.ingest_telemetry_payload_v5(p_device_id, p_payload);
$function$;

revoke all on function public.ingest_telemetry_payload_v3(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload_v3(uuid, jsonb)
  to service_role;
