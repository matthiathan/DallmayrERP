-- Evidence-backed workflow for turning observed raw machine faults into verified profile rules.
-- Technicians can propose; only operations/admin can activate a rule.

create table if not exists public.telemetry_fault_rule_candidates (
  id uuid primary key default gen_random_uuid(),
  fault_event_id uuid not null references public.telemetry_fault_events(id) on delete cascade,
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  machine_id uuid references public.machines(id) on delete set null,
  profile_key text not null,
  interface text,
  raw_fault_code text not null,
  proposed_canonical_fault_code text not null,
  proposed_title text not null,
  proposed_category text,
  proposed_severity text,
  proposed_description text,
  proposed_recommended_action text,
  evidence_note text not null,
  status text not null default 'pending',
  submitted_by uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telemetry_fault_rule_candidates_profile_nonempty check (btrim(profile_key) <> ''),
  constraint telemetry_fault_rule_candidates_raw_nonempty check (btrim(raw_fault_code) <> ''),
  constraint telemetry_fault_rule_candidates_code_nonempty check (btrim(proposed_canonical_fault_code) <> ''),
  constraint telemetry_fault_rule_candidates_title_nonempty check (btrim(proposed_title) <> ''),
  constraint telemetry_fault_rule_candidates_evidence_nonempty check (btrim(evidence_note) <> ''),
  constraint telemetry_fault_rule_candidates_interface_check check (interface is null or lower(interface) in ('mdb','dex','vendor','manual','any')),
  constraint telemetry_fault_rule_candidates_severity_check check (proposed_severity is null or lower(proposed_severity) in ('info','warning','fault','critical')),
  constraint telemetry_fault_rule_candidates_status_check check (status in ('pending','verified','rejected'))
);

create index if not exists telemetry_fault_rule_candidates_status_created
  on public.telemetry_fault_rule_candidates (status, created_at desc);
create index if not exists telemetry_fault_rule_candidates_profile_code
  on public.telemetry_fault_rule_candidates (profile_key, raw_fault_code, status);
create unique index if not exists telemetry_fault_rule_candidates_one_pending
  on public.telemetry_fault_rule_candidates (
    lower(btrim(profile_key)),
    lower(coalesce(interface, 'any')),
    lower(btrim(raw_fault_code))
  ) where status = 'pending';

alter table public.telemetry_fault_rule_candidates enable row level security;
revoke all on table public.telemetry_fault_rule_candidates from anon;
revoke insert, update, delete on table public.telemetry_fault_rule_candidates from authenticated;
grant select on table public.telemetry_fault_rule_candidates to authenticated;
grant all on table public.telemetry_fault_rule_candidates to service_role;

drop policy if exists telemetry_fault_rule_candidates_read on public.telemetry_fault_rule_candidates;
create policy telemetry_fault_rule_candidates_read
  on public.telemetry_fault_rule_candidates
  for select
  to authenticated
  using (public.is_active_app_user());

create or replace function public.submit_telemetry_fault_rule_candidate_v1(
  p_fault_event_id uuid,
  p_canonical_fault_code text,
  p_title text,
  p_category text default null,
  p_severity text default null,
  p_description text default null,
  p_recommended_action text default null,
  p_evidence_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(public.current_app_role(), '');
  v_fault public.telemetry_fault_events%rowtype;
  v_profile_key text;
  v_interface text;
  v_candidate public.telemetry_fault_rule_candidates%rowtype;
  v_severity text := lower(nullif(btrim(coalesce(p_severity, '')), ''));
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_role not in ('admin','operations','technician','road_technician') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_canonical_fault_code, '')), '') is null
     or nullif(btrim(coalesce(p_title, '')), '') is null
     or nullif(btrim(coalesce(p_evidence_note, '')), '') is null then
    raise exception 'canonical code, title and evidence note are required' using errcode = '22023';
  end if;
  if v_severity is not null and v_severity not in ('info','warning','fault','critical') then
    raise exception 'invalid severity' using errcode = '22023';
  end if;

  select * into v_fault
  from public.telemetry_fault_events
  where id = p_fault_event_id;
  if not found then
    raise exception 'fault event not found' using errcode = 'P0002';
  end if;
  if v_fault.normalization_status <> 'raw' then
    raise exception 'fault event is already normalized' using errcode = '22023';
  end if;

  v_profile_key := public.resolve_effective_telemetry_profile_key(v_fault.device_id, v_fault.machine_id);
  if nullif(btrim(coalesce(v_profile_key, '')), '') is null then
    raise exception 'no effective machine profile is available for this fault' using errcode = '22023';
  end if;

  select lower(nullif(btrim(d.reported_machine_interface), ''))
    into v_interface
  from public.telemetry_devices d
  where d.id = v_fault.device_id;
  if v_interface not in ('mdb','dex','vendor','manual') then
    v_interface := case when lower(btrim(coalesce(v_fault.source, ''))) in ('mdb','dex','vendor','manual')
      then lower(btrim(v_fault.source)) else 'any' end;
  end if;

  select * into v_candidate
  from public.telemetry_fault_rule_candidates c
  where c.status = 'pending'
    and lower(btrim(c.profile_key)) = lower(btrim(v_profile_key))
    and lower(coalesce(c.interface, 'any')) = lower(coalesce(v_interface, 'any'))
    and lower(btrim(c.raw_fault_code)) = lower(btrim(v_fault.fault_code))
  order by c.created_at desc
  limit 1;

  if found then
    return jsonb_build_object('accepted', true, 'duplicate', true, 'candidate_id', v_candidate.id, 'status', v_candidate.status);
  end if;

  insert into public.telemetry_fault_rule_candidates (
    fault_event_id, device_id, machine_id, profile_key, interface, raw_fault_code,
    proposed_canonical_fault_code, proposed_title, proposed_category, proposed_severity,
    proposed_description, proposed_recommended_action, evidence_note, submitted_by
  ) values (
    v_fault.id, v_fault.device_id, v_fault.machine_id, v_profile_key, v_interface, v_fault.fault_code,
    left(btrim(p_canonical_fault_code), 120), left(btrim(p_title), 160), left(nullif(btrim(coalesce(p_category, '')), ''), 120), v_severity,
    left(nullif(btrim(coalesce(p_description, '')), ''), 1000), left(nullif(btrim(coalesce(p_recommended_action, '')), ''), 1000),
    left(btrim(p_evidence_note), 1000), auth.uid()
  ) returning * into v_candidate;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'candidate_id', v_candidate.id,
    'status', v_candidate.status,
    'profile_key', v_candidate.profile_key,
    'raw_fault_code', v_candidate.raw_fault_code
  );
end;
$$;

revoke all on function public.submit_telemetry_fault_rule_candidate_v1(uuid,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.submit_telemetry_fault_rule_candidate_v1(uuid,text,text,text,text,text,text,text) to authenticated, service_role;

create or replace function public.review_telemetry_fault_rule_candidate_v1(
  p_candidate_id uuid,
  p_action text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(public.current_app_role(), '');
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_candidate public.telemetry_fault_rule_candidates%rowtype;
  v_profile_id uuid;
  v_rule public.machine_model_fault_rules%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_role not in ('admin','operations') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;
  if v_action not in ('verify','reject') then
    raise exception 'action must be verify or reject' using errcode = '22023';
  end if;

  select * into v_candidate
  from public.telemetry_fault_rule_candidates
  where id = p_candidate_id
  for update;
  if not found then
    raise exception 'fault rule candidate not found' using errcode = 'P0002';
  end if;
  if v_candidate.status <> 'pending' then
    return jsonb_build_object('accepted', true, 'status', v_candidate.status, 'candidate_id', v_candidate.id);
  end if;

  if v_action = 'reject' then
    update public.telemetry_fault_rule_candidates
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(nullif(btrim(coalesce(p_review_note, '')), ''), 1000), updated_at = now()
    where id = v_candidate.id;
    return jsonb_build_object('accepted', true, 'status', 'rejected', 'candidate_id', v_candidate.id);
  end if;

  select p.id into v_profile_id
  from public.machine_model_profiles p
  where lower(btrim(p.model_key)) = lower(btrim(v_candidate.profile_key))
  limit 1;
  if v_profile_id is null then
    raise exception 'machine profile no longer exists' using errcode = 'P0002';
  end if;

  select * into v_rule
  from public.machine_model_fault_rules r
  where r.profile_id = v_profile_id
    and lower(coalesce(r.interface, 'any')) = lower(coalesce(v_candidate.interface, 'any'))
    and lower(btrim(r.raw_fault_code)) = lower(btrim(v_candidate.raw_fault_code))
  limit 1;

  if found then
    update public.machine_model_fault_rules
    set canonical_fault_code = v_candidate.proposed_canonical_fault_code,
        title = v_candidate.proposed_title,
        category = v_candidate.proposed_category,
        severity = v_candidate.proposed_severity,
        description = v_candidate.proposed_description,
        recommended_action = v_candidate.proposed_recommended_action,
        evidence_source = 'Field evidence: ' || v_candidate.evidence_note,
        is_verified = true,
        is_active = true,
        updated_at = now()
    where id = v_rule.id
    returning * into v_rule;
  else
    insert into public.machine_model_fault_rules (
      profile_id, interface, raw_fault_code, canonical_fault_code, title, category, severity,
      description, recommended_action, evidence_source, is_verified, is_active
    ) values (
      v_profile_id, v_candidate.interface, v_candidate.raw_fault_code, v_candidate.proposed_canonical_fault_code,
      v_candidate.proposed_title, v_candidate.proposed_category, v_candidate.proposed_severity,
      v_candidate.proposed_description, v_candidate.proposed_recommended_action,
      'Field evidence: ' || v_candidate.evidence_note, true, true
    ) returning * into v_rule;
  end if;

  update public.telemetry_fault_rule_candidates
  set status = 'verified', reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(nullif(btrim(coalesce(p_review_note, '')), ''), 1000), updated_at = now()
  where id = v_candidate.id;

  update public.telemetry_fault_events
  set profile_key = v_candidate.profile_key,
      fault_rule_id = v_rule.id,
      canonical_fault_code = v_rule.canonical_fault_code,
      canonical_title = v_rule.title,
      fault_category = v_rule.category,
      recommended_action = v_rule.recommended_action,
      normalization_status = 'verified_rule',
      severity = coalesce(v_rule.severity, severity),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'fault_rule_evidence_source', v_rule.evidence_source,
        'fault_rule_description', v_rule.description
      )
  where device_id = v_candidate.device_id
    and cleared_at is null
    and lower(btrim(fault_code)) = lower(btrim(v_candidate.raw_fault_code));

  return jsonb_build_object(
    'accepted', true,
    'status', 'verified',
    'candidate_id', v_candidate.id,
    'rule_id', v_rule.id,
    'profile_key', v_candidate.profile_key,
    'raw_fault_code', v_candidate.raw_fault_code,
    'canonical_fault_code', v_rule.canonical_fault_code
  );
end;
$$;

revoke all on function public.review_telemetry_fault_rule_candidate_v1(uuid,text,text) from public, anon;
grant execute on function public.review_telemetry_fault_rule_candidate_v1(uuid,text,text) to authenticated, service_role;

comment on table public.telemetry_fault_rule_candidates is
  'Evidence-backed proposed mappings from observed raw machine fault events. Pending candidates never affect live fault severity until operations/admin verification.';