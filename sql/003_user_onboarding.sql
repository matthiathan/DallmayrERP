-- DallmayrERP user onboarding support
-- Allows admins to invite staff with only controlled business details first.
-- Staff complete personal details once after first login.

alter table public.users
  alter column first_name drop not null,
  alter column last_name drop not null;

alter table public.users
  add column if not exists onboarding_required boolean not null default true,
  add column if not exists profile_completed_at timestamptz,
  add column if not exists last_login_at timestamptz;

comment on column public.users.onboarding_required is 'When true, signed-in users must complete the first-login profile form before accessing role pages.';
comment on column public.users.profile_completed_at is 'Timestamp when the user completed first-login onboarding.';
comment on column public.users.last_login_at is 'Latest login timestamp observed by the app.';

-- Existing staff with names should not be forced through onboarding.
update public.users
set onboarding_required = false,
    profile_completed_at = coalesce(profile_completed_at, now())
where onboarding_required = true
  and nullif(trim(coalesce(first_name, '')), '') is not null
  and nullif(trim(coalesce(last_name, '')), '') is not null
  and nullif(trim(coalesce(phone_number, '')), '') is not null;
