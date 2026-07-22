create or replace function public.normalise_service_customer_name(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(lower(coalesce(p_value, '')), '^\s*fos\s*[-:]?\s*', ''),
    '[^a-z0-9]+',
    '',
    'g'
  );
$$;

create or replace function public.parse_legacy_service_date(p_value text)
returns date
language plpgsql
immutable
as $$
declare
  v_token text;
begin
  v_token := substring(trim(coalesce(p_value, '')) from '^([0-9]{2}-[A-Za-z]{3}-[0-9]{2})');
  if v_token is null then return null; end if;
  return to_date(v_token, 'DD-Mon-YY');
exception when others then
  return null;
end;
$$;

create table if not exists public.customer_service_plans (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  branch text not null,
  service_mode text not null default 'on_request' check (service_mode in ('monthly', 'on_request')),
  status text not null default 'pending_finance_review' check (status in ('pending_finance_review', 'active', 'suspended', 'ended')),
  monthly_fee numeric(14,2),
  preferred_day_of_month integer check (preferred_day_of_month between 1 and 31),
  service_window_days integer not null default 7 check (service_window_days between 0 and 21),
  effective_from date,
  effective_to date,
  source text,
  notes text,
  finance_verified_by uuid references public.users(id),
  finance_verified_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id)
);

create table if not exists public.customer_service_payments (
  id uuid primary key default gen_random_uuid(),
  service_plan_id uuid not null references public.customer_service_plans(id) on delete cascade,
  service_month date not null check (service_month = date_trunc('month', service_month)::date),
  payment_status text not null check (payment_status in ('pending', 'paid', 'unpaid', 'refunded', 'waived')),
  amount numeric(14,2),
  payment_reference text,
  paid_at timestamptz,
  notes text,
  verified_by uuid references public.users(id),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service_plan_id, service_month)
);

alter table public.service_jobs
  add column if not exists route_number text,
  add column if not exists route_order integer;

create table if not exists public.monthly_service_obligations (
  id uuid primary key default gen_random_uuid(),
  service_plan_id uuid not null references public.customer_service_plans(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  branch text not null,
  service_month date not null check (service_month = date_trunc('month', service_month)::date),
  original_scheduled_date date not null,
  scheduled_date date not null,
  status text not null default 'due' check (status in ('due', 'assigned', 'in_progress', 'completed', 'rescheduled', 'waived', 'cancelled')),
  assigned_to uuid references public.users(id),
  route_number text,
  route_order integer,
  service_job_id uuid unique references public.service_jobs(id) on delete set null,
  completion_source text check (completion_source is null or completion_source in ('service_job', 'historical_log', 'manual')),
  completion_reference text,
  completed_at timestamptz,
  reschedule_reason text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service_plan_id, service_month)
);

create index if not exists customer_service_plans_branch_status_idx
  on public.customer_service_plans(branch, status, service_mode);
create index if not exists customer_service_payments_month_status_idx
  on public.customer_service_payments(service_month, payment_status);
create index if not exists monthly_service_obligations_date_idx
  on public.monthly_service_obligations(scheduled_date, branch, status);
create index if not exists monthly_service_obligations_assignee_idx
  on public.monthly_service_obligations(assigned_to, scheduled_date);

alter table public.customer_service_plans enable row level security;
alter table public.customer_service_payments enable row level security;
alter table public.monthly_service_obligations enable row level security;

drop policy if exists customer_service_plans_select on public.customer_service_plans;
create policy customer_service_plans_select on public.customer_service_plans
for select to authenticated
using (public.current_app_role() in ('admin','operations','finance','executive'));

drop policy if exists customer_service_payments_select on public.customer_service_payments;
create policy customer_service_payments_select on public.customer_service_payments
for select to authenticated
using (public.current_app_role() in ('admin','operations','finance','executive'));

drop policy if exists monthly_service_obligations_select on public.monthly_service_obligations;
create policy monthly_service_obligations_select on public.monthly_service_obligations
for select to authenticated
using (
  public.current_app_role() in ('admin','operations','finance','executive')
  or assigned_to = public.current_app_user_id()
);

create or replace function public.find_historical_service_completion(
  p_customer_id uuid,
  p_service_month date
)
returns table(service_date date, source_table text, document_number text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_branch text;
  v_code text;
  v_name_key text;
  v_month date := date_trunc('month', p_service_month)::date;
begin
  select lower(c.branch), c.customer_code, public.normalise_service_customer_name(c.customer_name)
    into v_branch, v_code, v_name_key
  from public.customers c
  where c.id = p_customer_id;

  if v_branch = 'jhb' then
    return query
    select public.parse_legacy_service_date(l."Date"), 'service_call_log_jhb'::text, l."DocNo"
    from public.service_call_log_jhb l
    where upper(coalesce(l."Service Type", '')) = 'SERVICE'
      and date_trunc('month', public.parse_legacy_service_date(l."Date"))::date = v_month
      and (
        (nullif(trim(coalesce(v_code, '')), '') is not null and lower(trim(coalesce(l."Customer Code", ''))) = lower(trim(v_code)))
        or public.normalise_service_customer_name(l."Client Name") = v_name_key
        or public.normalise_service_customer_name(l."Client Name") like v_name_key || '%'
      )
    order by public.parse_legacy_service_date(l."Date")
    limit 1;
  elsif v_branch = 'kzn' then
    return query
    select public.parse_legacy_service_date(l."Date"), 'service_call_log_kzn'::text, l."DocNo"
    from public.service_call_log_kzn l
    where upper(coalesce(l."Service Type", '')) = 'SERVICE'
      and date_trunc('month', public.parse_legacy_service_date(l."Date"))::date = v_month
      and (
        public.normalise_service_customer_name(l."Client Name") = v_name_key
        or public.normalise_service_customer_name(l."Client Name") like v_name_key || '%'
      )
    order by public.parse_legacy_service_date(l."Date")
    limit 1;
  elsif v_branch = 'cpt' then
    return query
    select public.parse_legacy_service_date(l."Date"), 'preventive_service_log_cpt'::text, l."DocNo"
    from public.preventive_service_log_cpt l
    where upper(coalesce(l."Service Type", '')) = 'SERVICE'
      and date_trunc('month', public.parse_legacy_service_date(l."Date"))::date = v_month
      and (
        public.normalise_service_customer_name(l."Client Name") = v_name_key
        or public.normalise_service_customer_name(l."Client Name") like v_name_key || '%'
      )
    order by public.parse_legacy_service_date(l."Date")
    limit 1;
  end if;
end;
$$;

create or replace function public.ensure_paid_monthly_service_obligation(
  p_service_plan_id uuid,
  p_service_month date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.customer_service_plans%rowtype;
  v_month date := date_trunc('month', p_service_month)::date;
  v_last_day integer;
  v_day integer;
  v_scheduled date;
  v_obligation_id uuid;
  v_history record;
begin
  select * into v_plan from public.customer_service_plans where id = p_service_plan_id;
  if v_plan.id is null or v_plan.service_mode <> 'monthly' or v_plan.status <> 'active' then
    raise exception 'An active monthly service plan is required';
  end if;
  if not exists (
    select 1 from public.customer_service_payments p
    where p.service_plan_id = p_service_plan_id
      and p.service_month = v_month
      and p.payment_status = 'paid'
  ) then
    raise exception 'The monthly service payment has not been confirmed';
  end if;

  v_last_day := extract(day from (v_month + interval '1 month - 1 day'))::integer;
  v_day := least(coalesce(v_plan.preferred_day_of_month, 15), v_last_day);
  v_scheduled := make_date(extract(year from v_month)::integer, extract(month from v_month)::integer, v_day);

  select * into v_history
  from public.find_historical_service_completion(v_plan.customer_id, v_month)
  limit 1;

  insert into public.monthly_service_obligations (
    service_plan_id, customer_id, branch, service_month,
    original_scheduled_date, scheduled_date, status,
    completion_source, completion_reference, completed_at, created_by
  ) values (
    v_plan.id, v_plan.customer_id, v_plan.branch, v_month,
    v_scheduled, v_scheduled,
    case when v_history.service_date is not null then 'completed' else 'due' end,
    case when v_history.service_date is not null then 'historical_log' else null end,
    case when v_history.service_date is not null then concat(v_history.source_table, ':', coalesce(v_history.document_number, '')) else null end,
    case when v_history.service_date is not null then v_history.service_date::timestamptz else null end,
    public.current_app_user_id()
  )
  on conflict (service_plan_id, service_month) do update set updated_at = now()
  returning id into v_obligation_id;

  return v_obligation_id;
end;
$$;

create or replace function public.save_customer_service_plan(
  p_customer_id uuid,
  p_service_mode text,
  p_status text,
  p_monthly_fee numeric default null,
  p_preferred_day integer default null,
  p_window_days integer default 7,
  p_effective_from date default null,
  p_effective_to date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_app_role();
  v_user uuid := public.current_app_user_id();
  v_customer public.customers%rowtype;
  v_id uuid;
begin
  if v_role not in ('admin','finance') then
    raise exception 'Only Finance or an Administrator may confirm service plans' using errcode='42501';
  end if;
  if p_service_mode not in ('monthly','on_request') then raise exception 'Invalid service mode'; end if;
  if p_status not in ('pending_finance_review','active','suspended','ended') then raise exception 'Invalid plan status'; end if;

  select * into v_customer from public.customers where id=p_customer_id;
  if v_customer.id is null then raise exception 'Customer not found'; end if;

  insert into public.customer_service_plans (
    customer_id, branch, service_mode, status, monthly_fee,
    preferred_day_of_month, service_window_days,
    effective_from, effective_to, source, notes,
    finance_verified_by, finance_verified_at, created_by
  ) values (
    v_customer.id, v_customer.branch, p_service_mode, p_status, p_monthly_fee,
    p_preferred_day, coalesce(p_window_days,7), p_effective_from, p_effective_to,
    'finance_confirmed', p_notes,
    case when p_status='active' then v_user else null end,
    case when p_status='active' then now() else null end,
    v_user
  )
  on conflict (customer_id) do update set
    branch=excluded.branch,
    service_mode=excluded.service_mode,
    status=excluded.status,
    monthly_fee=excluded.monthly_fee,
    preferred_day_of_month=excluded.preferred_day_of_month,
    service_window_days=excluded.service_window_days,
    effective_from=excluded.effective_from,
    effective_to=excluded.effective_to,
    notes=excluded.notes,
    finance_verified_by=case when excluded.status='active' then v_user else customer_service_plans.finance_verified_by end,
    finance_verified_at=case when excluded.status='active' then now() else customer_service_plans.finance_verified_at end,
    updated_at=now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.record_customer_service_payment(
  p_service_plan_id uuid,
  p_service_month date,
  p_payment_status text,
  p_amount numeric default null,
  p_reference text default null,
  p_paid_at timestamptz default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_app_role();
  v_user uuid := public.current_app_user_id();
  v_month date := date_trunc('month', p_service_month)::date;
  v_payment_id uuid;
begin
  if v_role not in ('admin','finance') then
    raise exception 'Only Finance or an Administrator may record service payments' using errcode='42501';
  end if;
  if p_payment_status not in ('pending','paid','unpaid','refunded','waived') then raise exception 'Invalid payment status'; end if;

  insert into public.customer_service_payments (
    service_plan_id, service_month, payment_status, amount,
    payment_reference, paid_at, notes, verified_by, verified_at
  ) values (
    p_service_plan_id, v_month, p_payment_status, p_amount,
    p_reference, case when p_payment_status='paid' then coalesce(p_paid_at,now()) else p_paid_at end,
    p_notes, v_user, now()
  )
  on conflict (service_plan_id, service_month) do update set
    payment_status=excluded.payment_status,
    amount=excluded.amount,
    payment_reference=excluded.payment_reference,
    paid_at=excluded.paid_at,
    notes=excluded.notes,
    verified_by=v_user,
    verified_at=now(),
    updated_at=now()
  returning id into v_payment_id;

  if p_payment_status='paid' then
    perform public.ensure_paid_monthly_service_obligation(p_service_plan_id, v_month);
  end if;
  return v_payment_id;
end;
$$;

create or replace function public.list_customer_service_plans(
  p_search text default null,
  p_branch text default 'all',
  p_status text default 'all',
  p_limit integer default 500
)
returns table(
  service_plan_id uuid,
  customer_id uuid,
  customer_code text,
  customer_name text,
  branch text,
  imported_service_days text,
  service_mode text,
  plan_status text,
  monthly_fee numeric,
  preferred_day_of_month integer,
  service_window_days integer,
  finance_verified_at timestamptz,
  notes text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_app_role() not in ('admin','finance','operations','executive') then
    raise exception 'You do not have permission to view service plans' using errcode='42501';
  end if;

  return query
  select sp.id, c.id, c.customer_code, c.customer_name, c.branch,
         cc.service_days, sp.service_mode, sp.status, sp.monthly_fee,
         sp.preferred_day_of_month, sp.service_window_days,
         sp.finance_verified_at, sp.notes
  from public.customers c
  left join public.customer_service_plans sp on sp.customer_id=c.id
  left join lateral (
    select cs.service_days
    from public.customer_commercial_source cs
    where lower(cs.branch)=lower(c.branch)
      and cs.customer_code=c.customer_code
    order by case when cs.service_days='30' then 0 else 1 end
    limit 1
  ) cc on true
  where lower(coalesce(c.status,'active')) in ('active','')
    and lower(c.customer_name) not like '%do not use%'
    and (lower(coalesce(p_branch,'all'))='all' or lower(c.branch)=lower(p_branch))
    and (
      lower(coalesce(p_status,'all'))='all'
      or (lower(p_status)='unclassified' and sp.id is null)
      or lower(coalesce(sp.status,''))=lower(p_status)
    )
    and (
      nullif(trim(coalesce(p_search,'')),'') is null
      or c.customer_name ilike '%'||trim(p_search)||'%'
      or c.customer_code ilike '%'||trim(p_search)||'%'
    )
  order by
    case when sp.status='pending_finance_review' then 0 when cc.service_days='30' and sp.id is null then 1 else 2 end,
    c.customer_name
  limit greatest(1,least(coalesce(p_limit,500),2000));
end;
$$;

create or replace function public.list_finance_service_coverage(
  p_service_month date,
  p_branch text default 'all',
  p_search text default null
)
returns table(
  service_plan_id uuid,
  customer_id uuid,
  customer_code text,
  customer_name text,
  branch text,
  monthly_fee numeric,
  payment_status text,
  payment_amount numeric,
  payment_reference text,
  scheduled_date date,
  obligation_status text,
  completed_at timestamptz,
  completion_source text,
  completion_reference text,
  paid_not_serviced boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month',p_service_month)::date;
begin
  if public.current_app_role() not in ('admin','finance','executive') then
    raise exception 'You do not have permission to view service coverage' using errcode='42501';
  end if;

  return query
  select sp.id, c.id, c.customer_code, c.customer_name, c.branch,
         sp.monthly_fee,
         coalesce(pay.payment_status,'not_recorded'), pay.amount, pay.payment_reference,
         ob.scheduled_date,
         case
           when ob.status='completed' then 'completed'
           when pay.payment_status='paid' and ob.scheduled_date < current_date then 'missed'
           else coalesce(ob.status,'not_scheduled')
         end,
         ob.completed_at, ob.completion_source, ob.completion_reference,
         (pay.payment_status='paid' and (ob.id is null or (ob.status<>'completed' and ob.scheduled_date<current_date)))
  from public.customer_service_plans sp
  join public.customers c on c.id=sp.customer_id
  left join public.customer_service_payments pay on pay.service_plan_id=sp.id and pay.service_month=v_month
  left join public.monthly_service_obligations ob on ob.service_plan_id=sp.id and ob.service_month=v_month
  where sp.service_mode='monthly' and sp.status='active'
    and (lower(coalesce(p_branch,'all'))='all' or lower(c.branch)=lower(p_branch))
    and (
      nullif(trim(coalesce(p_search,'')),'') is null
      or c.customer_name ilike '%'||trim(p_search)||'%'
      or c.customer_code ilike '%'||trim(p_search)||'%'
      or coalesce(pay.payment_reference,'') ilike '%'||trim(p_search)||'%'
    )
  order by
    (pay.payment_status='paid' and (ob.id is null or (ob.status<>'completed' and ob.scheduled_date<current_date))) desc,
    c.branch, c.customer_name;
end;
$$;

create or replace function public.list_daily_service_schedule(
  p_schedule_date date,
  p_branch text default 'all'
)
returns table(
  item_type text,
  item_id uuid,
  customer_id uuid,
  customer_code text,
  customer_name text,
  branch text,
  scheduled_date date,
  payment_status text,
  status text,
  assigned_to uuid,
  assigned_name text,
  route_number text,
  route_order integer,
  address text,
  summary text,
  can_reschedule boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_app_role() not in ('admin','operations','finance','executive') then
    raise exception 'You do not have permission to view the daily service schedule' using errcode='42501';
  end if;

  return query
  select 'monthly'::text, ob.id, c.id, c.customer_code, c.customer_name, c.branch,
         ob.scheduled_date, pay.payment_status,
         case when ob.status<>'completed' and ob.scheduled_date<current_date then 'missed' else ob.status end,
         ob.assigned_to,
         trim(concat_ws(' ',ud.first_name,ud.last_name)), ob.route_number, ob.route_order,
         c.address, concat('Paid monthly service - ',to_char(ob.service_month,'Mon YYYY')), true
  from public.monthly_service_obligations ob
  join public.customer_service_plans sp on sp.id=ob.service_plan_id
  join public.customer_service_payments pay on pay.service_plan_id=sp.id and pay.service_month=ob.service_month and pay.payment_status='paid'
  join public.customers c on c.id=ob.customer_id
  left join public.user_details ud on ud.user_id=ob.assigned_to
  where ob.scheduled_date=p_schedule_date
    and ob.status not in ('cancelled','waived')
    and (lower(coalesce(p_branch,'all'))='all' or lower(ob.branch)=lower(p_branch))

  union all

  select 'request'::text, sj.id, c.id, c.customer_code, c.customer_name, sj.branch,
         sj.due_at::date, 'request'::text,
         case when sj.status not in ('completed','verified','closed','cancelled') and sj.due_at::date<current_date then 'missed' else sj.status end,
         sj.assigned_to,
         trim(concat_ws(' ',ud.first_name,ud.last_name)), sj.route_number, sj.route_order,
         coalesce(cs.address,c.address), sj.summary, true
  from public.service_jobs sj
  left join public.customers c on c.id=sj.customer_id
  left join public.customer_sites cs on cs.id=sj.site_id
  left join public.user_details ud on ud.user_id=sj.assigned_to
  where sj.due_at::date=p_schedule_date
    and sj.status not in ('cancelled')
    and not exists (select 1 from public.monthly_service_obligations ob where ob.service_job_id=sj.id)
    and (lower(coalesce(p_branch,'all'))='all' or lower(sj.branch)=lower(p_branch))
  order by route_number nulls last, route_order nulls last, customer_name;
end;
$$;

create or replace function public.assign_daily_service_item(
  p_item_type text,
  p_item_id uuid,
  p_assigned_to uuid,
  p_route_number text default null,
  p_route_order integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_app_role();
  v_user uuid := public.current_app_user_id();
  v_ob public.monthly_service_obligations%rowtype;
  v_job_id uuid;
  v_job_number text;
begin
  if v_role not in ('admin','operations') then
    raise exception 'Only Operations or an Administrator may plan service routes' using errcode='42501';
  end if;
  if not exists (select 1 from public.user_details ud where ud.user_id=p_assigned_to and ud.role in ('technician','road_technician')) then
    raise exception 'The selected driver is not an assignable technician';
  end if;

  if p_item_type='monthly' then
    select * into v_ob from public.monthly_service_obligations where id=p_item_id for update;
    if v_ob.id is null then raise exception 'Monthly service item not found'; end if;

    v_job_id := v_ob.service_job_id;
    if v_job_id is null then
      v_job_number := concat('MS-',upper(v_ob.branch),'-',to_char(v_ob.service_month,'YYYYMM'),'-',substr(replace(v_ob.id::text,'-',''),1,6));
      insert into public.service_jobs (
        branch, job_number, customer_id, assigned_to, priority, status,
        summary, description, due_at, created_by, route_number, route_order
      ) values (
        v_ob.branch, v_job_number, v_ob.customer_id, p_assigned_to, 'medium', 'assigned',
        concat('Paid monthly service - ',to_char(v_ob.service_month,'Month YYYY')),
        'Automatically generated from a Finance-confirmed monthly service payment.',
        (v_ob.scheduled_date::timestamp + time '17:00') at time zone 'Africa/Johannesburg',
        v_user, nullif(trim(coalesce(p_route_number,'')),''), p_route_order
      ) returning id into v_job_id;
    else
      update public.service_jobs
      set assigned_to=p_assigned_to,
          status=case when status='new' then 'assigned' else status end,
          route_number=nullif(trim(coalesce(p_route_number,'')),''),
          route_order=p_route_order,
          updated_at=now()
      where id=v_job_id;
    end if;

    update public.monthly_service_obligations
    set assigned_to=p_assigned_to,
        route_number=nullif(trim(coalesce(p_route_number,'')),''),
        route_order=p_route_order,
        service_job_id=v_job_id,
        status=case when status='completed' then status else 'assigned' end,
        updated_at=now()
    where id=p_item_id;
    return v_job_id;
  elsif p_item_type='request' then
    update public.service_jobs
    set assigned_to=p_assigned_to,
        status=case when status='new' then 'assigned' else status end,
        route_number=nullif(trim(coalesce(p_route_number,'')),''),
        route_order=p_route_order,
        updated_at=now()
    where id=p_item_id
    returning id into v_job_id;
    if v_job_id is null then raise exception 'Requested service job not found'; end if;
    return v_job_id;
  else
    raise exception 'Invalid service item type';
  end if;
end;
$$;

create or replace function public.reschedule_daily_service_item(
  p_item_type text,
  p_item_id uuid,
  p_new_date date,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_app_role();
  v_job_id uuid;
begin
  if v_role not in ('admin','operations') then
    raise exception 'Only Operations or an Administrator may reschedule service work' using errcode='42501';
  end if;
  if p_new_date is null or nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'A new date and reschedule reason are required';
  end if;

  if p_item_type='monthly' then
    update public.monthly_service_obligations
    set scheduled_date=p_new_date,
        status=case when status='completed' then status else 'rescheduled' end,
        reschedule_reason=trim(p_reason),
        updated_at=now()
    where id=p_item_id
    returning service_job_id into v_job_id;
    if not found then raise exception 'Monthly service item not found'; end if;
    if v_job_id is not null then
      update public.service_jobs
      set due_at=(p_new_date::timestamp + time '17:00') at time zone 'Africa/Johannesburg',
          updated_at=now()
      where id=v_job_id;
    end if;
  elsif p_item_type='request' then
    update public.service_jobs
    set due_at=(p_new_date::timestamp + time '17:00') at time zone 'Africa/Johannesburg',
        description=concat_ws(E'\n',description,concat('Rescheduled: ',trim(p_reason))),
        updated_at=now()
    where id=p_item_id;
    if not found then raise exception 'Requested service job not found'; end if;
  else
    raise exception 'Invalid service item type';
  end if;
end;
$$;

create or replace function public.sync_monthly_obligation_from_service_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'in_progress' then
    update public.monthly_service_obligations
    set status='in_progress', updated_at=now()
    where service_job_id=new.id and status<>'completed';
  elsif new.status in ('completed','verified','closed') then
    update public.monthly_service_obligations
    set status='completed', completion_source='service_job', completion_reference=new.job_number,
        completed_at=coalesce(new.completed_at,now()), updated_at=now()
    where service_job_id=new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists service_job_monthly_obligation_sync on public.service_jobs;
create trigger service_job_monthly_obligation_sync
after insert or update of status, completed_at on public.service_jobs
for each row execute function public.sync_monthly_obligation_from_service_job();

insert into public.customer_service_plans (
  customer_id, branch, service_mode, status, preferred_day_of_month,
  service_window_days, source, notes
)
select distinct on (c.id)
  c.id, c.branch, 'monthly', 'pending_finance_review', 15, 7,
  'imported_service_days_30',
  'Imported as a candidate because the commercial source lists service_days = 30. Finance must confirm the monthly fee and activate the plan.'
from public.customers c
join public.customer_commercial_source cs
  on lower(cs.branch)=lower(c.branch)
 and cs.customer_code=c.customer_code
where cs.service_days='30'
  and lower(coalesce(c.status,'active')) in ('active','')
  and lower(c.customer_name) not like '%do not use%'
on conflict (customer_id) do nothing;

revoke all on function public.find_historical_service_completion(uuid,date) from public;
revoke all on function public.ensure_paid_monthly_service_obligation(uuid,date) from public;
revoke all on function public.save_customer_service_plan(uuid,text,text,numeric,integer,integer,date,date,text) from public;
revoke all on function public.record_customer_service_payment(uuid,date,text,numeric,text,timestamptz,text) from public;
revoke all on function public.list_customer_service_plans(text,text,text,integer) from public;
revoke all on function public.list_finance_service_coverage(date,text,text) from public;
revoke all on function public.list_daily_service_schedule(date,text) from public;
revoke all on function public.assign_daily_service_item(text,uuid,uuid,text,integer) from public;
revoke all on function public.reschedule_daily_service_item(text,uuid,date,text) from public;

grant execute on function public.save_customer_service_plan(uuid,text,text,numeric,integer,integer,date,date,text) to authenticated;
grant execute on function public.record_customer_service_payment(uuid,date,text,numeric,text,timestamptz,text) to authenticated;
grant execute on function public.list_customer_service_plans(text,text,text,integer) to authenticated;
grant execute on function public.list_finance_service_coverage(date,text,text) to authenticated;
grant execute on function public.list_daily_service_schedule(date,text) to authenticated;
grant execute on function public.assign_daily_service_item(text,uuid,uuid,text,integer) to authenticated;
grant execute on function public.reschedule_daily_service_item(text,uuid,date,text) to authenticated;
