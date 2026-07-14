-- Harden RLS on public.user_details.
-- Normal users may manage only their own personal details.
-- Admin users may manage all details.

alter table public.user_details enable row level security;

drop policy if exists authenticated_select on public.user_details;
drop policy if exists authenticated_insert on public.user_details;
drop policy if exists authenticated_update on public.user_details;

create policy user_details_select_own_or_admin
on public.user_details
for select
to authenticated
using (
  exists (
    select 1
    from public.users access_user
    where access_user.id = user_details.user_id
      and (
        access_user.auth_user_id = (select auth.uid())
        or lower(access_user.email) = lower((select auth.jwt() ->> 'email'))
        or exists (
          select 1
          from public.users admin_user
          where admin_user.role = 'admin'
            and (
              admin_user.auth_user_id = (select auth.uid())
              or lower(admin_user.email) = lower((select auth.jwt() ->> 'email'))
            )
        )
      )
  )
);

create policy user_details_insert_own_or_admin
on public.user_details
for insert
to authenticated
with check (
  exists (
    select 1
    from public.users access_user
    where access_user.id = user_details.user_id
      and (
        access_user.auth_user_id = (select auth.uid())
        or lower(access_user.email) = lower((select auth.jwt() ->> 'email'))
        or exists (
          select 1
          from public.users admin_user
          where admin_user.role = 'admin'
            and (
              admin_user.auth_user_id = (select auth.uid())
              or lower(admin_user.email) = lower((select auth.jwt() ->> 'email'))
            )
        )
      )
  )
);

create policy user_details_update_own_or_admin
on public.user_details
for update
to authenticated
using (
  exists (
    select 1
    from public.users access_user
    where access_user.id = user_details.user_id
      and (
        access_user.auth_user_id = (select auth.uid())
        or lower(access_user.email) = lower((select auth.jwt() ->> 'email'))
        or exists (
          select 1
          from public.users admin_user
          where admin_user.role = 'admin'
            and (
              admin_user.auth_user_id = (select auth.uid())
              or lower(admin_user.email) = lower((select auth.jwt() ->> 'email'))
            )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.users access_user
    where access_user.id = user_details.user_id
      and (
        access_user.auth_user_id = (select auth.uid())
        or lower(access_user.email) = lower((select auth.jwt() ->> 'email'))
        or exists (
          select 1
          from public.users admin_user
          where admin_user.role = 'admin'
            and (
              admin_user.auth_user_id = (select auth.uid())
              or lower(admin_user.email) = lower((select auth.jwt() ->> 'email'))
            )
        )
      )
  )
);
