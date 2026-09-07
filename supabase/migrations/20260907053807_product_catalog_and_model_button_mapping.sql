create table public.products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_not_blank check (btrim(product_name) <> '')
);

create unique index products_product_name_ci_uidx
  on public.products ((lower(btrim(product_name))));

create table public.machine_model_profiles (
  id uuid primary key default gen_random_uuid(),
  model_key text not null,
  display_name text not null,
  button_count integer not null default 12,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machine_model_profiles_model_key_not_blank check (btrim(model_key) <> ''),
  constraint machine_model_profiles_display_name_not_blank check (btrim(display_name) <> ''),
  constraint machine_model_profiles_button_count_check check (button_count between 1 and 100)
);

create unique index machine_model_profiles_model_key_ci_uidx
  on public.machine_model_profiles ((lower(btrim(model_key))));

create table public.machine_model_button_mappings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.machine_model_profiles(id) on delete cascade,
  button_number integer not null,
  selection_code text not null,
  product_id uuid not null references public.products(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machine_model_button_mappings_button_check check (button_number between 1 and 100),
  constraint machine_model_button_mappings_selection_not_blank check (btrim(selection_code) <> ''),
  constraint machine_model_button_mappings_profile_button_unique unique (profile_id, button_number)
);

create unique index machine_model_button_mappings_profile_selection_ci_uidx
  on public.machine_model_button_mappings (profile_id, (lower(btrim(selection_code))));
create index machine_model_button_mappings_product_idx
  on public.machine_model_button_mappings (product_id);

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger machine_model_profiles_set_updated_at
before update on public.machine_model_profiles
for each row execute function public.set_updated_at();

create trigger machine_model_button_mappings_set_updated_at
before update on public.machine_model_button_mappings
for each row execute function public.set_updated_at();

alter table public.products enable row level security;
alter table public.machine_model_profiles enable row level security;
alter table public.machine_model_button_mappings enable row level security;

grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.machine_model_profiles to authenticated;
grant select, insert, update, delete on public.machine_model_button_mappings to authenticated;
grant select, insert, update, delete on public.products to service_role;
grant select, insert, update, delete on public.machine_model_profiles to service_role;
grant select, insert, update, delete on public.machine_model_button_mappings to service_role;
revoke all on public.products from anon;
revoke all on public.machine_model_profiles from anon;
revoke all on public.machine_model_button_mappings from anon;

create policy products_internal_read
  on public.products for select to authenticated
  using (public.current_app_role() is not null);
create policy products_internal_write
  on public.products for all to authenticated
  using (public.current_app_role() is not null)
  with check (public.current_app_role() is not null);

create policy machine_model_profiles_internal_read
  on public.machine_model_profiles for select to authenticated
  using (public.current_app_role() is not null);
create policy machine_model_profiles_internal_write
  on public.machine_model_profiles for all to authenticated
  using (public.current_app_role() is not null)
  with check (public.current_app_role() is not null);

create policy machine_model_button_mappings_internal_read
  on public.machine_model_button_mappings for select to authenticated
  using (public.current_app_role() is not null);
create policy machine_model_button_mappings_internal_write
  on public.machine_model_button_mappings for all to authenticated
  using (public.current_app_role() is not null)
  with check (public.current_app_role() is not null);