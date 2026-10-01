-- Automatically provision Sponty DMS profiles for approved Microsoft Entra users.
--
-- Entra remains responsible for authentication and Enterprise App assignment.
-- This migration only creates the matching application profile after Supabase
-- successfully creates an Azure-authenticated auth.users record.
--
-- Eligible email domain:
--   @spontyrides.onmicrosoft.com
--
-- New profiles use the existing default role: receptionist.
-- Existing roles and is_active values are never overwritten.

begin;

create or replace function public.provision_spontyrides_entra_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalised_email text;
  display_name text;
  entra_object_id_value text;
  provider_name text;
begin
  normalised_email := lower(trim(coalesce(new.email, '')));
  provider_name := lower(coalesce(new.raw_app_meta_data ->> 'provider', ''));

  -- Only Microsoft Entra / Azure identities are eligible.
  if provider_name <> 'azure' then
    return new;
  end if;

  -- Only the SpontyRides tenant email domain is automatically provisioned.
  if split_part(normalised_email, '@', 2) <> 'spontyrides.onmicrosoft.com' then
    return new;
  end if;

  display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'preferred_username'), ''),
    split_part(normalised_email, '@', 1)
  );

  -- Azure normally exposes oid. Leave this null rather than storing an
  -- unrelated identifier if oid is unavailable.
  entra_object_id_value := nullif(trim(new.raw_user_meta_data ->> 'oid'), '');

  insert into public.profiles (
    id,
    email,
    full_name,
    auth_provider,
    entra_object_id,
    entra_email,
    entra_display_name,
    entra_synced_at
  )
  values (
    new.id,
    normalised_email,
    display_name,
    'azure',
    entra_object_id_value,
    normalised_email,
    display_name,
    now()
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name,
    auth_provider = excluded.auth_provider,
    entra_object_id = coalesce(excluded.entra_object_id, public.profiles.entra_object_id),
    entra_email = excluded.entra_email,
    entra_display_name = excluded.entra_display_name,
    entra_synced_at = excluded.entra_synced_at,
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.provision_spontyrides_entra_profile() from public;

drop trigger if exists provision_spontyrides_entra_profile_after_signup on auth.users;

create trigger provision_spontyrides_entra_profile_after_signup
after insert on auth.users
for each row
execute function public.provision_spontyrides_entra_profile();

-- Backfill eligible Entra users who already exist in auth.users but do not yet
-- have a matching application profile.
insert into public.profiles (
  id,
  email,
  full_name,
  auth_provider,
  entra_object_id,
  entra_email,
  entra_display_name,
  entra_synced_at
)
select
  u.id,
  lower(trim(u.email)),
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'preferred_username'), ''),
    split_part(lower(trim(u.email)), '@', 1)
  ),
  'azure',
  nullif(trim(u.raw_user_meta_data ->> 'oid'), ''),
  lower(trim(u.email)),
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'preferred_username'), ''),
    split_part(lower(trim(u.email)), '@', 1)
  ),
  now()
from auth.users u
where lower(coalesce(u.raw_app_meta_data ->> 'provider', '')) = 'azure'
  and split_part(lower(trim(coalesce(u.email, ''))), '@', 2) = 'spontyrides.onmicrosoft.com'
  and not exists (
    select 1
    from public.profiles p
    where p.id = u.id
  );

commit;
