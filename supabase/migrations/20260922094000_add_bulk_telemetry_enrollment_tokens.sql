-- Fleet rollout: issue batches of UID-bound one-time enrollment tokens without
-- opening an unrestricted zero-touch window. Plaintext tokens are generated in
-- the browser and never stored in Supabase; this RPC accepts SHA-256 hashes only.

create or replace function public.create_telemetry_enrollment_tokens_bulk(
  p_rows jsonb,
  p_minutes integer default 1440,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_actor uuid := auth.uid();
  v_batch_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_item jsonb;
  v_hardware_uid text;
  v_token_hash text;
  v_row_label text;
  v_token public.telemetry_enrollment_tokens%rowtype;
  v_results jsonb := '[]'::jsonb;
  v_seen_uids text[] := array[]::text[];
  v_count integer;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  perform public.require_app_role(array['admin','operations']);

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Bulk enrollment rows must be a JSON array.' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 500 then
    raise exception 'Bulk enrollment supports between 1 and 500 devices per batch.' using errcode = '22023';
  end if;

  if p_minutes is null or p_minutes < 10 or p_minutes > 10080 then
    raise exception 'Bulk enrollment token duration must be between 10 minutes and 7 days.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each bulk enrollment row must be a JSON object.' using errcode = '22023';
    end if;

    v_hardware_uid := upper(btrim(coalesce(v_item ->> 'hardware_uid', '')));
    v_token_hash := lower(btrim(coalesce(v_item ->> 'token_hash', '')));
    v_row_label := nullif(btrim(coalesce(v_item ->> 'label', '')), '');

    if v_hardware_uid !~ '^[0-9A-F]{12}$' then
      raise exception 'Hardware UID % must contain exactly 12 hexadecimal characters.', coalesce(nullif(v_hardware_uid, ''), '<blank>') using errcode = '22023';
    end if;
    if v_token_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Enrollment token hash for % must be a SHA-256 hexadecimal digest.', v_hardware_uid using errcode = '22023';
    end if;
    if v_hardware_uid = any(v_seen_uids) then
      raise exception 'Hardware UID % appears more than once in this batch.', v_hardware_uid using errcode = '23505';
    end if;
    v_seen_uids := array_append(v_seen_uids, v_hardware_uid);

    if exists (
      select 1 from public.telemetry_devices d where d.hardware_uid = v_hardware_uid
    ) then
      raise exception 'Hardware UID % is already enrolled.', v_hardware_uid using errcode = '23505';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_hardware_uid, 0));

    update public.telemetry_enrollment_tokens
    set revoked_at = now()
    where expected_hardware_uid = v_hardware_uid
      and used_at is null
      and revoked_at is null;

    insert into public.telemetry_enrollment_tokens (
      token_hash,
      label,
      expected_hardware_uid,
      expires_at,
      created_by_auth_user_id,
      telemetry_region
    ) values (
      v_token_hash,
      coalesce(v_row_label, v_batch_label),
      v_hardware_uid,
      now() + make_interval(mins => p_minutes),
      v_actor,
      v_region
    )
    returning * into v_token;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'token_id', v_token.id,
      'hardware_uid', v_token.expected_hardware_uid,
      'label', v_token.label,
      'telemetry_region', v_region,
      'expires_at', v_token.expires_at,
      'seconds_remaining', greatest(floor(extract(epoch from (v_token.expires_at - now())))::integer, 0)
    ));
  end loop;

  return jsonb_build_object(
    'accepted', true,
    'telemetry_region', v_region,
    'count', v_count,
    'expires_in_minutes', p_minutes,
    'issued_at', now(),
    'tokens', v_results
  );
end;
$$;

revoke all on function public.create_telemetry_enrollment_tokens_bulk(jsonb,integer,text) from public, anon;
grant execute on function public.create_telemetry_enrollment_tokens_bulk(jsonb,integer,text) to authenticated;
