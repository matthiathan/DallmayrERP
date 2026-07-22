-- Return the richest available customer details for operational forms.
create or replace function public.get_customer_form_defaults(p_customer_id uuid)
returns table(
  customer_id uuid,
  branch text,
  customer_code text,
  customer_name text,
  contact_name text,
  telephone text,
  fax text,
  mobile text,
  contact_email text,
  address text,
  site_location text,
  category text,
  sub_category text,
  group_3 text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_app_role();
  v_actor_branch text;
  v_customer_branch text;
begin
  if v_role is null then
    raise exception 'Authentication is required to load customer details' using errcode = '42501';
  end if;

  select c.branch
    into v_customer_branch
  from public.customers c
  where c.id = p_customer_id;

  if not found then
    raise exception 'Customer not found';
  end if;

  if v_role = 'operations' then
    select d.branch into v_actor_branch
    from public.user_details d
    where d.user_id = public.current_app_user_id();

    if coalesce(v_actor_branch, 'national') <> 'national'
       and v_customer_branch <> v_actor_branch then
      raise exception 'Operations users may only load customers in their assigned branch' using errcode = '42501';
    end if;
  end if;

  return query
  with customer_row as (
    select c.*
    from public.customers c
    where c.id = p_customer_id
  ),
  source_rows as (
    select
      'jhb'::text as branch,
      nullif(btrim("A/C Code"::text), '') as customer_code,
      nullif(btrim("Telephone-1"::text), '') as phone_1,
      nullif(btrim("Telephone-2"::text), '') as phone_2,
      nullif(btrim("Fax"::text), '') as fax,
      nullif(btrim("Mobile No."::text), '') as mobile,
      nullif(btrim("Email-1"::text), '') as email,
      nullif(btrim("Ship To"::text), '') as ship_to,
      nullif(btrim("Bill To"::text), '') as bill_to,
      nullif(btrim("Area"::text), '') as area,
      nullif(btrim("Category"::text), '') as category,
      nullif(btrim("Group 2"::text), '') as group_2,
      nullif(btrim("ACC_GRP3_DESC"::text), '') as group_3
    from public.customer_master_jhb
    union all
    select
      'cpt'::text,
      nullif(btrim("A/C Code"::text), ''),
      nullif(btrim("Telephone-1"::text), ''),
      nullif(btrim("Telephone-2"::text), ''),
      nullif(btrim("Fax"::text), ''),
      nullif(btrim("Mobile No."::text), ''),
      nullif(btrim("Email-1"::text), ''),
      nullif(btrim("Ship To"::text), ''),
      nullif(btrim("Bill To"::text), ''),
      nullif(btrim("Area"::text), ''),
      nullif(btrim("Category"::text), ''),
      nullif(btrim("Group 2"::text), ''),
      nullif(btrim("ACC_GRP3_DESC"::text), '')
    from public.customer_master_cpt
    union all
    select
      'kzn'::text,
      nullif(btrim("A/C Code"::text), ''),
      nullif(btrim("Telephone-1"::text), ''),
      nullif(btrim("Telephone-2"::text), ''),
      nullif(btrim("Fax"::text), ''),
      nullif(btrim("Mobile No."::text), ''),
      nullif(btrim("Email-1"::text), ''),
      nullif(btrim("Ship To"::text), ''),
      nullif(btrim("Bill To"::text), ''),
      nullif(btrim("Area"::text), ''),
      nullif(btrim("Category"::text), ''),
      nullif(btrim("Group 2"::text), ''),
      nullif(btrim("ACC_GRP3_DESC"::text), '')
    from public.customer_master_kzn
  ),
  source_match as (
    select
      max(sr.phone_1) as phone_1,
      max(sr.phone_2) as phone_2,
      max(sr.fax) as fax,
      max(sr.mobile) as mobile,
      max(sr.email) as email,
      max(sr.ship_to) as ship_to,
      max(sr.bill_to) as bill_to,
      max(sr.area) as area,
      max(sr.category) as category,
      max(sr.group_2) as group_2,
      max(sr.group_3) as group_3
    from source_rows sr
    join customer_row c
      on c.branch = sr.branch
     and c.customer_code is not null
     and btrim(c.customer_code) = sr.customer_code
  )
  select
    c.id,
    c.branch,
    c.customer_code,
    c.customer_name,
    null::text as contact_name,
    nullif(concat_ws(' / ',
      nullif(btrim(c.phone), ''),
      case
        when sm.phone_1 is distinct from nullif(btrim(c.phone), '') then sm.phone_1
        else null
      end,
      case
        when sm.phone_2 is distinct from nullif(btrim(c.phone), '')
         and sm.phone_2 is distinct from sm.phone_1 then sm.phone_2
        else null
      end
    ), '') as telephone,
    sm.fax,
    sm.mobile,
    coalesce(nullif(btrim(c.email), ''), sm.email) as contact_email,
    coalesce(nullif(btrim(c.address), ''), sm.ship_to, sm.bill_to) as address,
    sm.area as site_location,
    sm.category,
    sm.group_2 as sub_category,
    sm.group_3
  from customer_row c
  cross join source_match sm;
end;
$$;

revoke all on function public.get_customer_form_defaults(uuid) from public;
grant execute on function public.get_customer_form_defaults(uuid) to authenticated;
