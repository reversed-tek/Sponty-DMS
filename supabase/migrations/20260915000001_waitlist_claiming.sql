-- One-click waitlist claiming RPCs and RLS policies.
-- Run after 20260915000000_waitlist_slot_prerequisites.sql.

create extension if not exists pgcrypto;

create table if not exists public.waitlist_claims (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists waitlist_claims_slot_idx
  on public.waitlist_claims (slot_id, patient_id, expires_at);

alter table public.waitlist_claims enable row level security;

drop policy if exists waitlist_claims_staff_access on public.waitlist_claims;
create policy waitlist_claims_staff_access
  on public.waitlist_claims for all to authenticated
  using (public.current_user_role() in ('admin', 'dentist', 'receptionist'))
  with check (public.current_user_role() in ('admin', 'dentist', 'receptionist'));

create or replace function public.create_waitlist_claim(
  p_slot_id uuid,
  p_patient_id uuid,
  p_expires_at timestamptz default now() + interval '48 hours'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_token text;
begin
  if public.current_user_role() is null then
    raise exception 'authenticated_profile_required';
  end if;

  if not exists (
    select 1 from public.appointments
    where id = p_slot_id and status = 'open'
  ) then
    raise exception 'slot_not_open';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.waitlist_claims (slot_id, patient_id, token_hash, expires_at, created_by)
  values (p_slot_id, p_patient_id, encode(extensions.digest(raw_token, 'sha256'), 'hex'), p_expires_at, auth.uid());
  return raw_token;
end;
$$;

grant execute on function public.create_waitlist_claim(uuid, uuid, timestamptz) to authenticated;

create or replace function public.validate_waitlist_claim(
  p_slot_id uuid,
  p_patient_id uuid,
  p_token text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.waitlist_claims
    where slot_id = p_slot_id
      and patient_id = p_patient_id
      and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and expires_at > now()
      and claimed_at is null
  );
$$;

grant execute on function public.validate_waitlist_claim(uuid, uuid, text) to authenticated, anon;

create or replace function public.claim_waitlist_slot(
  p_slot_id uuid,
  p_patient_id uuid
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_slot public.appointments;
begin
  if auth.uid() is null or public.current_user_role() is null then
    raise exception 'authenticated_profile_required';
  end if;

  update public.appointments
  set patient_id = p_patient_id,
      status = 'booked',
      updated_at = now()
  where id = p_slot_id
    and status = 'open'
    and exists (
      select 1
      from public.waitlist_claims
      where slot_id = p_slot_id
        and patient_id = p_patient_id
        and expires_at > now()
        and claimed_at is null
    )
  returning * into claimed_slot;

  if not found then
    raise exception 'slot_already_claimed_or_claim_invalid';
  end if;

  update public.waitlist_claims
  set claimed_at = now()
  where slot_id = p_slot_id
    and patient_id = p_patient_id
    and claimed_at is null;

  return claimed_slot;
end;
$$;

grant execute on function public.claim_waitlist_slot(uuid, uuid) to authenticated;

comment on function public.claim_waitlist_slot(uuid, uuid) is
  'Atomically claims an open appointment slot for a valid, unexpired waitlist claim.';
