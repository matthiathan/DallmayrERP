-- Profile-driven telemetry fault decoding.
-- Verified rules enrich raw machine fault codes without replacing or inventing them.

create table if not exists public.machine_model_fault_rules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.machine_model_profiles(id) on delete cascade,
  interface text,
  raw_fault_code text not null,
  canonical_fault_code text not null,
  title text not null,
  category text,
  severity text,
  description text,
  recommended_action text,
  evidence_source text not null,
  is_verified boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machine_model_fault_rules_raw_code_nonempty check (btrim(raw_fault_code) <> ''),
  constraint machine_model_fault_rules_canonical_code_nonempty check (btrim(canonical_fault_code) <> ''),
  constraint machine_model_fault_rules_title_nonempty check (btrim(title) <> ''),
  constraint machine_model_fault_rules_evidence_nonempty check (btrim(evidence_source) <> ''),
  constraint machine_model_fault_rules_interface_check check (interface is null or lower(interface) in ('mdb','dex','vendor','manual','any')),
  constraint machine_model_fault_rules_severity_check check (severity is null or lower(severity) in ('info','warning','fault','critical'))
);

create unique index if not exists machine_model_fault_rules_unique_code
  on public.machine_model_fault_rules (
    profile_id,
    lower(coalesce(interface, 'any')),
    lower(btrim(raw_fault_code))
  );

create index if not exists machine_model_fault_rules_profile_lookup
  on public.machine_model_fault_rules (profile_id, is_active, is_verified);

alter table public.machine_model_fault_rules enable row level security;
revoke all on table public.machine_model_fault_rules from anon;
grant select on table public.machine_model_fault_rules to authenticated;
grant all on table public.machine_model_fault_rules to service_role;

drop policy if exists machine_model_fault_rules_read on public.machine_model_fault_rules;
create policy machine_model_fault_rules_read
  on public.machine_model_fault_rules
  for select
  to authenticated
  using (public.is_active_app_user());

alter table public.telemetry_fault_events
  add column if not exists profile_key text,
  add column if not exists fault_rule_id uuid references public.machine_model_fault_rules(id) on delete set null,
  add column if not exists canonical_fault_code text,
  add column if not exists canonical_title text,
  add column if not exists fault_category text,
  add column if not exists recommended_action text,
  add column if not exists normalization_status text not null default 'raw';

alter table public.telemetry_fault_events
  drop constraint if exists telemetry_fault_events_normalization_status_check;
alter table public.telemetry_fault_events
  add constraint telemetry_fault_events_normalization_status_check
  check (normalization_status in ('raw','verified_rule'));

create or replace function public.resolve_telemetry_fault_rule_v1(
  p_device_id uuid,
  p_fault_code text,
  p_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_machine_id uuid;
  v_profile_key text;
  v_profile_id uuid;
  v_interface text;
  v_rule public.machine_model_fault_rules%rowtype;
begin
  if p_device_id is null or nullif(btrim(coalesce(p_fault_code, '')), '') is null then
    return jsonb_build_object('matched', false, 'status', 'raw');
  end if;

  select d.machine_id, lower(nullif(btrim(d.reported_machine_interface), ''))
    into v_machine_id, v_interface
  from public.telemetry_devices d
  where d.id = p_device_id
    and d.status = 'active';

  if not found then
    return jsonb_build_object('matched', false, 'status', 'raw');
  end if;

  v_profile_key := public.resolve_effective_telemetry_profile_key(p_device_id, v_machine_id);
  if nullif(btrim(coalesce(v_profile_key, '')), '') is null then
    return jsonb_build_object('matched', false, 'status', 'raw');
  end if;

  select p.id
    into v_profile_id
  from public.machine_model_profiles p
  where lower(btrim(p.model_key)) = lower(btrim(v_profile_key))
  limit 1;

  if v_profile_id is null then
    return jsonb_build_object('matched', false, 'status', 'raw', 'profile_key', v_profile_key);
  end if;

  select r.*
    into v_rule
  from public.machine_model_fault_rules r
  where r.profile_id = v_profile_id
    and r.is_active
    and r.is_verified
    and lower(btrim(r.raw_fault_code)) = lower(btrim(p_fault_code))
    and (
      r.interface is null
      or lower(r.interface) = 'any'
      or (v_interface is not null and lower(r.interface) = v_interface)
      or (v_interface is null and p_source is not null and lower(r.interface) = lower(btrim(p_source)))
    )
  order by
    case
      when v_interface is not null and lower(coalesce(r.interface, '')) = v_interface then 0
      when p_source is not null and lower(coalesce(r.interface, '')) = lower(btrim(p_source)) then 1
      when lower(coalesce(r.interface, 'any')) = 'any' then 2
      else 3
    end,
    r.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('matched', false, 'status', 'raw', 'profile_key', v_profile_key);
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'matched', true,
    'status', 'verified_rule',
    'profile_key', v_profile_key,
    'rule_id', v_rule.id,
    'canonical_fault_code', v_rule.canonical_fault_code,
    'title', v_rule.title,
    'category', v_rule.category,
    'severity', v_rule.severity,
    'description', v_rule.description,
    'recommended_action', v_rule.recommended_action,
    'evidence_source', v_rule.evidence_source
  ));
end;
$$;

revoke all on function public.resolve_telemetry_fault_rule_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_telemetry_fault_rule_v1(uuid, text, text) to service_role;

create or replace function public.ingest_telemetry_payload_v6(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := lower(btrim(coalesce(p_payload ->> 'type', '')));
  v_fault_code text;
  v_source text;
  v_rule jsonb;
  v_payload jsonb := p_payload;
  v_result jsonb;
  v_event_id uuid;
begin
  if v_type <> 'fault_state' then
    return public.ingest_telemetry_payload_v5(p_device_id, p_payload);
  end if;

  v_fault_code := left(btrim(coalesce(p_payload ->> 'fault_code', p_payload ->> 'code', 'UNKNOWN')), 80);
  if v_fault_code = '' then v_fault_code := 'UNKNOWN'; end if;
  v_source := left(coalesce(p_payload ->> 'source', ''), 80);

  v_rule := public.resolve_telemetry_fault_rule_v1(p_device_id, v_fault_code, nullif(v_source, ''));

  if coalesce((v_rule ->> 'matched')::boolean, false) and nullif(v_rule ->> 'severity', '') is not null then
    v_payload := jsonb_set(v_payload, '{severity}', to_jsonb(v_rule ->> 'severity'), true);
  end if;

  v_result := public.ingest_telemetry_payload_v5(p_device_id, v_payload);

  if coalesce((v_result ->> 'accepted')::boolean, false) then
    select f.id
      into v_event_id
    from public.telemetry_fault_events f
    where f.device_id = p_device_id
      and lower(btrim(f.fault_code)) = lower(btrim(v_fault_code))
    order by f.last_seen_at desc, f.started_at desc
    limit 1;

    if v_event_id is not null and coalesce((v_rule ->> 'matched')::boolean, false) then
      update public.telemetry_fault_events
      set profile_key = v_rule ->> 'profile_key',
          fault_rule_id = nullif(v_rule ->> 'rule_id', '')::uuid,
          canonical_fault_code = v_rule ->> 'canonical_fault_code',
          canonical_title = v_rule ->> 'title',
          fault_category = v_rule ->> 'category',
          recommended_action = v_rule ->> 'recommended_action',
          normalization_status = 'verified_rule',
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
            'fault_rule_evidence_source', v_rule ->> 'evidence_source',
            'fault_rule_description', v_rule ->> 'description'
          ))
      where id = v_event_id;
    end if;
  end if;

  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'fault_normalization', coalesce(v_rule ->> 'status', 'raw'),
    'canonical_fault_code', v_rule ->> 'canonical_fault_code'
  ));
end;
$$;

revoke all on function public.ingest_telemetry_payload_v6(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload_v6(uuid, jsonb) to service_role;

-- Preserve the stable RPC used by telemetry-ingest while routing new payloads through V6.
create or replace function public.ingest_telemetry_payload_v3(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.ingest_telemetry_payload_v6(p_device_id, p_payload);
$$;

revoke all on function public.ingest_telemetry_payload_v3(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload_v3(uuid, jsonb) to service_role;

comment on table public.machine_model_fault_rules is
  'Verified profile-specific mappings from raw machine fault codes to normalized fault metadata. No unverified manufacturer codes should be seeded.';
comment on column public.telemetry_fault_events.fault_code is
  'Raw fault code received from the telemetry device. Never replaced by normalized codes.';
comment on column public.telemetry_fault_events.normalization_status is
  'raw when no verified rule matched; verified_rule when profile-driven normalization was applied.';
