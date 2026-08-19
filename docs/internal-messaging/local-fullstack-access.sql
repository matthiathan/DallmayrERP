\set ON_ERROR_STOP on

-- Mirror the production employee/profile read boundary closely enough for the
-- local full-stack messaging test. Normal staff can read only their own ERP user
-- and profile rows. Messaging discovery must therefore use the dedicated minimal
-- directory RPC rather than widening these general-purpose policies.

alter table public.users enable row level security;
alter table public.user_details enable row level security;

revoke all on public.users from public, anon, authenticated;
revoke all on public.user_details from public, anon, authenticated;
grant select on public.users to authenticated;
grant select on public.user_details to authenticated;

drop policy if exists users_select_own_or_admin on public.users;
create policy users_select_own_or_admin
on public.users
for select
to authenticated
using (
  id = public.current_app_user_id()
  or public.current_app_role() = 'admin'
);

drop policy if exists user_details_select_own_or_admin on public.user_details;
create policy user_details_select_own_or_admin
on public.user_details
for select
to authenticated
using (
  user_id = public.current_app_user_id()
  or public.current_app_role() = 'admin'
);
