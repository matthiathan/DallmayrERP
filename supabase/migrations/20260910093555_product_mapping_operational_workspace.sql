create table if not exists public.product_mapping_history (
  id bigint generated always as identity primary key,
  profile_id uuid references public.machine_model_profiles(id) on delete set null,
  model_key text not null,
  event_type text not null,
  button_number integer,
  selection_code text,
  product_id uuid references public.products(id) on delete set null,
  product_name text,
  source_model_key text,
  metadata jsonb not null default '{}'::jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  constraint product_mapping_history_event_check check (event_type in ('baseline','map_insert','map_update','map_delete','copy'))
);

create index if not exists product_mapping_history_profile_time_idx
  on public.product_mapping_history (profile_id, changed_at desc);
create index if not exists product_mapping_history_model_time_idx
  on public.product_mapping_history ((lower(btrim(model_key))), changed_at desc);

alter table public.product_mapping_history enable row level security;
revoke all on public.product_mapping_history from anon;
revoke insert, update, delete on public.product_mapping_history from authenticated;
grant select on public.product_mapping_history to authenticated, service_role;

create policy product_mapping_history_authenticated_read
  on public.product_mapping_history for select to authenticated
  using (public.is_active_app_user());

create or replace function public.capture_product_mapping_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := coalesce(new.profile_id, old.profile_id);
  v_model_key text;
  v_product_id uuid := coalesce(new.product_id, old.product_id);
  v_product_name text;
  v_event text;
begin
  select mp.model_key into v_model_key
  from public.machine_model_profiles mp
  where mp.id = v_profile_id;

  select p.product_name into v_product_name
  from public.products p
  where p.id = v_product_id;

  v_event := case tg_op
    when 'INSERT' then 'map_insert'
    when 'UPDATE' then 'map_update'
    else 'map_delete'
  end;

  insert into public.product_mapping_history (
    profile_id, model_key, event_type, button_number, selection_code,
    product_id, product_name, changed_by, metadata
  ) values (
    v_profile_id,
    coalesce(v_model_key, 'Unknown profile'),
    v_event,
    coalesce(new.button_number, old.button_number),
    coalesce(new.selection_code, old.selection_code),
    v_product_id,
    v_product_name,
    auth.uid(),
    jsonb_build_object('operation', tg_op)
  );

  return coalesce(new, old);
end;
$$;

revoke all on function public.capture_product_mapping_history() from public, anon, authenticated;

drop trigger if exists machine_model_button_mappings_history on public.machine_model_button_mappings;
create trigger machine_model_button_mappings_history
after insert or update or delete on public.machine_model_button_mappings
for each row execute function public.capture_product_mapping_history();

insert into public.product_mapping_history (
  profile_id, model_key, event_type, button_number, selection_code,
  product_id, product_name, changed_by, metadata
)
select
  mp.id, mp.model_key, 'baseline', mm.button_number, mm.selection_code,
  p.id, p.product_name, null, jsonb_build_object('backfilled', true)
from public.machine_model_button_mappings mm
join public.machine_model_profiles mp on mp.id = mm.profile_id
join public.products p on p.id = mm.product_id
where not exists (
  select 1 from public.product_mapping_history h
  where h.profile_id = mp.id and h.event_type = 'baseline'
    and h.button_number = mm.button_number
);

create or replace function public.get_product_mapping_operational_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_result jsonb;
begin
  if not v_is_service_role and not public.is_active_app_user() then
    raise exception 'An active authenticated DallmayrERP user is required.' using errcode = '42501';
  end if;

  with effective_devices as (
    select
      d.id as device_id,
      d.device_code,
      d.machine_id,
      m.machine_name,
      m.model as machine_model,
      coalesce(
        case when coalesce(d.profile_assignment_method, 'automatic') = 'manual' then nullif(btrim(d.profile_id), '') end,
        nullif(btrim(d.applied_config ->> 'profile_id'), ''),
        reported_profile.model_key,
        machine_profile.model_key
      ) as effective_profile_key
    from public.telemetry_devices d
    left join public.machines m on m.id = d.machine_id
    left join lateral (
      select mp.model_key
      from public.machine_model_profiles mp
      where regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(coalesce(d.reported_machine_model, '')), '[^a-z0-9]+', '', 'g')
        and btrim(coalesce(d.reported_machine_model, '')) <> ''
      limit 1
    ) reported_profile on true
    left join lateral (
      select mp.model_key
      from public.machine_model_profiles mp
      where regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(coalesce(m.model, m.machine_name, '')), '[^a-z0-9]+', '', 'g')
        and btrim(coalesce(m.model, m.machine_name, '')) <> ''
      limit 1
    ) machine_profile on true
    where d.status = 'active'
  ),
  profile_rows as (
    select
      mp.id,
      mp.model_key,
      mp.display_name,
      mp.button_count,
      count(distinct mm.id)::integer as mapped_count,
      greatest(mp.button_count - count(distinct mm.id)::integer, 0) as unmapped_count,
      case when mp.button_count > 0
        then round((count(distinct mm.id)::numeric * 100) / mp.button_count)::integer
        else 0 end as completeness_percent,
      count(distinct case when p.is_active = false then mm.id end)::integer as inactive_product_count,
      (select count(*)::integer from public.machines m
        where regexp_replace(lower(coalesce(m.model, m.machine_name, '')), '[^a-z0-9]+', '', 'g') =
              regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g')) as machine_count,
      (select count(*)::integer from effective_devices ed
        where lower(btrim(coalesce(ed.effective_profile_key, ''))) = lower(btrim(mp.model_key))) as active_device_count,
      mp.updated_at
    from public.machine_model_profiles mp
    left join public.machine_model_button_mappings mm on mm.profile_id = mp.id
    left join public.products p on p.id = mm.product_id
    group by mp.id, mp.model_key, mp.display_name, mp.button_count, mp.updated_at
  ),
  unmapped_rows as (
    select
      ed.device_id,
      ed.device_code,
      ed.machine_id,
      ed.machine_name,
      ed.machine_model,
      ed.effective_profile_key as profile_key,
      cs.selection_code,
      max(cs.sold_total)::bigint as sold_total,
      max(cs.failed_total)::bigint as failed_total,
      max(cs.updated_at) as last_seen_at
    from public.telemetry_counter_state cs
    join effective_devices ed on ed.device_id = cs.device_id
    left join public.machine_model_profiles mp
      on lower(btrim(mp.model_key)) = lower(btrim(coalesce(ed.effective_profile_key, '')))
    left join public.machine_model_button_mappings mm
      on mm.profile_id = mp.id
     and lower(btrim(mm.selection_code)) = lower(btrim(cs.selection_code))
    where mm.id is null
      and btrim(coalesce(cs.selection_code, '')) <> ''
      and (coalesce(cs.sold_total, 0) > 0 or coalesce(cs.failed_total, 0) > 0)
    group by ed.device_id, ed.device_code, ed.machine_id, ed.machine_name,
             ed.machine_model, ed.effective_profile_key, cs.selection_code
    order by max(cs.updated_at) desc
    limit 100
  )
  select jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'model_key', pr.model_key,
        'display_name', pr.display_name,
        'button_count', pr.button_count,
        'mapped_count', pr.mapped_count,
        'unmapped_count', pr.unmapped_count,
        'completeness_percent', pr.completeness_percent,
        'inactive_product_count', pr.inactive_product_count,
        'machine_count', pr.machine_count,
        'active_device_count', pr.active_device_count,
        'updated_at', pr.updated_at
      ) order by pr.active_device_count desc, pr.machine_count desc, pr.display_name)
      from profile_rows pr
    ), '[]'::jsonb),
    'unmapped_selections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'device_id', ur.device_id,
        'device_code', ur.device_code,
        'machine_id', ur.machine_id,
        'machine_name', ur.machine_name,
        'machine_model', ur.machine_model,
        'profile_key', ur.profile_key,
        'selection_code', ur.selection_code,
        'sold_total', ur.sold_total,
        'failed_total', ur.failed_total,
        'last_seen_at', ur.last_seen_at
      ) order by ur.last_seen_at desc)
      from unmapped_rows ur
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_product_mapping_operational_summary() from public, anon;
grant execute on function public.get_product_mapping_operational_summary() to authenticated, service_role;

create or replace function public.get_product_mapping_history(
  p_model_key text default null,
  p_limit integer default 50
)
returns table (
  id bigint,
  model_key text,
  event_type text,
  button_number integer,
  selection_code text,
  product_name text,
  source_model_key text,
  changed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if not v_is_service_role and not public.is_active_app_user() then
    raise exception 'An active authenticated DallmayrERP user is required.' using errcode = '42501';
  end if;

  return query
  select h.id, h.model_key, h.event_type, h.button_number, h.selection_code,
         h.product_name, h.source_model_key, h.changed_at
  from public.product_mapping_history h
  where nullif(btrim(coalesce(p_model_key, '')), '') is null
     or lower(btrim(h.model_key)) = lower(btrim(p_model_key))
  order by h.changed_at desc, h.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.get_product_mapping_history(text,integer) from public, anon;
grant execute on function public.get_product_mapping_history(text,integer) to authenticated, service_role;

create or replace function public.copy_machine_model_profile_mappings(
  p_source_model_key text,
  p_target_model_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_source public.machine_model_profiles%rowtype;
  v_target_id uuid;
  v_mapping_count integer;
  v_refreshed_sales integer := 0;
  v_source_key text := btrim(coalesce(p_source_model_key, ''));
  v_target_key text := btrim(coalesce(p_target_model_key, ''));
begin
  if not v_is_service_role and not public.is_active_app_user() then
    raise exception 'An active authenticated DallmayrERP user is required.' using errcode = '42501';
  end if;
  if v_source_key = '' or v_target_key = '' then
    raise exception 'Source and target machine models are required.' using errcode = '22023';
  end if;
  if lower(v_source_key) = lower(v_target_key) then
    raise exception 'Source and target profiles must be different.' using errcode = '22023';
  end if;

  select * into v_source
  from public.machine_model_profiles
  where lower(btrim(model_key)) = lower(v_source_key)
  limit 1;
  if not found then
    raise exception 'Source decoder profile not found.' using errcode = '22023';
  end if;

  select count(*)::integer into v_mapping_count
  from public.machine_model_button_mappings
  where profile_id = v_source.id;
  if v_mapping_count = 0 then
    raise exception 'Source profile has no product mappings to copy.' using errcode = '22023';
  end if;

  select id into v_target_id
  from public.machine_model_profiles
  where lower(btrim(model_key)) = lower(v_target_key)
  limit 1;

  if v_target_id is null then
    insert into public.machine_model_profiles (model_key, display_name, button_count)
    values (v_target_key, v_target_key, v_source.button_count)
    returning id into v_target_id;
  else
    update public.machine_model_profiles
    set button_count = v_source.button_count,
        updated_at = now()
    where id = v_target_id;
  end if;

  delete from public.machine_model_button_mappings where profile_id = v_target_id;

  insert into public.machine_model_button_mappings (profile_id, button_number, selection_code, product_id)
  select v_target_id, mm.button_number, mm.selection_code, mm.product_id
  from public.machine_model_button_mappings mm
  where mm.profile_id = v_source.id
  on conflict (profile_id, button_number) do update
    set selection_code = excluded.selection_code,
        product_id = excluded.product_id,
        updated_at = now();

  v_refreshed_sales := private.refresh_product_mapping_sales(v_target_id);

  insert into public.product_mapping_history (
    profile_id, model_key, event_type, source_model_key, changed_by, metadata
  ) values (
    v_target_id, v_target_key, 'copy', v_source.model_key, auth.uid(),
    jsonb_build_object('mapping_count', v_mapping_count, 'button_count', v_source.button_count)
  );

  return jsonb_build_object(
    'accepted', true,
    'source_model_key', v_source.model_key,
    'target_model_key', v_target_key,
    'profile_id', v_target_id,
    'button_count', v_source.button_count,
    'mapping_count', v_mapping_count,
    'refreshed_sales_rows', v_refreshed_sales
  );
end;
$$;

revoke all on function public.copy_machine_model_profile_mappings(text,text) from public, anon;
grant execute on function public.copy_machine_model_profile_mappings(text,text) to authenticated, service_role;
