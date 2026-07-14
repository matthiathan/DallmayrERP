-- Allow DallmayrERP admins to delete staff access records.
-- Deleting public.users cascades to public.user_details through the FK.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and policyname = 'users_delete_admin'
  ) then
    create policy users_delete_admin
    on public.users
    for delete
    to authenticated
    using (public.current_app_role() = 'admin');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_details'
      and policyname = 'user_details_delete_own_or_admin'
  ) then
    create policy user_details_delete_own_or_admin
    on public.user_details
    for delete
    to authenticated
    using (user_id = public.current_app_user_id() or public.current_app_role() = 'admin');
  end if;
end $$;
