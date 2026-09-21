-- Trusted application-access attributes must never be self-service. In particular,
-- role, branch and telemetry-region ownership feed SECURITY DEFINER authorization
-- helpers such as current_app_role(), so direct client mutations must be limited to
-- administrators. Authenticated users retain the existing self-read policy.
--
-- Controlled SECURITY DEFINER paths remain authoritative for permitted changes:
-- set_my_telemetry_region for the initial/self region workflow and
-- admin_create_user_access, admin_update_user_access, admin_delete_user_access for
-- access provisioning and administration.

drop policy if exists user_details_insert_own_or_admin on public.user_details;
drop policy if exists user_details_update_own_or_admin on public.user_details;
drop policy if exists user_details_delete_own_or_admin on public.user_details;

drop policy if exists user_details_insert_admin on public.user_details;
create policy user_details_insert_admin
on public.user_details
for insert
to authenticated
with check (public.current_app_role() = 'admin');

drop policy if exists user_details_update_admin on public.user_details;
create policy user_details_update_admin
on public.user_details
for update
to authenticated
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

drop policy if exists user_details_delete_admin on public.user_details;
create policy user_details_delete_admin
on public.user_details
for delete
to authenticated
using (public.current_app_role() = 'admin');

comment on table public.user_details is
  'Trusted DallmayrERP application-access profile. Authenticated users retain self-read access through user_details_select_own_or_admin. Non-admin self changes use controlled SECURITY DEFINER paths such as set_my_telemetry_region; access provisioning remains under admin_create_user_access, admin_update_user_access and admin_delete_user_access.';
