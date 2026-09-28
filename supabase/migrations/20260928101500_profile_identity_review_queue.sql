-- Operational decoder identity review queue.
-- Resolver recommendations remain advisory; persisted profile_id remains the trust boundary.

create or replace function public.get_telemetry_profile_identity_review_queue(
  p_filter text default 'needs_review',
  p_search text default '',
  p_offset integer default 0,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_filter text := lower(btrim(coalesce(nullif(p_filter, ''), 'needs_review')));
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 250);
  v_result jsonb;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;

  if v_filter not in ('needs_review', 'ambiguous', 'recommended', 'unresolved', 'all') then
    raise exception 'Invalid profile identity review filter.' using errcode = '22023';
  end if;

  with resolved as (
    select
      d.id,
      d.device_code,
      d.machine_id,
      d.profile_id,
      coalesce(d.profile_assignment_method, 'automatic') profile_assignment_method,
      d.reported_machine_profile_fingerprint,
      d.reported_machine_model,
      d.reported_machine_interface,
      d.reported_machine_revision,
      d.reported_machine_identity_source,
      d.reported_machine_identity_at,
      d.last_seen_at,
      m.machine_name,
      m.model machine_model,
      r.resolution
    from public.telemetry_devices d
    left join public.machines m on m.id = d.machine_id
    left join lateral (
      select public.resolve_telemetry_device_profile(d.id) resolution
    ) r on true
    where d.status = 'active'
      and d.telemetry_region = v_region
  ), classified as (
    select
      r.*,
      nullif(r.resolution->>'effective_profile_key', '') recommended_profile_key,
      nullif(r.resolution->'recommended_profile'->>'display_name', '') recommended_profile_name,
      nullif(r.resolution->>'confidence', '') profile_confidence,
      coalesce((r.resolution->>'ambiguous')::boolean, false) resolver_ambiguous,
      case
        when r.profile_assignment_method = 'manual' or r.profile_id is not null then 'trusted'
        when coalesce((r.resolution->>'ambiguous')::boolean, false)
          or coalesce(r.resolution->>'profile_resolution', '') = 'automatic_ambiguous' then 'ambiguous'
        when nullif(r.resolution->>'effective_profile_key', '') is not null
          or r.resolution->'recommended_profile' is not null then 'recommended'
        else 'unresolved'
      end review_class
    from resolved r
  ), filtered as (
    select c.*
    from classified c
    where (
        v_filter = 'all'
        or (v_filter = 'needs_review' and c.review_class in ('ambiguous', 'recommended', 'unresolved'))
        or c.review_class = v_filter
      )
      and (
        v_search = ''
        or lower(coalesce(c.device_code, '')) like '%' || v_search || '%'
        or lower(coalesce(c.reported_machine_model, '')) like '%' || v_search || '%'
        or lower(coalesce(c.reported_machine_interface, '')) like '%' || v_search || '%'
        or lower(coalesce(c.reported_machine_profile_fingerprint, '')) like '%' || v_search || '%'
        or lower(coalesce(c.machine_name, '')) like '%' || v_search || '%'
        or lower(coalesce(c.machine_model, '')) like '%' || v_search || '%'
        or lower(coalesce(c.profile_id, '')) like '%' || v_search || '%'
        or lower(coalesce(c.recommended_profile_key, '')) like '%' || v_search || '%'
      )
  ), page_rows as (
    select f.*
    from filtered f
    order by
      case f.review_class when 'ambiguous' then 0 when 'recommended' then 1 when 'unresolved' then 2 else 3 end,
      f.reported_machine_identity_at desc nulls last,
      lower(f.device_code),
      f.id
    limit v_limit offset v_offset
  ), summary as (
    select
      count(*)::bigint all_candidates,
      count(*) filter (where review_class in ('ambiguous', 'recommended', 'unresolved'))::bigint needs_review,
      count(*) filter (where review_class = 'ambiguous')::bigint ambiguous,
      count(*) filter (where review_class = 'recommended')::bigint recommended,
      count(*) filter (where review_class = 'unresolved')::bigint unresolved,
      count(*) filter (where review_class = 'trusted' and profile_assignment_method = 'manual')::bigint trusted_manual,
      count(*) filter (where review_class = 'trusted' and profile_assignment_method <> 'manual')::bigint trusted_automatic
    from classified
  )
  select jsonb_build_object(
    'telemetry_region', v_region,
    'rows', coalesce((select jsonb_agg(to_jsonb(p) - 'resolution' order by case p.review_class when 'ambiguous' then 0 when 'recommended' then 1 when 'unresolved' then 2 else 3 end, p.reported_machine_identity_at desc nulls last, p.device_code) from page_rows p), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'summary', jsonb_build_object(
      'all_candidates', s.all_candidates,
      'needs_review', s.needs_review,
      'ambiguous', s.ambiguous,
      'recommended', s.recommended,
      'unresolved', s.unresolved,
      'trusted_manual', s.trusted_manual,
      'trusted_automatic', s.trusted_automatic
    ),
    'limit', v_limit,
    'offset', v_offset,
    'generated_at', now()
  ) into v_result
  from summary s;

  return v_result;
end;
$function$;

revoke all on function public.get_telemetry_profile_identity_review_queue(text, text, integer, integer) from public;
revoke all on function public.get_telemetry_profile_identity_review_queue(text, text, integer, integer) from anon;
grant execute on function public.get_telemetry_profile_identity_review_queue(text, text, integer, integer) to authenticated;
grant execute on function public.get_telemetry_profile_identity_review_queue(text, text, integer, integer) to service_role;
