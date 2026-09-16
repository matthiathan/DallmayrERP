-- Keep telemetry/interface health diagnostics separate from manufacturer machine-fault rules.
-- The initial code is grounded in observed production telemetry and our own firmware semantics.

create table if not exists public.telemetry_platform_fault_codes (
  raw_fault_code text primary key,
  title text not null,
  category text not null,
  severity text,
  description text,
  recommended_action text,
  evidence_source text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telemetry_platform_fault_codes_code_nonempty check (btrim(raw_fault_code) <> ''),
  constraint telemetry_platform_fault_codes_severity_check check (severity is null or lower(severity) in ('info','warning','fault','critical'))
);

alter table public.telemetry_platform_fault_codes enable row level security;
revoke all on table public.telemetry_platform_fault_codes from anon;
grant select on table public.telemetry_platform_fault_codes to authenticated;
grant all on table public.telemetry_platform_fault_codes to service_role;

drop policy if exists telemetry_platform_fault_codes_read on public.telemetry_platform_fault_codes;
create policy telemetry_platform_fault_codes_read
  on public.telemetry_platform_fault_codes
  for select
  to authenticated
  using (public.is_active_app_user());

insert into public.telemetry_platform_fault_codes (
  raw_fault_code, title, category, severity, description, recommended_action, evidence_source, is_active
) values (
  'MDB_NO_VALID_TRAFFIC',
  'MDB traffic not detected',
  'Telemetry interface',
  'warning',
  'The telemetry receiver has not detected checksum-valid MDB master traffic within the monitoring window. This describes telemetry/interface visibility, not a manufacturer machine fault code.',
  'Check the isolated MDB sensing connection, communications common reference, GPIO/polarity configuration and Test Center raw traffic before investigating a machine component fault.',
  'Dallmayr telemetry firmware diagnostic observed in production telemetry_fault_events.',
  true
)
on conflict (raw_fault_code) do update set
  title = excluded.title,
  category = excluded.category,
  severity = excluded.severity,
  description = excluded.description,
  recommended_action = excluded.recommended_action,
  evidence_source = excluded.evidence_source,
  is_active = excluded.is_active,
  updated_at = now();

alter table public.telemetry_fault_events
  drop constraint if exists telemetry_fault_events_normalization_status_check;
alter table public.telemetry_fault_events
  add constraint telemetry_fault_events_normalization_status_check
  check (normalization_status in ('raw','verified_rule','telemetry_diagnostic'));

create or replace function public.resolve_telemetry_platform_fault_v1(p_fault_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.telemetry_platform_fault_codes%rowtype;
begin
  select * into v_code
  from public.telemetry_platform_fault_codes c
  where c.is_active
    and lower(btrim(c.raw_fault_code)) = lower(btrim(coalesce(p_fault_code, '')))
  limit 1;

  if not found then
    return jsonb_build_object('matched', false, 'status', 'raw');
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'matched', true,
    'status', 'telemetry_diagnostic',
    'raw_fault_code', v_code.raw_fault_code,
    'title', v_code.title,
    'category', v_code.category,
    'severity', v_code.severity,
    'description', v_code.description,
    'recommended_action', v_code.recommended_action,
    'evidence_source', v_code.evidence_source
  ));
end;
$$;

revoke all on function public.resolve_telemetry_platform_fault_v1(text) from public, anon, authenticated;
grant execute on function public.resolve_telemetry_platform_fault_v1(text) to service_role;

create or replace function public.reject_platform_fault_candidate_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.telemetry_platform_fault_codes c
    where c.is_active
      and lower(btrim(c.raw_fault_code)) = lower(btrim(new.raw_fault_code))
  ) then
    raise exception 'telemetry platform diagnostics cannot be promoted as machine-profile fault rules' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists telemetry_fault_rule_candidates_reject_platform on public.telemetry_fault_rule_candidates;
create trigger telemetry_fault_rule_candidates_reject_platform
before insert or update of raw_fault_code on public.telemetry_fault_rule_candidates
for each row execute function public.reject_platform_fault_candidate_v1();

create or replace function public.ingest_telemetry_payload_v7(
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
  v_platform jsonb;
  v_payload jsonb := p_payload;
  v_result jsonb;
  v_event_id uuid;
begin
  if v_type <> 'fault_state' then
    return public.ingest_telemetry_payload_v6(p_device_id, p_payload);
  end if;

  v_fault_code := left(btrim(coalesce(p_payload ->> 'fault_code', p_payload ->> 'code', 'UNKNOWN')), 80);
  if v_fault_code = '' then v_fault_code := 'UNKNOWN'; end if;
  v_platform := public.resolve_telemetry_platform_fault_v1(v_fault_code);

  if not coalesce((v_platform ->> 'matched')::boolean, false) then
    return public.ingest_telemetry_payload_v6(p_device_id, p_payload);
  end if;

  if nullif(v_platform ->> 'severity', '') is not null then
    v_payload := jsonb_set(v_payload, '{severity}', to_jsonb(v_platform ->> 'severity'), true);
  end if;

  v_result := public.ingest_telemetry_payload_v6(p_device_id, v_payload);

  if coalesce((v_result ->> 'accepted')::boolean, false) then
    select f.id into v_event_id
    from public.telemetry_fault_events f
    where f.device_id = p_device_id
      and lower(btrim(f.fault_code)) = lower(btrim(v_fault_code))
    order by f.last_seen_at desc, f.started_at desc
    limit 1;

    if v_event_id is not null then
      update public.telemetry_fault_events
      set canonical_fault_code = v_platform ->> 'raw_fault_code',
          canonical_title = v_platform ->> 'title',
          fault_category = v_platform ->> 'category',
          recommended_action = v_platform ->> 'recommended_action',
          normalization_status = 'telemetry_diagnostic',
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
            'platform_fault_evidence_source', v_platform ->> 'evidence_source',
            'platform_fault_description', v_platform ->> 'description'
          ))
      where id = v_event_id;
    end if;
  end if;

  return v_result || jsonb_build_object('fault_normalization', 'telemetry_diagnostic');
end;
$$;

revoke all on function public.ingest_telemetry_payload_v7(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload_v7(uuid, jsonb) to service_role;

create or replace function public.ingest_telemetry_payload_v3(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.ingest_telemetry_payload_v7(p_device_id, p_payload);
$$;

revoke all on function public.ingest_telemetry_payload_v3(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload_v3(uuid, jsonb) to service_role;

update public.telemetry_fault_events f
set canonical_fault_code = c.raw_fault_code,
    canonical_title = c.title,
    fault_category = c.category,
    recommended_action = c.recommended_action,
    normalization_status = 'telemetry_diagnostic',
    severity = coalesce(c.severity, f.severity),
    metadata = coalesce(f.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'platform_fault_evidence_source', c.evidence_source,
      'platform_fault_description', c.description
    ))
from public.telemetry_platform_fault_codes c
where c.is_active
  and f.normalization_status = 'raw'
  and lower(btrim(f.fault_code)) = lower(btrim(c.raw_fault_code));

comment on table public.telemetry_platform_fault_codes is
  'Telemetry-device/interface diagnostic codes owned by this platform. These are intentionally excluded from manufacturer machine-profile fault rules.';
