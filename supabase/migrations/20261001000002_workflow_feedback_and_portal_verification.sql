-- Workflow feedback timestamps, appointment realtime updates, and
-- verification-code protection for the patient portal.

begin;

-- Operational timestamps make the existing statuses meaningful in the UI
-- without introducing extra appointment statuses.
alter table public.appointments
  add column if not exists checked_in_at timestamptz,
  add column if not exists handed_over_at timestamptz,
  add column if not exists clinical_updated_at timestamptz,
  add column if not exists treatment_completed_at timestamptz;

-- Update check-in so the server records the authoritative time.
create or replace function public.check_in_appointment(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_row public.appointments;
  caller_role public.app_role;
  was_checked_in boolean;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist', 'receptionist') then
    raise exception 'staff_profile_required';
  end if;

  select *
  into appointment_row
  from public.appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'appointment_not_found';
  end if;

  if appointment_row.patient_id is null then
    raise exception 'appointment_has_no_patient';
  end if;

  if appointment_row.status in ('cancelled', 'no_show', 'completed', 'open') then
    raise exception 'appointment_cannot_be_checked_in_from_status_%', appointment_row.status;
  end if;

  was_checked_in := appointment_row.checked_in_at is not null;

  update public.appointments
  set
    status = case
      when status in ('confirmed', 'in_progress') then status
      else 'confirmed'
    end,
    checked_in_at = coalesce(checked_in_at, now()),
    updated_at = now()
  where id = p_appointment_id
  returning * into appointment_row;

  if not was_checked_in then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      'appointment_checked_in',
      'appointment',
      p_appointment_id,
      jsonb_build_object(
        'patient_id', appointment_row.patient_id,
        'checked_in_at', appointment_row.checked_in_at
      )
    );
  end if;

  return appointment_row;
end;
$$;

revoke all on function public.check_in_appointment(uuid) from public;
grant execute on function public.check_in_appointment(uuid) to authenticated;

-- Update handover so the dentist receives a persistent handover time.
create or replace function public.handover_appointment_to_dentist(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_row public.appointments;
  provider_role public.app_role;
  caller_role public.app_role;
  was_handed_over boolean;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist', 'receptionist') then
    raise exception 'staff_profile_required';
  end if;

  select *
  into appointment_row
  from public.appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'appointment_not_found';
  end if;

  if appointment_row.patient_id is null then
    raise exception 'appointment_has_no_patient';
  end if;

  if appointment_row.provider_id is null then
    raise exception 'dentist_not_assigned';
  end if;

  select role
  into provider_role
  from public.profiles
  where id = appointment_row.provider_id
    and is_active = true;

  if provider_role is null or provider_role not in ('dentist', 'admin') then
    raise exception 'assigned_provider_is_not_an_active_dentist';
  end if;

  if appointment_row.status in ('cancelled', 'no_show', 'completed', 'open') then
    raise exception 'appointment_cannot_be_handed_over_from_status_%', appointment_row.status;
  end if;

  if appointment_row.status not in ('confirmed', 'in_progress') then
    raise exception 'appointment_must_be_checked_in_before_handover';
  end if;

  was_handed_over := appointment_row.handed_over_at is not null;

  update public.appointments
  set
    status = 'in_progress',
    checked_in_at = coalesce(checked_in_at, now()),
    handed_over_at = coalesce(handed_over_at, now()),
    updated_at = now()
  where id = p_appointment_id
  returning * into appointment_row;

  if not was_handed_over then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      'appointment_handed_to_dentist',
      'appointment',
      p_appointment_id,
      jsonb_build_object(
        'patient_id', appointment_row.patient_id,
        'provider_id', appointment_row.provider_id,
        'handed_over_at', appointment_row.handed_over_at
      )
    );
  end if;

  return appointment_row;
end;
$$;

revoke all on function public.handover_appointment_to_dentist(uuid) from public;
grant execute on function public.handover_appointment_to_dentist(uuid) to authenticated;

-- Any clinical note automatically touches the appointment.
create or replace function public.touch_appointment_from_clinical_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_value uuid;
begin
  if tg_op = 'DELETE' then
    appointment_value := old.appointment_id;
  else
    appointment_value := new.appointment_id;
  end if;

  if appointment_value is not null then
    update public.appointments
    set clinical_updated_at = now(),
        updated_at = now()
    where id = appointment_value;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists clinical_notes_touch_appointment on public.clinical_notes;
create trigger clinical_notes_touch_appointment
after insert or update or delete
on public.clinical_notes
for each row execute function public.touch_appointment_from_clinical_note();

-- Treatment activity updates the appointment and records when all active
-- treatments for the appointment are complete.
create or replace function public.sync_appointment_from_treatment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_value uuid;
  has_active_treatment boolean;
  all_active_treatments_complete boolean;
begin
  if tg_op = 'DELETE' then
    appointment_value := old.appointment_id;
  else
    appointment_value := new.appointment_id;
  end if;

  if appointment_value is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select
    exists (
      select 1
      from public.treatments t
      where t.appointment_id = appointment_value
        and t.status <> 'cancelled'
    ),
    not exists (
      select 1
      from public.treatments t
      where t.appointment_id = appointment_value
        and t.status not in ('completed', 'cancelled')
    )
  into has_active_treatment, all_active_treatments_complete;

  update public.appointments
  set
    clinical_updated_at = now(),
    treatment_completed_at = case
      when has_active_treatment and all_active_treatments_complete
        then coalesce(treatment_completed_at, now())
      else null
    end,
    updated_at = now()
  where id = appointment_value;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists treatments_sync_appointment_activity on public.treatments;
create trigger treatments_sync_appointment_activity
after insert or update or delete
on public.treatments
for each row execute function public.sync_appointment_from_treatment();

-- Appointment updates are the single realtime signal. Treatment and clinical
-- triggers above touch the appointment so other logged-in staff see changes.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'appointments'
  ) then
    execute 'alter publication supabase_realtime add table public.appointments';
  end if;
end;
$$;

-- -------------------------------------------------------------------------
-- Patient portal verification code
-- -------------------------------------------------------------------------

alter table public.access_tokens
  add column if not exists verification_code_hash text,
  add column if not exists verification_attempts integer not null default 0,
  add column if not exists verified_at timestamptz;

-- New issuer returns both the secret URL token and a separate six-digit code.
create or replace function public.issue_patient_portal_access(
  p_patient_id uuid,
  p_expires_at timestamptz default now() + interval '24 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_token text;
  raw_code text;
  code_bytes bytea;
  code_value integer;
  token_id uuid;
begin
  if public.current_user_role() is null then
    raise exception 'authenticated_profile_required';
  end if;

  if not exists (
    select 1
    from public.patients
    where id = p_patient_id
      and is_active
  ) then
    raise exception 'patient_not_found';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  code_bytes := extensions.gen_random_bytes(3);
  code_value :=
      get_byte(code_bytes, 0) * 65536
    + get_byte(code_bytes, 1) * 256
    + get_byte(code_bytes, 2);
  raw_code := lpad((code_value % 1000000)::text, 6, '0');

  insert into public.access_tokens (
    patient_id,
    token_hash,
    verification_code_hash,
    purpose,
    expires_at,
    created_by
  )
  values (
    p_patient_id,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    encode(extensions.digest(raw_code, 'sha256'), 'hex'),
    'patient_portal',
    p_expires_at,
    auth.uid()
  )
  returning id into token_id;

  return jsonb_build_object(
    'token', raw_token,
    'verification_code', raw_code,
    'expires_at', p_expires_at
  );
end;
$$;

revoke all on function public.issue_patient_portal_access(uuid, timestamptz) from public;
grant execute on function public.issue_patient_portal_access(uuid, timestamptz) to authenticated;

-- The old issuer is disabled for app users so new links cannot be created
-- without a verification code.
revoke all on function public.issue_patient_portal_token(uuid, timestamptz)
  from public;
revoke execute on function public.issue_patient_portal_token(uuid, timestamptz)
  from anon, authenticated;

-- Verify link + code before creating the short-lived portal session.
create or replace function public.verify_patient_portal_access(
  p_token text,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  token_row public.access_tokens;
  raw_session text;
  patient_row public.patients;
  attempts_after integer;
begin
  select *
  into token_row
  from public.access_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and purpose = 'patient_portal'
    and consumed_at is null
    and expires_at > now()
  for update;

  if not found then
    return jsonb_build_object(
      'verified', false,
      'error', 'portal_token_invalid_or_expired',
      'attempts_remaining', 0
    );
  end if;

  if token_row.verification_code_hash is null then
    return jsonb_build_object(
      'verified', false,
      'error', 'portal_verification_required',
      'attempts_remaining', 0
    );
  end if;

  if token_row.verification_attempts >= 5 then
    return jsonb_build_object(
      'verified', false,
      'error', 'portal_verification_locked',
      'attempts_remaining', 0
    );
  end if;

  if token_row.verification_code_hash <>
     encode(extensions.digest(coalesce(trim(p_code), ''), 'sha256'), 'hex') then

    attempts_after := token_row.verification_attempts + 1;

    update public.access_tokens
    set verification_attempts = attempts_after
    where id = token_row.id;

    return jsonb_build_object(
      'verified', false,
      'error', case
        when attempts_after >= 5 then 'portal_verification_locked'
        else 'portal_code_invalid'
      end,
      'attempts_remaining', greatest(5 - attempts_after, 0)
    );
  end if;

  update public.access_tokens
  set
    verified_at = now(),
    consumed_at = now()
  where id = token_row.id;

  raw_session := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.portal_sessions (
    access_token_id,
    patient_id,
    session_hash
  )
  values (
    token_row.id,
    token_row.patient_id,
    encode(extensions.digest(raw_session, 'sha256'), 'hex')
  );

  select *
  into patient_row
  from public.patients
  where id = token_row.patient_id;

  return jsonb_build_object(
    'verified', true,
    'session_token', raw_session,
    'patient_id', patient_row.id,
    'patient_name', patient_row.first_name || ' ' || patient_row.last_name,
    'expires_at', now() + interval '30 minutes'
  );
end;
$$;

revoke all on function public.verify_patient_portal_access(text, text) from public;
grant execute on function public.verify_patient_portal_access(text, text) to anon, authenticated;

-- Disable the old token-only exchange path so the verification code cannot be
-- bypassed by calling the legacy RPC directly.
revoke all on function public.consume_patient_portal_token(text)
  from public;
revoke execute on function public.consume_patient_portal_token(text)
  from anon, authenticated;

commit;
