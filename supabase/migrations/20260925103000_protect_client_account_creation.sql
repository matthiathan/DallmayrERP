-- Do not let the create-account path mutate an existing Dallmayr or client account.
-- Existing accounts must be changed explicitly through admin_update_user_access_v2,
-- which preserves self-demotion and final-administrator protections.

create or replace function public.admin_create_user_access_v2(
  p_email text,
  p_account_scope text,
  p_customer_id uuid default null,
  p_telemetry_region text default null,
  p_role text default 'operations',
  p_branch text default 'jhb',
  p_is_active boolean default true,
  p_access_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_email text := lower(trim(coalesce(p_email,'')));
  v_scope text := lower(trim(coalesce(p_account_scope,'dallmayr')));
  v_region text := nullif(lower(trim(coalesce(p_telemetry_region,''))), '');
  v_role text := lower(trim(coalesce(p_role,'operations')));
  v_branch text := lower(trim(coalesce(p_branch,'jhb')));
  v_user_id uuid;
begin
  if not public.is_dallmayr_app_user() or public.current_app_role() <> 'admin' then
    raise exception 'Only a Dallmayr Administrator may add users' using errcode='42501';
  end if;
  if v_email = '' or position('@' in v_email) <= 1 then
    raise exception 'Enter a valid email address';
  end if;
  if exists(select 1 from public.users u where lower(u.email) = v_email) then
    raise exception 'An access record already exists for this email. Update the existing user instead.' using errcode='23505';
  end if;
  if v_scope not in ('dallmayr','client') then
    raise exception 'Invalid account scope';
  end if;

  if v_scope = 'client' then
    if p_customer_id is null or not exists(
      select 1 from public.customers c
      where c.id=p_customer_id and lower(coalesce(c.status,'active'))='active'
    ) then
      raise exception 'Select an active client company';
    end if;
    if v_region not in ('south_africa','dubai','europe') then
      raise exception 'Select the client telemetry region';
    end if;
    v_role := 'client_viewer';
    v_branch := 'national';
  else
    if v_role not in ('admin','operations','sales','finance','marketing','executive','warehouse_staff','technician','road_technician') then
      raise exception 'Invalid ERP role';
    end if;
    if v_branch not in ('jhb','cpt','kzn','national') then
      raise exception 'Invalid ERP branch';
    end if;
  end if;

  insert into public.users(
    email,is_active,access_note,access_updated_by,access_updated_at,updated_at,account_scope,customer_id
  ) values(
    v_email,
    coalesce(p_is_active,true),
    nullif(trim(coalesce(p_access_note,'')),''),
    v_actor,
    now(),
    now(),
    v_scope,
    case when v_scope='client' then p_customer_id else null end
  )
  returning id into v_user_id;

  insert into public.user_details(user_id,role,branch,telemetry_region,updated_at)
  values(v_user_id,v_role,v_branch,v_region,now());

  return v_user_id;
end;
$$;

revoke all on function public.admin_create_user_access_v2(text,text,uuid,text,text,text,boolean,text) from public, anon;
grant execute on function public.admin_create_user_access_v2(text,text,uuid,text,text,text,boolean,text) to authenticated, service_role;
