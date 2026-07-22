-- Store user-specific visual preferences without changing role or application permissions.
create table if not exists public.user_appearance_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  accent_color text not null default '#d4af37',
  theme_color text not null default '#7a4b22',
  background_color text not null default '#0d0905',
  theme_tone text not null default 'dark',
  background_style text not null default 'aurora',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_appearance_accent_hex check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint user_appearance_theme_hex check (theme_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint user_appearance_background_hex check (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint user_appearance_theme_tone check (theme_tone in ('dark', 'light')),
  constraint user_appearance_background_style check (background_style in ('aurora', 'mesh', 'dots', 'solid'))
);

alter table public.user_appearance_preferences enable row level security;

revoke all on table public.user_appearance_preferences from public;
grant select, insert, update, delete on table public.user_appearance_preferences to authenticated;

drop policy if exists user_appearance_select_own on public.user_appearance_preferences;
create policy user_appearance_select_own
  on public.user_appearance_preferences
  for select
  to authenticated
  using (user_id = public.current_app_user_id());

drop policy if exists user_appearance_insert_own on public.user_appearance_preferences;
create policy user_appearance_insert_own
  on public.user_appearance_preferences
  for insert
  to authenticated
  with check (user_id = public.current_app_user_id());

drop policy if exists user_appearance_update_own on public.user_appearance_preferences;
create policy user_appearance_update_own
  on public.user_appearance_preferences
  for update
  to authenticated
  using (user_id = public.current_app_user_id())
  with check (user_id = public.current_app_user_id());

drop policy if exists user_appearance_delete_own on public.user_appearance_preferences;
create policy user_appearance_delete_own
  on public.user_appearance_preferences
  for delete
  to authenticated
  using (user_id = public.current_app_user_id());

comment on table public.user_appearance_preferences is
  'Per-user accent, theme and background preferences. These settings are visual only and do not alter ERP permissions.';
