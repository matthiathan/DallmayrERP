\set ON_ERROR_STOP on

-- Production-shaped minimum ERP identity/profile surface for the zero-cost local
-- Supabase messaging acceptance environment. Supabase Auth itself is provided by
-- the local stack; these rows are synthetic and never leave the CI runner.

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  access_note text,
  access_updated_by uuid references public.users(id) on delete set null,
  access_updated_at timestamptz
);

create table public.user_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  first_name text,
  last_name text,
  phone_number text,
  birthday date,
  role text not null check (role in ('admin','operations','sales','finance','marketing','executive','warehouse_staff','technician','road_technician')),
  branch text not null check (branch in ('jhb','cpt','kzn','national')),
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.users (id, email, is_active) values
  ('00000000-0000-0000-0000-000000000001', 'messaging-a@example.invalid', true),
  ('00000000-0000-0000-0000-000000000002', 'messaging-b@example.invalid', true),
  ('00000000-0000-0000-0000-000000000003', 'messaging-c@example.invalid', true),
  ('00000000-0000-0000-0000-000000000004', 'messaging-inactive@example.invalid', false),
  ('00000000-0000-0000-0000-000000000005', 'messaging-observer@example.invalid', true);

insert into public.user_details (
  user_id,
  first_name,
  last_name,
  phone_number,
  birthday,
  role,
  branch,
  emergency_contact_name,
  emergency_contact_phone
) values
  ('00000000-0000-0000-0000-000000000001', 'Messaging', 'Alpha', '+27110000001', '1990-01-01', 'operations', 'jhb', 'Local Contact A', '+27119990001'),
  ('00000000-0000-0000-0000-000000000002', 'Messaging', 'Bravo', '+27110000002', '1990-01-02', 'operations', 'jhb', 'Local Contact B', '+27119990002'),
  ('00000000-0000-0000-0000-000000000003', 'Messaging', 'Charlie', '+27110000003', '1990-01-03', 'operations', 'jhb', 'Local Contact C', '+27119990003'),
  ('00000000-0000-0000-0000-000000000004', 'Messaging', 'Inactive', '+27110000004', '1990-01-04', 'operations', 'jhb', 'Local Contact D', '+27119990004'),
  ('00000000-0000-0000-0000-000000000005', 'Messaging', 'Observer', '+27110000005', '1990-01-05', 'operations', 'jhb', 'Local Contact E', '+27119990005');
