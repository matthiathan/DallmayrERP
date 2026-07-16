create unique index if not exists machines_source_unique_idx
  on public.machines(source_table, source_key)
  where source_table is not null and source_key is not null;

with qr_counts as (
  select nullif(trim("QR Code"), '') as qr_code, count(*) as qr_count
  from public.fixed_assets
  where nullif(trim("QR Code"), '') is not null
  group by nullif(trim("QR Code"), '')
), source_rows as (
  select
    fa.*,
    nullif(trim(fa."FA Doc#"), '') as fa_doc,
    nullif(trim(fa."QR Code"), '') as qr_code_clean,
    nullif(trim(fa."Serial#"), '') as serial_clean,
    nullif(trim(fa."Asset Name"), '') as asset_name_clean,
    nullif(trim(fa."Machine Model"), '') as model_clean,
    nullif(trim(fa."Machine Type"), '') as machine_type_clean,
    nullif(trim(fa."C.Code"), '') as customer_code_clean,
    nullif(trim(fa."Current Customer Name"), '') as current_customer_clean,
    nullif(trim(fa."Current Bldg Name"), '') as building_clean,
    nullif(trim(fa."Current Location"), '') as location_clean,
    nullif(trim(fa."Division"), '') as division_clean,
    nullif(trim(fa."FAMST_DISPOSAL_DATE"), '') as disposal_clean,
    qc.qr_count
  from public.fixed_assets fa
  left join qr_counts qc on qc.qr_code = nullif(trim(fa."QR Code"), '')
  where nullif(trim(fa."FA Doc#"), '') is not null
), prepared as (
  select
    sr.*,
    c.id as matched_customer_id,
    c.branch as matched_customer_branch
  from source_rows sr
  left join public.customers c
    on c.customer_code = sr.customer_code_clean
)
insert into public.machines (
  branch,
  customer_id,
  asset_tag,
  serial_number,
  machine_barcode,
  machine_name,
  model,
  status,
  source_table,
  source_key,
  condition,
  criticality,
  current_custodian,
  custody_status,
  purchase_cost
)
select
  coalesce(
    matched_customer_branch,
    case division_clean
      when '21' then 'jhb'
      when '31' then 'cpt'
      when '41' then 'kzn'
      else 'national'
    end
  ) as branch,
  matched_customer_id,
  fa_doc as asset_tag,
  serial_clean as serial_number,
  case when qr_count = 1 then qr_code_clean else null end as machine_barcode,
  coalesce(asset_name_clean, model_clean, machine_type_clean, serial_clean, qr_code_clean, fa_doc) as machine_name,
  coalesce(model_clean, machine_type_clean) as model,
  case when disposal_clean is not null then 'retired' else 'active' end as status,
  'fixed_assets' as source_table,
  fa_doc as source_key,
  'unknown' as condition,
  'medium' as criticality,
  coalesce(current_customer_clean, building_clean, location_clean) as current_custodian,
  case
    when disposal_clean is not null then 'retired'
    when coalesce(current_customer_clean, building_clean, location_clean) is not null then 'assigned'
    else 'available'
  end as custody_status,
  nullif(regexp_replace(coalesce("Cost Amount", ''), '[^0-9.-]', '', 'g'), '')::numeric as purchase_cost
from prepared
where not exists (
  select 1
  from public.machines m
  where m.source_table = 'fixed_assets'
    and m.source_key = prepared.fa_doc
)
on conflict (source_table, source_key) where source_table is not null and source_key is not null do nothing;
