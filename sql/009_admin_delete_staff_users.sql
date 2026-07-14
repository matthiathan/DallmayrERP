-- Allow DallmayrERP admins to delete staff access records.
-- Deleting public.users cascades to public.user_details through the FK.

create policy if not exists users_delete_admin
on public.users
for delete
to authenticated
using (public.current_app_role() = 'admin');

create policy if not exists user_details_delete_own_or_admin
on public.user_details
for delete
to authenticated
using (user_id = public.current_app_user_id() or public.current_app_role() = 'admin');
